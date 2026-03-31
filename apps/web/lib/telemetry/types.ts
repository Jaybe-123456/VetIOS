export type TelemetryEventType = 'inference' | 'outcome' | 'evaluation' | 'simulation' | 'system' | 'training';
export type TelemetrySystemState = 'LIVE' | 'STALE';
export type TelemetryTrafficMode = 'production' | 'simulation';
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

export interface TelemetryFailureRecord {
    id: string;
    predicted: string | null;
    actual: string | null;
    error_type: 'wrong_top1' | 'near_miss' | 'abstention_trigger';
    severity: 'info' | 'warning' | 'critical';
    failure_classification: 'diagnostic_error' | 'feature_weighting_error' | 'ontology_violation' | 'data_sparsity_issue' | 'abstention';
    confidence: number | null;
    actual_in_top3: boolean;
    abstained: boolean;
    created_at: string;
    payload: Record<string, unknown>;
}

export interface TelemetryDiseasePerformanceRecord {
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

export interface TelemetryRetentionPolicy {
    hot_storage: string;
    warm_storage: string;
    cold_storage: string;
}

export interface TelemetryBufferState {
    buffer_size: number;
    log_queue_depth: number;
    dropped_events: number;
    last_flush_at: string | null;
}

export interface TelemetrySnapshot {
    generated_at: string;
    traffic_mode: TelemetryTrafficMode;
    system_state: TelemetrySystemState;
    last_event_timestamp: string | null;
    metrics: {
        inference_count: number;
        p95_latency_ms: number | null;
        avg_confidence: number | null;
        accuracy: number | null;
        rolling_top1_accuracy: number | null;
        rolling_top3_accuracy: number | null;
        drift_score: number | null;
        calibration_gap: number | null;
        overconfidence_rate: number | null;
        abstention_rate: number | null;
        failure_event_count: number;
        near_miss_count: number;
        outcome_count: number;
        anomaly_count: number;
        memory_usage: number | null;
        buffer_size: number;
        log_queue_depth: number;
    };
    metric_states: {
        p95_latency: TelemetryMetricState;
        avg_confidence: TelemetryMetricState;
        accuracy: TelemetryMetricState;
        rolling_top1_accuracy: TelemetryMetricState;
        rolling_top3_accuracy: TelemetryMetricState;
        drift_score: TelemetryMetricState;
        calibration_gap: TelemetryMetricState;
        failure_events: TelemetryMetricState;
        memory: TelemetryMetricState;
    };
    latest_system: TelemetrySystemPayload;
    charts: {
        latency: TelemetryChartPoint[];
        drift: TelemetryChartPoint[];
        memory: TelemetryChartPoint[];
    };
    observability: {
        sample_window_size: number;
        disease_performance: TelemetryDiseasePerformanceRecord[];
        recent_failures: TelemetryFailureRecord[];
        retention_policy: TelemetryRetentionPolicy;
        buffer: TelemetryBufferState;
    };
    logs: TelemetryLogEntry[];
}

export interface TelemetryStreamPayload {
    snapshot: TelemetrySnapshot;
    simulation_mode: boolean;
}
