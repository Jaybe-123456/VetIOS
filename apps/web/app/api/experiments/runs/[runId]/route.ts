import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getExperimentRunDetail, updateExperimentHeartbeat } from '@/lib/experiments/service';
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

    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const detail = await getExperimentRunDetail(store, actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001', runId);

    if (!detail) {
        return NextResponse.json({ error: 'Experiment run not found', request_id: requestId }, { status: 404 });
    }

    const response = NextResponse.json({
        detail,
        authenticated_user_id: actor?.userId ?? null,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function PATCH(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as {
        status?: import('@/lib/experiments/types').ExperimentRunStatus;
        status_reason?: string | null;
        progress_percent?: number | null;
        epochs_completed?: number | null;
        resource_usage?: Record<string, unknown>;
    };
    const { runId } = await context.params;

    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const run = await updateExperimentHeartbeat(
        store,
        actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runId,
        {
            status: body.status,
            statusReason: body.status_reason ?? null,
            progressPercent: body.progress_percent ?? null,
            epochsCompleted: body.epochs_completed ?? null,
            resourceUsage: body.resource_usage,
        },
    );

    const response = NextResponse.json({
        run,
        authenticated_user_id: actor?.userId ?? null,
        auth_mode: actor?.authMode ?? 'dev_bypass',
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
