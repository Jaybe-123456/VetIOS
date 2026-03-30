import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
} from '@/lib/auth/authorization';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { logLearningAuditEvent } from '@/lib/learningEngine/auditLogger';
import { evaluateRollbackGuard, executeRollback } from '@/lib/learningEngine/rollbackGuard';
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

    const adminClient = getSupabaseServer();
    const actor = resolveRequestActor(session);
    const user = session ? (await session.supabase.auth.getUser()).data.user ?? null : null;
    const authContext = buildRouteAuthorizationContext({
        tenantId: actor.tenantId,
        userId: actor.userId,
        authMode: session ? 'session' : 'dev_bypass',
        user,
    });
    if (!isRouteAuthorizationGranted(authContext, 'manage_models')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: 'api/learning/rollback:POST',
            requirement: 'manage_models',
        });
    }

    const body = await safeJson<{
        execute?: boolean;
        reason?: string;
        calibration_failure?: boolean;
        adversarial_failure?: boolean;
        dangerous_false_negative_spike?: boolean;
    }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const store = createSupabaseLearningEngineStore(adminClient);
    const evaluation = await evaluateRollbackGuard(store, actor.tenantId, {
        calibrationFailure: body.data.calibration_failure,
        adversarialFailure: body.data.adversarial_failure,
        dangerousFalseNegativeSpike: body.data.dangerous_false_negative_spike,
    });

    let rollbackEvent = null;
    if (body.data.execute === true && evaluation.should_rollback) {
        rollbackEvent = await executeRollback(store, actor.tenantId, {
            reason: body.data.reason ?? evaluation.reasons.join(' '),
        });
        await logLearningAuditEvent(store, {
            tenantId: actor.tenantId,
            eventType: 'rollback_executed',
            payload: {
                evaluation,
                rollback_event_id: rollbackEvent?.id ?? null,
            },
        });
    }

    const response = NextResponse.json({
        evaluation,
        rollback_event: rollbackEvent,
        authenticated_user_id: actor.userId,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
