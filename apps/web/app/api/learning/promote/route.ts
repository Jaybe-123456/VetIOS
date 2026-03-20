import { NextResponse } from 'next/server';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { logLearningPromotionDecision } from '@/lib/learningEngine/auditLogger';
import { applyPromotionDecisionToRegistry } from '@/lib/learningEngine/modelRegistryConnector';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 5, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const body = await safeJson<{ candidate_model_version?: string }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    if (!body.data.candidate_model_version) {
        return NextResponse.json({ error: 'candidate_model_version is required', request_id: requestId }, { status: 400 });
    }

    const store = createSupabaseLearningEngineStore(getSupabaseServer());
    const entries = await store.listModelRegistryEntries(actor.tenantId);
    const targetEntries = entries.filter((entry) => entry.model_version === body.data.candidate_model_version);

    if (targetEntries.length === 0) {
        return NextResponse.json({ error: 'Candidate model version not found in registry', request_id: requestId }, { status: 404 });
    }

    const updated = await applyPromotionDecisionToRegistry(
        store,
        actor.tenantId,
        targetEntries,
        'promote',
    );

    await logLearningPromotionDecision(store, {
        tenantId: actor.tenantId,
        candidateModelVersion: body.data.candidate_model_version,
        championModelVersion: null,
        decision: 'promote',
        reasons: ['Manual promote requested through Learning Engine API.'],
    });

    const response = NextResponse.json({
        promoted_models: updated,
        authenticated_user_id: actor.userId,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
