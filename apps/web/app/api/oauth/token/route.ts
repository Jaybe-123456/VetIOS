import { NextResponse } from 'next/server';
import { issueOAuthClientCredentialsToken, sanitizeOAuthClient } from '@/lib/auth/oauthClientCredentials';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 30,
        windowMs: 60_000,
        maxBodySize: 32 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await readOAuthTokenRequest(req);
    if (body.grant_type !== 'client_credentials') {
        return withHeaders(
            NextResponse.json({
                error: 'unsupported_grant_type',
                error_description: 'VetIOS OAuth v1 supports client_credentials only.',
                request_id: requestId,
            }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const basic = parseBasicClientAuth(req.headers.get('authorization'));
    const clientId = basic?.clientId ?? body.client_id;
    const clientSecret = basic?.clientSecret ?? body.client_secret;
    if (!clientId || !clientSecret) {
        return withHeaders(
            NextResponse.json({
                error: 'invalid_client',
                error_description: 'client_id and client_secret are required.',
                request_id: requestId,
            }, { status: 401 }),
            requestId,
            startTime,
        );
    }

    try {
        const issued = await issueOAuthClientCredentialsToken({
            client: getSupabaseServer(),
            clientId,
            clientSecret,
            requestedScopes: body.scope,
            audience: body.audience,
            req,
        });

        return withHeaders(
            NextResponse.json({
                access_token: issued.accessToken,
                token_type: 'Bearer',
                expires_in: issued.expiresIn,
                scope: issued.token.scopes.join(' '),
                audience: issued.token.audience,
                oauth_client: sanitizeOAuthClient(issued.oauthClient),
                request_id: requestId,
            }),
            requestId,
            startTime,
        );
    } catch (error) {
        return withHeaders(
            NextResponse.json({
                error: 'invalid_client',
                error_description: error instanceof Error ? error.message : 'OAuth token issuance failed.',
                request_id: requestId,
            }, { status: 401 }),
            requestId,
            startTime,
        );
    }
}

async function readOAuthTokenRequest(req: Request): Promise<Record<string, string | null>> {
    const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
        const data = await req.json().catch(() => ({}));
        return mapOAuthRequestRecord(data);
    }

    const text = await req.text();
    return mapOAuthRequestRecord(Object.fromEntries(new URLSearchParams(text)));
}

function mapOAuthRequestRecord(value: unknown): Record<string, string | null> {
    const record = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        grant_type: readText(record.grant_type),
        client_id: readText(record.client_id),
        client_secret: readText(record.client_secret),
        scope: readText(record.scope),
        audience: readText(record.audience),
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

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Pragma', 'no-cache');
    return response;
}
