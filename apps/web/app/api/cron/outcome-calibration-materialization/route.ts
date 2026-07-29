import { NextResponse } from 'next/server';
import { runOutcomeCalibrationMaterialization } from '@/lib/evaluation/outcomeCalibrationMaterializer';
import { apiGuard } from '@/lib/http/apiGuard';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JOB_NAME = 'outcome-calibration-materialization';
const JOB_SCHEDULE = '55 3 * * *';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 5, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const cronAuth = authorizeCronRequest(req, JOB_NAME);

    if (!cronAuth.authorized) {
        const response = NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    if (process.env.VETIOS_OUTCOME_CALIBRATION_ENABLED === 'false') {
        const response = NextResponse.json({
            cron: {
                ...buildCronExecutionRecord(JOB_NAME, cronAuth, requestId),
                schedule: JOB_SCHEDULE,
            },
            skipped: true,
            reason: 'outcome_calibration_materialization_disabled',
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const url = new URL(req.url);
    const requestedTenantId = normalizeText(url.searchParams.get('tenant_id'));
    const tenantId = requestedTenantId
        ?? normalizeText(process.env.VETIOS_PLATFORM_TENANT_ID)
        ?? normalizeText(process.env.VETIOS_PUBLIC_TENANT_ID);

    if (!tenantId) {
        const response = NextResponse.json({
            error: 'tenant_missing',
            message:
                'tenant_id, VETIOS_PLATFORM_TENANT_ID, or VETIOS_PUBLIC_TENANT_ID is required.',
            request_id: requestId,
        }, { status: 400 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    try {
        const execution = await runOutcomeCalibrationMaterialization(
            getSupabaseServer(),
            {
                tenantId,
                requestId,
                mode: 'commit',
                runKind: 'scheduled',
            },
        );
        const response = NextResponse.json({
            cron: {
                ...buildCronExecutionRecord(JOB_NAME, cronAuth, requestId),
                schedule: JOB_SCHEDULE,
                tenant_id: tenantId,
                requested_tenant_id: requestedTenantId,
            },
            data: execution,
            request_id: requestId,
        });
        response.headers.set('Cache-Control', 'no-store');
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            error: 'outcome_calibration_materialization_cron_failed',
            detail: error instanceof Error ? error.message : 'Unknown materialization error.',
            cron: {
                ...buildCronExecutionRecord(JOB_NAME, cronAuth, requestId),
                schedule: JOB_SCHEDULE,
                tenant_id: tenantId,
            },
            request_id: requestId,
        }, { status: 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function normalizeText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}
