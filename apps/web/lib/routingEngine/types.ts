import type { ModelFamily, ModelRegistryRecord } from '@/lib/experiments/types';

export type RoutingModelType = 'fast' | 'deep_reasoning' | 'adversarial_resistant' | 'high_recall';
export type RoutingApprovalStatus = 'approved' | 'pending' | 'blocked';
export type RoutingMode = 'single' | 'ensemble' | 'manual_override';
export type RoutingExecutionStatus = 'planned' | 'executed' | 'fallback_executed' | 'failed';

export interface RoutingInputAnalysis {
    family: ModelFamily;
    complexity_score: number;
    risk_score: number;
    symptom_count: number;
    contradiction_score: number;
    confidence_expected: number;
    emergency_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
    high_risk: boolean;
    structured_signal_count: number;
    attachment_count: number;
    reasons: string[];
}

export interface RoutingModelProfile {
    id: string;
    tenant_id: string;
    model_id: string;
    model_family: ModelFamily;
    model_type: RoutingModelType;
    provider_model: string;
    model_name: string;
    model_version: string;
    registry_id: string | null;
    approval_status: RoutingApprovalStatus;
    active: boolean;
    expected_latency_ms: number;
    base_accuracy: number;
    base_cost: number;
    robustness_score: number;
    recall_score: number;
    metadata: Record<string, unknown>;
}

export interface RoutingModelPerformance {
    model_id: string;
    model_version: string;
    inference_count: number;
    avg_latency_ms: number | null;
    accuracy: number | null;
    high_risk_accuracy: number | null;
    fallback_rate: number | null;
    ensemble_rate: number | null;
}

export interface RoutingCandidate {
    profile: RoutingModelProfile;
    score: number;
    reason: string;
    blocked_reason: string | null;
    dynamic_accuracy: number | null;
    dynamic_latency_ms: number | null;
    registry_record: ModelRegistryRecord | null;
}

export interface RoutingSystemState {
    safe_mode_enabled: boolean;
    family_node_status: 'healthy' | 'degraded' | 'critical' | 'offline' | null;
    active_registry_role: string | null;
    alert_pressure: number;
}

export interface RoutingPlan {
    routing_decision_id: string;
    tenant_id: string;
    requested_model_name: string;
    requested_model_version: string;
    family: ModelFamily;
    analysis: RoutingInputAnalysis;
    route_mode: RoutingMode;
    selected_models: RoutingModelProfile[];
    fallback_model: RoutingModelProfile | null;
    candidates: RoutingCandidate[];
    reason: string;
    manual_override: boolean;
    system_state: RoutingSystemState;
}

export interface RoutingExecutionAttempt {
    model_id: string;
    model_version: string;
    provider_model: string;
    status: 'success' | 'failed';
    reason: string | null;
    prediction: string | null;
    confidence: number | null;
}

export interface RoutingExecutionResult<T> {
    routed_output: T;
    selected_model: RoutingModelProfile;
    executed_models: RoutingModelProfile[];
    attempts: RoutingExecutionAttempt[];
    route_mode: RoutingMode;
    fallback_used: boolean;
    consensus: Record<string, unknown> | null;
}

export interface RoutingDecisionRecord {
    routing_decision_id: string;
    tenant_id: string;
    case_id: string | null;
    inference_event_id: string | null;
    outcome_event_id: string | null;
    evaluation_event_id: string | null;
    requested_model_name: string;
    requested_model_version: string;
    selected_model_id: string;
    selected_provider_model: string;
    selected_model_version: string;
    selected_registry_id: string | null;
    model_family: ModelFamily;
    route_mode: RoutingMode;
    execution_status: RoutingExecutionStatus;
    trigger_reason: string;
    analysis: Record<string, unknown>;
    candidates: Record<string, unknown>[];
    fallback_chain: Record<string, unknown>[];
    consensus_payload: Record<string, unknown> | null;
    actual_latency_ms: number | null;
    prediction: string | null;
    prediction_confidence: number | null;
    outcome_correct: boolean | null;
    created_at: string;
    updated_at: string;
}
