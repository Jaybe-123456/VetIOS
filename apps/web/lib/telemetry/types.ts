export type TelemetryEventType = 'inference' | 'outcome' | 'evaluation' | 'simulation' | 'system' | 'training';
export type TelemetrySystemState = 'LIVE' | 'STALE';
export type TelemetryMetricState =
    | 'READY'
    | 'NO_DATA'
    | 'INSUFFICIENT_OUTCOMES'
    | 'STREAM_DISCONNECTED';
export type TelemetryLogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface TelemetryMetricsPayload {
    latency_ms?: number | null;
    confidence?: number | null;
    prediction?: string | null;
    ground_truth?: string | null;
    correct?: boolean | null;
}

export interface TelemetrySystemPayload {
    cpu?: number | null;
    gpu?: number | null;
    memory?: number | null;
}

export interface TelemetryEventRecord {
    event_id: string;
    tenant_id: string;
    linked_event_id: string | null;
    source_id: string | null;
    source_table: string | null;
    event_type: TelemetryEventType;
    timestamp: string;
    model_version: string;
    run_id: string;
    metrics: TelemetryMetricsPayload;
    system: TelemetrySystemPayload;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface TelemetryChartPoint {
    time: string;
    value: number;
}

export interface TelemetryLogEntry {
    id: string;
    level: TelemetryLogLevel;
    timestamp: string;
    message: string;
}

export interface TelemetrySnapshot {
    generated_at: string;
    system_state: TelemetrySystemState;
    last_event_timestamp: string | null;
    metrics: {
        inference_count: number;
        p95_latency_ms: number | null;
        avg_confidence: number | null;
        accuracy: number | null;
        drift_score: number | null;
        outcome_count: number;
        anomaly_count: number;
    };
    metric_states: {
        p95_latency: TelemetryMetricState;
        avg_confidence: TelemetryMetricState;
        accuracy: TelemetryMetricState;
        drift_score: TelemetryMetricState;
    };
    latest_system: TelemetrySystemPayload;
    charts: {
        latency: TelemetryChartPoint[];
        drift: TelemetryChartPoint[];
    };
    logs: TelemetryLogEntry[];
}

export interface TelemetryStreamPayload {
    snapshot: TelemetrySnapshot;
    simulation_mode: boolean;
}
