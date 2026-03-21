import type { ModelFamily, GateStatus } from '@/lib/experiments/types';
import type { TelemetryEventType, TelemetryEventRecord } from '@/lib/telemetry/types';
import type { TopologyAlertSeverity, TopologyControlPlaneState, TopologySimulationScenario } from '@/lib/intelligence/types';

export type ControlPlaneUserRole = 'admin' | 'researcher' | 'clinician' | 'developer';
export type ControlPlaneAlertSensitivity = 'low' | 'balanced' | 'high';
export type ControlPlanePipelineStatus = 'ACTIVE' | 'FAILED' | 'INITIALIZING';
export type ControlPlaneApiKeyStatus = 'active' | 'revoked';
export type ControlPlaneActionStatus = 'requested' | 'completed' | 'failed';
export type ControlPlaneLogCategory =
    | TelemetryEventType
    | 'registry'
    | 'control'
    | 'system'
    | 'error';
export type ControlPlaneSimulationScenario =
    | TopologySimulationScenario
    | 'incorrect_outcome_burst';

export interface ControlPlanePermissionSet {
    can_manage_profile: boolean;
    can_manage_api_keys: boolean;
    can_manage_models: boolean;
    can_manage_configuration: boolean;
    can_manage_infrastructure: boolean;
    can_run_debug_tools: boolean;
    can_run_simulations: boolean;
}

export interface ControlPlaneProfile {
    user_id: string | null;
    email: string | null;
    role: ControlPlaneUserRole;
    organization: string | null;
    permissions: string[];
    permission_set: ControlPlanePermissionSet;
    last_login: string | null;
}

export interface ControlPlaneSessionSummary {
    session_id: string;
    label: string;
    current: boolean;
    expires_at: string | null;
    access_scope: string[];
    tenant_isolation: string;
}

export interface ControlPlaneApiKeyRecord {
    id: string;
    label: string;
    key_prefix: string;
    scopes: string[];
    status: ControlPlaneApiKeyStatus;
    created_at: string;
    created_by: string | null;
    revoked_at: string | null;
    revoked_by: string | null;
    last_used_at: string | null;
}

export interface ControlPlaneAccessSecurity {
    tenant_id: string;
    auth_mode: 'session' | 'dev_bypass';
    active_sessions: ControlPlaneSessionSummary[];
    token_expiry: string | null;
    access_scope: string[];
    api_keys: ControlPlaneApiKeyRecord[];
}

export interface ControlPlaneSystemHealth {
    telemetry_status: 'connected' | 'disconnected';
    topology_state: TopologyControlPlaneState;
    event_ingestion_rate: number | null;
    network_health_score: number;
    last_inference_timestamp: string | null;
    last_outcome_timestamp: string | null;
    last_evaluation_event_timestamp: string | null;
    last_simulation_timestamp: string | null;
    warnings: string[];
}

export interface ControlPlanePipelineState {
    key: 'inference' | 'outcome' | 'evaluation' | 'telemetry_stream' | 'topology_stream';
    label: string;
    status: ControlPlanePipelineStatus;
    last_successful_event: string | null;
    error_logs: string[];
}

export interface ControlPlaneGovernanceEntry {
    registry_id: string;
    run_id: string;
    model_version: string;
    lifecycle_status: string;
    registry_role: string;
    is_active_route: boolean;
    promotion_allowed: boolean;
    deployment_decision: 'approved' | 'hold' | 'rejected';
    blockers: string[];
    gating: {
        calibration: GateStatus;
        adversarial: GateStatus;
        safety: GateStatus;
        benchmark: GateStatus;
        manual_approval: GateStatus;
    };
}

export interface ControlPlaneGovernanceFamily {
    model_family: ModelFamily;
    current_production_model: string | null;
    staging_candidate: string | null;
    rollback_target: string | null;
    active_registry_id: string | null;
    entries: ControlPlaneGovernanceEntry[];
}

export interface ControlPlaneConfiguration {
    latency_threshold_ms: number;
    drift_threshold: number;
    confidence_threshold: number;
    alert_sensitivity: ControlPlaneAlertSensitivity;
    simulation_enabled: boolean;
    updated_at: string | null;
    updated_by: string | null;
}

export interface ControlPlaneAlertRecord {
    id: string;
    severity: TopologyAlertSeverity;
    source: string;
    title: string;
    message: string;
    node_id: string | null;
    timestamp: string;
    resolved: boolean;
    metadata: Record<string, unknown>;
}

export interface ControlPlaneActionRecord {
    id: string;
    actor: string | null;
    action_type: string;
    target_type: string | null;
    target_id: string | null;
    status: ControlPlaneActionStatus;
    requires_confirmation: boolean;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface ControlPlaneLogRecord {
    id: string;
    category: ControlPlaneLogCategory;
    level: 'INFO' | 'WARN' | 'ERROR';
    message: string;
    timestamp: string;
    run_id: string | null;
    model_version: string | null;
    event_type: string | null;
}

export interface ControlPlaneDiagnostics {
    missing_tables: string[];
    disconnected_streams: string[];
    failing_pipelines: string[];
    warnings: string[];
    root_cause: string;
    where_failing: string;
    impact: string;
    next_action: string;
}

export interface ControlPlaneDebugSnapshot {
    latest_inference_event_id: string | null;
    latest_outcome_event_id: string | null;
    latest_evaluation_event_id: string | null;
    dataset_row_count: number;
    orphan_counts: {
        inference_events_missing_case_id: number;
        outcome_events_missing_case_id: number;
        simulation_events_missing_case_id: number;
    };
}

export interface ControlPlaneSnapshot {
    tenant_id: string;
    profile: ControlPlaneProfile;
    access_security: ControlPlaneAccessSecurity;
    system_health: ControlPlaneSystemHealth;
    pipelines: ControlPlanePipelineState[];
    governance: {
        families: ControlPlaneGovernanceFamily[];
        current_production_model: string | null;
        staging_candidate: string | null;
        rollback_target: string | null;
    };
    diagnostics: ControlPlaneDiagnostics;
    configuration: ControlPlaneConfiguration;
    alerts: ControlPlaneAlertRecord[];
    logs: ControlPlaneLogRecord[];
    actions: ControlPlaneActionRecord[];
    debug: ControlPlaneDebugSnapshot;
    telemetry_events: TelemetryEventRecord[];
    refreshed_at: string;
}

export interface ControlPlaneSnapshotResponse {
    snapshot: ControlPlaneSnapshot;
    request_id: string;
}
