/**
 * Schema Contracts
 *
 * Canonical column names for Supabase tables.
 * Use these constants in logger insert mappings to prevent
 * human errors like latency_ms vs inference_latency_ms.
 *
 * If a column name changes in the DB, update it HERE and nowhere else.
 */

// ─── ai_inference_events ────────────────────────────────────────────────────

export const AI_INFERENCE_EVENTS = {
    TABLE: 'ai_inference_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        clinic_id: 'clinic_id',
        case_id: 'case_id',
        model_name: 'model_name',
        model_version: 'model_version',
        input_signature: 'input_signature',
        output_payload: 'output_payload',
        confidence_score: 'confidence_score',
        uncertainty_metrics: 'uncertainty_metrics',
        inference_latency_ms: 'inference_latency_ms',
        created_at: 'created_at',
    },
} as const;

// ─── clinical_outcome_events ────────────────────────────────────────────────

export const CLINICAL_OUTCOME_EVENTS = {
    TABLE: 'clinical_outcome_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        clinic_id: 'clinic_id',
        case_id: 'case_id',
        inference_event_id: 'inference_event_id',
        outcome_type: 'outcome_type',
        outcome_payload: 'outcome_payload',
        outcome_timestamp: 'outcome_timestamp',
        created_at: 'created_at',
    },
} as const;

// ─── edge_simulation_events ─────────────────────────────────────────────────

export const EDGE_SIMULATION_EVENTS = {
    TABLE: 'edge_simulation_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        simulation_type: 'simulation_type',
        simulation_parameters: 'simulation_parameters',
        scenario: 'scenario',
        triggered_inference_id: 'triggered_inference_id',
        inference_output: 'inference_output',
        failure_mode: 'failure_mode',
        created_at: 'created_at',
    },
} as const;

// ─── network_intelligence_metrics ───────────────────────────────────────────

export const NETWORK_INTELLIGENCE_METRICS = {
    TABLE: 'network_intelligence_metrics',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        metric_name: 'metric_name',
        metric_scope: 'metric_scope',
        aggregated_signal: 'aggregated_signal',
        model_version: 'model_version',
        computed_at: 'computed_at',
        created_at: 'created_at',
    },
} as const;
