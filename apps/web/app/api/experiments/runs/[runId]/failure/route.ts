import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { recordExperimentFailure } from '@/lib/experiments/service';
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
    const failure = await store.getExperimentFailure(
        actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runId,
    );

    if (!failure) {
        return NextResponse.json({ failure: null, request_id: requestId }, { status: 200 });
    }

    const response = NextResponse.json({ failure, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<{
        tenant_id?: string;
        failure_reason?: string;
        failure_epoch?: number | null;
        failure_step?: number | null;
        last_train_loss?: number | null;
        last_val_loss?: number | null;
        last_learning_rate?: number | null;
        last_gradient_norm?: number | null;
        nan_detected?: boolean;
        checkpoint_recovery_attempted?: boolean;
        stack_trace_excerpt?: string | null;
        error_summary?: string | null;
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

    if (!body.data.failure_reason) {
        return NextResponse.json({ error: 'failure_reason is required', request_id: requestId }, { status: 400 });
    }

    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const failure = await recordExperimentFailure(
        store,
        actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runId,
        {
            failureReason: body.data.failure_reason,
            failureEpoch: body.data.failure_epoch ?? null,
            failureStep: body.data.failure_step ?? null,
            lastTrainLoss: body.data.last_train_loss ?? null,
            lastValLoss: body.data.last_val_loss ?? null,
            lastLearningRate: body.data.last_learning_rate ?? null,
            lastGradientNorm: body.data.last_gradient_norm ?? null,
            nanDetected: body.data.nan_detected === true,
            checkpointRecoveryAttempted: body.data.checkpoint_recovery_attempted === true,
            stackTraceExcerpt: body.data.stack_trace_excerpt ?? null,
            errorSummary: body.data.error_summary ?? null,
        },
    );

    const response = NextResponse.json({
        failure,
        auth_mode: actor?.authMode ?? 'dev_bypass',
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
