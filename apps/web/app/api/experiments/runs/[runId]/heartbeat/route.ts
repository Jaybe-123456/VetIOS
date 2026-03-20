import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { updateExperimentHeartbeat } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import type { ExperimentRunStatus } from '@/lib/experiments/types';
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
    const run = await store.getExperimentRun(
        actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runId,
    );

    if (!run) {
        return NextResponse.json({ error: 'Experiment run not found', request_id: requestId }, { status: 404 });
    }

    const response = NextResponse.json({
        heartbeat: {
            run_id: run.run_id,
            status: run.status,
            status_reason: run.status_reason,
            progress_percent: run.progress_percent,
            epochs_completed: run.epochs_completed,
            last_heartbeat_at: run.last_heartbeat_at,
            resource_usage: run.resource_usage,
        },
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<{
        tenant_id?: string;
        status?: ExperimentRunStatus;
        status_reason?: string | null;
        progress_percent?: number | null;
        epochs_completed?: number | null;
        resource_usage?: Record<string, unknown>;
        last_heartbeat_at?: string | null;
    }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: body.data.tenant_id ?? null,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const run = await updateExperimentHeartbeat(
        store,
        actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runId,
        {
            status: body.data.status,
            statusReason: body.data.status_reason ?? null,
            progressPercent: body.data.progress_percent ?? null,
            epochsCompleted: body.data.epochs_completed ?? null,
            resourceUsage: body.data.resource_usage,
            lastHeartbeatAt: body.data.last_heartbeat_at ?? null,
        },
    );

    const response = NextResponse.json({
        heartbeat: {
            run_id: run.run_id,
            status: run.status,
            status_reason: run.status_reason,
            progress_percent: run.progress_percent,
            epochs_completed: run.epochs_completed,
            last_heartbeat_at: run.last_heartbeat_at,
            resource_usage: run.resource_usage,
        },
        auth_mode: actor?.authMode ?? 'dev_bypass',
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
