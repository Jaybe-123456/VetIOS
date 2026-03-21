import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TELEMETRY_EVENTS } from '@/lib/db/schemaContracts';
import type {
    TelemetryChartPoint,
    TelemetryEventRecord,
    TelemetryLogEntry,
    TelemetryMetricsPayload,
    TelemetrySnapshot,
    TelemetrySystemPayload,
} from '@/lib/telemetry/types';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_STALE_MS = 30 * 1000;
export const TELEMETRY_HEARTBEAT_INTERVAL_MS = 15 * 1000;
const LATENCY_ANOMALY_MS = 5_000;
const MIN_OUTCOMES_FOR_DRIFT = 2;
const MAX_EVENTS_PER_WINDOW = 5_000;
const MAX_LOGS = 16;
const SYNTHETIC_DIAGNOSES = [
    'Parvovirus',
    'Pancreatitis',
    'Otitis externa',
    'Feline asthma',
    'Renal insufficiency',
];

export interface EmitTelemetryEventInput {
    event_id: string;
    tenant_id: string;
    linked_event_id?: string | null;
    source_id?: string | null;
    source_table?: string | null;
    event_type: TelemetryEventRecord['event_type'];
    timestamp?: string;
    model_version: string;
    run_id: string;
    metrics?: TelemetryMetricsPayload;
    system?: TelemetrySystemPayload;
    metadata?: Record<string, unknown>;
}

export interface TelemetryExecutionSample {
    startedAtMs: number;
    cpuUsage: NodeJS.CpuUsage;
}

export async function emitTelemetryEvent(
    client: SupabaseClient,
    input: EmitTelemetryEventInput,
): Promise<TelemetryEventRecord> {
    const C = TELEMETRY_EVENTS.COLUMNS;
    const eventTimestamp = input.timestamp ?? new Date().toISOString();
    const latency = numberOrNull(input.metrics?.latency_ms);
    const anomaly = latency != null && latency > LATENCY_ANOMALY_MS;

    const payload = {
        [C.event_id]: input.event_id,
        [C.tenant_id]: input.tenant_id,
        [C.linked_event_id]: input.linked_event_id ?? null,
        [C.source_id]: input.source_id ?? null,
        [C.source_table]: textOrNull(input.source_table),
        [C.event_type]: input.event_type,
        [C.timestamp]: eventTimestamp,
        [C.model_version]: input.model_version,
        [C.run_id]: input.run_id,
        [C.metrics]: {
            latency_ms: latency,
            confidence: numberOrNull(input.metrics?.confidence),
            prediction: textOrNull(input.metrics?.prediction),
            ground_truth: textOrNull(input.metrics?.ground_truth),
            correct: booleanOrNull(input.metrics?.correct),
        },
        [C.system]: {
            cpu: numberOrNull(input.system?.cpu),
            gpu: numberOrNull(input.system?.gpu),
            memory: numberOrNull(input.system?.memory),
        },
        [C.metadata]: {
            ...(input.metadata ?? {}),
            anomaly,
            excluded_from_p95: anomaly,
        },
    };

    const { data, error } = await client
        .from(TELEMETRY_EVENTS.TABLE)
        .upsert(payload, { onConflict: C.event_id })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to emit telemetry event: ${error?.message ?? 'Unknown error'}`);
    }

    return mapTelemetryEventRow(data);
}

export async function getTelemetrySnapshot(
    client: SupabaseClient,
    tenantId: string,
): Promise<TelemetrySnapshot> {
    const C = TELEMETRY_EVENTS.COLUMNS;
    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

    const { data, error } = await client
        .from(TELEMETRY_EVENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .gte(C.timestamp, windowStart)
        .order(C.timestamp, { ascending: false })
        .limit(MAX_EVENTS_PER_WINDOW);

    if (error) {
        throw new Error(`Failed to load telemetry events: ${error.message}`);
    }

    const events = (data ?? [])
        .slice()
        .reverse()
        .map(mapTelemetryEventRow);
    return buildTelemetrySnapshot(events);
}

export async function generateFakeEvents(
    client: SupabaseClient,
    tenantId: string,
): Promise<void> {
    const timestamp = new Date().toISOString();
    const prediction = pickOne(SYNTHETIC_DIAGNOSES);
    const confidence = roundNumber(randomBetween(0.6, 0.95), 3);
    const latency = roundNumber(randomBetween(100, 400), 1);
    const inferenceEventId = `evt_sim_inference_${randomUUID()}`;
    const modelVersion = 'sim-clinical-v1';

    await emitTelemetryEvent(client, {
        event_id: inferenceEventId,
        tenant_id: tenantId,
        event_type: 'inference',
        timestamp,
        model_version: modelVersion,
        run_id: modelVersion,
        metrics: {
            latency_ms: latency,
            confidence,
            prediction,
        },
        system: {
            cpu: roundNumber(randomBetween(0.2, 0.85), 3),
            gpu: roundNumber(randomBetween(0.15, 0.8), 3),
            memory: roundNumber(randomBetween(0.25, 0.9), 3),
        },
        metadata: {
            simulated: true,
            source: 'telemetry_stream_generator',
        },
    });

    if (Math.random() < 0.65) {
        const correct = Math.random() >= 0.25;
        const alternatives = SYNTHETIC_DIAGNOSES.filter((candidate) => candidate !== prediction);
        const groundTruth = correct ? prediction : pickOne(alternatives);

        await emitTelemetryEvent(client, {
            event_id: `evt_sim_outcome_${randomUUID()}`,
            tenant_id: tenantId,
            linked_event_id: inferenceEventId,
            event_type: 'outcome',
            timestamp: new Date().toISOString(),
            model_version: modelVersion,
            run_id: modelVersion,
            metrics: {
                ground_truth: groundTruth,
                correct,
            },
            metadata: {
                simulated: true,
                source: 'telemetry_stream_generator',
            },
        });
    }
}

export function telemetryInferenceEventId(inferenceEventId: string) {
    return `evt_inference_${inferenceEventId}`;
}

export function telemetryOutcomeEventId(outcomeEventId: string) {
    return `evt_outcome_${outcomeEventId}`;
}

export function telemetryEvaluationEventId(evaluationEventId: string) {
    return `evt_evaluation_${evaluationEventId}`;
}

export function telemetrySimulationEventId(simulationEventId: string) {
    return `evt_simulation_${simulationEventId}`;
}

export function telemetryHeartbeatEventId(source: string, timestamp: string = new Date().toISOString()) {
    const suffix = timestamp.replace(/\D/g, '').slice(-17);
    return `evt_system_heartbeat_${normalizeTelemetryIdentifier(source)}_${suffix}`;
}

export function resolveTelemetryRunId(modelVersion: string, candidate: unknown) {
    const explicit = textOrNull(candidate);
    return explicit ?? modelVersion;
}

export async function emitTelemetryHeartbeat(
    client: SupabaseClient,
    input: {
        tenantId: string;
        source: string;
        targetNodeId?: string | null;
        modelVersion?: string | null;
        runId?: string | null;
        system?: TelemetrySystemPayload;
        metadata?: Record<string, unknown>;
    },
) {
    const timestamp = new Date().toISOString();
    return emitTelemetryEvent(client, {
        event_id: telemetryHeartbeatEventId(input.source, timestamp),
        tenant_id: input.tenantId,
        event_type: 'system',
        timestamp,
        model_version: textOrNull(input.modelVersion) ?? 'control-plane-heartbeat',
        run_id: textOrNull(input.runId) ?? 'control-plane-heartbeat',
        metrics: {},
        system: input.system,
        metadata: {
            source_module: input.source,
            action: 'heartbeat',
            heartbeat: true,
            heartbeat_interval_ms: TELEMETRY_HEARTBEAT_INTERVAL_MS,
            target_node_id: textOrNull(input.targetNodeId) ?? 'telemetry_observer',
            ...(input.metadata ?? {}),
        },
    });
}

export function extractPredictionLabel(outputPayload: Record<string, unknown>) {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const topDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    const topDiagnosis = topDifferentials[0];

    if (typeof topDiagnosis === 'object' && topDiagnosis !== null) {
        const name = textOrNull((topDiagnosis as Record<string, unknown>).name);
        if (name) return name;
    }

    return textOrNull(diagnosis.primary_condition_class);
}

export function extractSystemTelemetry(
    computeProfile: Record<string, unknown>,
    fallback: {
        cpu: number | null;
        gpu: number | null;
        memory: number | null;
    },
): TelemetrySystemPayload {
    return {
        cpu: numberOrNull(computeProfile.cpu)
            ?? numberOrNull(computeProfile.cpu_utilization)
            ?? fallback.cpu,
        gpu: numberOrNull(computeProfile.gpu)
            ?? numberOrNull(computeProfile.gpu_utilization)
            ?? fallback.gpu,
        memory: numberOrNull(computeProfile.memory)
            ?? numberOrNull(computeProfile.memory_utilization)
            ?? fallback.memory,
    };
}

export function beginTelemetryExecutionSample(): TelemetryExecutionSample {
    return {
        startedAtMs: performance.now(),
        cpuUsage: process.cpuUsage(),
    };
}

export function finishTelemetryExecutionSample(sample: TelemetryExecutionSample) {
    const latencyMs = roundNumber(Math.max(0, performance.now() - sample.startedAtMs), 1);
    const cpuDelta = process.cpuUsage(sample.cpuUsage);
    const memoryUsage = process.memoryUsage();
    const cpuUtilization = latencyMs <= 0
        ? null
        : clampNumber((((cpuDelta.user + cpuDelta.system) / 1000) / latencyMs), 0, 1);
    const memoryUtilization = memoryUsage.heapTotal > 0
        ? clampNumber(memoryUsage.heapUsed / memoryUsage.heapTotal, 0, 1)
        : null;

    return {
        latencyMs,
        system: {
            cpu: cpuUtilization,
            gpu: null,
            memory: memoryUtilization,
        } satisfies TelemetrySystemPayload,
    };
}

function buildTelemetrySnapshot(events: TelemetryEventRecord[]): TelemetrySnapshot {
    const productionEvents = events.filter((event) => !isSyntheticTelemetryRecord(event));
    const inferenceEvents = productionEvents.filter((event) => event.event_type === 'inference');
    const outcomeEvents = productionEvents.filter((event) => event.event_type === 'outcome');
    const evaluationEvents = productionEvents.filter((event) => event.event_type === 'evaluation');
    const inferenceById = new Map(inferenceEvents.map((event) => [event.event_id, event]));

    const validLatencyEvents = inferenceEvents.filter((event) => {
        const latency = numberOrNull(event.metrics.latency_ms);
        return latency != null && latency <= LATENCY_ANOMALY_MS;
    });
    const anomalyCount = inferenceEvents.filter((event) => {
        const latency = numberOrNull(event.metrics.latency_ms);
        return latency != null && latency > LATENCY_ANOMALY_MS;
    }).length;

    const latencies = validLatencyEvents
        .map((event) => numberOrNull(event.metrics.latency_ms))
        .filter((value): value is number => value != null)
        .sort((left, right) => left - right);
    const confidences = inferenceEvents
        .map((event) => numberOrNull(event.metrics.confidence))
        .filter((value): value is number => value != null);
    const outcomePairs = outcomeEvents
        .map((event) => {
            const linkedInference = event.linked_event_id ? inferenceById.get(event.linked_event_id) ?? null : null;
            const prediction = linkedInference ? textOrNull(linkedInference.metrics.prediction) : null;
            const groundTruth = textOrNull(event.metrics.ground_truth);
            const correct = booleanOrNull(event.metrics.correct);

            if (!prediction || !groundTruth || correct == null) {
                return null;
            }

            return {
                timestamp: event.timestamp,
                prediction,
                groundTruth,
                correct,
            };
        })
        .filter((value): value is { timestamp: string; prediction: string; groundTruth: string; correct: boolean } => value != null);
    const evaluationPairs = evaluationEvents
        .map((event) => {
            const prediction = textOrNull(event.metrics.prediction);
            const groundTruth = textOrNull(event.metrics.ground_truth);
            const correct = booleanOrNull(event.metrics.correct);

            if (!prediction || !groundTruth || correct == null) {
                return null;
            }

            return {
                timestamp: event.timestamp,
                prediction,
                groundTruth,
                correct,
            };
        })
        .filter((value): value is { timestamp: string; prediction: string; groundTruth: string; correct: boolean } => value != null);
    const accuracyPairs = evaluationPairs.length > 0 ? evaluationPairs : outcomePairs;
    const driftPairs = evaluationPairs.length > 0 ? evaluationPairs : outcomePairs;

    const lastEvent = events.at(-1) ?? null;
    const lastEventTimestamp = lastEvent?.timestamp ?? null;
    const systemState = lastEventTimestamp != null && Date.now() - new Date(lastEventTimestamp).getTime() <= HEARTBEAT_STALE_MS
        ? 'LIVE'
        : 'STALE';

    const p95Latency = percentile(latencies, 95);
    const avgConfidence = mean(confidences);
    const accuracy = accuracyPairs.length > 0
        ? accuracyPairs.filter((entry) => entry.correct).length / accuracyPairs.length
        : null;
    const driftScore = driftPairs.length >= MIN_OUTCOMES_FOR_DRIFT
        ? computeDriftScore(driftPairs)
        : null;

    return {
        generated_at: new Date().toISOString(),
        system_state: systemState,
        last_event_timestamp: lastEventTimestamp,
        metrics: {
            inference_count: inferenceEvents.length,
            p95_latency_ms: p95Latency,
            avg_confidence: avgConfidence,
            accuracy,
            drift_score: driftScore,
            outcome_count: outcomeEvents.length,
            anomaly_count: anomalyCount,
        },
        metric_states: {
            p95_latency: latencies.length > 0 ? 'READY' : 'NO_DATA',
            avg_confidence: confidences.length > 0 ? 'READY' : 'NO_DATA',
            accuracy: accuracyPairs.length > 0 ? 'READY' : 'INSUFFICIENT_OUTCOMES',
            drift_score: driftPairs.length >= MIN_OUTCOMES_FOR_DRIFT ? 'READY' : 'INSUFFICIENT_OUTCOMES',
        },
        latest_system: findLatestSystemMetrics(events),
        charts: {
            latency: validLatencyEvents.slice(-40).map((event) => ({
                time: formatChartTime(event.timestamp),
                value: numberOrNull(event.metrics.latency_ms) ?? 0,
            })),
            drift: buildDriftTimeline(driftPairs),
        },
        logs: buildLogs(events, {
            p95Latency,
            avgConfidence,
            accuracy,
            driftScore,
            anomalyCount,
        }),
    };
}

function buildLogs(
    events: TelemetryEventRecord[],
    aggregate: {
        p95Latency: number | null;
        avgConfidence: number | null;
        accuracy: number | null;
        driftScore: number | null;
        anomalyCount: number;
    },
): TelemetryLogEntry[] {
    const recentEventLogs = events
        .slice(-12)
        .reverse()
        .map((event) => mapEventToLog(event));
    const latestTimestamp = events.at(-1)?.timestamp ?? 'no_events';
    const aggregateLog: TelemetryLogEntry | null = events.length === 0
        ? null
        : {
            id: `agg_${latestTimestamp}_${aggregate.p95Latency ?? 'na'}_${aggregate.driftScore ?? 'na'}_${aggregate.accuracy ?? 'na'}_${aggregate.anomalyCount}`,
            level: aggregate.anomalyCount > 0 ? 'WARN' : 'INFO',
            timestamp: latestTimestamp,
            message: `[${aggregate.anomalyCount > 0 ? 'WARN' : 'INFO'}] AGGREGATE p95=${formatLatencyValue(aggregate.p95Latency)} drift=${formatScore(aggregate.driftScore, 'INSUFFICIENT OUTCOMES')} accuracy=${formatScore(aggregate.accuracy, 'INSUFFICIENT OUTCOMES')} confidence=${formatScore(aggregate.avgConfidence, 'NO DATA')}`,
        };

    return [aggregateLog, ...recentEventLogs]
        .filter((entry): entry is TelemetryLogEntry => entry != null)
        .slice(0, MAX_LOGS);
}

function mapEventToLog(event: TelemetryEventRecord): TelemetryLogEntry {
    const latency = numberOrNull(event.metrics.latency_ms);
    const anomaly = latency != null && latency > LATENCY_ANOMALY_MS;

    if (event.event_type === 'inference') {
        return {
            id: event.event_id,
            level: anomaly ? 'WARN' : 'INFO',
            timestamp: event.timestamp,
            message: anomaly
                ? `[WARN] INFERENCE ${event.event_id} latency=${latency?.toFixed(1) ?? 'NO DATA'}ms anomaly=true excluded_from_p95=true`
                : `[INFO] INFERENCE ${event.event_id} latency=${latency?.toFixed(1) ?? 'NO DATA'}ms confidence=${formatScore(numberOrNull(event.metrics.confidence), 'NO DATA')} prediction=${textOrNull(event.metrics.prediction) ?? 'NO DATA'}`,
        };
    }

    if (event.event_type === 'outcome') {
        return {
            id: event.event_id,
            level: 'INFO',
            timestamp: event.timestamp,
            message: `[INFO] OUTCOME ${event.linked_event_id ?? event.event_id} correct=${String(booleanOrNull(event.metrics.correct) ?? false)} ground_truth=${textOrNull(event.metrics.ground_truth) ?? 'NO DATA'}`,
        };
    }

    if (event.event_type === 'evaluation') {
        return {
            id: event.event_id,
            level: booleanOrNull(event.metrics.correct) === false ? 'WARN' : 'INFO',
            timestamp: event.timestamp,
            message: `[${booleanOrNull(event.metrics.correct) === false ? 'WARN' : 'INFO'}] EVALUATION ${event.source_id ?? event.event_id} correct=${String(booleanOrNull(event.metrics.correct) ?? false)} prediction=${textOrNull(event.metrics.prediction) ?? 'NO DATA'} ground_truth=${textOrNull(event.metrics.ground_truth) ?? 'NO DATA'}`,
        };
    }

    if (event.event_type === 'simulation') {
        return {
            id: event.event_id,
            level: 'WARN',
            timestamp: event.timestamp,
            message: `[WARN] SIMULATION ${event.source_id ?? event.event_id} target=${textOrNull(event.metrics.prediction) ?? 'NO DATA'} latency=${formatLatencyValue(numberOrNull(event.metrics.latency_ms))}`,
        };
    }

    if (event.event_type === 'system') {
        const action = textOrNull(event.metadata.action) ?? 'system';
        if (action === 'heartbeat') {
            return {
                id: event.event_id,
                level: 'INFO',
                timestamp: event.timestamp,
                message: `[INFO] HEARTBEAT ${textOrNull(event.metadata.target_node_id) ?? 'telemetry_observer'} source=${textOrNull(event.metadata.source_module) ?? 'control_plane'} interval_ms=${numberOrNull(event.metadata.heartbeat_interval_ms)?.toFixed(0) ?? 'NO DATA'}`,
            };
        }
        const selectedModel = textOrNull(event.metadata.routing_selected_model_id)
            ?? textOrNull(event.metadata.routing_selected_model_name)
            ?? 'NO DATA';
        const routeMode = textOrNull(event.metadata.routing_route_mode) ?? 'single';
        const riskScore = numberOrNull(event.metadata.routing_risk_score);
        const fallbackUsed = booleanOrNull(event.metadata.routing_fallback_used) === true;
        const level = action === 'routing_fallback' || fallbackUsed ? 'WARN' : 'INFO';
        const label = action === 'routing_ensemble'
            ? 'ROUTING_ENSEMBLE'
            : action === 'routing_fallback'
                ? 'ROUTING_FALLBACK'
                : 'ROUTING';

        return {
            id: event.event_id,
            level,
            timestamp: event.timestamp,
            message: `[${level}] ${label} ${textOrNull(event.metadata.routing_decision_id) ?? event.event_id} model=${selectedModel} mode=${routeMode} risk=${formatScore(riskScore, 'NO DATA')} latency=${formatLatencyValue(numberOrNull(event.metrics.latency_ms))}`,
        };
    }

    return {
        id: event.event_id,
        level: 'INFO',
        timestamp: event.timestamp,
        message: `[INFO] ${event.event_type.toUpperCase()} ${event.event_id}`,
    };
}

function buildDriftTimeline(
    outcomePairs: Array<{ timestamp: string; prediction: string; groundTruth: string; correct: boolean }>,
): TelemetryChartPoint[] {
    const predictionCounts = new Map<string, number>();
    const groundTruthCounts = new Map<string, number>();
    const timeline: TelemetryChartPoint[] = [];

    for (const outcome of outcomePairs) {
        predictionCounts.set(outcome.prediction, (predictionCounts.get(outcome.prediction) ?? 0) + 1);
        groundTruthCounts.set(outcome.groundTruth, (groundTruthCounts.get(outcome.groundTruth) ?? 0) + 1);

        const sampleCount = Array.from(groundTruthCounts.values()).reduce((sum, value) => sum + value, 0);
        if (sampleCount < MIN_OUTCOMES_FOR_DRIFT) continue;

        timeline.push({
            time: formatChartTime(outcome.timestamp),
            value: computeDistributionDrift(predictionCounts, groundTruthCounts),
        });
    }

    return timeline.slice(-40);
}

function computeDriftScore(
    outcomePairs: Array<{ prediction: string; groundTruth: string }>,
): number {
    const predictionCounts = new Map<string, number>();
    const groundTruthCounts = new Map<string, number>();

    for (const outcome of outcomePairs) {
        predictionCounts.set(outcome.prediction, (predictionCounts.get(outcome.prediction) ?? 0) + 1);
        groundTruthCounts.set(outcome.groundTruth, (groundTruthCounts.get(outcome.groundTruth) ?? 0) + 1);
    }

    return computeDistributionDrift(predictionCounts, groundTruthCounts);
}

function computeDistributionDrift(
    predictionCounts: Map<string, number>,
    groundTruthCounts: Map<string, number>,
): number {
    const labels = new Set([...predictionCounts.keys(), ...groundTruthCounts.keys()]);
    const predictionTotal = Array.from(predictionCounts.values()).reduce((sum, value) => sum + value, 0);
    const groundTruthTotal = Array.from(groundTruthCounts.values()).reduce((sum, value) => sum + value, 0);

    if (predictionTotal === 0 || groundTruthTotal === 0) {
        return 0;
    }

    let squaredDistance = 0;
    for (const label of labels) {
        const predictedProbability = (predictionCounts.get(label) ?? 0) / predictionTotal;
        const actualProbability = (groundTruthCounts.get(label) ?? 0) / groundTruthTotal;
        squaredDistance += (predictedProbability - actualProbability) ** 2;
    }

    return roundNumber(Math.sqrt(squaredDistance), 4);
}

function isSyntheticTelemetryRecord(event: Pick<TelemetryEventRecord, 'event_type' | 'metadata'>) {
    if (event.event_type === 'simulation') return true;
    if (event.metadata.synthetic === true || event.metadata.simulated === true) return true;
    const source = textOrNull(event.metadata.source_module) ?? textOrNull(event.metadata.source);
    return source === 'adversarial_simulation' || source === 'telemetry_stream_generator';
}

function findLatestSystemMetrics(events: TelemetryEventRecord[]): TelemetrySystemPayload {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (!event) continue;

        if (numberOrNull(event.system.cpu) != null ||
            numberOrNull(event.system.gpu) != null ||
            numberOrNull(event.system.memory) != null) {
            return {
                cpu: numberOrNull(event.system.cpu),
                gpu: numberOrNull(event.system.gpu),
                memory: numberOrNull(event.system.memory),
            };
        }
    }

    return { cpu: null, gpu: null, memory: null };
}

function mapTelemetryEventRow(row: Record<string, unknown>): TelemetryEventRecord {
    return {
        event_id: textOrNull(row.event_id) ?? `evt_${randomUUID()}`,
        tenant_id: textOrNull(row.tenant_id) ?? '',
        linked_event_id: textOrNull(row.linked_event_id),
        source_id: textOrNull(row.source_id),
        source_table: textOrNull(row.source_table),
        event_type: resolveEventType(textOrNull(row.event_type)),
        timestamp: textOrNull(row.timestamp) ?? new Date().toISOString(),
        model_version: textOrNull(row.model_version) ?? 'unknown',
        run_id: textOrNull(row.run_id) ?? 'unknown',
        metrics: asMetricsPayload(row.metrics),
        system: asSystemPayload(row.system),
        metadata: asRecord(row.metadata),
        created_at: textOrNull(row.created_at) ?? new Date().toISOString(),
    };
}

function resolveEventType(value: string | null): TelemetryEventRecord['event_type'] {
    if (value === 'outcome' || value === 'evaluation' || value === 'simulation' || value === 'system' || value === 'training') return value;
    return 'inference';
}

function asMetricsPayload(value: unknown): TelemetryMetricsPayload {
    const record = asRecord(value);
    return {
        latency_ms: numberOrNull(record.latency_ms),
        confidence: numberOrNull(record.confidence),
        prediction: textOrNull(record.prediction),
        ground_truth: textOrNull(record.ground_truth),
        correct: booleanOrNull(record.correct),
    };
}

function asSystemPayload(value: unknown): TelemetrySystemPayload {
    const record = asRecord(value);
    return {
        cpu: numberOrNull(record.cpu),
        gpu: numberOrNull(record.gpu),
        memory: numberOrNull(record.memory),
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function numberOrNull(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizeTelemetryIdentifier(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'control_plane';
}

function booleanOrNull(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

function mean(values: number[]) {
    if (values.length === 0) return null;
    return roundNumber(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function percentile(values: number[], percentileRank: number) {
    if (values.length === 0) return null;
    const index = Math.max(0, Math.ceil((percentileRank / 100) * values.length) - 1);
    return roundNumber(values[index] ?? values[values.length - 1] ?? 0, 1);
}

function roundNumber(value: number, digits: number) {
    return Number(value.toFixed(digits));
}

function formatChartTime(timestamp: string) {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatLatencyValue(value: number | null) {
    return value == null ? 'NO DATA' : `${value.toFixed(1)}ms`;
}

function formatScore(value: number | null, fallback: string) {
    return value == null ? fallback : value.toFixed(3);
}

function randomBetween(min: number, max: number) {
    return min + Math.random() * (max - min);
}

function pickOne<T>(values: T[]) {
    return values[Math.floor(Math.random() * values.length)] ?? values[0]!;
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}
