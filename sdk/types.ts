export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonObject
    | JsonValue[];

export interface JsonObject {
    [key: string]: JsonValue | undefined;
}

export interface ApiError {
    code: string;
    message: string;
}

export interface ApiMeta {
    tenant_id: string | null;
    timestamp: string;
    version: string;
    request_id?: string;
    next_cursor?: string | null;
    limit?: number;
}

export interface ApiEnvelope<T> {
    data: T;
    meta: ApiMeta;
    error: ApiError | null;
}

export interface RateLimitExceeded {
    error: 'rate_limit_exceeded';
    tenant_id: string;
    limit: number;
    window_seconds: number;
    retry_after_seconds: number;
}

export interface InferenceCreateRequest {
    clinic_id?: string;
    case_id?: string;
    model: {
        name: string;
        version: string;
    };
    input: {
        input_signature: {
            species?: string | null;
            breed?: string | null;
            symptoms: string[];
            metadata?: JsonObject;
            diagnostic_images?: JsonObject[];
            lab_results?: JsonObject[];
        };
    };
}

export interface InferenceListItem {
    id: string;
    tenant_id: string;
    model_name: string;
    model_version: string;
    input_signature: JsonObject;
    output_payload: JsonObject;
    confidence_score: number | null;
    created_at: string;
    flagged: boolean;
    flag_reason: string | null;
    blocked: boolean;
}

export interface InferenceAutoOutcome {
    id: string;
    status: 'pending' | 'scored' | 'failed';
}

export interface InferenceEvaluationSummary {
    id: string;
    score: number;
    dataset_version: number | null;
}

export interface InferenceCreateResponse {
    inference_event_id: string;
    clinical_case_id: string;
    episode_id: string | null;
    episode_reconcile_error?: string | null;
    prediction: JsonObject;
    output: JsonObject;
    confidence_score: number | null;
    uncertainty_metrics?: JsonObject | null;
    contradiction_analysis?: JsonObject | null;
    differential_spread?: JsonValue;
    inference_latency_ms: number;
    integrity?: JsonObject;
    safety_policy?: JsonObject;
    evaluation: InferenceEvaluationSummary | null;
    auto_outcome: InferenceAutoOutcome | null;
    flywheel_error: string | null;
    ml_risk?: JsonObject | null;
    routing: JsonObject;
    request_id?: string;
}

export interface InferenceBlockedResponse {
    blocked: true;
    reason: string;
    policy_id: string | null;
    request_id?: string;
}

export interface OutcomeCreateRequest {
    inference_event_id: string;
    clinic_id?: string;
    case_id?: string;
    outcome: {
        type: string;
        payload: JsonObject;
        timestamp: string;
    };
}

export interface OutcomeCreateResponse {
    outcome_event_id: string;
    episode_id: string | null;
    episode_reconcile_error?: string | null;
    outcome_inference_id?: string | null;
    evidence_card_id?: string | null;
    artifact_error?: string | null;
    protocol_template_id?: string | null;
    protocol_execution_id?: string | null;
    protocol_error?: string | null;
    benchmark_cohort_id?: string | null;
    benchmark_snapshot_id?: string | null;
    benchmark_snapshot?: JsonObject | null;
    benchmark_error?: string | null;
    linked_inference_event_id: string;
    evaluation?: LegacyEvaluationRecord | null;
    idempotent?: boolean;
    request_id?: string;
}

export interface SimulateRunRequest {
    base_case?: JsonObject;
    steps?: number;
    mode?: 'linear' | 'adaptive';
    simulation?: {
        type: string;
        parameters: JsonObject;
    };
    inference?: {
        model: string;
        model_version?: string;
    };
}

export interface SimulateRunResponse {
    simulation_event_id: string;
    triggered_inference_event_id: string | null;
    clinical_case_id: string;
    inference_output: JsonObject;
    confidence_score: number | null;
    inference_latency_ms: number;
    contradiction_analysis?: JsonObject | null;
    differential_diagnosis?: JsonValue;
    differential_spread?: JsonValue;
    target_evaluation?: JsonObject | null;
    stability_report?: JsonObject | null;
    simulation: JsonObject;
    request_id?: string;
}

export interface EvaluationCreateRequest {
    outcome_id?: string;
    inference_event_id?: string;
    model_name: string;
    model_version: string;
    predicted_confidence?: number;
    trigger_type?: 'inference' | 'outcome' | 'simulation';
}

export interface LegacyEvaluationRecord {
    id: string;
    inference_event_id?: string | null;
    model_name?: string;
    model_version?: string;
    calibration_error?: number | null;
    drift_score?: number | null;
    outcome_alignment_delta?: number | null;
    calibrated_confidence?: number | null;
    epistemic_uncertainty?: number | null;
    aleatoric_uncertainty?: number | null;
    [key: string]: JsonValue | undefined;
}

export interface PlatformEvaluation {
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

export type EvaluationCreateResponse = PlatformEvaluation | LegacyEvaluationRecord;

export interface EvaluationListResponse {
    evaluations: Array<PlatformEvaluation | JsonObject>;
    summary: {
        total_evaluations: number;
        mean_score: number | null;
        mean_calibration_error: number | null;
        mean_drift_score: number | null;
        rolling_top1_accuracy: number | null;
        rolling_top3_accuracy: number | null;
        calibration_gap: number | null;
        overconfidence_rate: number | null;
        abstention_rate: number | null;
        recent_failure_events: number;
    };
}

export interface DatasetStatsResponse {
    row_count: number;
    request_id?: string;
}

export interface OrphanCountResponse {
    count: number;
    request_id?: string;
}

export interface DatasetSnapshot {
    id: string;
    tenant_id: string;
    version: number;
    row_count: number;
    trigger: 'backfill' | 'manual' | 'evaluation';
    snapshot_at: string;
    created_at: string;
    updated_at: string;
}

export interface GovernancePolicyRules {
    max_token_limit?: number | null;
    allowed_model_versions?: string[] | null;
    blocked_prompt_patterns?: string[] | null;
    require_outcome_logging?: boolean | null;
    max_requests_per_minute?: number | null;
    blocked_model_versions?: string[] | null;
}

export interface GovernancePolicy {
    id: string;
    tenant_id: string;
    name: string;
    status: 'draft' | 'active' | 'archived';
    rules: GovernancePolicyRules;
    metadata: JsonObject;
    activated_at: string | null;
    archived_at: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface GovernancePolicyCreateRequest {
    tenant_id?: string | null;
    name?: string;
    rules?: GovernancePolicyRules;
    metadata?: JsonObject;
}

export interface GovernancePolicyActivateRequest {
    tenant_id?: string | null;
}

export interface GovernanceAuditEvent {
    id: string;
    tenant_id: string;
    event_type: 'policy_updated' | 'policy_applied' | 'request_blocked' | 'request_flagged' | 'model_version_changed' | 'governance_override';
    actor: string | null;
    payload: JsonObject;
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
    metadata: JsonObject;
    created_at?: string;
    updated_at?: string;
}

export interface AlertCreateRequest {
    tenant_id?: string | null;
    type: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    message: string;
    metadata?: JsonObject;
}

export interface AlertRecord {
    id: string;
    tenant_id?: string;
    severity?: string;
    title?: string;
    message?: string;
    metadata?: JsonObject;
    created_at?: string;
    updated_at?: string;
    [key: string]: JsonValue | undefined;
}

export interface TenantRateLimitConfig {
    tenant_id: string;
    inference_requests_per_minute: number;
    evaluation_requests_per_minute: number;
    simulate_requests_per_minute: number;
    created_at?: string;
    updated_at?: string;
}

export interface TenantRateLimitUpdateRequest {
    tenant_id?: string | null;
    inference_requests_per_minute?: number;
    evaluation_requests_per_minute?: number;
    simulate_requests_per_minute?: number;
}

export interface ModelVersionOption {
    model_version: string;
}

export interface WebhookSubscription {
    id: string;
    tenant_id: string;
    url: string;
    events: string[];
    secret: string;
    active: boolean;
    created_at: string;
    updated_at: string;
}

export interface WebhookCreateRequest {
    tenant_id?: string | null;
    url: string;
    events: string[];
    secret?: string | null;
    active?: boolean;
}

export interface SimulationScenarioRequest {
    mode?: 'scenario_load';
    scenario_name: string;
    agent_count: number;
    requests_per_agent: number;
    request_rate_per_second: number;
    model_version: string;
    prompt_distribution: Array<{
        prompt: string;
        weight: number;
    }>;
    duration_seconds: number;
}

export interface SimulationAdversarialRequest {
    mode: 'adversarial';
    scenario_name?: string;
    model_version: string;
    categories: Array<'jailbreak' | 'injection' | 'gibberish' | 'extreme_length' | 'multilingual' | 'sensitive_topic'>;
}

export interface SimulationRegressionRequest {
    mode: 'regression';
    scenario_name?: string;
    candidate_model_version: string;
}

export type SimulationRunRequest =
    | SimulationScenarioRequest
    | SimulationAdversarialRequest
    | SimulationRegressionRequest;

export interface SimulationRecord {
    id: string;
    tenant_id: string;
    scenario_name: string;
    mode: 'scenario_load' | 'adversarial' | 'regression';
    status: 'queued' | 'running' | 'completed' | 'failed';
    config: JsonObject;
    summary: JsonObject;
    completed: number;
    total: number;
    candidate_model_version: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
}

export interface SimulationProgress {
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    completed: number;
    total: number;
    summary: JsonObject;
    error_message: string | null;
}

export interface RequestOptions {
    signal?: AbortSignal;
}
