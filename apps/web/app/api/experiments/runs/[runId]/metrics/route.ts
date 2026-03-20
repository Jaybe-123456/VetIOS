import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { buildExperimentMetricSeries, logExperimentMetrics } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req);
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const metrics = await store.listExperimentMetrics(
        actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runId,
        2_000,
    );

    const response = NextResponse.json({
        metrics,
        series: buildExperimentMetricSeries(metrics),
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
        metrics?: Array<{
            epoch?: number | null;
            global_step?: number | null;
            train_loss?: number | null;
            val_loss?: number | null;
            train_accuracy?: number | null;
            val_accuracy?: number | null;
            learning_rate?: number | null;
            gradient_norm?: number | null;
            macro_f1?: number | null;
            recall_critical?: number | null;
            calibration_error?: number | null;
            adversarial_score?: number | null;
            false_negative_critical_rate?: number | null;
            dangerous_false_reassurance_rate?: number | null;
            abstain_accuracy?: number | null;
            contradiction_detection_rate?: number | null;
            wall_clock_time_seconds?: number | null;
            steps_per_second?: number | null;
            gpu_utilization?: number | null;
            cpu_utilization?: number | null;
            memory_utilization?: number | null;
            metric_timestamp?: string;
        }>;
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

    if (!body.data.metrics?.length) {
        return NextResponse.json({ error: 'metrics payload is required', request_id: requestId }, { status: 400 });
    }

    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const metrics = await logExperimentMetrics(
        store,
        actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runId,
        body.data.metrics,
    );

    const response = NextResponse.json({
        metrics,
        count: metrics.length,
        auth_mode: actor?.authMode ?? 'dev_bypass',
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
