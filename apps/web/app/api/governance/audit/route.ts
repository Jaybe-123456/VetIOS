import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { listGovernanceAuditEvents } from '@/lib/platform/governance';
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
        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { actor } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:read'],
            requestedTenantId: requestedTenantId ?? undefined,
        });

        const limit = Math.max(1, Math.min(Number(new URL(req.url).searchParams.get('limit') ?? '25'), 100));
        const page = new URL(req.url).searchParams.get('page');
        const result = await listGovernanceAuditEvents(supabase, {
            actor,
            tenantId: requestedTenantId,
            cursor: page,
            limit,
        });

        const response = NextResponse.json({
            data: result.rows,
            meta: {
                tenant_id: actor.role === 'system_admin' ? requestedTenantId : actor.tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
                request_id: requestId,
                next_cursor: result.nextCursor,
                limit,
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
                    code: error instanceof PlatformAuthError ? error.code : 'governance_audit_failed',
                    message: error instanceof Error ? error.message : 'Failed to load governance audit log.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
