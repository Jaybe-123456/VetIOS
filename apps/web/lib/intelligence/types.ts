export type TopologyNodeStatus = 'healthy' | 'degraded' | 'critical' | 'offline';
export type TopologyEdgeStatus = 'normal' | 'stressed' | 'failing';
export type TopologyControlPlaneState =
    | 'READY'
    | 'CONTROL_PLANE_INITIALIZING'
    | 'STREAM_DISCONNECTED'
    | 'NO_TELEMETRY_EVENTS'
    | 'WAITING_FOR_EVALUATION_EVENTS'
    | 'INSUFFICIENT_OUTCOMES_FOR_DRIFT'
    | 'MISSING_EVALUATION_EVENTS_TABLE';
export type TopologyNodeKind =
    | 'control'
    | 'registry'
    | 'telemetry'
    | 'clinic'
    | 'data'
    | 'model'
    | 'decision'
    | 'outcome'
    | 'simulation';
export type TopologyAlertSeverity = 'info' | 'warning' | 'critical';
export type TopologyWindow = '1h' | '24h';
export type TopologySimulationScenario = 'failure' | 'drift' | 'adversarial_attack';

export interface TopologyNodeState {
    status: TopologyNodeStatus;
    latency: number | null;
    throughput: number | null;
    error_rate: number | null;
    drift_score: number | null;
    confidence_avg: number | null;
    last_updated: string | null;
}

export interface TopologyNodeGovernance {
    model_version: string | null;
    registry_role: string | null;
    deployment_status: string | null;
    lifecycle_status: string | null;
    border_state: 'normal' | 'pending' | 'failed';
    promotion_blockers: string[];
}

export interface TopologyAlert {
    id: string;
    node_id: string;
    severity: TopologyAlertSeverity;
    category: 'latency' | 'drift' | 'error_rate' | 'governance' | 'heartbeat' | 'simulation' | 'stream' | 'evaluation';
    title: string;
    message: string;
    timestamp: string;
}

export interface TopologyNodeSnapshot {
    id: string;
    label: string;
    kind: TopologyNodeKind;
    position: { x: number; y: number };
    state: TopologyNodeState;
    governance: TopologyNodeGovernance | null;
    alert_count: number;
    propagated_risk: boolean;
    impact_sources: string[];
    connected_node_ids: string[];
    recent_errors: string[];
    recommendations: string[];
    metadata: Record<string, unknown>;
}

export interface TopologyEdgeSnapshot {
    id: string;
    source: string;
    target: string;
    label: string;
    flow_direction: 'source_to_target';
    requests_per_min: number | null;
    latency: number | null;
    failure_rate: number | null;
    latency_distribution: {
        p50: number | null;
        p95: number | null;
        max: number | null;
    };
    status: TopologyEdgeStatus;
    animated: boolean;
    propagated_risk: boolean;
    metadata: Record<string, unknown>;
}

export interface TopologyFailureImpact {
    source_node_id: string;
    impacted_node_ids: string[];
    impacted_edge_ids: string[];
    reason: string;
}

export interface TopologyTimelineMarker {
    event_id: string;
    timestamp: string;
    event_type: string;
    label: string;
}

export interface TopologyRecommendation {
    id: string;
    severity: TopologyAlertSeverity;
    message: string;
}

export interface TopologySnapshot {
    tenant_id: string;
    refreshed_at: string;
    window: TopologyWindow;
    mode: 'live' | 'historical';
    control_plane_state: TopologyControlPlaneState;
    playback: {
        live_supported: boolean;
        current_until: string;
        event_timeline: TopologyTimelineMarker[];
    };
    diagnostics: {
        telemetry_stream_connected: boolean;
        evaluation_events_table_exists: boolean;
        latest_inference_timestamp: string | null;
        latest_outcome_timestamp: string | null;
        latest_evaluation_timestamp: string | null;
        latest_simulation_timestamp: string | null;
        active_alert_count: number;
    };
    network_health_score: number;
    summary: {
        where_failing: string;
        root_cause: string;
        impact: string;
        next_action: string;
    };
    nodes: TopologyNodeSnapshot[];
    edges: TopologyEdgeSnapshot[];
    alerts: TopologyAlert[];
    failure_impacts: TopologyFailureImpact[];
    recommendations: TopologyRecommendation[];
}

export interface TopologyStreamPayload {
    snapshot: TopologySnapshot;
}
