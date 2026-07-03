import { NextResponse } from 'next/server';
import {
    CIRE_OPERATIONAL_SCHEMA_TARGETS,
    recordCireOperationalProof,
} from '@/lib/cire/operationalProof';
import { submitReferenceCireCertification } from '@/lib/cire/referenceCertification';
import { apiGuard } from '@/lib/http/apiGuard';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CIRE_REFERENCE_CERTIFICATION_JOB = 'cire-reference-certification';
const CIRE_REFERENCE_CERTIFICATION_SCHEDULE = '20 3 * * *';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const cronAuth = authorizeCronRequest(req, CIRE_REFERENCE_CERTIFICATION_JOB);
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
        const certification = await submitReferenceCireCertification(supabase, tenantId);
        const operationalProof = await recordCireOperationalProof(supabase, {
            tenantId,
            requestId,
            proofKind: 'registry_population',
            proofTarget: CIRE_REFERENCE_CERTIFICATION_JOB,
            proofStatus: certification.certification_status === 'passed' && certification.conformance_result === 'passed'
                ? 'succeeded'
                : 'degraded',
            cronJobName: CIRE_REFERENCE_CERTIFICATION_JOB,
            cronSchedule: CIRE_REFERENCE_CERTIFICATION_SCHEDULE,
            cronAuthorizedBy: cronAuth.method,
            startedAt: new Date(startTime),
            completedAt: new Date(),
            latencyMs: Date.now() - startTime,
            recordsProcessed: certification.cached ? 0 : 1,
            schemaTargets: CIRE_OPERATIONAL_SCHEMA_TARGETS,
            blockers: certification.blockers,
            warnings: certification.cached ? ['idempotent_reference_certification_replay'] : [],
            proofPacket: {
                certification_id: certification.certification_id,
                certification_status: certification.certification_status,
                conformance_result: certification.conformance_result,
                conformance_score: certification.conformance_score,
                total_checks: certification.total_checks,
                passed_checks: certification.passed_checks,
                failed_checks: certification.failed_checks,
                public_listing_eligible: certification.public_listing_eligible,
                signed_payload_hash: certification.signed_payload_hash,
                cached: certification.cached,
            },
        }).catch(() => null);

        const response = NextResponse.json({
            cron: {
                ...buildCronExecutionRecord(CIRE_REFERENCE_CERTIFICATION_JOB, cronAuth, requestId),
                schedule: CIRE_REFERENCE_CERTIFICATION_SCHEDULE,
                tenant_id: tenantId,
                requested_tenant_id: requestedTenantId,
            },
            certification,
            operational_proof: operationalProof,
            request_id: requestId,
        }, { status: certification.cached ? 200 : 201 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const operationalProof = await recordCireOperationalProof(getSupabaseServer(), {
            tenantId,
            requestId,
            proofKind: 'cron_execution',
            proofTarget: CIRE_REFERENCE_CERTIFICATION_JOB,
            proofStatus: 'failed',
            cronJobName: CIRE_REFERENCE_CERTIFICATION_JOB,
            cronSchedule: CIRE_REFERENCE_CERTIFICATION_SCHEDULE,
            cronAuthorizedBy: cronAuth.method,
            startedAt: new Date(startTime),
            completedAt: new Date(),
            latencyMs: Date.now() - startTime,
            recordsProcessed: 0,
            schemaTargets: CIRE_OPERATIONAL_SCHEMA_TARGETS,
            blockers: [error instanceof Error ? error.message : 'reference_certification_failed'],
            proofPacket: {
                error_code: 'cire_reference_certification_failed',
            },
        }).catch(() => null);

        const response = NextResponse.json({
            error: {
                code: 'cire_reference_certification_failed',
                message: error instanceof Error ? error.message : 'Failed to submit reference CIRE certification.',
            },
            cron: {
                ...buildCronExecutionRecord(CIRE_REFERENCE_CERTIFICATION_JOB, cronAuth, requestId),
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
