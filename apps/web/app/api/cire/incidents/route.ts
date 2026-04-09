import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { listCireIncidents } from '@/lib/cire/engine';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const url = new URL(req.url);
        const requestedTenantId = url.searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['inference:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });
        const resolvedTenantId = tenantId ?? actor.tenantId;
        if (!resolvedTenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const resolvedParam = url.searchParams.get('resolved');
        const incidents = await listCireIncidents(supabase, {
            tenantId: resolvedTenantId,
            resolved: resolvedParam == null ? null : resolvedParam === 'true',
            limit: Number(url.searchParams.get('limit') ?? '20'),
            cursor: url.searchParams.get('cursor'),
        });

        const response = NextResponse.json({
            data: incidents.rows,
            meta: {
                tenant_id: resolvedTenantId,
                timestamp: new Date().toISOString(),
                request_id: requestId,
                next_cursor: incidents.nextCursor,
            },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = error instanceof PlatformRateLimitError
            ? NextResponse.json({
                data: buildRateLimitErrorPayload(error),
                meta: {
                    tenant_id: error.tenantId,
                    timestamp: new Date().toISOString(),
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
                    request_id: requestId,
                },
                error: {
                    code: error instanceof PlatformAuthError ? error.code : 'cire_incidents_failed',
                    message: error instanceof Error ? error.message : 'Failed to load CIRE incidents.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
