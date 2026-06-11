import { createHash, randomUUID } from 'crypto';

export type TraceSupabaseClient = {
    from: (table: string) => {
        insert: (rows: TraceInsertRow[]) => PromiseLike<{ error: { message?: string; code?: string } | null }>;
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                eq: (column: string, value: string) => {
                    order: (column: string, options: { ascending: boolean }) => PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null }>;
                };
            };
        };
    };
};

export type InferenceTraceStageStatus = 'completed' | 'skipped' | 'failed';

export interface InferenceExecutionTraceEvent {
    id: string;
    tenant_id: string;
    request_id: string;
    trace_id: string;
    inference_event_id: string | null;
    stage_key: string;
    stage_label: string;
    stage_status: InferenceTraceStageStatus;
    started_at: string;
    completed_at: string;
    latency_ms: number;
    source_module: string;
    model_name: string | null;
    model_version: string | null;
    provider_name: string | null;
    ranker: 'classical' | 'quantum' | 'hybrid' | null;
    schema_version: string | null;
    input_digest: string | null;
    output_digest: string | null;
    stage_metadata: Record<string, unknown>;
    created_at: string;
}

interface TraceContextInput {
    tenantId: string;
    requestId: string;
    sourceModule: string;
    modelName?: string | null;
    modelVersion?: string | null;
    providerName?: string | null;
    ranker?: 'classical' | 'quantum' | 'hybrid' | null;
    schemaVersion?: string | null;
    inputDigestSource?: unknown;
}

interface FlushOptions {
    inferenceEventId?: string | null;
    ranker?: 'classical' | 'quantum' | 'hybrid' | null;
    outputDigestSource?: unknown;
}

interface PendingTraceEvent {
    stageKey: string;
    stageLabel: string;
    status: InferenceTraceStageStatus;
    startedAt: Date;
    completedAt: Date;
    latencyMs: number;
    metadata: Record<string, unknown>;
}

interface TraceInsertRow {
    tenant_id: string;
    request_id: string;
    trace_id: string;
    inference_event_id: string | null;
    stage_key: string;
    stage_label: string;
    stage_status: InferenceTraceStageStatus;
    started_at: string;
    completed_at: string;
    latency_ms: number;
    source_module: string;
    model_name: string | null;
    model_version: string | null;
    provider_name: string | null;
    ranker: 'classical' | 'quantum' | 'hybrid' | null;
    schema_version: string | null;
    input_digest: string | null;
    output_digest: string | null;
    stage_metadata: Record<string, unknown>;
}

const REDACTED_METADATA_KEY = /(patient|owner|microchip|contact|symptom|sign|history|narrative|note|transcript|email|phone|address|name|species|breed|raw|text)/i;
const MAX_METADATA_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 240;

export class InferenceExecutionTraceContext {
    readonly traceId: string;
    private readonly tenantId: string;
    private readonly requestId: string;
    private readonly sourceModule: string;
    private readonly modelName: string | null;
    private readonly modelVersion: string | null;
    private readonly providerName: string | null;
    private readonly schemaVersion: string | null;
    private readonly inputDigest: string | null;
    private defaultRanker: 'classical' | 'quantum' | 'hybrid' | null;
    private pending: PendingTraceEvent[] = [];
    private flushed = false;

    constructor(input: TraceContextInput) {
        this.traceId = randomUUID();
        this.tenantId = input.tenantId;
        this.requestId = input.requestId;
        this.sourceModule = input.sourceModule;
        this.modelName = input.modelName ?? null;
        this.modelVersion = input.modelVersion ?? null;
        this.providerName = input.providerName ?? null;
        this.schemaVersion = input.schemaVersion ?? null;
        this.defaultRanker = input.ranker ?? null;
        this.inputDigest = input.inputDigestSource == null ? null : digestUnknown(input.inputDigestSource);
    }

    recordCompleted(stageKey: string, stageLabel: string, metadata: Record<string, unknown> = {}) {
        const now = new Date();
        this.pending.push({
            stageKey,
            stageLabel,
            status: 'completed',
            startedAt: now,
            completedAt: now,
            latencyMs: 0,
            metadata: sanitizeTraceMetadata(metadata),
        });
    }

    recordSkipped(stageKey: string, stageLabel: string, metadata: Record<string, unknown> = {}) {
        const now = new Date();
        this.pending.push({
            stageKey,
            stageLabel,
            status: 'skipped',
            startedAt: now,
            completedAt: now,
            latencyMs: 0,
            metadata: sanitizeTraceMetadata(metadata),
        });
    }

    recordFailed(stageKey: string, stageLabel: string, error: unknown, metadata: Record<string, unknown> = {}) {
        const now = new Date();
        this.pending.push({
            stageKey,
            stageLabel,
            status: 'failed',
            startedAt: now,
            completedAt: now,
            latencyMs: 0,
            metadata: sanitizeTraceMetadata({
                ...metadata,
                error: serializeTraceError(error),
            }),
        });
    }

    async measure<T>(
        stageKey: string,
        stageLabel: string,
        action: () => Promise<T>,
        metadata: Record<string, unknown> = {},
    ): Promise<T> {
        const startedAt = new Date();
        const started = Date.now();
        try {
            const result = await action();
            const completedAt = new Date();
            this.pending.push({
                stageKey,
                stageLabel,
                status: 'completed',
                startedAt,
                completedAt,
                latencyMs: Math.max(0, Date.now() - started),
                metadata: sanitizeTraceMetadata(metadata),
            });
            return result;
        } catch (error) {
            const completedAt = new Date();
            this.pending.push({
                stageKey,
                stageLabel,
                status: 'failed',
                startedAt,
                completedAt,
                latencyMs: Math.max(0, Date.now() - started),
                metadata: sanitizeTraceMetadata({
                    ...metadata,
                    error: serializeTraceError(error),
                }),
            });
            throw error;
        }
    }

    async flush(client: TraceSupabaseClient, options: FlushOptions = {}): Promise<void> {
        if (this.flushed || this.pending.length === 0) return;
        this.flushed = true;

        const rows: TraceInsertRow[] = this.pending.map((event) => ({
            tenant_id: this.tenantId,
            request_id: this.requestId,
            trace_id: this.traceId,
            inference_event_id: options.inferenceEventId ?? null,
            stage_key: event.stageKey,
            stage_label: event.stageLabel,
            stage_status: event.status,
            started_at: event.startedAt.toISOString(),
            completed_at: event.completedAt.toISOString(),
            latency_ms: event.latencyMs,
            source_module: this.sourceModule,
            model_name: this.modelName,
            model_version: this.modelVersion,
            provider_name: this.providerName,
            ranker: options.ranker ?? this.defaultRanker,
            schema_version: this.schemaVersion,
            input_digest: this.inputDigest,
            output_digest: options.outputDigestSource == null ? null : digestUnknown(options.outputDigestSource),
            stage_metadata: event.metadata,
        }));

        try {
            const { error } = await client.from('inference_execution_trace_events').insert(rows);
            if (!error) return;
            console.warn(JSON.stringify({
                event: 'inference_execution_trace_flush_failed',
                request_id: this.requestId,
                trace_id: this.traceId,
                error: error.message ?? error.code ?? 'unknown',
            }));
        } catch (error) {
            console.warn(JSON.stringify({
                event: 'inference_execution_trace_flush_failed',
                request_id: this.requestId,
                trace_id: this.traceId,
                error: error instanceof Error ? error.message : 'unknown',
            }));
        }
    }
}

export function createInferenceExecutionTraceContext(input: TraceContextInput): InferenceExecutionTraceContext {
    return new InferenceExecutionTraceContext(input);
}

export async function loadInferenceExecutionTraceEvents(
    client: TraceSupabaseClient,
    tenantId: string,
    inferenceEventId: string,
): Promise<{ data: InferenceExecutionTraceEvent[]; error: string | null }> {
    const { data, error } = await client
        .from('inference_execution_trace_events')
        .select('id, tenant_id, request_id, trace_id, inference_event_id, stage_key, stage_label, stage_status, started_at, completed_at, latency_ms, source_module, model_name, model_version, provider_name, ranker, schema_version, input_digest, output_digest, stage_metadata, created_at')
        .eq('tenant_id', tenantId)
        .eq('inference_event_id', inferenceEventId)
        .order('created_at', { ascending: true });

    if (error) {
        return { data: [], error: error.message ?? 'trace_lookup_failed' };
    }

    return {
        data: (data ?? []).map(normalizeTraceEvent),
        error: null,
    };
}

export function sanitizeTraceMetadata(value: unknown, depth = 0): Record<string, unknown> {
    const sanitized = sanitizeMetadataValue(value, depth);
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized as Record<string, unknown>
        : {};
}

export function digestUnknown(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
    if (depth > MAX_METADATA_DEPTH) return '[truncated]';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => sanitizeMetadataValue(entry, depth + 1));
    }
    if (typeof value !== 'object') return String(value);

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !REDACTED_METADATA_KEY.test(key))
            .map(([key, entry]) => [key, sanitizeMetadataValue(entry, depth + 1)])
            .filter(([, entry]) => entry !== undefined),
    );
}

function serializeTraceError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: sanitizeErrorMessage(error.message),
        };
    }
    return { message: sanitizeErrorMessage(String(error)) };
}

function sanitizeErrorMessage(value: string): string {
    return value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
        .slice(0, MAX_STRING_LENGTH);
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(',')}}`;
}

function normalizeTraceEvent(row: unknown): InferenceExecutionTraceEvent {
    const record = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {};
    return {
        id: readString(record.id) ?? '',
        tenant_id: readString(record.tenant_id) ?? '',
        request_id: readString(record.request_id) ?? '',
        trace_id: readString(record.trace_id) ?? '',
        inference_event_id: readString(record.inference_event_id),
        stage_key: readString(record.stage_key) ?? '',
        stage_label: readString(record.stage_label) ?? '',
        stage_status: readTraceStatus(record.stage_status),
        started_at: readString(record.started_at) ?? '',
        completed_at: readString(record.completed_at) ?? '',
        latency_ms: readNumber(record.latency_ms) ?? 0,
        source_module: readString(record.source_module) ?? 'clinical_api',
        model_name: readString(record.model_name),
        model_version: readString(record.model_version),
        provider_name: readString(record.provider_name),
        ranker: readRanker(record.ranker),
        schema_version: readString(record.schema_version),
        input_digest: readString(record.input_digest),
        output_digest: readString(record.output_digest),
        stage_metadata: sanitizeTraceMetadata(record.stage_metadata),
        created_at: readString(record.created_at) ?? '',
    };
}

function readTraceStatus(value: unknown): InferenceTraceStageStatus {
    return value === 'completed' || value === 'skipped' || value === 'failed' ? value : 'failed';
}

function readRanker(value: unknown): 'classical' | 'quantum' | 'hybrid' | null {
    return value === 'classical' || value === 'quantum' || value === 'hybrid' ? value : null;
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
