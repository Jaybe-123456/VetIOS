import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { startCireCalibration } from '@/lib/cire/engine';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['simulation:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });
        const resolvedTenantId = tenantId ?? actor.tenantId;
        if (!resolvedTenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const calibration = await startCireCalibration(supabase, {
            actor,
            tenantId: resolvedTenantId,
        });

        const response = NextResponse.json({
            data: calibration,
            meta: {
                tenant_id: resolvedTenantId,
                timestamp: new Date().toISOString(),
                request_id: requestId,
                simulation_id: calibration.simulation_id,
            },
            error: null,
        }, { status: 202 });
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
                    code: error instanceof PlatformAuthError ? error.code : 'cire_calibration_failed',
                    message: error instanceof Error ? error.message : 'Failed to start CIRE calibration.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
