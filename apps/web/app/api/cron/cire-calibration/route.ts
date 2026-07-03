import { NextResponse } from 'next/server';
import { startCireCalibration } from '@/lib/cire/engine';
import { apiGuard } from '@/lib/http/apiGuard';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const cronAuth = authorizeCronRequest(req, 'cire-calibration');
    if (!cronAuth.authorized) {
        const response = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const url = new URL(req.url);
    const requestedTenantId = normalizeOptionalText(url.searchParams.get('tenant_id'));
    const tenantId = requestedTenantId
        ?? normalizeOptionalText(process.env.VETIOS_PLATFORM_TENANT_ID ?? null)
        ?? normalizeOptionalText(process.env.VETIOS_PUBLIC_TENANT_ID ?? null);

    if (!tenantId) {
        const response = NextResponse.json({
            error: 'tenant_missing',
            message: 'tenant_id, VETIOS_PLATFORM_TENANT_ID, or VETIOS_PUBLIC_TENANT_ID is required.',
            request_id: requestId,
        }, { status: 400 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    try {
        const calibration = await startCireCalibration(getSupabaseServer(), {
            actor: {
                userId: 'cron:cire_calibration',
                tenantId,
                scopes: ['simulation:write', 'cire:calibrate'],
                role: 'system_admin',
                authMode: 'service_account',
                tenantScope: tenantId,
            },
            tenantId,
        });

        const response = NextResponse.json({
            cron: {
                ...buildCronExecutionRecord('cire-calibration', cronAuth, requestId),
                schedule: '15 3 * * *',
                tenant_id: tenantId,
                requested_tenant_id: requestedTenantId,
            },
            calibration,
            request_id: requestId,
        }, { status: 202 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            error: {
                code: 'cire_calibration_cron_failed',
                message: error instanceof Error ? error.message : 'Failed to start CIRE calibration cron.',
            },
            cron: {
                ...buildCronExecutionRecord('cire-calibration', cronAuth, requestId),
                tenant_id: tenantId,
            },
            request_id: requestId,
        }, { status: 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function normalizeOptionalText(value: string | null): string | null {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
}
