import { NextResponse } from 'next/server';
import { runFederatedCandidateEvidenceSweep } from '@/lib/federation/evidenceGenerator';
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

    const cronAuth = authorizeCronRequest(req, 'federated-candidate-evidence');
    if (!cronAuth.authorized) {
        const response = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const url = new URL(req.url);
    const tenantId = normalizeOptionalText(url.searchParams.get('tenant_id'));
    const federationKey = normalizeOptionalText(url.searchParams.get('federation_key'));
    const limit = normalizePositiveInteger(url.searchParams.get('limit'));
    const force = normalizeBoolean(url.searchParams.get('force')) ?? false;
    const sweep = await runFederatedCandidateEvidenceSweep(getSupabaseServer(), {
        tenantId,
        federationKey,
        limit,
        force,
        actor: 'cron:federated_candidate_evidence',
    });

    const response = NextResponse.json({
        cron: {
            ...buildCronExecutionRecord('federated-candidate-evidence', cronAuth, requestId),
            schedule: '50 2 * * *',
            tenant_id: tenantId,
            federation_key: federationKey,
            force,
        },
        summary: {
            scanned_rounds: sweep.scanned_rounds,
            generated_candidates: sweep.generated_candidates,
            skipped_candidates: sweep.skipped_candidates,
            failed_candidates: sweep.failed_candidates,
        },
        sweep,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

function normalizeOptionalText(value: string | null): string | null {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
}

function normalizePositiveInteger(value: string | null): number | null {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBoolean(value: string | null): boolean | null {
    if (value == null) return null;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return null;
}
