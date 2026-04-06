import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { createPlatformAlert } from '@/lib/platform/alerts';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError, resolveActorTenant } from '@/lib/platform/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const { actor } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:write'],
        });
        const parsed = await safeJson<{
            tenant_id?: string | null;
            type?: string;
            severity?: 'low' | 'medium' | 'high' | 'critical';
            title?: string;
            message?: string;
            metadata?: Record<string, unknown>;
        }>(req);

        if (!parsed.ok) {
            return NextResponse.json(
                { error: parsed.error, request_id: requestId },
                { status: 400 },
            );
        }

        const tenantId = resolveActorTenant(actor, parsed.data.tenant_id ?? null);
        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required to create an alert.');
        }
        if (!parsed.data.type || !parsed.data.title || !parsed.data.message) {
            throw new PlatformAuthError(400, 'invalid_alert', 'type, title, and message are required.');
        }

        const alert = await createPlatformAlert(supabase, {
            tenantId,
            type: parsed.data.type,
            severity: parsed.data.severity ?? 'medium',
            title: parsed.data.title,
            message: parsed.data.message,
            metadata: parsed.data.metadata ?? {},
        });

        const response = NextResponse.json({
            data: alert,
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
                request_id: requestId,
            },
            error: null,
        }, { status: 201 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = error instanceof PlatformRateLimitError
            ? NextResponse.json({
                data: buildRateLimitErrorPayload(error),
                meta: {
                    tenant_id: error.tenantId,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error.code,
                    message: error.message,
                },
            }, { status: error.status })
            : NextResponse.json({
                data: null,
                meta: {
                    tenant_id: null,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error instanceof PlatformAuthError ? error.code : 'alert_create_failed',
                    message: error instanceof Error ? error.message : 'Failed to create alert.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
