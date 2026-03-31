import type { SupabaseClient } from '@supabase/supabase-js';

const MODEL_EVALUATION_EVENTS_TABLE = 'model_evaluation_events';
const TELEMETRY_EVENTS_TABLE = 'telemetry_events';
const CONTROL_PLANE_ALERTS_TABLE = 'control_plane_alerts';
const ACCURACY_METRICS_TABLE = 'accuracy_metrics';
const DISEASE_PERFORMANCE_TABLE = 'disease_performance';
const FAILURE_EVENTS_TABLE = 'failure_events';
const MEMORY_METRICS_TABLE = 'memory_metrics';

export const ROLLING_ACCURACY_WINDOW_SIZE = 100;
export const DISEASE_PERFORMANCE_WINDOW_SIZE = 250;
export const HOT_RETENTION_HOURS = 24;
export const WARM_RETENTION_DAYS = 7;
export const COLD_RETENTION_DAYS = 30;

const BUFFER_FLUSH_INTERVAL_MS = 1_500;
const BUFFER_BATCH_THRESHOLD = 12;
const MAX_BUFFER_DEPTH = 180;
const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const MEMORY_WARNING_THRESHOLD = 0.8;
const MEMORY_CRITICAL_THRESHOLD = 0.9;
const ACCURACY_DROP_WARNING = 0.08;
const ACCURACY_DROP_CRITICAL = 0.14;
const FAILURE_RATE_WARNING = 0.2;
const FAILURE_RATE_CRITICAL = 0.35;
const ABSTENTION_RATE_WARNING = 0.12;
const ABSTENTION_RATE_CRITICAL = 0.2;
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const LOW_CONFIDENCE_THRESHOLD = 0.55;

const OBSERVABILITY_ALERT_KEYS = [
    'telemetry_memory_pressure',
    'telemetry_accuracy_drop',
    'telemetry_failure_spike',
    'telemetry_abstention_spike',
] as const;

type FailureErrorType = 'wrong_top1' | 'near_miss' | 'abstention_trigger';
type FailureClassification =
    | 'diagnostic_error'
    | 'feature_weighting_error'
    | 'ontology_violation'
    | 'data_sparsity_issue'
    | 'abstention';
type AlertSeverity = 'info' | 'warning' | 'critical';

interface EvaluationRow {
    evaluation_event_id: string;
    inference_event_id: string | null;
    outcome_event_id: string | null;
    model_version: string;
    prediction: string | null;
    prediction_confidence: number | null;
    ground_truth: string | null;
    prediction_correct: boolean | null;
    contradiction_score: number | null;
    evaluation_payload: Record<string, unknown>;
    created_at: string;
}

export interface AccuracyAggregateRow {
    window_id: string;
    top1_accuracy: number | null;
    top3_accuracy: number | null;
    calibration_gap: number | null;
    overconfidence_rate: number | null;
    abstention_rate: number | null;
    sample_size: number;
    metadata: Record<string, unknown>;
    computed_at: string;
}

export interface DiseasePerformanceRow {
    disease_name: string;
    precision: number | null;
    recall: number | null;
    false_positive_rate: number | null;
    false_negative_rate: number | null;
    top1_accuracy: number | null;
    top3_recall: number | null;
    support_n: number;
    misclassification_patterns: Array<{ predicted: string; count: number }>;
    computed_at: string;
}

export interface FailureEventRow {
    id: string;
    predicted: string | null;
    actual: string | null;
    error_type: FailureErrorType;
    severity: AlertSeverity;
    failure_classification: FailureClassification;
    confidence: number | null;
    actual_in_top3: boolean;
    abstained: boolean;
    created_at: string;
    payload: Record<string, unknown>;
}

export interface MemoryMetricRow {
    metric_timestamp: string;
    memory_usage: number | null;
    rss_mb: number | null;
    heap_used_mb: number | null;
    heap_total_mb: number | null;
    external_mb: number | null;
    buffer_size: number;
    log_queue_depth: number;
    retention_tier: string;
    metadata: Record<string, unknown>;
}

interface ObservabilityAlert {
    alert_key: string;
    severity: AlertSeverity;
    title: string;
    message: string;
    node_id: string;
    metadata: Record<string, unknown>;
}

interface QueueOperation {
    table: typeof ACCURACY_METRICS_TABLE | typeof DISEASE_PERFORMANCE_TABLE | typeof FAILURE_EVENTS_TABLE | typeof MEMORY_METRICS_TABLE;
    payload: Record<string, unknown>;
    mode: 'insert' | 'upsert';
    conflict?: string;
}

export interface ObservabilityBufferState {
    buffer_size: number;
    log_queue_depth: number;
    dropped_events: number;
    last_flush_at: string | null;
}

export interface ObservabilitySnapshot {
    latest_accuracy: AccuracyAggregateRow | null;
    disease_performance: DiseasePerformanceRow[];
    recent_failures: FailureEventRow[];
    latest_memory: MemoryMetricRow | null;
    memory_timeline: Array<{ time: string; value: number }>;
    retention_policy: {
        hot_storage: string;
        warm_storage: string;
        cold_storage: string;
    };
    buffer_state: ObservabilityBufferState;
}

export interface RecordInferenceObservabilityInput {
    tenantId: string;
    inferenceEventId: string;
    modelVersion: string;
    observedAt: string;
    outputPayload: Record<string, unknown>;
    confidenceScore: number | null;
    contradictionScore: number | null;
}

export interface RecordOutcomeObservabilityInput {
    tenantId: string;
    inferenceEventId: string;
    outcomeEventId: string;
    evaluationEventId: string;
    modelVersion: string;
    observedAt: string;
    prediction: string | null;
    actual: string | null;
    confidence: number | null;
    contradictionScore: number | null;
    outputPayload: Record<string, unknown>;
    actualOutcome: Record<string, unknown>;
}

let observabilityQueue: QueueOperation[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let inFlightFlush: Promise<void> | null = null;
let lastFlushAt: string | null = null;
let droppedEvents = 0;
const retentionSweepByTenant = new Map<string, number>();

export function getTelemetryBufferState(): ObservabilityBufferState {
    return {
        buffer_size: observabilityQueue.length,
        log_queue_depth: observabilityQueue.length,
        dropped_events: droppedEvents,
        last_flush_at: lastFlushAt,
    };
}

export async function recordInferenceObservability(
    client: SupabaseClient,
    input: RecordInferenceObservabilityInput,
): Promise<void> {
    const memoryPayload = buildMemoryMetricPayload(input.tenantId, input.observedAt, {
        eventType: 'inference',
        modelVersion: input.modelVersion,
        inferenceEventId: input.inferenceEventId,
    }, getTelemetryBufferState());
    const writes: QueueOperation[] = [
        {
            table: MEMORY_METRICS_TABLE,
            mode: 'insert',
            payload: memoryPayload,
        },
    ];

    const abstentionFailure = buildAbstentionFailureEvent(input);
    if (abstentionFailure) {
        writes.push({
            table: FAILURE_EVENTS_TABLE,
            mode: 'upsert',
            conflict: 'event_id',
            payload: abstentionFailure,
        });
    }

    await enqueueObservabilityWrites(client, writes);
    await syncObservabilityAlerts(client, input.tenantId, await buildObservabilityAlerts(client, input.tenantId, {
        memoryMetric: buildMemoryMetricRowFromPayload(memoryPayload),
        latestAccuracy: null,
        recentFailures: abstentionFailure ? [mapFailurePayload(abstentionFailure)] : [],
    }));
    await maybeRunTelemetryRetentionSweep(client, input.tenantId);
}

export async function recordOutcomeObservability(
    client: SupabaseClient,
    input: RecordOutcomeObservabilityInput,
): Promise<void> {
    const [recentEvaluations, previousAccuracy] = await Promise.all([
        loadRecentEvaluations(client, input.tenantId, DISEASE_PERFORMANCE_WINDOW_SIZE),
        loadLatestAccuracyAggregate(client, input.tenantId),
    ]);
    const now = input.observedAt;
    const rollingAggregate = buildRollingAccuracyAggregate(
        input.tenantId,
        input.modelVersion,
        recentEvaluations.slice(0, ROLLING_ACCURACY_WINDOW_SIZE),
        now,
    );
    const diseaseRows = buildDiseasePerformanceRows(input.tenantId, recentEvaluations, now);
    const failurePayload = buildOutcomeFailureEvent(input);
    const memoryPayload = buildMemoryMetricPayload(input.tenantId, input.observedAt, {
        eventType: 'outcome',
        modelVersion: input.modelVersion,
        inferenceEventId: input.inferenceEventId,
        outcomeEventId: input.outcomeEventId,
        evaluationEventId: input.evaluationEventId,
    }, getTelemetryBufferState());

    const writes: QueueOperation[] = [
        {
            table: ACCURACY_METRICS_TABLE,
            mode: 'upsert',
            conflict: 'tenant_id,window_id',
            payload: rollingAggregate,
        },
        ...diseaseRows.map<QueueOperation>((row) => ({
            table: DISEASE_PERFORMANCE_TABLE,
            mode: 'upsert',
            conflict: 'tenant_id,window_id,disease_name',
            payload: row,
        })),
        {
            table: MEMORY_METRICS_TABLE,
            mode: 'insert',
            payload: memoryPayload,
        },
    ];

    if (failurePayload) {
        writes.push({
            table: FAILURE_EVENTS_TABLE,
            mode: 'upsert',
            conflict: 'event_id',
            payload: failurePayload,
        });
    }

    await enqueueObservabilityWrites(client, writes);
    await syncObservabilityAlerts(client, input.tenantId, await buildObservabilityAlerts(client, input.tenantId, {
        memoryMetric: buildMemoryMetricRowFromPayload(memoryPayload),
        latestAccuracy: mapAccuracyRow(rollingAggregate),
        previousAccuracy,
        recentFailures: failurePayload ? [mapFailurePayload(failurePayload)] : [],
    }));
    await maybeRunTelemetryRetentionSweep(client, input.tenantId);
}

export async function loadTelemetryObservabilitySnapshot(
    client: SupabaseClient,
    tenantId: string,
): Promise<ObservabilitySnapshot> {
    const [latestAccuracy, diseasePerformance, recentFailures, latestMemory, memoryTimeline] = await Promise.all([
        loadLatestAccuracyAggregate(client, tenantId),
        loadDiseasePerformanceRows(client, tenantId),
        loadRecentFailureRows(client, tenantId),
        loadLatestMemoryMetric(client, tenantId),
        loadMemoryTimeline(client, tenantId),
    ]);

    return {
        latest_accuracy: latestAccuracy,
        disease_performance: diseasePerformance,
        recent_failures: recentFailures,
        latest_memory: latestMemory,
        memory_timeline: memoryTimeline,
        retention_policy: {
            hot_storage: `Raw telemetry reads kept to ${HOT_RETENTION_HOURS}h hot window.`,
            warm_storage: `Rolling aggregates compressed for ${WARM_RETENTION_DAYS}d in ${ACCURACY_METRICS_TABLE} and ${DISEASE_PERFORMANCE_TABLE}.`,
            cold_storage: `Retention sweeps prune aged telemetry beyond ${COLD_RETENTION_DAYS}d to keep observer memory under control.`,
        },
        buffer_state: getTelemetryBufferState(),
    };
}

export function buildRollingAccuracyAggregate(
    tenantId: string,
    modelVersion: string,
    evaluations: EvaluationRow[],
    computedAt: string,
): Record<string, unknown> {
    const usable = evaluations.filter((row) => row.prediction != null && row.ground_truth != null);
    const sampleSize = usable.length;
    const top1Correct = usable.filter((row) => row.prediction_correct === true).length;
    const top3Correct = usable.filter((row) => actualInTop3(row)).length;
    const meanConfidence = average(usable.map((row) => row.prediction_confidence).filter((value): value is number => value != null));
    const meanCorrectness = average(usable.map((row) => row.prediction_correct === true ? 1 : 0));
    const calibrationGap = meanConfidence == null || meanCorrectness == null
        ? null
        : round(Math.abs(meanConfidence - meanCorrectness));

    return {
        tenant_id: tenantId,
        window_id: `rolling_${ROLLING_ACCURACY_WINDOW_SIZE}`,
        model_version: modelVersion,
        top1_accuracy: sampleSize === 0 ? null : round(top1Correct / sampleSize),
        top3_accuracy: sampleSize === 0 ? null : round(top3Correct / sampleSize),
        calibration_gap: calibrationGap,
        overconfidence_rate: sampleSize === 0
            ? null
            : round(usable.filter((row) => row.prediction_correct === false && (row.prediction_confidence ?? 0) >= HIGH_CONFIDENCE_THRESHOLD).length / sampleSize),
        abstention_rate: sampleSize === 0
            ? null
            : round(usable.filter((row) => evaluationAbstained(row)).length / sampleSize),
        sample_size: sampleSize,
        metadata: {
            window_size: ROLLING_ACCURACY_WINDOW_SIZE,
            wrong_top1_count: usable.filter((row) => row.prediction_correct === false).length,
            near_miss_count: usable.filter((row) => row.prediction_correct === false && actualInTop3(row)).length,
            computed_from: MODEL_EVALUATION_EVENTS_TABLE,
        },
        computed_at: computedAt,
        created_at: computedAt,
        updated_at: computedAt,
    };
}

export function buildDiseasePerformanceRows(
    tenantId: string,
    evaluations: EvaluationRow[],
    computedAt: string,
): Array<Record<string, unknown>> {
    const usable = evaluations.filter((row) => row.prediction != null && row.ground_truth != null);
    const labels = new Set<string>();
    for (const row of usable) {
        if (row.prediction) labels.add(row.prediction);
        if (row.ground_truth) labels.add(row.ground_truth);
    }

    return Array.from(labels)
        .map((diseaseName) => {
            const actualRows = usable.filter((row) => row.ground_truth === diseaseName);
            const predictedRows = usable.filter((row) => row.prediction === diseaseName);
            const truePositive = usable.filter((row) => row.prediction === diseaseName && row.ground_truth === diseaseName).length;
            const falsePositive = predictedRows.length - truePositive;
            const falseNegative = actualRows.length - truePositive;
            const trueNegative = usable.length - truePositive - falsePositive - falseNegative;
            const top3Hits = actualRows.filter((row) => actualInTop3(row)).length;
            const misclassifications = countBy(
                actualRows
                    .filter((row) => row.prediction !== diseaseName && row.prediction != null)
                    .map((row) => row.prediction as string),
            );

            return {
                tenant_id: tenantId,
                window_id: `rolling_${DISEASE_PERFORMANCE_WINDOW_SIZE}`,
                disease_name: diseaseName,
                precision: ratio(truePositive, truePositive + falsePositive),
                recall: ratio(truePositive, truePositive + falseNegative),
                false_positive_rate: ratio(falsePositive, falsePositive + trueNegative),
                false_negative_rate: ratio(falseNegative, truePositive + falseNegative),
                top1_accuracy: ratio(truePositive, actualRows.length),
                top3_recall: ratio(top3Hits, actualRows.length),
                support_n: actualRows.length,
                misclassification_patterns: Array.from(misclassifications.entries())
                    .sort((left, right) => right[1] - left[1])
                    .slice(0, 4)
                    .map(([predicted, count]) => ({ predicted, count })),
                metadata: {
                    window_size: DISEASE_PERFORMANCE_WINDOW_SIZE,
                    predicted_support_n: predictedRows.length,
                    computed_from: MODEL_EVALUATION_EVENTS_TABLE,
                },
                computed_at: computedAt,
                created_at: computedAt,
                updated_at: computedAt,
            };
        })
        .filter((row) => Number(row.support_n) > 0)
        .sort((left, right) => Number(right.support_n) - Number(left.support_n));
}

export function buildOutcomeFailureEvent(
    input: RecordOutcomeObservabilityInput,
): Record<string, unknown> | null {
    if (!input.actual) {
        return null;
    }

    const top3Labels = resolveTopKLabels(input.outputPayload, 3);
    const actualInTop3Match = top3Labels.includes(normalizeLabel(input.actual) ?? '__no_actual__');
    const abstained = booleanOrFalse(input.outputPayload.abstain_recommendation);
    const predictionMatches = normalizeLabel(input.prediction) === normalizeLabel(input.actual);

    if (predictionMatches && !abstained) {
        return null;
    }

    const errorType: FailureErrorType = abstained
        ? 'abstention_trigger'
        : actualInTop3Match
            ? 'near_miss'
            : 'wrong_top1';

    return {
        event_id: `failure_eval_${input.evaluationEventId}`,
        tenant_id: input.tenantId,
        inference_event_id: input.inferenceEventId,
        outcome_event_id: input.outcomeEventId,
        evaluation_event_id: input.evaluationEventId,
        model_version: input.modelVersion,
        predicted: normalizeLabel(input.prediction),
        actual: normalizeLabel(input.actual),
        error_type: errorType,
        severity: classifyFailureSeverity(input.actualOutcome, input.outputPayload, input.confidence),
        failure_classification: classifyFailure({
            errorType,
            prediction: input.prediction,
            actual: input.actual,
            confidence: input.confidence,
            top3Labels,
            contradictionScore: input.contradictionScore,
        }),
        confidence: clampNumber(input.confidence),
        contradiction_score: input.contradictionScore,
        actual_in_top3: actualInTop3Match,
        abstained,
        payload_json: {
            top3_labels: top3Labels,
            abstain_reason: textOrNull(input.outputPayload.abstain_reason),
            contradiction_score: input.contradictionScore,
            diagnosis_feature_importance: asRecord(input.outputPayload.diagnosis_feature_importance),
            severity_feature_importance: asRecord(input.outputPayload.severity_feature_importance),
            feature_mismatch: buildFeatureMismatch(input.outputPayload, input.actual),
        },
        created_at: input.observedAt,
    };
}

export function buildAbstentionFailureEvent(
    input: RecordInferenceObservabilityInput,
): Record<string, unknown> | null {
    if (!booleanOrFalse(input.outputPayload.abstain_recommendation)) {
        return null;
    }

    return {
        event_id: `failure_inference_${input.inferenceEventId}`,
        tenant_id: input.tenantId,
        inference_event_id: input.inferenceEventId,
        outcome_event_id: null,
        evaluation_event_id: null,
        model_version: input.modelVersion,
        predicted: resolveTopKLabels(input.outputPayload, 1)[0] ?? null,
        actual: null,
        error_type: 'abstention_trigger',
        severity: classifyFailureSeverity({}, input.outputPayload, input.confidenceScore),
        failure_classification: 'abstention',
        confidence: clampNumber(input.confidenceScore),
        contradiction_score: input.contradictionScore,
        actual_in_top3: false,
        abstained: true,
        payload_json: {
            top3_labels: resolveTopKLabels(input.outputPayload, 3),
            abstain_reason: textOrNull(input.outputPayload.abstain_reason),
            contradiction_score: input.contradictionScore,
            diagnosis_feature_importance: asRecord(input.outputPayload.diagnosis_feature_importance),
            severity_feature_importance: asRecord(input.outputPayload.severity_feature_importance),
        },
        created_at: input.observedAt,
    };
}

export function resolveTopKLabels(outputPayload: Record<string, unknown>, limit: number): string[] {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const topDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    const labels = topDifferentials
        .map((entry) => normalizeLabel(asRecord(entry).name))
        .filter((value): value is string => value != null);
    if (labels.length === 0) {
        const primary = normalizeLabel(diagnosis.primary_condition_class);
        return primary ? [primary] : [];
    }
    return labels.slice(0, limit);
}

async function loadRecentEvaluations(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<EvaluationRow[]> {
    const { data, error } = await client
        .from(MODEL_EVALUATION_EVENTS_TABLE)
        .select('evaluation_event_id,inference_event_id,outcome_event_id,model_version,prediction,prediction_confidence,ground_truth,prediction_correct,contradiction_score,evaluation_payload,created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to load recent evaluations: ${error.message}`);
    }

    return ((data ?? []) as Record<string, unknown>[]).map(mapEvaluationRow);
}

async function loadLatestAccuracyAggregate(
    client: SupabaseClient,
    tenantId: string,
): Promise<AccuracyAggregateRow | null> {
    const { data, error } = await client
        .from(ACCURACY_METRICS_TABLE)
        .select('window_id,top1_accuracy,top3_accuracy,calibration_gap,overconfidence_rate,abstention_rate,sample_size,metadata,computed_at')
        .eq('tenant_id', tenantId)
        .eq('window_id', `rolling_${ROLLING_ACCURACY_WINDOW_SIZE}`)
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !data) {
        return null;
    }

    return mapAccuracyRow(data as Record<string, unknown>);
}

async function loadDiseasePerformanceRows(
    client: SupabaseClient,
    tenantId: string,
): Promise<DiseasePerformanceRow[]> {
    const { data, error } = await client
        .from(DISEASE_PERFORMANCE_TABLE)
        .select('disease_name,precision,recall,false_positive_rate,false_negative_rate,top1_accuracy,top3_recall,support_n,misclassification_patterns,computed_at')
        .eq('tenant_id', tenantId)
        .eq('window_id', `rolling_${DISEASE_PERFORMANCE_WINDOW_SIZE}`)
        .order('support_n', { ascending: false })
        .limit(10);

    if (error) {
        return [];
    }

    return ((data ?? []) as Record<string, unknown>[]).map(mapDiseasePerformanceRow);
}

async function loadRecentFailureRows(
    client: SupabaseClient,
    tenantId: string,
): Promise<FailureEventRow[]> {
    const { data, error } = await client
        .from(FAILURE_EVENTS_TABLE)
        .select('id,predicted,actual,error_type,severity,failure_classification,confidence,actual_in_top3,abstained,payload_json,created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(8);

    if (error) {
        return [];
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: textOrNull(row.id) ?? randomId(),
        predicted: normalizeLabel(row.predicted),
        actual: normalizeLabel(row.actual),
        error_type: resolveFailureErrorType(row.error_type),
        severity: resolveAlertSeverity(row.severity),
        failure_classification: resolveFailureClassification(row.failure_classification),
        confidence: numberOrNull(row.confidence),
        actual_in_top3: booleanOrFalse(row.actual_in_top3),
        abstained: booleanOrFalse(row.abstained),
        payload: asRecord(row.payload_json),
        created_at: textOrNull(row.created_at) ?? new Date().toISOString(),
    }));
}

async function loadLatestMemoryMetric(
    client: SupabaseClient,
    tenantId: string,
): Promise<MemoryMetricRow | null> {
    const { data, error } = await client
        .from(MEMORY_METRICS_TABLE)
        .select('metric_timestamp,memory_usage,rss_mb,heap_used_mb,heap_total_mb,external_mb,buffer_size,log_queue_depth,retention_tier,metadata')
        .eq('tenant_id', tenantId)
        .order('metric_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !data) {
        return null;
    }

    return buildMemoryMetricRowFromPayload(data as Record<string, unknown>);
}

async function loadMemoryTimeline(
    client: SupabaseClient,
    tenantId: string,
): Promise<Array<{ time: string; value: number }>> {
    const { data, error } = await client
        .from(MEMORY_METRICS_TABLE)
        .select('metric_timestamp,memory_usage')
        .eq('tenant_id', tenantId)
        .order('metric_timestamp', { ascending: false })
        .limit(40);

    if (error) {
        return [];
    }

    return ((data ?? []) as Record<string, unknown>[])
        .slice()
        .reverse()
        .map((row) => ({
            time: formatChartTime(textOrNull(row.metric_timestamp) ?? new Date().toISOString()),
            value: numberOrNull(row.memory_usage) ?? 0,
        }));
}

async function buildObservabilityAlerts(
    client: SupabaseClient,
    tenantId: string,
    input: {
        memoryMetric: MemoryMetricRow | null;
        latestAccuracy: AccuracyAggregateRow | null;
        previousAccuracy?: AccuracyAggregateRow | null;
        recentFailures: FailureEventRow[];
    },
): Promise<ObservabilityAlert[]> {
    const alerts: ObservabilityAlert[] = [];
    const previousAccuracy = input.previousAccuracy ?? await loadLatestAccuracyAggregate(client, tenantId);

    if (input.memoryMetric?.memory_usage != null && input.memoryMetric.memory_usage >= MEMORY_WARNING_THRESHOLD) {
        const severity: AlertSeverity = input.memoryMetric.memory_usage >= MEMORY_CRITICAL_THRESHOLD ? 'critical' : 'warning';
        alerts.push({
            alert_key: 'telemetry_memory_pressure',
            severity,
            title: 'Telemetry Memory Pressure',
            message: `Memory usage is ${formatPercent(input.memoryMetric.memory_usage)} with queue depth ${input.memoryMetric.log_queue_depth}.`,
            node_id: 'telemetry_observer',
            metadata: {
                metric: 'memory_usage',
                value: input.memoryMetric.memory_usage,
                buffer_size: input.memoryMetric.buffer_size,
                queue_depth: input.memoryMetric.log_queue_depth,
            },
        });
    }

    if (input.latestAccuracy && previousAccuracy && previousAccuracy.top1_accuracy != null && input.latestAccuracy.top1_accuracy != null) {
        const delta = previousAccuracy.top1_accuracy - input.latestAccuracy.top1_accuracy;
        if (delta >= ACCURACY_DROP_WARNING) {
            alerts.push({
                alert_key: 'telemetry_accuracy_drop',
                severity: delta >= ACCURACY_DROP_CRITICAL ? 'critical' : 'warning',
                title: 'Rolling Accuracy Drop',
                message: `Rolling top-1 accuracy dropped by ${formatPercent(delta)} to ${formatPercent(input.latestAccuracy.top1_accuracy)} over ${input.latestAccuracy.sample_size} cases.`,
                node_id: 'outcome_feedback',
                metadata: {
                    metric: 'rolling_top1_accuracy',
                    previous: previousAccuracy.top1_accuracy,
                    current: input.latestAccuracy.top1_accuracy,
                    delta,
                },
            });
        }
    }

    if (input.latestAccuracy) {
        const wrongTop1 = numberOrNull(input.latestAccuracy.metadata.wrong_top1_count) ?? 0;
        const nearMiss = numberOrNull(input.latestAccuracy.metadata.near_miss_count) ?? 0;
        const failureRate = input.latestAccuracy.sample_size > 0
            ? (wrongTop1 + nearMiss) / input.latestAccuracy.sample_size
            : 0;
        if (failureRate >= FAILURE_RATE_WARNING) {
            alerts.push({
                alert_key: 'telemetry_failure_spike',
                severity: failureRate >= FAILURE_RATE_CRITICAL ? 'critical' : 'warning',
                title: 'Failure Telemetry Spike',
                message: `Wrong top-1 plus near-miss rate reached ${formatPercent(failureRate)} across the rolling outcome-linked window.`,
                node_id: 'outcome_feedback',
                metadata: {
                    metric: 'failure_rate',
                    wrong_top1_count: wrongTop1,
                    near_miss_count: nearMiss,
                    sample_size: input.latestAccuracy.sample_size,
                },
            });
        }

        if ((input.latestAccuracy.abstention_rate ?? 0) >= ABSTENTION_RATE_WARNING) {
            alerts.push({
                alert_key: 'telemetry_abstention_spike',
                severity: (input.latestAccuracy.abstention_rate ?? 0) >= ABSTENTION_RATE_CRITICAL ? 'critical' : 'warning',
                title: 'Abstention Spike',
                message: `Abstention rate is ${formatPercent(input.latestAccuracy.abstention_rate)} in the rolling evaluation window.`,
                node_id: 'diagnostics_model',
                metadata: {
                    metric: 'abstention_rate',
                    value: input.latestAccuracy.abstention_rate,
                    sample_size: input.latestAccuracy.sample_size,
                },
            });
        }
    }

    return alerts;
}

async function syncObservabilityAlerts(
    client: SupabaseClient,
    tenantId: string,
    alerts: ObservabilityAlert[],
): Promise<void> {
    try {
        if (alerts.length > 0) {
            await client
                .from(CONTROL_PLANE_ALERTS_TABLE)
                .upsert(alerts.map((alert) => ({
                    alert_key: alert.alert_key,
                    tenant_id: tenantId,
                    severity: alert.severity,
                    title: alert.title,
                    message: alert.message,
                    node_id: alert.node_id,
                    resolved: false,
                    resolved_at: null,
                    metadata: {
                        ...alert.metadata,
                        category: 'observability',
                    },
                })), {
                    onConflict: 'tenant_id,alert_key',
                });
        }

        const { data, error } = await client
            .from(CONTROL_PLANE_ALERTS_TABLE)
            .select('id,alert_key')
            .eq('tenant_id', tenantId)
            .eq('resolved', false)
            .in('alert_key', [...OBSERVABILITY_ALERT_KEYS]);

        if (error) return;

        const activeKeys = new Set(alerts.map((alert) => alert.alert_key));
        const staleIds = ((data ?? []) as Record<string, unknown>[])
            .filter((row) => !activeKeys.has(textOrNull(row.alert_key) ?? ''))
            .map((row) => textOrNull(row.id))
            .filter((value): value is string => value != null);

        if (staleIds.length > 0) {
            await client
                .from(CONTROL_PLANE_ALERTS_TABLE)
                .update({
                    resolved: true,
                    resolved_at: new Date().toISOString(),
                })
                .in('id', staleIds);
        }
    } catch {
        // Observability alerts are best effort.
    }
}

async function maybeRunTelemetryRetentionSweep(
    client: SupabaseClient,
    tenantId: string,
): Promise<void> {
    const nowMs = Date.now();
    const lastSweep = retentionSweepByTenant.get(tenantId) ?? 0;
    if (nowMs - lastSweep < RETENTION_SWEEP_INTERVAL_MS) return;
    retentionSweepByTenant.set(tenantId, nowMs);

    const coldCutoff = new Date(nowMs - COLD_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await Promise.allSettled([
        client.from(MEMORY_METRICS_TABLE).delete().eq('tenant_id', tenantId).lt('metric_timestamp', coldCutoff),
        client.from(FAILURE_EVENTS_TABLE).delete().eq('tenant_id', tenantId).lt('created_at', coldCutoff),
        client.from(ACCURACY_METRICS_TABLE).delete().eq('tenant_id', tenantId).lt('computed_at', coldCutoff),
        client.from(DISEASE_PERFORMANCE_TABLE).delete().eq('tenant_id', tenantId).lt('computed_at', coldCutoff),
        client.from(TELEMETRY_EVENTS_TABLE).delete().eq('tenant_id', tenantId).lt('timestamp', coldCutoff),
    ]);
}

async function enqueueObservabilityWrites(
    client: SupabaseClient,
    writes: QueueOperation[],
): Promise<void> {
    observabilityQueue.push(...writes);
    applyBackpressure();

    if (observabilityQueue.length >= BUFFER_BATCH_THRESHOLD) {
        await flushObservabilityBuffer(client);
        return;
    }

    if (!flushTimer) {
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void flushObservabilityBuffer(client);
        }, BUFFER_FLUSH_INTERVAL_MS);
    }
}

async function flushObservabilityBuffer(client: SupabaseClient): Promise<void> {
    if (inFlightFlush) {
        await inFlightFlush;
        return;
    }
    if (observabilityQueue.length === 0) return;

    const batch = observabilityQueue.splice(0, observabilityQueue.length);
    inFlightFlush = (async () => {
        try {
            const grouped = new Map<string, QueueOperation[]>();
            for (const operation of batch) {
                const key = `${operation.table}:${operation.mode}:${operation.conflict ?? ''}`;
                const existing = grouped.get(key) ?? [];
                existing.push(operation);
                grouped.set(key, existing);
            }

            for (const operations of grouped.values()) {
                const first = operations[0];
                if (!first) continue;
                const rows = operations.map((operation) => operation.payload);
                if (first.mode === 'insert') {
                    await client.from(first.table).insert(rows);
                } else {
                    await client.from(first.table).upsert(rows, { onConflict: first.conflict });
                }
            }

            lastFlushAt = new Date().toISOString();
        } catch (error) {
            const message = error instanceof Error ? error.message.toLowerCase() : '';
            if (message.includes('does not exist') || message.includes('relation')) {
                droppedEvents += batch.length;
                observabilityQueue = observabilityQueue.slice(0, MAX_BUFFER_DEPTH);
                return;
            }
            observabilityQueue = [...batch, ...observabilityQueue].slice(0, MAX_BUFFER_DEPTH);
        } finally {
            inFlightFlush = null;
        }
    })();

    await inFlightFlush;
}

function applyBackpressure() {
    if (observabilityQueue.length <= MAX_BUFFER_DEPTH) return;

    const overflow = observabilityQueue.length - MAX_BUFFER_DEPTH;
    let removed = 0;
    observabilityQueue = observabilityQueue.filter((operation) => {
        if (removed >= overflow) return true;
        if (operation.table === FAILURE_EVENTS_TABLE) return true;
        removed += 1;
        droppedEvents += 1;
        return false;
    });

    if (observabilityQueue.length > MAX_BUFFER_DEPTH) {
        const hardOverflow = observabilityQueue.length - MAX_BUFFER_DEPTH;
        observabilityQueue.splice(0, hardOverflow);
        droppedEvents += hardOverflow;
    }
}

function buildMemoryMetricPayload(
    tenantId: string,
    observedAt: string,
    metadata: Record<string, unknown>,
    bufferState: ObservabilityBufferState,
): Record<string, unknown> {
    const memory = process.memoryUsage();
    const heapRatio = memory.heapTotal > 0 ? memory.heapUsed / memory.heapTotal : null;
    return {
        tenant_id: tenantId,
        metric_timestamp: observedAt,
        memory_usage: clampNumber(heapRatio),
        rss_mb: bytesToMb(memory.rss),
        heap_used_mb: bytesToMb(memory.heapUsed),
        heap_total_mb: bytesToMb(memory.heapTotal),
        external_mb: bytesToMb(memory.external),
        buffer_size: bufferState.buffer_size,
        log_queue_depth: bufferState.log_queue_depth,
        retention_tier: resolveRetentionTier(observedAt),
        metadata: {
            ...metadata,
            dropped_events: bufferState.dropped_events,
            last_flush_at: bufferState.last_flush_at,
        },
        created_at: observedAt,
    };
}

function buildMemoryMetricRowFromPayload(payload: Record<string, unknown>): MemoryMetricRow {
    return {
        metric_timestamp: textOrNull(payload.metric_timestamp) ?? new Date().toISOString(),
        memory_usage: numberOrNull(payload.memory_usage),
        rss_mb: numberOrNull(payload.rss_mb),
        heap_used_mb: numberOrNull(payload.heap_used_mb),
        heap_total_mb: numberOrNull(payload.heap_total_mb),
        external_mb: numberOrNull(payload.external_mb),
        buffer_size: integerOrZero(payload.buffer_size),
        log_queue_depth: integerOrZero(payload.log_queue_depth),
        retention_tier: textOrNull(payload.retention_tier) ?? 'hot',
        metadata: asRecord(payload.metadata),
    };
}

function buildFeatureMismatch(
    outputPayload: Record<string, unknown>,
    actualDiagnosis: string,
): Record<string, unknown> {
    const diagnosisFeatureImportance = Object.entries(asRecord(outputPayload.diagnosis_feature_importance))
        .map(([feature, weight]) => ({
            feature,
            weight: numberOrNull(weight) ?? 0,
        }))
        .sort((left, right) => right.weight - left.weight)
        .slice(0, 5);

    return {
        target_condition: normalizeLabel(actualDiagnosis),
        dominant_features: diagnosisFeatureImportance,
        abstain_reason: textOrNull(outputPayload.abstain_reason),
        contradiction_reasons: Array.isArray(outputPayload.contradiction_reasons)
            ? outputPayload.contradiction_reasons
            : [],
    };
}

function classifyFailure(input: {
    errorType: FailureErrorType;
    prediction: string | null;
    actual: string | null;
    confidence: number | null;
    top3Labels: string[];
    contradictionScore: number | null;
}): FailureClassification {
    if (input.errorType === 'abstention_trigger') return 'abstention';
    if (!input.prediction || /unknown|syndrome|mechanical emergency/i.test(input.prediction)) {
        return 'ontology_violation';
    }
    if ((input.contradictionScore ?? 0) >= 0.65 || input.top3Labels.includes(normalizeLabel(input.actual) ?? '__no_actual__')) {
        return 'feature_weighting_error';
    }
    if ((input.confidence ?? 0) <= LOW_CONFIDENCE_THRESHOLD || input.top3Labels.length < 2) {
        return 'data_sparsity_issue';
    }
    return 'diagnostic_error';
}

function classifyFailureSeverity(
    actualOutcome: Record<string, unknown>,
    outputPayload: Record<string, unknown>,
    confidence: number | null,
): AlertSeverity {
    const actualLevel = normalizeLabel(actualOutcome.emergency_level);
    const predictedLevel = normalizeLabel(asRecord(outputPayload.risk_assessment).emergency_level);
    if (actualLevel === 'critical' || predictedLevel === 'critical' || (confidence ?? 0) >= HIGH_CONFIDENCE_THRESHOLD) {
        return 'critical';
    }
    if (actualLevel === 'high' || predictedLevel === 'high') {
        return 'warning';
    }
    return 'info';
}

function actualInTop3(row: EvaluationRow): boolean {
    if (row.prediction_correct === true) return true;
    return row.ground_truth != null && readTop3Labels(row.evaluation_payload).includes(row.ground_truth);
}

function evaluationAbstained(row: EvaluationRow): boolean {
    return booleanOrFalse(row.evaluation_payload.abstain);
}

function readTop3Labels(payload: Record<string, unknown>): string[] {
    const raw = Array.isArray(payload.top3_labels) ? payload.top3_labels : [];
    return raw
        .map((value) => normalizeLabel(value))
        .filter((value): value is string => value != null)
        .slice(0, 3);
}

function mapEvaluationRow(row: Record<string, unknown>): EvaluationRow {
    return {
        evaluation_event_id: textOrNull(row.evaluation_event_id) ?? randomId(),
        inference_event_id: textOrNull(row.inference_event_id),
        outcome_event_id: textOrNull(row.outcome_event_id),
        model_version: textOrNull(row.model_version) ?? 'unknown',
        prediction: normalizeLabel(row.prediction),
        prediction_confidence: numberOrNull(row.prediction_confidence),
        ground_truth: normalizeLabel(row.ground_truth),
        prediction_correct: booleanOrNull(row.prediction_correct),
        contradiction_score: numberOrNull(row.contradiction_score),
        evaluation_payload: asRecord(row.evaluation_payload),
        created_at: textOrNull(row.created_at) ?? new Date().toISOString(),
    };
}

function mapAccuracyRow(row: Record<string, unknown>): AccuracyAggregateRow {
    return {
        window_id: textOrNull(row.window_id) ?? `rolling_${ROLLING_ACCURACY_WINDOW_SIZE}`,
        top1_accuracy: numberOrNull(row.top1_accuracy),
        top3_accuracy: numberOrNull(row.top3_accuracy),
        calibration_gap: numberOrNull(row.calibration_gap),
        overconfidence_rate: numberOrNull(row.overconfidence_rate),
        abstention_rate: numberOrNull(row.abstention_rate),
        sample_size: integerOrZero(row.sample_size),
        metadata: asRecord(row.metadata),
        computed_at: textOrNull(row.computed_at) ?? new Date().toISOString(),
    };
}

function mapDiseasePerformanceRow(row: Record<string, unknown>): DiseasePerformanceRow {
    return {
        disease_name: textOrNull(row.disease_name) ?? 'Unknown',
        precision: numberOrNull(row.precision),
        recall: numberOrNull(row.recall),
        false_positive_rate: numberOrNull(row.false_positive_rate),
        false_negative_rate: numberOrNull(row.false_negative_rate),
        top1_accuracy: numberOrNull(row.top1_accuracy),
        top3_recall: numberOrNull(row.top3_recall),
        support_n: integerOrZero(row.support_n),
        misclassification_patterns: Array.isArray(row.misclassification_patterns)
            ? row.misclassification_patterns
                .map((entry) => {
                    const record = asRecord(entry);
                    const predicted = normalizeLabel(record.predicted);
                    return predicted ? { predicted, count: integerOrZero(record.count) } : null;
                })
                .filter((value): value is { predicted: string; count: number } => value != null)
            : [],
        computed_at: textOrNull(row.computed_at) ?? new Date().toISOString(),
    };
}

function mapFailurePayload(payload: Record<string, unknown>): FailureEventRow {
    return {
        id: textOrNull(payload.event_id) ?? randomId(),
        predicted: normalizeLabel(payload.predicted),
        actual: normalizeLabel(payload.actual),
        error_type: resolveFailureErrorType(payload.error_type),
        severity: resolveAlertSeverity(payload.severity),
        failure_classification: resolveFailureClassification(payload.failure_classification),
        confidence: numberOrNull(payload.confidence),
        actual_in_top3: booleanOrFalse(payload.actual_in_top3),
        abstained: booleanOrFalse(payload.abstained),
        payload: asRecord(payload.payload_json),
        created_at: textOrNull(payload.created_at) ?? new Date().toISOString(),
    };
}

function resolveFailureErrorType(value: unknown): FailureErrorType {
    if (value === 'near_miss' || value === 'abstention_trigger') {
        return value;
    }
    return 'wrong_top1';
}

function resolveFailureClassification(value: unknown): FailureClassification {
    if (
        value === 'feature_weighting_error'
        || value === 'ontology_violation'
        || value === 'data_sparsity_issue'
        || value === 'abstention'
    ) {
        return value;
    }
    return 'diagnostic_error';
}

function resolveAlertSeverity(value: unknown): AlertSeverity {
    if (value === 'warning' || value === 'critical') {
        return value;
    }
    return 'info';
}

function ratio(numerator: number, denominator: number): number | null {
    if (denominator <= 0) return null;
    return round(numerator / denominator);
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function countBy(values: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
}

function resolveRetentionTier(timestamp: string): string {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    if (ageMs <= HOT_RETENTION_HOURS * 60 * 60 * 1000) return 'hot';
    if (ageMs <= WARM_RETENTION_DAYS * 24 * 60 * 60 * 1000) return 'warm';
    return 'cold';
}

function clampNumber(value: unknown): number | null {
    const num = numberOrNull(value);
    if (num == null) return null;
    return Math.max(0, Math.min(1, num));
}

function normalizeLabel(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerOrZero(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function textOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function booleanOrFalse(value: unknown): boolean {
    return value === true;
}

function bytesToMb(value: number): number {
    return round(value / (1024 * 1024));
}

function round(value: number): number {
    return Number(value.toFixed(4));
}

function formatPercent(value: number | null): string {
    if (value == null) return 'NO DATA';
    return `${(value * 100).toFixed(1)}%`;
}

function formatChartTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function randomId(): string {
    return `obs_${Math.random().toString(36).slice(2, 10)}`;
}
