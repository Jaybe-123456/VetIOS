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
        user_id: 'user_id',                       // uuid, nullable
        clinic_id: 'clinic_id',                   // uuid, nullable
        case_id: 'case_id',                       // uuid, nullable
        source_module: 'source_module',           // text, nullable
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
export const CLINICAL_CASES = {
    TABLE: 'clinical_cases',
    COLUMNS: {
        id: 'id',                                 // uuid, PK
        tenant_id: 'tenant_id',                   // uuid, NOT NULL
        user_id: 'user_id',                       // uuid, nullable
        clinic_id: 'clinic_id',                   // uuid, nullable
        source_module: 'source_module',           // text, nullable
        case_key: 'case_key',                     // text, NOT NULL
        source_case_reference: 'source_case_reference', // text, nullable
        species: 'species',                       // text, nullable
        species_canonical: 'species_canonical',   // text, nullable
        species_display: 'species_display',       // text, nullable
        species_raw: 'species_raw',               // text, nullable
        breed: 'breed',                           // text, nullable
        symptom_text_raw: 'symptom_text_raw',     // text, nullable
        symptoms_raw: 'symptoms_raw',             // text, nullable
        symptoms_normalized: 'symptoms_normalized', // text[], NOT NULL
        symptom_vector: 'symptom_vector',         // text[], NOT NULL
        symptom_vector_normalized: 'symptom_vector_normalized', // jsonb, NOT NULL
        symptom_summary: 'symptom_summary',       // text, nullable
        patient_metadata: 'patient_metadata',     // jsonb, NOT NULL
        metadata: 'metadata',                     // jsonb, NOT NULL
        latest_input_signature: 'latest_input_signature', // jsonb, NOT NULL
        ingestion_status: 'ingestion_status',     // text, NOT NULL
        invalid_case: 'invalid_case',             // boolean, NOT NULL
        validation_error_code: 'validation_error_code', // text, nullable
        primary_condition_class: 'primary_condition_class', // text, nullable
        top_diagnosis: 'top_diagnosis',           // text, nullable
        predicted_diagnosis: 'predicted_diagnosis', // text, nullable
        confirmed_diagnosis: 'confirmed_diagnosis', // text, nullable
        label_type: 'label_type',                 // text, NOT NULL
        diagnosis_confidence: 'diagnosis_confidence', // double precision, nullable
        severity_score: 'severity_score',         // double precision, nullable
        emergency_level: 'emergency_level',       // text, nullable
        triage_priority: 'triage_priority',       // text, nullable
        contradiction_score: 'contradiction_score', // double precision, nullable
        contradiction_flags: 'contradiction_flags', // text[], NOT NULL
        adversarial_case: 'adversarial_case',     // boolean, NOT NULL
        adversarial_case_type: 'adversarial_case_type', // text, nullable
        uncertainty_notes: 'uncertainty_notes',   // text[], NOT NULL
        case_cluster: 'case_cluster',             // text, nullable
        model_version: 'model_version',           // text, nullable
        telemetry_status: 'telemetry_status',     // text, nullable
        calibration_status: 'calibration_status', // text, nullable
        prediction_correct: 'prediction_correct', // boolean, nullable
        confidence_error: 'confidence_error',     // double precision, nullable
        calibration_bucket: 'calibration_bucket', // text, nullable
        degraded_confidence: 'degraded_confidence', // double precision, nullable
        differential_spread: 'differential_spread', // jsonb, nullable
        latest_inference_event_id: 'latest_inference_event_id', // uuid, nullable
        latest_outcome_event_id: 'latest_outcome_event_id', // uuid, nullable
        latest_simulation_event_id: 'latest_simulation_event_id', // uuid, nullable
        inference_event_count: 'inference_event_count', // integer, NOT NULL
        first_inference_at: 'first_inference_at', // timestamptz, NOT NULL
        last_inference_at: 'last_inference_at',   // timestamptz, NOT NULL
        created_at: 'created_at',                 // timestamptz, NOT NULL
        updated_at: 'updated_at',                 // timestamptz, NOT NULL
    },
} as const;

export const CLINICAL_CASE_LIVE_VIEW = {
    TABLE: 'clinical_case_live_view',
    COLUMNS: {
        case_id: 'case_id',
        tenant_id: 'tenant_id',
        user_id: 'user_id',
        species: 'species',
        breed: 'breed',
        symptoms_summary: 'symptoms_summary',
        symptom_vector_normalized: 'symptom_vector_normalized',
        primary_condition_class: 'primary_condition_class',
        top_diagnosis: 'top_diagnosis',
        predicted_diagnosis: 'predicted_diagnosis',
        confirmed_diagnosis: 'confirmed_diagnosis',
        label_type: 'label_type',
        diagnosis_confidence: 'diagnosis_confidence',
        severity_score: 'severity_score',
        triage_priority: 'triage_priority',
        contradiction_score: 'contradiction_score',
        contradiction_flags: 'contradiction_flags',
        uncertainty_notes: 'uncertainty_notes',
        case_cluster: 'case_cluster',
        model_version: 'model_version',
        telemetry_status: 'telemetry_status',
        calibration_status: 'calibration_status',
        prediction_correct: 'prediction_correct',
        confidence_error: 'confidence_error',
        calibration_bucket: 'calibration_bucket',
        degraded_confidence: 'degraded_confidence',
        differential_spread: 'differential_spread',
        ingestion_status: 'ingestion_status',
        invalid_case: 'invalid_case',
        validation_error_code: 'validation_error_code',
        adversarial_case: 'adversarial_case',
        adversarial_case_type: 'adversarial_case_type',
        latest_inference_event_id: 'latest_inference_event_id',
        latest_outcome_event_id: 'latest_outcome_event_id',
        latest_simulation_event_id: 'latest_simulation_event_id',
        latest_confidence: 'latest_confidence',
        latest_emergency_level: 'latest_emergency_level',
        source_module: 'source_module',
        updated_at: 'updated_at',
    },
} as const;

export const CLINICAL_OUTCOME_EVENTS = {
    TABLE: 'clinical_outcome_events',
    COLUMNS: {
        id: 'id',                                 // uuid, PK
        tenant_id: 'tenant_id',                   // uuid, NOT NULL
        user_id: 'user_id',                       // uuid, nullable
        clinic_id: 'clinic_id',                   // uuid, nullable
        case_id: 'case_id',                       // uuid, nullable
        source_module: 'source_module',           // text, nullable
        inference_event_id: 'inference_event_id', // uuid, nullable
        outcome_type: 'outcome_type',             // text, NOT NULL
        outcome_payload: 'outcome_payload',       // jsonb, NOT NULL
        outcome_timestamp: 'outcome_timestamp',   // timestamptz, NOT NULL
        clinician_feedback_score: 'clinician_feedback_score', // double precision, nullable
        clinician_notes: 'clinician_notes',       // text, nullable
        label_type: 'label_type',                 // text, nullable (synthetic, expert, confirmed)
        created_at: 'created_at',                 // timestamptz, NOT NULL
    },
} as const;

// ─── outcome_calibrations ───────────────────────────────────────────────────
export const OUTCOME_CALIBRATIONS = {
    TABLE: 'outcome_calibrations',
    COLUMNS: {
        id: 'id',                                 // uuid, PK
        tenant_id: 'tenant_id',                   // uuid, NOT NULL
        inference_event_id: 'inference_event_id', // uuid, NOT NULL
        outcome_event_id: 'outcome_event_id',     // uuid, NOT NULL
        predicted_confidence: 'predicted_confidence', // double precision, nullable
        actual_correctness: 'actual_correctness', // double precision, nullable
        calibration_error: 'calibration_error',   // double precision, nullable
        brier_score: 'brier_score',               // double precision, nullable
        created_at: 'created_at',                 // timestamptz, NOT NULL
    },
} as const;

// ─── learning_reinforcements ─────────────────────────────────────────────────
export const LEARNING_REINFORCEMENTS = {
    TABLE: 'learning_reinforcements',
    COLUMNS: {
        id: 'id',                                 // uuid, PK
        tenant_id: 'tenant_id',                   // uuid, NOT NULL
        inference_event_id: 'inference_event_id', // uuid, NOT NULL
        diagnosis_label: 'diagnosis_label',       // text, nullable
        condition_class: 'condition_class',       // text, nullable
        severity_label: 'severity_label',         // text, nullable
        features: 'features',                     // jsonb, NOT NULL
        reinforcement_type: 'reinforcement_type', // text, NOT NULL (Diagnosis | Severity | Calibration)
        impact_delta: 'impact_delta',             // double precision, NOT NULL
        created_at: 'created_at',                 // timestamptz, NOT NULL
    },
} as const;

// ─── model_improvement_audits ───────────────────────────────────────────────
export const MODEL_IMPROVEMENT_AUDITS = {
    TABLE: 'model_improvement_audits',
    COLUMNS: {
        id: 'id',                                 // uuid, PK
        tenant_id: 'tenant_id',                   // uuid, NOT NULL
        inference_event_id: 'inference_event_id', // uuid, NOT NULL
        pre_update_prediction: 'pre_update_prediction', // jsonb, nullable
        post_update_prediction: 'post_update_prediction', // jsonb, nullable
        pre_confidence: 'pre_confidence',         // double precision, nullable
        post_confidence: 'post_confidence',       // double precision, nullable
        improvement_delta: 'improvement_delta',   // double precision, NOT NULL
        created_at: 'created_at',                 // timestamptz, NOT NULL
    },
} as const;

// ─── error_clusters ─────────────────────────────────────────────────────────
export const ERROR_CLUSTERS = {
    TABLE: 'error_clusters',
    COLUMNS: {
        id: 'id',                                       // uuid, PK
        tenant_id: 'tenant_id',                         // uuid, NOT NULL
        cluster_signature: 'cluster_signature',         // text, NOT NULL
        misclassification_type: 'misclassification_type', // text, nullable
        severity_error: 'severity_error',               // double precision, nullable
        contradiction_presence: 'contradiction_presence', // boolean, nullable
        frequency: 'frequency',                         // integer, NOT NULL
        created_at: 'created_at',                       // timestamptz, NOT NULL
        updated_at: 'updated_at',                       // timestamptz, NOT NULL
    },
} as const;

// ─── edge_simulation_events ─────────────────────────────────────────────────
export const EDGE_SIMULATION_EVENTS = {
    TABLE: 'edge_simulation_events',
    COLUMNS: {
        id: 'id',                                     // uuid, PK
        tenant_id: 'tenant_id',                       // uuid, nullable
        user_id: 'user_id',                           // uuid, nullable
        clinic_id: 'clinic_id',                       // uuid, nullable
        case_id: 'case_id',                           // uuid, nullable
        source_module: 'source_module',               // text, nullable
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
