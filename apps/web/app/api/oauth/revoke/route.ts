import { NextResponse } from 'next/server';
import { authenticateOAuthClientRequest, revokeOAuthAccessToken } from '@/lib/auth/oauthClientCredentials';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 40,
        windowMs: 60_000,
        maxBodySize: 32 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await readOAuthRequest(req);
    const basic = parseBasicClientAuth(req.headers.get('authorization'));
    const clientId = basic?.clientId ?? body.client_id;
    const clientSecret = basic?.clientSecret ?? body.client_secret;
    if ((!body.client_assertion && (!clientId || !clientSecret)) || !body.token) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_client', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }

    const client = getSupabaseServer();
    try {
        const authenticated = await authenticateOAuthClientRequest({
            client,
            clientId,
            clientSecret,
            clientAssertionType: body.client_assertion_type,
            clientAssertion: body.client_assertion,
            expectedAssertionAudiences: buildExpectedOAuthAudiences(req),
            req,
        });
        const result = await revokeOAuthAccessToken({
            client,
            token: body.token,
            authenticatedClientId: authenticated.oauthClient.client_id,
            req,
        });
        return withHeaders(
            NextResponse.json({
                revoked: result.revoked,
                reason: result.reason,
                request_id: requestId,
            }, { status: result.revoked ? 200 : 400 }),
            requestId,
            startTime,
        );
    } catch (error) {
        return withHeaders(
            NextResponse.json({
                error: 'invalid_client',
                error_description: error instanceof Error ? error.message : 'OAuth revocation failed.',
                request_id: requestId,
            }, { status: 401 }),
            requestId,
            startTime,
        );
    }
}

async function readOAuthRequest(req: Request): Promise<Record<string, string | null>> {
    const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
        const data = await req.json().catch(() => ({}));
        return mapRecord(data);
    }
    const text = await req.text();
    return mapRecord(Object.fromEntries(new URLSearchParams(text)));
}

function mapRecord(value: unknown): Record<string, string | null> {
    const record = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        token: readText(record.token),
        client_id: readText(record.client_id),
        client_secret: readText(record.client_secret),
        client_assertion_type: readText(record.client_assertion_type),
        client_assertion: readText(record.client_assertion),
    };
}

function parseBasicClientAuth(value: string | null): { clientId: string; clientSecret: string } | null {
    const encoded = value?.match(/^Basic\s+(.+)$/i)?.[1]?.trim();
    if (!encoded) return null;
    try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator <= 0) return null;
        return {
            clientId: decodeURIComponent(decoded.slice(0, separator)),
            clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
        };
    } catch {
        return null;
    }
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function buildExpectedOAuthAudiences(req: Request): string[] {
    const url = new URL(req.url);
    return [
        url.toString(),
        `${url.origin}${url.pathname}`,
        url.origin,
    ];
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Pragma', 'no-cache');
    return response;
}
