import { NextResponse } from 'next/server';
import { startCireCalibration } from '@/lib/cire/engine';
import {
    CIRE_OPERATIONAL_SCHEMA_TARGETS,
    recordCireOperationalProof,
} from '@/lib/cire/operationalProof';
import { apiGuard } from '@/lib/http/apiGuard';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CIRE_CALIBRATION_JOB = 'cire-calibration';
const CIRE_CALIBRATION_SCHEDULE = '15 3 * * *';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const cronAuth = authorizeCronRequest(req, CIRE_CALIBRATION_JOB);
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
        const supabase = getSupabaseServer();
        const calibration = await startCireCalibration(supabase, {
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
        const operationalProof = await recordCireOperationalProof(supabase, {
            tenantId,
            requestId,
            proofKind: 'calibration_execution',
            proofTarget: CIRE_CALIBRATION_JOB,
            proofStatus: 'succeeded',
            cronJobName: CIRE_CALIBRATION_JOB,
            cronSchedule: CIRE_CALIBRATION_SCHEDULE,
            cronAuthorizedBy: cronAuth.method,
            startedAt: new Date(startTime),
            completedAt: new Date(),
            latencyMs: Date.now() - startTime,
            recordsProcessed: 1,
            schemaTargets: CIRE_OPERATIONAL_SCHEMA_TARGETS,
            proofPacket: {
                simulation_id: calibration.simulation_id,
                estimated_duration_seconds: calibration.estimated_duration_seconds,
                calibration_mode: 'adversarial',
            },
        }).catch(() => null);

        const response = NextResponse.json({
            cron: {
                ...buildCronExecutionRecord(CIRE_CALIBRATION_JOB, cronAuth, requestId),
                schedule: CIRE_CALIBRATION_SCHEDULE,
                tenant_id: tenantId,
                requested_tenant_id: requestedTenantId,
            },
            calibration,
            operational_proof: operationalProof,
            request_id: requestId,
        }, { status: 202 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const operationalProof = await recordCireOperationalProof(getSupabaseServer(), {
            tenantId,
            requestId,
            proofKind: 'calibration_execution',
            proofTarget: CIRE_CALIBRATION_JOB,
            proofStatus: 'failed',
            cronJobName: CIRE_CALIBRATION_JOB,
            cronSchedule: CIRE_CALIBRATION_SCHEDULE,
            cronAuthorizedBy: cronAuth.method,
            startedAt: new Date(startTime),
            completedAt: new Date(),
            latencyMs: Date.now() - startTime,
            recordsProcessed: 0,
            schemaTargets: CIRE_OPERATIONAL_SCHEMA_TARGETS,
            blockers: [error instanceof Error ? error.message : 'cire_calibration_failed'],
            proofPacket: {
                error_code: 'cire_calibration_cron_failed',
            },
        }).catch(() => null);

        const response = NextResponse.json({
            error: {
                code: 'cire_calibration_cron_failed',
                message: error instanceof Error ? error.message : 'Failed to start CIRE calibration cron.',
            },
            cron: {
                ...buildCronExecutionRecord(CIRE_CALIBRATION_JOB, cronAuth, requestId),
                tenant_id: tenantId,
            },
            operational_proof: operationalProof,
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
