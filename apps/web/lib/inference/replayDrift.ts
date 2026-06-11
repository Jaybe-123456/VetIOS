import { randomUUID } from 'crypto';
import { runInference, type InputSignature } from '@/lib/vetios-inference';
import { digestUnknown } from '@/lib/inference/executionTrace';

export type ReplayRanker = 'classical' | 'quantum' | 'hybrid';
export type ReplayStatus = 'completed' | 'failed';

type ReplaySupabaseClient = {
    from: (table: string) => unknown;
};

export interface InferenceReplayResult {
    replay_event_id: string | null;
    source_inference_event_id: string;
    replay_request_id: string;
    replay_status: ReplayStatus;
    replay_mode: 'deterministic_core';
    original_top_label: string | null;
    replay_top_label: string | null;
    original_confidence: number | null;
    replay_confidence: number | null;
    top_label_changed: boolean;
    confidence_delta: number | null;
    distribution_drift: number | null;
    latency_ms: number;
    warnings: string[];
    error: string | null;
}

interface ReplayEventInsertRow {
    tenant_id: string;
    replay_request_id: string;
    source_inference_event_id: string;
    source_request_id: string | null;
    replay_mode: 'deterministic_core';
    replay_status: ReplayStatus;
    failure_reason: string | null;
    source_model_name: string | null;
    source_model_version: string | null;
    replay_model_name: string | null;
    replay_model_version: string | null;
    source_schema_version: string | null;
    replay_schema_version: string | null;
    source_ranker: ReplayRanker | null;
    replay_ranker: ReplayRanker | null;
    original_top_label: string | null;
    replay_top_label: string | null;
    original_confidence: number | null;
    replay_confidence: number | null;
    top_label_changed: boolean;
    confidence_delta: number | null;
    distribution_drift: number | null;
    latency_ms: number;
    input_digest: string | null;
    original_output_digest: string | null;
    replay_output_digest: string | null;
    replay_summary: Record<string, unknown>;
}

interface SourceInferenceEvent {
    id: string;
    tenant_id: string;
    request_id: string | null;
    model_name: string | null;
    model_version: string | null;
    schema_version: string | null;
    ranker: ReplayRanker | null;
    input_signature: Record<string, unknown>;
    output_payload: Record<string, unknown>;
    confidence_score: number | null;
}

export async function replayInferenceEventForDrift(input: {
    client: ReplaySupabaseClient;
    tenantId: string;
    inferenceEventId: string;
    userId?: string | null;
}): Promise<InferenceReplayResult> {
    const started = Date.now();
    const replayRequestId = randomUUID();
    const source = await loadSourceInferenceEvent(input.client, input.tenantId, input.inferenceEventId);

    if (!source) {
        return {
            replay_event_id: null,
            source_inference_event_id: input.inferenceEventId,
            replay_request_id: replayRequestId,
            replay_status: 'failed',
            replay_mode: 'deterministic_core',
            original_top_label: null,
            replay_top_label: null,
            original_confidence: null,
            replay_confidence: null,
            top_label_changed: false,
            confidence_delta: null,
            distribution_drift: null,
            latency_ms: Date.now() - started,
            warnings: [],
            error: 'source_inference_not_found',
        };
    }

    const sanitizedInput = sanitizeReplayInputSignature(source.input_signature);
    const warnings = buildReplayWarnings(source.input_signature, sanitizedInput);
    let replayStatus: ReplayStatus = 'completed';
    let failureReason: string | null = null;
    let replayOutput: Record<string, unknown> | null = null;
    let replayRanker: ReplayRanker | null = 'classical';
    let replayModelName: string | null = source.model_name ?? 'VetIOS Diagnostics';
    let replayModelVersion: string | null = source.model_version ?? 'latest';

    try {
        const replay = await runInference({
            tenantId: input.tenantId,
            requestId: replayRequestId,
            supabase: input.client as never,
            persist: false,
            userId: input.userId ?? null,
            model: {
                name: replayModelName,
                version: replayModelVersion,
            },
            inputSignature: sanitizedInput,
            sourceModule: 'inference_replay',
            ranker: 'classical',
            quantumResult: null,
        });
        replayOutput = replay.output_payload;
        replayRanker = replay.ranker;
    } catch (error) {
        replayStatus = 'failed';
        failureReason = error instanceof Error ? error.message : 'replay_failed';
    }

    const comparison = compareInferenceOutputs(source.output_payload, replayOutput);
    const latencyMs = Date.now() - started;
    const insertRow: ReplayEventInsertRow = {
        tenant_id: input.tenantId,
        replay_request_id: replayRequestId,
        source_inference_event_id: source.id,
        source_request_id: source.request_id,
        replay_mode: 'deterministic_core',
        replay_status: replayStatus,
        failure_reason: failureReason,
        source_model_name: source.model_name,
        source_model_version: source.model_version,
        replay_model_name: replayModelName,
        replay_model_version: replayModelVersion,
        source_schema_version: source.schema_version,
        replay_schema_version: readString(asRecord(sanitizedInput.metadata).schema_version) ?? source.schema_version,
        source_ranker: source.ranker,
        replay_ranker: replayRanker,
        original_top_label: comparison.originalTopLabel,
        replay_top_label: comparison.replayTopLabel,
        original_confidence: comparison.originalConfidence,
        replay_confidence: comparison.replayConfidence,
        top_label_changed: comparison.topLabelChanged,
        confidence_delta: comparison.confidenceDelta,
        distribution_drift: comparison.distributionDrift,
        latency_ms: latencyMs,
        input_digest: digestUnknown(sanitizedInput),
        original_output_digest: digestUnknown(source.output_payload),
        replay_output_digest: replayOutput ? digestUnknown(replayOutput) : null,
        replay_summary: {
            warnings,
            original_distribution: comparison.originalDistribution.slice(0, 8),
            replay_distribution: comparison.replayDistribution.slice(0, 8),
            replay_status: replayStatus,
        },
    };

    const replayEventId = await insertReplayEvent(input.client, insertRow);

    return {
        replay_event_id: replayEventId,
        source_inference_event_id: source.id,
        replay_request_id: replayRequestId,
        replay_status: replayStatus,
        replay_mode: 'deterministic_core',
        original_top_label: comparison.originalTopLabel,
        replay_top_label: comparison.replayTopLabel,
        original_confidence: comparison.originalConfidence,
        replay_confidence: comparison.replayConfidence,
        top_label_changed: comparison.topLabelChanged,
        confidence_delta: comparison.confidenceDelta,
        distribution_drift: comparison.distributionDrift,
        latency_ms: latencyMs,
        warnings,
        error: failureReason,
    };
}

export function sanitizeReplayInputSignature(input: Record<string, unknown>): InputSignature {
    const metadata = asRecord(input.metadata);
    const sanitized: Record<string, unknown> = {
        ...input,
        metadata: {
            ...metadata,
            replay_mode: 'deterministic_core',
            replay_external_media_skipped: Array.isArray(input.diagnostic_images) && input.diagnostic_images.length > 0,
            replay_created_at: new Date().toISOString(),
        },
    };

    delete sanitized.diagnostic_images;

    return {
        ...sanitized,
        species: readString(input.species) ?? 'unknown',
        symptoms: readStringArray(input.symptoms),
    };
}

export function compareInferenceOutputs(
    originalOutput: Record<string, unknown>,
    replayOutput: Record<string, unknown> | null,
) {
    const originalDistribution = extractDistribution(originalOutput);
    const replayDistribution = replayOutput ? extractDistribution(replayOutput) : [];
    const originalTop = originalDistribution[0] ?? null;
    const replayTop = replayDistribution[0] ?? null;
    const originalConfidence = originalTop?.probability ?? readNumber(originalOutput.confidence_score) ?? readNumber(originalOutput.primary_confidence);
    const replayConfidence = replayTop?.probability ?? readNumber(replayOutput?.confidence_score) ?? readNumber(replayOutput?.primary_confidence);
    const confidenceDelta = originalConfidence == null || replayConfidence == null
        ? null
        : roundMetric(Math.abs(originalConfidence - replayConfidence));

    return {
        originalDistribution,
        replayDistribution,
        originalTopLabel: originalTop?.label ?? null,
        replayTopLabel: replayTop?.label ?? null,
        originalConfidence,
        replayConfidence,
        topLabelChanged: Boolean(originalTop?.label && replayTop?.label && originalTop.label !== replayTop.label),
        confidenceDelta,
        distributionDrift: replayDistribution.length > 0
            ? roundMetric(totalVariationDistance(originalDistribution, replayDistribution))
            : null,
    };
}

function extractDistribution(output: Record<string, unknown>): Array<{ label: string; probability: number }> {
    const diagnosis = asRecord(output.diagnosis);
    const candidates = Array.isArray(output.differentials)
        ? output.differentials
        : Array.isArray(diagnosis.top_differentials)
            ? diagnosis.top_differentials
            : Array.isArray(output.clinical_output)
                ? output.clinical_output
                : [];

    return candidates
        .map((entry) => {
            const record = asRecord(entry);
            const label = readString(record.label)
                ?? readString(record.condition)
                ?? readString(record.name);
            const probability = readNumber(record.p)
                ?? readNumber(record.probability)
                ?? readNumber(record.confidence);
            if (!label || probability == null) return null;
            return {
                label,
                probability: clampProbability(probability),
            };
        })
        .filter((entry): entry is { label: string; probability: number } => Boolean(entry))
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 12);
}

function totalVariationDistance(
    original: Array<{ label: string; probability: number }>,
    replay: Array<{ label: string; probability: number }>,
) {
    const labels = new Set([...original.map((entry) => entry.label), ...replay.map((entry) => entry.label)]);
    let total = 0;
    for (const label of labels) {
        const left = original.find((entry) => entry.label === label)?.probability ?? 0;
        const right = replay.find((entry) => entry.label === label)?.probability ?? 0;
        total += Math.abs(left - right);
    }
    return Math.min(1, total / 2);
}

async function loadSourceInferenceEvent(
    client: ReplaySupabaseClient,
    tenantId: string,
    inferenceEventId: string,
): Promise<SourceInferenceEvent | null> {
    const query = client.from('ai_inference_events') as {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                eq: (column: string, value: string) => {
                    maybeSingle: () => PromiseLike<{ data: unknown | null; error: { message?: string } | null }>;
                };
            };
        };
    };
    const { data, error } = await query
        .select('id, tenant_id, request_id, model_name, model_version, schema_version, ranker, input_signature, output_payload, confidence_score')
        .eq('tenant_id', tenantId)
        .eq('id', inferenceEventId)
        .maybeSingle();

    if (error || !data) return null;
    const record = asRecord(data);
    return {
        id: readString(record.id) ?? inferenceEventId,
        tenant_id: readString(record.tenant_id) ?? tenantId,
        request_id: readString(record.request_id),
        model_name: readString(record.model_name),
        model_version: readString(record.model_version),
        schema_version: readString(record.schema_version),
        ranker: readRanker(record.ranker),
        input_signature: asRecord(record.input_signature),
        output_payload: asRecord(record.output_payload),
        confidence_score: readNumber(record.confidence_score),
    };
}

async function insertReplayEvent(client: ReplaySupabaseClient, row: ReplayEventInsertRow): Promise<string | null> {
    const table = client.from('inference_replay_events') as {
        insert: (payload: ReplayEventInsertRow) => {
            select: (columns: string) => {
                single: () => PromiseLike<{ data: unknown | null; error: { message?: string } | null }>;
            };
        };
    };
    const { data, error } = await table.insert(row).select('id').single();
    if (error) {
        console.warn(JSON.stringify({
            event: 'inference_replay_event_insert_failed',
            source_inference_event_id: row.source_inference_event_id,
            error: error.message ?? 'unknown',
        }));
        return null;
    }
    return readString(asRecord(data).id);
}

function buildReplayWarnings(source: Record<string, unknown>, sanitized: Record<string, unknown>) {
    const warnings: string[] = [];
    if (Array.isArray(source.diagnostic_images) && source.diagnostic_images.length > 0 && !Array.isArray(sanitized.diagnostic_images)) {
        warnings.push('Diagnostic image blobs were excluded from deterministic replay.');
    }
    return warnings;
}

function readRanker(value: unknown): ReplayRanker | null {
    return value === 'classical' || value === 'quantum' || value === 'hybrid' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(readString)
        .filter((entry): entry is string => Boolean(entry));
}

function clampProbability(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number): number {
    return Number(value.toFixed(4));
}
