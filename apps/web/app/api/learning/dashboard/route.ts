import { NextResponse } from 'next/server';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getLearningDashboardSnapshot } from '@/lib/learningEngine/performanceDashboard';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const store = createSupabaseLearningEngineStore(getSupabaseServer());
    const snapshot = await getLearningDashboardSnapshot(store, {
        tenantId: actor.tenantId,
    });

    const response = NextResponse.json({
        snapshot,
        authenticated_user_id: actor.userId,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
