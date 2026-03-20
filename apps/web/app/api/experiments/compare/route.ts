import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getExperimentComparison } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req);
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const url = new URL(req.url);
    const runIds = url.searchParams.getAll('run_id');
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const comparison = await getExperimentComparison(
        store,
        actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runIds,
    );

    const response = NextResponse.json({ comparison, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
