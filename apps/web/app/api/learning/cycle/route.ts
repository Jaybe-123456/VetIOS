import { NextResponse } from 'next/server';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { materializeLearningCycleTelemetry } from '@/lib/experiments/learningCycleTelemetry';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { publishFederatedSiteSnapshots } from '@/lib/federation/service';
import { runLearningCycle } from '@/lib/learningEngine/engine';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
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
    const cycles = await store.listLearningCycles(actor.tenantId, 20);

    const response = NextResponse.json({
        cycles,
        authenticated_user_id: actor.userId,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 5, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const bodyResult = await safeJson<{
        cycle_type?: string;
        trigger_mode?: 'scheduled' | 'manual' | 'dry_run';
        dataset_filters?: Record<string, unknown>;
    }>(req);

    if (!bodyResult.ok) {
        return NextResponse.json({ error: bodyResult.error, request_id: requestId }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const store = createSupabaseLearningEngineStore(supabase);
    const result = await runLearningCycle(store, {
        tenantId: actor.tenantId,
        cycleType: isCycleType(bodyResult.data.cycle_type)
            ? bodyResult.data.cycle_type
            : 'manual_review',
        triggerMode: bodyResult.data.trigger_mode ?? 'manual',
        requestPayload: bodyResult.data as Record<string, unknown>,
        datasetFilters: isRecord(bodyResult.data.dataset_filters)
            ? bodyResult.data.dataset_filters
            : undefined,
    });

    let experimentTracking:
        | { status: 'materialized' | 'skipped'; run_ids: string[] }
        | { status: 'failed'; error: string; run_ids: string[] } = {
            status: 'skipped',
            run_ids: [],
        };
    let federation:
        | { status: 'published'; snapshot_ids: string[] }
        | { status: 'skipped'; snapshot_ids: string[] }
        | { status: 'failed'; error: string; snapshot_ids: string[] } = {
            status: 'skipped',
            snapshot_ids: [],
        };

    try {
        experimentTracking = await materializeLearningCycleTelemetry(
            createSupabaseExperimentTrackingStore(supabase),
            {
                tenantId: actor.tenantId,
                actorId: actor.userId,
                result,
            },
        );
    } catch (error) {
        experimentTracking = {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown experiment telemetry bridge error',
            run_ids: [],
        };
    }

    try {
        const snapshots = await publishFederatedSiteSnapshots(supabase, {
            tenantId: actor.tenantId,
            actor: actor.userId,
        });
        federation = snapshots.length > 0
            ? {
                status: 'published',
                snapshot_ids: snapshots.map((snapshot) => snapshot.id),
            }
            : {
                status: 'skipped',
                snapshot_ids: [],
            };
    } catch (error) {
        federation = {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown federation publish error',
            snapshot_ids: [],
        };
    }

    const response = NextResponse.json({
        result,
        experiment_tracking: experimentTracking,
        federation,
        authenticated_user_id: actor.userId,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

function isCycleType(value: unknown): value is
    'daily_dataset_refresh' |
    'daily_calibration_update' |
    'weekly_candidate_training' |
    'weekly_benchmark_run' |
    'manual_review' |
    'rollback_review' {
    return value === 'daily_dataset_refresh' ||
        value === 'daily_calibration_update' ||
        value === 'weekly_candidate_training' ||
        value === 'weekly_benchmark_run' ||
        value === 'manual_review' ||
        value === 'rollback_review';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
