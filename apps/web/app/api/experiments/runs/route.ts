import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { createExperimentRun, getExperimentDashboardSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import type { ExperimentModality, ExperimentRunStatus, ExperimentTaskType } from '@/lib/experiments/types';
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
    const selectedRunId = url.searchParams.get('selected_run_id');
    const compareRunIds = url.searchParams.getAll('compare_run_id');
    const limit = Number(url.searchParams.get('limit') ?? '50');

    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const snapshot = await getExperimentDashboardSnapshot(store, actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001', {
        selectedRunId,
        compareRunIds,
        runLimit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 50,
    });

    const response = NextResponse.json({
        snapshot,
        authenticated_user_id: actor?.userId ?? null,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<{
        tenant_id?: string;
        created_by?: string | null;
        run_id?: string;
        experiment_group_id?: string | null;
        sweep_id?: string | null;
        parent_run_id?: string | null;
        baseline_run_id?: string | null;
        task_type?: ExperimentTaskType;
        modality?: ExperimentModality;
        target_type?: string | null;
        model_arch?: string;
        model_size?: string | null;
        model_version?: string | null;
        dataset_name?: string;
        dataset_version?: string | null;
        feature_schema_version?: string | null;
        label_policy_version?: string | null;
        epochs_planned?: number | null;
        epochs_completed?: number | null;
        status?: ExperimentRunStatus;
        status_reason?: string | null;
        progress_percent?: number | null;
        summary_only?: boolean;
        hyperparameters?: Record<string, unknown>;
        dataset_lineage?: Record<string, unknown>;
        config_snapshot?: Record<string, unknown>;
        safety_metrics?: Record<string, unknown>;
        resource_usage?: Record<string, unknown>;
        registry_context?: Record<string, unknown>;
        started_at?: string | null;
        ended_at?: string | null;
    }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: body.data.tenant_id ?? null,
        userIdHint: body.data.created_by ?? null,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    if (!body.data.run_id || !body.data.task_type || !body.data.modality || !body.data.model_arch || !body.data.dataset_name) {
        return NextResponse.json(
            { error: 'run_id, task_type, modality, model_arch, and dataset_name are required', request_id: requestId },
            { status: 400 },
        );
    }

    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const run = await createExperimentRun(store, {
        tenantId: actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        runId: body.data.run_id,
        experimentGroupId: body.data.experiment_group_id ?? null,
        sweepId: body.data.sweep_id ?? null,
        parentRunId: body.data.parent_run_id ?? null,
        baselineRunId: body.data.baseline_run_id ?? null,
        taskType: body.data.task_type,
        modality: body.data.modality,
        targetType: body.data.target_type ?? null,
        modelArch: body.data.model_arch,
        modelSize: body.data.model_size ?? null,
        modelVersion: body.data.model_version ?? null,
        datasetName: body.data.dataset_name,
        datasetVersion: body.data.dataset_version ?? null,
        featureSchemaVersion: body.data.feature_schema_version ?? null,
        labelPolicyVersion: body.data.label_policy_version ?? null,
        epochsPlanned: body.data.epochs_planned ?? null,
        epochsCompleted: body.data.epochs_completed ?? null,
        status: body.data.status ?? 'queued',
        statusReason: body.data.status_reason ?? null,
        progressPercent: body.data.progress_percent ?? 0,
        summaryOnly: body.data.summary_only ?? false,
        createdBy: actor?.userId ?? null,
        hyperparameters: body.data.hyperparameters ?? {},
        datasetLineage: body.data.dataset_lineage ?? {},
        configSnapshot: body.data.config_snapshot ?? {},
        safetyMetrics: body.data.safety_metrics ?? {},
        resourceUsage: body.data.resource_usage ?? {},
        registryContext: body.data.registry_context ?? {},
        startedAt: body.data.started_at ?? null,
        endedAt: body.data.ended_at ?? null,
    });

    const response = NextResponse.json({
        run,
        authenticated_user_id: actor?.userId ?? null,
        auth_mode: actor?.authMode ?? 'dev_bypass',
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
