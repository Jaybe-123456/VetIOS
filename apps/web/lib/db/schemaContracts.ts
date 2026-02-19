/**
 * Schema Contracts — Single source of truth for DB column names.
 *
 * Generated from live Supabase schema query on 2026-02-19.
 * Update HERE if column renames happen — nowhere else.
 */

// ─── ai_inference_events ────────────────────────────────────────────────────
export const AI_INFERENCE_EVENTS = {
    TABLE: 'ai_inference_events',
    COLUMNS: {
        id: 'id',                                 // uuid, PK
        tenant_id: 'tenant_id',                   // uuid, NOT NULL
        clinic_id: 'clinic_id',                   // uuid, nullable
        case_id: 'case_id',                       // uuid, nullable
        model_name: 'model_name',                 // text, NOT NULL
        model_version: 'model_version',           // text, NOT NULL
        input_signature: 'input_signature',       // jsonb, NOT NULL
        output_payload: 'output_payload',         // jsonb, NOT NULL
        confidence_score: 'confidence_score',     // double precision, nullable
        uncertainty_metrics: 'uncertainty_metrics', // jsonb, nullable
        inference_latency_ms: 'inference_latency_ms', // integer, nullable
        compute_profile: 'compute_profile',       // jsonb, nullable
        created_at: 'created_at',                 // timestamptz, NOT NULL
    },
} as const;

// ─── clinical_outcome_events ────────────────────────────────────────────────
export const CLINICAL_OUTCOME_EVENTS = {
    TABLE: 'clinical_outcome_events',
    COLUMNS: {
        id: 'id',                                 // uuid, PK
        tenant_id: 'tenant_id',                   // uuid, NOT NULL
        clinic_id: 'clinic_id',                   // uuid, nullable
        case_id: 'case_id',                       // uuid, nullable
        inference_event_id: 'inference_event_id', // uuid, nullable
        outcome_type: 'outcome_type',             // text, NOT NULL
        outcome_payload: 'outcome_payload',       // jsonb, NOT NULL
        outcome_timestamp: 'outcome_timestamp',   // timestamptz, NOT NULL
        clinician_feedback_score: 'clinician_feedback_score', // double precision, nullable
        clinician_notes: 'clinician_notes',       // text, nullable
        created_at: 'created_at',                 // timestamptz, NOT NULL
    },
} as const;

// ─── edge_simulation_events ─────────────────────────────────────────────────
// NOTE: This table has NO tenant_id, NO scenario, NO inference_output.
//       It uses stress_metrics (jsonb) and is_real_world (boolean).
export const EDGE_SIMULATION_EVENTS = {
    TABLE: 'edge_simulation_events',
    COLUMNS: {
        id: 'id',                                     // uuid, PK
        simulation_type: 'simulation_type',           // text, NOT NULL
        simulation_parameters: 'simulation_parameters', // jsonb, NOT NULL
        triggered_inference_id: 'triggered_inference_id', // uuid, nullable
        failure_mode: 'failure_mode',                 // text, nullable
        stress_metrics: 'stress_metrics',             // jsonb, nullable
        is_real_world: 'is_real_world',               // boolean, NOT NULL
        created_at: 'created_at',                     // timestamptz, NOT NULL
    },
} as const;

// ─── network_intelligence_metrics ───────────────────────────────────────────
// NOTE: No tenant_id. Has contributing_tenant_count instead.
export const NETWORK_INTELLIGENCE_METRICS = {
    TABLE: 'network_intelligence_metrics',
    COLUMNS: {
        id: 'id',                                         // uuid, PK
        metric_name: 'metric_name',                       // text, NOT NULL
        metric_scope: 'metric_scope',                     // text, NOT NULL
        aggregated_signal: 'aggregated_signal',           // jsonb, NOT NULL
        contributing_tenant_count: 'contributing_tenant_count', // integer, NOT NULL
        model_version: 'model_version',                   // text, nullable
        computed_at: 'computed_at',                        // timestamptz, NOT NULL
    },
} as const;
