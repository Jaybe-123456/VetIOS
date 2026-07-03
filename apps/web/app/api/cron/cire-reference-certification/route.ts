import { NextResponse } from 'next/server';
import { submitReferenceCireCertification } from '@/lib/cire/referenceCertification';
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

    const cronAuth = authorizeCronRequest(req, 'cire-reference-certification');
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
        const certification = await submitReferenceCireCertification(getSupabaseServer(), tenantId);
        const response = NextResponse.json({
            cron: {
                ...buildCronExecutionRecord('cire-reference-certification', cronAuth, requestId),
                schedule: '20 3 * * *',
                tenant_id: tenantId,
                requested_tenant_id: requestedTenantId,
            },
            certification,
            request_id: requestId,
        }, { status: certification.cached ? 200 : 201 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            error: {
                code: 'cire_reference_certification_failed',
                message: error instanceof Error ? error.message : 'Failed to submit reference CIRE certification.',
            },
            cron: {
                ...buildCronExecutionRecord('cire-reference-certification', cronAuth, requestId),
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
