import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { resolveSessionTenant } from '@/lib/supabaseServer';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { runClinicalDrugReasoner } from '@/lib/drugInteraction/clinicalDrugReasoner';
import type { ClinicalDrugReasonerInput } from '@/lib/drugInteraction/clinicalDrugReasoner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);

    const bodyResult = await safeJson<ClinicalDrugReasonerInput>(req);
    if (!bodyResult.ok) {
        return NextResponse.json({ error: bodyResult.error, request_id: requestId }, { status: 400 });
    }

    const body = bodyResult.data;

    if (!body.species || !body.proposedDrug) {
        return NextResponse.json({
            error: 'species and proposedDrug are required',
            request_id: requestId,
        }, { status: 422 });
    }

    if (!body.conditions) body.conditions = [];
    if (!body.currentMedications) body.currentMedications = [];

    try {
        const result = await runClinicalDrugReasoner(body);

        const response = NextResponse.json({
            request_id: requestId,
            tenant_id: actor.tenantId,
            ...result,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[drug/check] error:', message);
        return NextResponse.json({
            error: 'Drug reasoning failed',
            detail: message,
            request_id: requestId,
        }, { status: 500 });
    }
}