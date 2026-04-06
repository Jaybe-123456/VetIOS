import type { SupabaseClient } from '@supabase/supabase-js';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { collectClinicalDatasetDebugSnapshot } from '@/lib/dataset/clinicalDatasetDiagnostics';
import { createPlatformAlert } from '@/lib/platform/alerts';
import { recordPlatformTelemetry } from '@/lib/platform/telemetry';
import { dispatchWebhookEvent } from '@/lib/platform/webhooks';
import type {
    DatasetSnapshotRecord,
    EvaluationRecord,
    OutcomeRecord,
    PlatformActor,
} from '@/lib/platform/types';

type InferenceFlywheelInput = {
    actor: PlatformActor;
    tenantId: string;
    inferenceEventId: string;
    modelName: string;
    modelVersion: string;
    outputPayload: Record<string, unknown>;
    rawOutput: string;
    confidenceScore: number | null;
    latencyMs: number;
    tokenCountInput: number;
    tokenCountOutput: number;
    flagged: boolean;
    blocked: boolean;
    flagReason?: string | null;
    pipelineId?: string;
    metadata?: Record<string, unknown>;
};

type DriftDetectionResult = {
    tenant_id: string;
    model_version: string;
    current_mean: number | null;
    baseline_mean: number | null;
    baseline_stddev: number | null;
    delta: number | null;
    drift_detected: boolean;
    snapshot_window_start: string;
    snapshot_window_end: string;
};

declare global {
    // eslint-disable-next-line no-var
    var __vetiosPlatformJobsStarted: boolean | undefined;
    // eslint-disable-next-line no-var
    var __vetiosOrphanMonitorPromise: Promise<void> | null | undefined;
    // eslint-disable-next-line no-var
    var __vetiosDriftMonitorPromise: Promise<void> | null | undefined;
}

const ORPHAN_AGE_MS = 5 * 60 * 1000;
const ORPHAN_MONITOR_INTERVAL_MS = 60 * 1000;
const DRIFT_MONITOR_INTERVAL_MS = 60 * 60 * 1000;

export async function runInferenceFlywheel(
    client: SupabaseClient,
    input: InferenceFlywheelInput,
) {
    const outcome = await ensureOutcomeRecord(client, {
        tenantId: input.tenantId,
        inferenceEventId: input.inferenceEventId,
        rawOutput: input.rawOutput,
        metadata: {
            ...(input.metadata ?? {}),
            auto_created: true,
            flag_reason: input.flagReason ?? null,
            source: 'auto_flywheel',
        },
    }).catch(async (error) => {
        await markInferenceAsOrphaned(client, {
            tenantId: input.tenantId,
            inferenceEventId: input.inferenceEventId,
            reason: error instanceof Error ? error.message : 'Outcome creation failed.',
        });
        throw error;
    });

    const evaluation = await ensureEvaluationForOutcome(client, {
        actor: input.actor,
        tenantId: input.tenantId,
        outcomeId: outcome.id,
        inferenceEventId: input.inferenceEventId,
        modelName: input.modelName,
        modelVersion: input.modelVersion,
        outputPayload: input.outputPayload,
        confidenceScore: input.confidenceScore,
        trigger: 'evaluation',
    }).catch(async (error) => {
        await client
            .from('outcomes')
            .update({ status: 'failed' })
            .eq('tenant_id', input.tenantId)
            .eq('id', outcome.id);

        await incrementOrphanCounter(client, input.tenantId);

        await createPlatformAlert(client, {
            tenantId: input.tenantId,
            type: 'evaluation_failed',
            severity: 'high',
            title: 'Automatic evaluation failed',
            message: error instanceof Error ? error.message : 'Failed to score the automatic evaluation.',
            metadata: {
                inference_event_id: input.inferenceEventId,
                outcome_id: outcome.id,
            },
        });

        await dispatchWebhookEvent(client, {
            tenantId: input.tenantId,
            eventType: 'evaluation.failed',
            payload: {
                inference_event_id: input.inferenceEventId,
                outcome_id: outcome.id,
                error: error instanceof Error ? error.message : 'Automatic evaluation failed.',
            },
        }).catch((dispatchError) => {
            console.error('[platform] evaluation.failed webhook dispatch failed:', dispatchError);
        });

        throw error;
    });

    await client
        .from('outcomes')
        .update({ status: 'scored' })
        .eq('tenant_id', input.tenantId)
        .eq('id', outcome.id);

    await recordPlatformTelemetry(client, {
        telemetry_key: `inference:${input.inferenceEventId}`,
        inference_event_id: input.inferenceEventId,
        tenant_id: input.tenantId,
        pipeline_id: input.pipelineId ?? 'inference',
        model_version: input.modelVersion,
        latency_ms: input.latencyMs,
        token_count_input: input.tokenCountInput,
        token_count_output: input.tokenCountOutput,
        outcome_linked: true,
        evaluation_score: evaluation.score,
        flagged: input.flagged,
        blocked: input.blocked,
        timestamp: new Date().toISOString(),
        metadata: {
            outcome_id: outcome.id,
            evaluation_id: evaluation.id,
            flag_reason: input.flagReason ?? null,
        },
    });

    await dispatchWebhookEvent(client, {
        tenantId: input.tenantId,
        eventType: 'inference.completed',
        payload: {
            inference_event_id: input.inferenceEventId,
            outcome_id: outcome.id,
            evaluation_id: evaluation.id,
            model_version: input.modelVersion,
            score: evaluation.score,
        },
    }).catch((error) => {
        console.error('[platform] inference.completed webhook dispatch failed:', error);
    });

    return {
        outcome,
        evaluation,
    };
}

export async function ensureOutcomeRecord(
    client: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        rawOutput: string;
        metadata?: Record<string, unknown>;
    },
) {
    const { data: existing, error: existingError } = await client
        .from('outcomes')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .eq('inference_event_id', input.inferenceEventId)
        .maybeSingle();

    if (existingError) {
        throw new Error(`Failed to look up outcome record: ${existingError.message}`);
    }

    if (existing) {
        return existing as OutcomeRecord;
    }

    const { data, error } = await client
        .from('outcomes')
        .insert({
            tenant_id: input.tenantId,
            inference_event_id: input.inferenceEventId,
            status: 'pending',
            raw_output: input.rawOutput,
            metadata: input.metadata ?? {},
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create outcome record: ${error?.message ?? 'Unknown error'}`);
    }

    return data as OutcomeRecord;
}

export async function ensureEvaluationForOutcome(
    client: SupabaseClient,
    input: {
        actor: PlatformActor;
        tenantId: string;
        outcomeId: string;
        inferenceEventId: string;
        modelName: string;
        modelVersion: string;
        outputPayload: Record<string, unknown>;
        confidenceScore: number | null;
        trigger: 'evaluation' | 'backfill';
    },
) {
    const { data: existing, error: existingError } = await client
        .from('evaluations')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .eq('outcome_id', input.outcomeId)
        .maybeSingle();

    if (existingError) {
        throw new Error(`Failed to look up evaluation record: ${existingError.message}`);
    }

    if (existing) {
        return existing as EvaluationRecord;
    }

    const { data: outcome, error: outcomeError } = await client
        .from('outcomes')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .eq('id', input.outcomeId)
        .single();

    if (outcomeError || !outcome) {
        throw new Error(`Outcome record not found for evaluation: ${outcomeError?.message ?? 'Unknown error'}`);
    }

    const recentEvaluations = await getRecentEvaluations(
        client,
        input.tenantId,
        input.modelName,
        20,
    );
    const resolvedInferenceEventId = readText(input.inferenceEventId)
        ?? readText((outcome as Record<string, unknown>).inference_event_id);

    if (!resolvedInferenceEventId) {
        throw new Error('Outcome record is missing its linked inference_event_id.');
    }

    const legacyEvaluation = await createEvaluationEvent(client, {
        tenant_id: input.tenantId,
        trigger_type: input.trigger === 'backfill' ? 'outcome' : 'inference',
        inference_event_id: resolvedInferenceEventId,
        model_name: input.modelName,
        model_version: input.modelVersion,
        predicted_confidence: input.confidenceScore ?? undefined,
        predicted_output: input.outputPayload,
        actual_outcome: tryParseRawJson(String((outcome as Record<string, unknown>).raw_output ?? '')),
        recent_evaluations: recentEvaluations,
    });

    const score = resolveEvaluationScore(legacyEvaluation);
    const datasetSnapshot = await ensureDatasetSnapshot(client, {
        tenantId: input.tenantId,
        trigger: input.trigger,
        actorUserId: input.actor.userId,
    });

    const { data, error } = await client
        .from('evaluations')
        .insert({
            tenant_id: input.tenantId,
            outcome_id: input.outcomeId,
            inference_event_id: resolvedInferenceEventId,
            model_version: input.modelVersion,
            score,
            scorer: 'auto',
            dataset_version: datasetSnapshot?.version ?? null,
            evaluated_at: new Date().toISOString(),
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create platform evaluation: ${error?.message ?? 'Unknown error'}`);
    }

    const evaluation = data as EvaluationRecord;
    await recordPlatformTelemetry(client, {
        telemetry_key: `evaluation:${input.outcomeId}`,
        inference_event_id: resolvedInferenceEventId,
        tenant_id: input.tenantId,
        pipeline_id: input.trigger === 'backfill' ? 'evaluation-backfill' : 'evaluation',
        model_version: input.modelVersion,
        latency_ms: 0,
        token_count_input: 0,
        token_count_output: 0,
        outcome_linked: true,
        evaluation_score: evaluation.score,
        flagged: false,
        blocked: false,
        timestamp: evaluation.evaluated_at,
        metadata: {
            outcome_id: input.outcomeId,
            evaluation_id: evaluation.id,
            dataset_version: evaluation.dataset_version,
        },
    });

    await dispatchWebhookEvent(client, {
        tenantId: input.tenantId,
        eventType: 'evaluation.scored',
        payload: {
            inference_event_id: resolvedInferenceEventId,
            outcome_id: input.outcomeId,
            evaluation_id: evaluation.id,
            score: evaluation.score,
            dataset_version: evaluation.dataset_version,
            model_version: input.modelVersion,
        },
    }).catch((error) => {
        console.error('[platform] evaluation.scored webhook dispatch failed:', error);
    });

    return evaluation;
}

export async function ensureDatasetSnapshot(
    client: SupabaseClient,
    input: {
        tenantId: string;
        trigger: 'evaluation' | 'backfill' | 'manual';
        actorUserId: string | null;
    },
) {
    const rowCount = await getDatasetRowCount(client, input.tenantId, input.actorUserId);
    const latest = await getLatestDatasetSnapshot(client, input.tenantId);

    if (latest && latest.row_count === rowCount) {
        return latest;
    }

    const version = (latest?.version ?? 0) + 1;
    const { data, error } = await client
        .from('dataset_snapshots')
        .insert({
            tenant_id: input.tenantId,
            version,
            row_count: rowCount,
            trigger: input.trigger,
            snapshot_at: new Date().toISOString(),
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create dataset snapshot: ${error?.message ?? 'Unknown error'}`);
    }

    return data as DatasetSnapshotRecord;
}

export async function listDatasetSnapshots(
    client: SupabaseClient,
    tenantId: string,
) {
    const { data, error } = await client
        .from('dataset_snapshots')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('version', { ascending: false });

    if (error) {
        throw new Error(`Failed to list dataset snapshots: ${error.message}`);
    }

    return (data ?? []) as DatasetSnapshotRecord[];
}

export async function getDatasetRowCount(
    client: SupabaseClient,
    tenantId: string,
    userId: string | null,
) {
    const snapshot = await collectClinicalDatasetDebugSnapshot(client, tenantId, userId);
    return snapshot.dataset_row_count;
}

export async function getOrphanCounter(
    client: SupabaseClient,
    tenantId: string,
) {
    const { data, error } = await client
        .from('orphan_event_counters')
        .select('count')
        .eq('tenant_id', tenantId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load orphan counter: ${error.message}`);
    }

    return Number((data as Record<string, unknown> | null)?.count ?? 0);
}

export async function incrementOrphanCounter(
    client: SupabaseClient,
    tenantId: string,
) {
    const current = await getOrphanCounter(client, tenantId);
    const nextCount = current + 1;
    const { error } = await client
        .from('orphan_event_counters')
        .upsert({
            tenant_id: tenantId,
            count: nextCount,
            last_orphan_at: new Date().toISOString(),
        }, {
            onConflict: 'tenant_id',
        });

    if (error) {
        throw new Error(`Failed to increment orphan counter: ${error.message}`);
    }

    return nextCount;
}

async function getLatestDatasetSnapshot(
    client: SupabaseClient,
    tenantId: string,
) {
    const { data, error } = await client
        .from('dataset_snapshots')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load latest dataset snapshot: ${error.message}`);
    }

    return (data ?? null) as DatasetSnapshotRecord | null;
}

function resolveEvaluationScore(evaluation: Awaited<ReturnType<typeof createEvaluationEvent>>) {
    if (evaluation.outcome_alignment_delta != null) {
        return clampScore(1 - evaluation.outcome_alignment_delta);
    }
    if (evaluation.calibration_error != null) {
        return clampScore(1 - evaluation.calibration_error);
    }
    if (evaluation.calibrated_confidence != null) {
        return clampScore(evaluation.calibrated_confidence);
    }
    if (evaluation.prediction_confidence != null) {
        return clampScore(evaluation.prediction_confidence);
    }
    return 0.5;
}

function clampScore(value: number) {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function tryParseRawJson(value: string) {
    if (!value || value.trim().length === 0) {
        return {};
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

export function startPlatformBackgroundJobs(client: SupabaseClient) {
    if (globalThis.__vetiosPlatformJobsStarted) {
        return;
    }

    globalThis.__vetiosPlatformJobsStarted = true;

    setInterval(() => {
        if (globalThis.__vetiosOrphanMonitorPromise) {
            return;
        }

        globalThis.__vetiosOrphanMonitorPromise = runOrphanMonitor(client)
            .catch((error) => {
                console.error('[platform] orphan monitor failed:', error);
            })
            .finally(() => {
                globalThis.__vetiosOrphanMonitorPromise = null;
            });
    }, ORPHAN_MONITOR_INTERVAL_MS);

    setInterval(() => {
        if (globalThis.__vetiosDriftMonitorPromise) {
            return;
        }

        globalThis.__vetiosDriftMonitorPromise = runDriftDetection(client)
            .then(() => undefined)
            .catch((error) => {
                console.error('[platform] drift monitor failed:', error);
            })
            .finally(() => {
                globalThis.__vetiosDriftMonitorPromise = null;
            });
    }, DRIFT_MONITOR_INTERVAL_MS);
}

export async function runOrphanMonitor(client: SupabaseClient) {
    const threshold = new Date(Date.now() - ORPHAN_AGE_MS).toISOString();
    const [{ data: outcomes, error: outcomesError }, { data, error }] = await Promise.all([
        client
            .from('outcomes')
            .select('inference_event_id'),
        client
            .from('ai_inference_events')
            .select('id,tenant_id,created_at,output_payload,model_name,model_version,confidence_score')
            .lt('created_at', threshold)
            .eq('blocked', false)
            .eq('orphaned', false),
    ]);

    if (outcomesError) {
        throw new Error(`Failed to load linked outcomes during orphan scan: ${outcomesError.message}`);
    }

    if (error) {
        throw new Error(`Failed to scan for orphaned inference events: ${error.message}`);
    }

    const linkedInferenceIds = new Set(
        (outcomes ?? [])
            .map((row) => readText((row as Record<string, unknown>).inference_event_id))
            .filter((value): value is string => value != null),
    );

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const inferenceEventId = String(row.id);
        const tenantId = String(row.tenant_id);
        if (linkedInferenceIds.has(inferenceEventId)) {
            continue;
        }

        await markInferenceAsOrphaned(client, {
            tenantId,
            inferenceEventId,
            reason: 'No linked outcome was created within 5 minutes.',
        });

        await backfillInferenceEvaluation(client, {
            actor: {
                userId: 'system',
                tenantId,
                role: 'system_admin',
                authMode: 'jwt',
                scopes: ['*'],
                tenantScope: tenantId,
            },
            tenantId,
            inferenceEventId,
        });
    }

    await emitOrphanRateAlerts(client);
}

export async function backfillInferenceEvaluation(
    client: SupabaseClient,
    input: {
        actor: PlatformActor;
        tenantId: string;
        inferenceEventId?: string | null;
    },
) {
    const query = client
        .from('ai_inference_events')
        .select('id,tenant_id,model_name,model_version,output_payload,confidence_score,blocked')
        .eq('tenant_id', input.tenantId)
        .eq('blocked', false)
        .order('created_at', { ascending: false })
        .limit(input.inferenceEventId ? 1 : 50);

    const filteredQuery = input.inferenceEventId
        ? query.eq('id', input.inferenceEventId)
        : query;

    const { data, error } = await filteredQuery;
    if (error) {
        throw new Error(`Failed to load inference events for backfill: ${error.message}`);
    }

    const results: EvaluationRecord[] = [];
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const inferenceEventId = String(row.id);
        const outcome = await ensureOutcomeRecord(client, {
            tenantId: input.tenantId,
            inferenceEventId,
            rawOutput: JSON.stringify((row.output_payload as Record<string, unknown> | null) ?? {}),
            metadata: {
                auto_created: true,
                source: 'backfill',
            },
        });

        const evaluation = await ensureEvaluationForOutcome(client, {
            actor: input.actor,
            tenantId: input.tenantId,
            outcomeId: outcome.id,
            inferenceEventId,
            modelName: readText(row.model_name) ?? 'unknown-model',
            modelVersion: readText(row.model_version) ?? 'unknown-version',
            outputPayload: asRecord(row.output_payload),
            confidenceScore: readNumber(row.confidence_score),
            trigger: 'backfill',
        });
        results.push(evaluation);
    }

    return results;
}

export async function markInferenceAsOrphaned(
    client: SupabaseClient,
    input: {
        tenantId: string;
        inferenceEventId: string;
        reason: string;
    },
) {
    const { data: existing, error: existingError } = await client
        .from('ai_inference_events')
        .select('id,orphaned')
        .eq('tenant_id', input.tenantId)
        .eq('id', input.inferenceEventId)
        .maybeSingle();

    if (existingError) {
        throw new Error(`Failed to load inference event for orphan marking: ${existingError.message}`);
    }

    if (!existing) {
        return;
    }

    const wasAlreadyOrphaned = existing.orphaned === true;
    if (!wasAlreadyOrphaned) {
        const { error } = await client
            .from('ai_inference_events')
            .update({
                orphaned: true,
                orphaned_at: new Date().toISOString(),
                blocked_reason: input.reason,
            })
            .eq('tenant_id', input.tenantId)
            .eq('id', input.inferenceEventId);

        if (error) {
            throw new Error(`Failed to mark inference event as orphaned: ${error.message}`);
        }

        await incrementOrphanCounter(client, input.tenantId);
    }

    await createPlatformAlert(client, {
        tenantId: input.tenantId,
        type: 'orphan_detected',
        severity: 'high',
        title: 'Orphan inference detected',
        message: input.reason,
        metadata: {
            inference_event_id: input.inferenceEventId,
        },
    });

    await recordPlatformTelemetry(client, {
        telemetry_key: `orphan:${input.tenantId}:${input.inferenceEventId}`,
        inference_event_id: input.inferenceEventId,
        tenant_id: input.tenantId,
        pipeline_id: 'orphan-monitor',
        model_version: 'platform',
        latency_ms: 0,
        token_count_input: 0,
        token_count_output: 0,
        outcome_linked: false,
        evaluation_score: null,
        flagged: true,
        blocked: false,
        timestamp: new Date().toISOString(),
        metadata: {
            reason: input.reason,
        },
    });

    await dispatchWebhookEvent(client, {
        tenantId: input.tenantId,
        eventType: 'orphan.detected',
        payload: {
            inference_event_id: input.inferenceEventId,
            reason: input.reason,
        },
    }).catch((error) => {
        console.error('[platform] orphan.detected webhook dispatch failed:', error);
    });
}

export async function runDriftDetection(client: SupabaseClient) {
    const now = new Date();
    const windowEnd = now.toISOString();
    const currentStart = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
    const baselineStart = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString();
    const snapshotWindowStart = new Date(now.getTime() - DRIFT_MONITOR_INTERVAL_MS).toISOString();
    const results: DriftDetectionResult[] = [];

    const { data: tenants, error: tenantsError } = await client
        .from('evaluations')
        .select('tenant_id,model_version');

    if (tenantsError) {
        throw new Error(`Failed to load evaluation tenants for drift detection: ${tenantsError.message}`);
    }

    const uniquePairs = new Map<string, { tenantId: string; modelVersion: string }>();
    for (const row of (tenants ?? []) as Array<Record<string, unknown>>) {
        const tenantId = readText(row.tenant_id);
        const modelVersion = readText(row.model_version);
        if (!tenantId || !modelVersion) {
            continue;
        }
        uniquePairs.set(`${tenantId}:${modelVersion}`, { tenantId, modelVersion });
    }

    for (const { tenantId, modelVersion } of uniquePairs.values()) {
        const currentScores = await listEvaluationScores(client, tenantId, modelVersion, currentStart, windowEnd);
        const baselineScores = await listEvaluationScores(client, tenantId, modelVersion, baselineStart, windowEnd);
        const currentMean = mean(currentScores);
        const baselineMean = mean(baselineScores);
        const baselineStddev = standardDeviation(baselineScores, baselineMean);
        const delta = currentMean != null && baselineMean != null
            ? Number((currentMean - baselineMean).toFixed(4))
            : null;
        const driftDetected = currentMean != null
            && baselineMean != null
            && baselineStddev != null
            && currentMean < (baselineMean - baselineStddev);

        const result = {
            tenant_id: tenantId,
            model_version: modelVersion,
            current_mean: currentMean,
            baseline_mean: baselineMean,
            baseline_stddev: baselineStddev,
            delta,
            drift_detected: driftDetected,
            snapshot_window_start: snapshotWindowStart,
            snapshot_window_end: windowEnd,
        } satisfies DriftDetectionResult;

        await upsertDriftSnapshot(client, result);
        results.push(result);

        if (driftDetected) {
            await createPlatformAlert(client, {
                tenantId,
                type: 'behavioral_drift',
                severity: 'high',
                title: 'Behavioral drift detected',
                message: `Model ${modelVersion} fell more than one standard deviation below its 7-day baseline.`,
                metadata: result,
            });

            await dispatchWebhookEvent(client, {
                tenantId,
                eventType: 'drift.detected',
                payload: result,
            }).catch((error) => {
                console.error('[platform] drift.detected webhook dispatch failed:', error);
            });
        }
    }

    return results;
}

async function emitOrphanRateAlerts(client: SupabaseClient) {
    const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000)).toISOString();
    const { data, error } = await client
        .from('ai_inference_events')
        .select('tenant_id,orphaned,created_at')
        .gte('created_at', oneHourAgo);

    if (error) {
        throw new Error(`Failed to compute orphan rate: ${error.message}`);
    }

    const stats = new Map<string, { total: number; orphaned: number }>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const tenantId = readText(row.tenant_id);
        if (!tenantId) {
            continue;
        }
        const bucket = stats.get(tenantId) ?? { total: 0, orphaned: 0 };
        bucket.total += 1;
        if (row.orphaned === true) {
            bucket.orphaned += 1;
        }
        stats.set(tenantId, bucket);
    }

    for (const [tenantId, bucket] of stats) {
        if (bucket.total === 0) {
            continue;
        }

        const rate = bucket.orphaned / bucket.total;
        if (rate <= 0.01) {
            continue;
        }

        await createPlatformAlert(client, {
            tenantId,
            type: 'orphan_rate_threshold',
            severity: 'critical',
            title: 'Orphan rate exceeded threshold',
            message: `Orphan rate reached ${(rate * 100).toFixed(2)}% in the last hour.`,
            metadata: {
                orphaned: bucket.orphaned,
                total: bucket.total,
                rate,
            },
        });
    }
}

async function listEvaluationScores(
    client: SupabaseClient,
    tenantId: string,
    modelVersion: string,
    start: string,
    end: string,
) {
    const { data, error } = await client
        .from('evaluations')
        .select('score')
        .eq('tenant_id', tenantId)
        .eq('model_version', modelVersion)
        .gte('evaluated_at', start)
        .lte('evaluated_at', end);

    if (error) {
        throw new Error(`Failed to load evaluation scores: ${error.message}`);
    }

    return (data ?? [])
        .map((row) => readNumber((row as Record<string, unknown>).score))
        .filter((value): value is number => value != null);
}

async function upsertDriftSnapshot(
    client: SupabaseClient,
    result: DriftDetectionResult,
) {
    const { error } = await client
        .from('drift_snapshots')
        .upsert({
            tenant_id: result.tenant_id,
            model_version: result.model_version,
            current_mean: result.current_mean,
            baseline_mean: result.baseline_mean,
            baseline_stddev: result.baseline_stddev,
            delta: result.delta,
            drift_detected: result.drift_detected,
            snapshot_window_start: result.snapshot_window_start,
            snapshot_window_end: result.snapshot_window_end,
            metadata: {},
        }, {
            onConflict: 'tenant_id,model_version,snapshot_window_start',
        });

    if (error) {
        throw new Error(`Failed to upsert drift snapshot: ${error.message}`);
    }
}

function mean(values: number[]) {
    if (values.length === 0) {
        return null;
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    return Number((total / values.length).toFixed(4));
}

function standardDeviation(values: number[], providedMean: number | null) {
    if (values.length < 2 || providedMean == null) {
        return null;
    }

    const variance = values.reduce((sum, value) => sum + ((value - providedMean) ** 2), 0) / values.length;
    return Number(Math.sqrt(variance).toFixed(4));
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
