import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { backfillSummaryExperimentRuns } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req);
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    await backfillSummaryExperimentRuns(store, tenantId);
    const registry = await store.getExperimentRegistryLink(tenantId, runId);

    const response = NextResponse.json({ registry, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
