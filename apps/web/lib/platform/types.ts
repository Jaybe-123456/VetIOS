export type PlatformRole = 'system_admin' | 'tenant_user';

export interface PlatformApiError {
    code: string;
    message: string;
}

export interface PlatformEnvelopeMeta {
    tenant_id: string | null;
    timestamp: string;
    version: string;
    [key: string]: unknown;
}

export interface PlatformEnvelope<T> {
    data: T;
    meta: PlatformEnvelopeMeta;
    error: PlatformApiError | null;
}

export interface PlatformActor {
    userId: string | null;
    tenantId: string | null;
    role: PlatformRole;
    authMode: 'jwt' | 'session' | 'dev_bypass' | 'service_account' | 'connector_installation';
    scopes: string[];
    tenantScope: string | null;
}

export interface GovernancePolicyRules {
    max_token_limit?: number | null;
    allowed_model_versions?: string[] | null;
    blocked_prompt_patterns?: string[] | null;
    require_outcome_logging?: boolean | null;
    max_requests_per_minute?: number | null;
    blocked_model_versions?: string[] | null;
}

export interface GovernancePolicyRecord {
    id: string;
    tenant_id: string;
    name: string;
    status: 'draft' | 'active' | 'archived';
    rules: GovernancePolicyRules;
    metadata: Record<string, unknown>;
    activated_at: string | null;
    archived_at: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface PlatformTelemetryRecord {
    id?: string;
    telemetry_key: string;
    inference_event_id: string | null;
    tenant_id: string;
    pipeline_id: string;
    model_version: string;
    latency_ms: number;
    token_count_input: number;
    token_count_output: number;
    outcome_linked: boolean;
    evaluation_score: number | null;
    flagged: boolean;
    blocked: boolean;
    timestamp: string;
    metadata: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
}

export interface OutcomeRecord {
    id: string;
    inference_event_id: string;
    tenant_id: string;
    status: 'pending' | 'scored' | 'failed';
    raw_output: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface EvaluationRecord {
    id: string;
    outcome_id: string;
    inference_event_id: string;
    tenant_id: string;
    model_version: string;
    score: number;
    scorer: 'auto' | 'human';
    dataset_version: number | null;
    evaluated_at: string;
    created_at: string;
    updated_at: string;
}

export interface DatasetSnapshotRecord {
    id: string;
    tenant_id: string;
    version: number;
    row_count: number;
    trigger: 'backfill' | 'manual' | 'evaluation';
    snapshot_at: string;
    created_at: string;
    updated_at: string;
}

export interface TenantRateLimitConfig {
    tenant_id: string;
    inference_requests_per_minute: number;
    evaluation_requests_per_minute: number;
    simulate_requests_per_minute: number;
    created_at: string;
    updated_at: string;
}

export interface WebhookSubscriptionRecord {
    id: string;
    tenant_id: string;
    url: string;
    events: string[];
    secret: string;
    active: boolean;
    created_at: string;
    updated_at: string;
}

export interface WebhookDeliveryRecord {
    id: string;
    subscription_id: string;
    tenant_id: string;
    event_type: string;
    attempt_no: number;
    status_code: number | null;
    success: boolean;
    request_payload: Record<string, unknown>;
    response_payload: Record<string, unknown>;
    error_message: string | null;
    created_at: string;
    updated_at: string;
}

export interface SimulationRecord {
    id: string;
    tenant_id: string;
    scenario_name: string;
    mode: 'scenario_load' | 'adversarial' | 'regression';
    status: 'queued' | 'running' | 'completed' | 'failed';
    config: Record<string, unknown>;
    summary: Record<string, unknown>;
    completed: number;
    total: number;
    candidate_model_version: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
}
