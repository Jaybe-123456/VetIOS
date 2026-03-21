import type { ModelFamily } from '@/lib/experiments/types';
import type { TopologyNodeStatus } from '@/lib/intelligence/types';

export type DecisionEngineMode = 'observe' | 'assist' | 'autonomous';
export type DecisionExecutionStatus = 'pending' | 'executed' | 'blocked';
export type DecisionTriggerEvent =
    | 'model_drift_detected'
    | 'latency_degradation'
    | 'confidence_collapse'
    | 'accuracy_drop'
    | 'system_disconnected';
export type DecisionActionKind =
    | 'mark_model_at_risk'
    | 'switch_model'
    | 'rollback_to_previous'
    | 'block_model_promotion'
    | 'enable_safe_mode'
    | 'trigger_simulation'
    | 'restart_pipeline'
    | 'raise_alert';
export type DecisionAuditActor = 'system' | 'user';
export type DecisionAuditResult = 'success' | 'failed';

export interface DecisionActionPlan {
    kind: DecisionActionKind;
    label: string;
    payload?: Record<string, unknown>;
}

export interface DecisionEngineRecord {
    decision_id: string;
    tenant_id: string;
    decision_key: string;
    trigger_event: DecisionTriggerEvent;
    condition: string;
    action: string;
    confidence: number;
    mode: DecisionEngineMode;
    source_node_id: string | null;
    source_node_type: string | null;
    model_family: ModelFamily | null;
    registry_id: string | null;
    run_id: string | null;
    timestamp: string;
    status: DecisionExecutionStatus;
    requires_approval: boolean;
    blocked_reason: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface DecisionAuditLogRecord {
    id: string;
    decision_id: string;
    tenant_id: string;
    trigger: DecisionTriggerEvent;
    action: string;
    executed_at: string;
    result: DecisionAuditResult;
    actor: DecisionAuditActor;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface DecisionEngineConfiguration {
    latency_threshold_ms: number;
    drift_threshold: number;
    confidence_threshold: number;
    mode: DecisionEngineMode;
    safe_mode_enabled: boolean;
    abstain_threshold: number;
    auto_execute_confidence_threshold: number;
}

export interface DecisionEngineCandidate {
    decision_key: string;
    trigger_event: DecisionTriggerEvent;
    condition: string;
    actions: DecisionActionPlan[];
    confidence: number;
    source_node_id: string | null;
    source_node_type: string | null;
    model_family: ModelFamily | null;
    registry_id: string | null;
    run_id: string | null;
    requires_approval: boolean;
    severity: 'warning' | 'critical';
    node_status: TopologyNodeStatus;
    metadata: Record<string, unknown>;
}

export interface DecisionEngineEvaluationSummary {
    where_failing: string;
    root_cause: string;
    impact: string;
    next_action: string;
}

export interface DecisionEngineSnapshot {
    mode: DecisionEngineMode;
    safe_mode_enabled: boolean;
    abstain_threshold: number;
    auto_execute_confidence_threshold: number;
    last_evaluated_at: string;
    active_decision_count: number;
    latest_trigger: DecisionTriggerEvent | null;
    latest_action: string | null;
    decisions: DecisionEngineRecord[];
    audit_log: DecisionAuditLogRecord[];
    summary: DecisionEngineEvaluationSummary;
}
