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
        patient_id: 'patient_id',                 // uuid, nullable
        encounter_id: 'encounter_id',             // uuid, nullable
        episode_id: 'episode_id',                 // uuid, nullable
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
        episode_status: 'episode_status',         // text, nullable
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
        resolved_at: 'resolved_at',               // timestamptz, nullable
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
export const SIGNAL_SOURCES = {
    TABLE: 'signal_sources',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        clinic_id: 'clinic_id',
        source_type: 'source_type',
        vendor_name: 'vendor_name',
        vendor_account_ref: 'vendor_account_ref',
        status: 'status',
        cursor_state: 'cursor_state',
        last_synced_at: 'last_synced_at',
        metadata: 'metadata',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const PATIENT_EPISODES = {
    TABLE: 'patient_episodes',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        clinic_id: 'clinic_id',
        patient_id: 'patient_id',
        primary_condition_class: 'primary_condition_class',
        episode_key: 'episode_key',
        status: 'status',
        started_at: 'started_at',
        ended_at: 'ended_at',
        resolved_at: 'resolved_at',
        latest_case_id: 'latest_case_id',
        latest_encounter_id: 'latest_encounter_id',
        outcome_state: 'outcome_state',
        outcome_confidence: 'outcome_confidence',
        severity_peak: 'severity_peak',
        recurrence_count: 'recurrence_count',
        summary: 'summary',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const PASSIVE_SIGNAL_EVENTS = {
    TABLE: 'passive_signal_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        clinic_id: 'clinic_id',
        patient_id: 'patient_id',
        encounter_id: 'encounter_id',
        case_id: 'case_id',
        episode_id: 'episode_id',
        source_id: 'source_id',
        signal_type: 'signal_type',
        signal_subtype: 'signal_subtype',
        observed_at: 'observed_at',
        payload: 'payload',
        normalized_facts: 'normalized_facts',
        confidence: 'confidence',
        dedupe_key: 'dedupe_key',
        ingestion_status: 'ingestion_status',
        created_at: 'created_at',
    },
} as const;

export const EPISODE_EVENT_LINKS = {
    TABLE: 'episode_event_links',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        episode_id: 'episode_id',
        event_table: 'event_table',
        event_id: 'event_id',
        event_kind: 'event_kind',
        observed_at: 'observed_at',
        sequence_no: 'sequence_no',
        state_transition: 'state_transition',
        metadata: 'metadata',
        created_at: 'created_at',
    },
} as const;

export const OUTCOME_INFERENCES = {
    TABLE: 'outcome_inferences',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        clinic_id: 'clinic_id',
        episode_id: 'episode_id',
        case_id: 'case_id',
        inference_type: 'inference_type',
        inferred_state: 'inferred_state',
        confidence: 'confidence',
        window_start: 'window_start',
        window_end: 'window_end',
        rationale: 'rationale',
        evidence_event_ids: 'evidence_event_ids',
        review_status: 'review_status',
        reviewed_by: 'reviewed_by',
        reviewed_at: 'reviewed_at',
        created_at: 'created_at',
    },
} as const;

export const BENCHMARK_COHORTS = {
    TABLE: 'benchmark_cohorts',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        scope: 'scope',
        cohort_key: 'cohort_key',
        species: 'species',
        condition_class: 'condition_class',
        acuity_band: 'acuity_band',
        clinic_type: 'clinic_type',
        geography_region: 'geography_region',
        matching_rules: 'matching_rules',
        min_support: 'min_support',
        created_at: 'created_at',
    },
} as const;

export const BENCHMARK_SNAPSHOTS = {
    TABLE: 'benchmark_snapshots',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        clinic_id: 'clinic_id',
        cohort_id: 'cohort_id',
        metric_name: 'metric_name',
        window_start: 'window_start',
        window_end: 'window_end',
        support_n: 'support_n',
        observed_value: 'observed_value',
        expected_value: 'expected_value',
        risk_adjusted_value: 'risk_adjusted_value',
        oe_ratio: 'oe_ratio',
        confidence_interval: 'confidence_interval',
        computed_at: 'computed_at',
        created_at: 'created_at',
    },
} as const;

export const PROTOCOL_TEMPLATES = {
    TABLE: 'protocol_templates',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        protocol_key: 'protocol_key',
        version: 'version',
        condition_class: 'condition_class',
        trigger_rules: 'trigger_rules',
        steps: 'steps',
        writeback_targets: 'writeback_targets',
        status: 'status',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const PROTOCOL_EXECUTIONS = {
    TABLE: 'protocol_executions',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        clinic_id: 'clinic_id',
        patient_id: 'patient_id',
        encounter_id: 'encounter_id',
        episode_id: 'episode_id',
        case_id: 'case_id',
        template_id: 'template_id',
        trigger_source: 'trigger_source',
        status: 'status',
        recommended_actions: 'recommended_actions',
        accepted_actions: 'accepted_actions',
        started_at: 'started_at',
        completed_at: 'completed_at',
        created_at: 'created_at',
    },
} as const;

export const EVIDENCE_CARDS = {
    TABLE: 'evidence_cards',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        subject_type: 'subject_type',
        subject_id: 'subject_id',
        headline: 'headline',
        summary: 'summary',
        lineage: 'lineage',
        support_n: 'support_n',
        model_versions: 'model_versions',
        created_at: 'created_at',
    },
} as const;

export const TREATMENT_CANDIDATES = {
    TABLE: 'treatment_candidates',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        inference_event_id: 'inference_event_id',
        case_id: 'case_id',
        episode_id: 'episode_id',
        disease: 'disease',
        diagnosis_confidence: 'diagnosis_confidence',
        species_applicability: 'species_applicability',
        treatment_pathway: 'treatment_pathway',
        treatment_type: 'treatment_type',
        intervention_json: 'intervention_json',
        indication_criteria: 'indication_criteria',
        contraindications: 'contraindications',
        detected_contraindications: 'detected_contraindications',
        risk_level: 'risk_level',
        urgency_level: 'urgency_level',
        evidence_level: 'evidence_level',
        environment_constraints: 'environment_constraints',
        expected_outcome_json: 'expected_outcome_json',
        uncertainty_json: 'uncertainty_json',
        risks: 'risks',
        regulatory_notes: 'regulatory_notes',
        supporting_signals: 'supporting_signals',
        rationale: 'rationale',
        clinician_validation_required: 'clinician_validation_required',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const TREATMENT_EVENTS = {
    TABLE: 'treatment_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        inference_event_id: 'inference_event_id',
        case_id: 'case_id',
        episode_id: 'episode_id',
        treatment_candidate_id: 'treatment_candidate_id',
        disease: 'disease',
        selected_treatment: 'selected_treatment',
        clinician_override: 'clinician_override',
        clinician_validation_status: 'clinician_validation_status',
        context_json: 'context_json',
        selected_at: 'selected_at',
        created_at: 'created_at',
    },
} as const;

export const TREATMENT_OUTCOMES = {
    TABLE: 'treatment_outcomes',
    COLUMNS: {
        id: 'id',
        event_id: 'event_id',
        tenant_id: 'tenant_id',
        outcome_status: 'outcome_status',
        recovery_time_days: 'recovery_time_days',
        complications: 'complications',
        notes: 'notes',
        short_term_response: 'short_term_response',
        outcome_json: 'outcome_json',
        observed_at: 'observed_at',
        created_at: 'created_at',
    },
} as const;

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

export const ADVERSARIAL_SIMULATION_RUNS = {
    TABLE: 'adversarial_simulation_runs',
    COLUMNS: {
        id: 'id',
        simulation_event_id: 'simulation_event_id',
        tenant_id: 'tenant_id',
        base_case_id: 'base_case_id',
        step_index: 'step_index',
        m: 'm',
        perturbation_vector: 'perturbation_vector',
        input_variant: 'input_variant',
        output_summary: 'output_summary',
        global_phi: 'global_phi',
        state: 'state',
        collapse_risk: 'collapse_risk',
        precliff_flag: 'precliff_flag',
        instability: 'instability',
        created_at: 'created_at',
    },
} as const;

export const MODEL_EVALUATION_EVENTS = {
    TABLE: 'model_evaluation_events',
    COLUMNS: {
        id: 'id',
        evaluation_event_id: 'evaluation_event_id',
        tenant_id: 'tenant_id',
        trigger_type: 'trigger_type',
        inference_event_id: 'inference_event_id',
        outcome_event_id: 'outcome_event_id',
        case_id: 'case_id',
        model_name: 'model_name',
        model_version: 'model_version',
        prediction: 'prediction',
        prediction_confidence: 'prediction_confidence',
        ground_truth: 'ground_truth',
        prediction_correct: 'prediction_correct',
        condition_class_pred: 'condition_class_pred',
        condition_class_true: 'condition_class_true',
        severity_pred: 'severity_pred',
        severity_true: 'severity_true',
        contradiction_score: 'contradiction_score',
        adversarial_case: 'adversarial_case',
        calibration_error: 'calibration_error',
        drift_score: 'drift_score',
        outcome_alignment_delta: 'outcome_alignment_delta',
        simulation_degradation: 'simulation_degradation',
        calibrated_confidence: 'calibrated_confidence',
        epistemic_uncertainty: 'epistemic_uncertainty',
        aleatoric_uncertainty: 'aleatoric_uncertainty',
        evaluation_payload: 'evaluation_payload',
        created_at: 'created_at',
    },
} as const;

export const TELEMETRY_EVENTS = {
    TABLE: 'telemetry_events',
    COLUMNS: {
        event_id: 'event_id',
        tenant_id: 'tenant_id',
        linked_event_id: 'linked_event_id',
        source_id: 'source_id',
        source_table: 'source_table',
        event_type: 'event_type',
        timestamp: 'timestamp',
        model_version: 'model_version',
        run_id: 'run_id',
        metrics: 'metrics',
        system: 'system',
        metadata: 'metadata',
        created_at: 'created_at',
    },
} as const;

export const CONTROL_PLANE_ALERTS = {
    TABLE: 'control_plane_alerts',
    COLUMNS: {
        id: 'id',
        alert_key: 'alert_key',
        tenant_id: 'tenant_id',
        severity: 'severity',
        title: 'title',
        message: 'message',
        node_id: 'node_id',
        created_at: 'created_at',
        updated_at: 'updated_at',
        resolved: 'resolved',
        resolved_at: 'resolved_at',
        metadata: 'metadata',
    },
} as const;

export const ACCURACY_METRICS = {
    TABLE: 'accuracy_metrics',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        window_id: 'window_id',
        model_version: 'model_version',
        top1_accuracy: 'top1_accuracy',
        top3_accuracy: 'top3_accuracy',
        calibration_gap: 'calibration_gap',
        overconfidence_rate: 'overconfidence_rate',
        abstention_rate: 'abstention_rate',
        sample_size: 'sample_size',
        metadata: 'metadata',
        computed_at: 'computed_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const DISEASE_PERFORMANCE = {
    TABLE: 'disease_performance',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        window_id: 'window_id',
        disease_name: 'disease_name',
        precision: 'precision',
        recall: 'recall',
        false_positive_rate: 'false_positive_rate',
        false_negative_rate: 'false_negative_rate',
        top1_accuracy: 'top1_accuracy',
        top3_recall: 'top3_recall',
        support_n: 'support_n',
        misclassification_patterns: 'misclassification_patterns',
        metadata: 'metadata',
        computed_at: 'computed_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const FAILURE_EVENTS = {
    TABLE: 'failure_events',
    COLUMNS: {
        id: 'id',
        event_id: 'event_id',
        tenant_id: 'tenant_id',
        inference_event_id: 'inference_event_id',
        outcome_event_id: 'outcome_event_id',
        evaluation_event_id: 'evaluation_event_id',
        model_version: 'model_version',
        predicted: 'predicted',
        actual: 'actual',
        error_type: 'error_type',
        severity: 'severity',
        failure_classification: 'failure_classification',
        confidence: 'confidence',
        contradiction_score: 'contradiction_score',
        actual_in_top3: 'actual_in_top3',
        abstained: 'abstained',
        payload_json: 'payload_json',
        created_at: 'created_at',
    },
} as const;

export const MEMORY_METRICS = {
    TABLE: 'memory_metrics',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        metric_timestamp: 'metric_timestamp',
        memory_usage: 'memory_usage',
        rss_mb: 'rss_mb',
        heap_used_mb: 'heap_used_mb',
        heap_total_mb: 'heap_total_mb',
        external_mb: 'external_mb',
        buffer_size: 'buffer_size',
        log_queue_depth: 'log_queue_depth',
        retention_tier: 'retention_tier',
        metadata: 'metadata',
        created_at: 'created_at',
    },
} as const;

export const CLINICAL_INTEGRITY_EVENTS = {
    TABLE: 'clinical_integrity_events',
    COLUMNS: {
        id: 'id',
        inference_event_id: 'inference_event_id',
        tenant_id: 'tenant_id',
        perturbation_score_m: 'perturbation_score_m',
        global_phi: 'global_phi',
        delta_phi: 'delta_phi',
        curvature: 'curvature',
        variance_proxy: 'variance_proxy',
        divergence: 'divergence',
        critical_instability_index: 'critical_instability_index',
        state: 'state',
        collapse_risk: 'collapse_risk',
        precliff_detected: 'precliff_detected',
        details: 'details',
        created_at: 'created_at',
    },
} as const;

export const CONTROL_PLANE_CONFIGS = {
    TABLE: 'control_plane_configs',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        latency_threshold_ms: 'latency_threshold_ms',
        drift_threshold: 'drift_threshold',
        confidence_threshold: 'confidence_threshold',
        alert_sensitivity: 'alert_sensitivity',
        simulation_enabled: 'simulation_enabled',
        decision_mode: 'decision_mode',
        safe_mode_enabled: 'safe_mode_enabled',
        abstain_threshold: 'abstain_threshold',
        auto_execute_confidence_threshold: 'auto_execute_confidence_threshold',
        updated_by: 'updated_by',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const CONTROL_PLANE_API_KEYS = {
    TABLE: 'control_plane_api_keys',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        label: 'label',
        key_prefix: 'key_prefix',
        key_hash: 'key_hash',
        scopes: 'scopes',
        status: 'status',
        metadata: 'metadata',
        created_by: 'created_by',
        revoked_by: 'revoked_by',
        last_used_at: 'last_used_at',
        created_at: 'created_at',
        revoked_at: 'revoked_at',
    },
} as const;

export const SERVICE_ACCOUNTS = {
    TABLE: 'service_accounts',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        name: 'name',
        description: 'description',
        status: 'status',
        metadata: 'metadata',
        created_by: 'created_by',
        last_used_at: 'last_used_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const CONNECTOR_INSTALLATIONS = {
    TABLE: 'connector_installations',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        installation_name: 'installation_name',
        connector_type: 'connector_type',
        vendor_name: 'vendor_name',
        vendor_account_ref: 'vendor_account_ref',
        status: 'status',
        metadata: 'metadata',
        created_by: 'created_by',
        last_used_at: 'last_used_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const API_CREDENTIALS = {
    TABLE: 'api_credentials',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        principal_type: 'principal_type',
        service_account_id: 'service_account_id',
        connector_installation_id: 'connector_installation_id',
        label: 'label',
        key_prefix: 'key_prefix',
        key_hash: 'key_hash',
        scopes: 'scopes',
        status: 'status',
        expires_at: 'expires_at',
        metadata: 'metadata',
        created_by: 'created_by',
        revoked_by: 'revoked_by',
        last_used_at: 'last_used_at',
        created_at: 'created_at',
        revoked_at: 'revoked_at',
    },
} as const;

export const OUTBOX_EVENTS = {
    TABLE: 'outbox_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        topic: 'topic',
        handler_key: 'handler_key',
        target_type: 'target_type',
        target_ref: 'target_ref',
        idempotency_key: 'idempotency_key',
        payload: 'payload',
        headers: 'headers',
        metadata: 'metadata',
        status: 'status',
        attempt_count: 'attempt_count',
        max_attempts: 'max_attempts',
        available_at: 'available_at',
        locked_at: 'locked_at',
        locked_by: 'locked_by',
        last_error: 'last_error',
        delivered_at: 'delivered_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const CONNECTOR_DELIVERY_ATTEMPTS = {
    TABLE: 'connector_delivery_attempts',
    COLUMNS: {
        id: 'id',
        outbox_event_id: 'outbox_event_id',
        tenant_id: 'tenant_id',
        connector_installation_id: 'connector_installation_id',
        handler_key: 'handler_key',
        attempt_no: 'attempt_no',
        worker_id: 'worker_id',
        status: 'status',
        request_payload: 'request_payload',
        response_payload: 'response_payload',
        error_message: 'error_message',
        started_at: 'started_at',
        finished_at: 'finished_at',
        created_at: 'created_at',
    },
} as const;

export const CONTROL_PLANE_ACTION_LOG = {
    TABLE: 'control_plane_action_log',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        actor: 'actor',
        action_type: 'action_type',
        target_type: 'target_type',
        target_id: 'target_id',
        status: 'status',
        requires_confirmation: 'requires_confirmation',
        metadata: 'metadata',
        created_at: 'created_at',
    },
} as const;

export const TOPOLOGY_NODE_STATES = {
    TABLE: 'topology_node_states',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        node_id: 'node_id',
        node_type: 'node_type',
        status: 'status',
        latency: 'latency',
        throughput: 'throughput',
        error_rate: 'error_rate',
        drift_score: 'drift_score',
        confidence_avg: 'confidence_avg',
        last_updated: 'last_updated',
        metadata: 'metadata',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const DECISION_ENGINE = {
    TABLE: 'decision_engine',
    COLUMNS: {
        decision_id: 'decision_id',
        tenant_id: 'tenant_id',
        decision_key: 'decision_key',
        trigger_event: 'trigger_event',
        condition: 'condition',
        action: 'action',
        confidence: 'confidence',
        mode: 'mode',
        source_node_id: 'source_node_id',
        source_node_type: 'source_node_type',
        model_family: 'model_family',
        registry_id: 'registry_id',
        run_id: 'run_id',
        timestamp: 'timestamp',
        status: 'status',
        requires_approval: 'requires_approval',
        blocked_reason: 'blocked_reason',
        metadata: 'metadata',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const DECISION_AUDIT_LOG = {
    TABLE: 'decision_audit_log',
    COLUMNS: {
        id: 'id',
        decision_id: 'decision_id',
        tenant_id: 'tenant_id',
        trigger: 'trigger',
        action: 'action',
        executed_at: 'executed_at',
        result: 'result',
        actor: 'actor',
        metadata: 'metadata',
        created_at: 'created_at',
    },
} as const;

export const MODEL_ROUTER_PROFILES = {
    TABLE: 'model_router_profiles',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        model_id: 'model_id',
        model_family: 'model_family',
        model_type: 'model_type',
        provider_model: 'provider_model',
        model_name: 'model_name',
        model_version: 'model_version',
        registry_id: 'registry_id',
        approval_status: 'approval_status',
        active: 'active',
        expected_latency_ms: 'expected_latency_ms',
        base_accuracy: 'base_accuracy',
        base_cost: 'base_cost',
        robustness_score: 'robustness_score',
        recall_score: 'recall_score',
        metadata: 'metadata',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const MODEL_ROUTING_DECISIONS = {
    TABLE: 'model_routing_decisions',
    COLUMNS: {
        routing_decision_id: 'routing_decision_id',
        tenant_id: 'tenant_id',
        case_id: 'case_id',
        inference_event_id: 'inference_event_id',
        outcome_event_id: 'outcome_event_id',
        evaluation_event_id: 'evaluation_event_id',
        requested_model_name: 'requested_model_name',
        requested_model_version: 'requested_model_version',
        selected_model_id: 'selected_model_id',
        selected_provider_model: 'selected_provider_model',
        selected_model_version: 'selected_model_version',
        selected_registry_id: 'selected_registry_id',
        model_family: 'model_family',
        route_mode: 'route_mode',
        execution_status: 'execution_status',
        trigger_reason: 'trigger_reason',
        analysis: 'analysis',
        candidates: 'candidates',
        fallback_chain: 'fallback_chain',
        consensus_payload: 'consensus_payload',
        actual_latency_ms: 'actual_latency_ms',
        prediction: 'prediction',
        prediction_confidence: 'prediction_confidence',
        outcome_correct: 'outcome_correct',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const LEARNING_DATASET_VERSIONS = {
    TABLE: 'learning_dataset_versions',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        dataset_version: 'dataset_version',
        dataset_kind: 'dataset_kind',
        feature_schema_version: 'feature_schema_version',
        label_policy_version: 'label_policy_version',
        row_count: 'row_count',
        case_ids: 'case_ids',
        filters: 'filters',
        summary: 'summary',
        dataset_rows: 'dataset_rows',
        created_at: 'created_at',
    },
} as const;

export const LEARNING_CYCLES = {
    TABLE: 'learning_cycles',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        cycle_type: 'cycle_type',
        trigger_mode: 'trigger_mode',
        status: 'status',
        request_payload: 'request_payload',
        summary: 'summary',
        started_at: 'started_at',
        completed_at: 'completed_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const LEARNING_BENCHMARK_REPORTS = {
    TABLE: 'learning_benchmark_reports',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        learning_cycle_id: 'learning_cycle_id',
        model_registry_id: 'model_registry_id',
        benchmark_family: 'benchmark_family',
        task_type: 'task_type',
        report_payload: 'report_payload',
        summary_score: 'summary_score',
        pass_status: 'pass_status',
        created_at: 'created_at',
    },
} as const;

export const LEARNING_CALIBRATION_REPORTS = {
    TABLE: 'learning_calibration_reports',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        learning_cycle_id: 'learning_cycle_id',
        model_registry_id: 'model_registry_id',
        task_type: 'task_type',
        report_payload: 'report_payload',
        brier_score: 'brier_score',
        ece_score: 'ece_score',
        created_at: 'created_at',
    },
} as const;

export const MODEL_REGISTRY_ENTRIES = {
    TABLE: 'model_registry_entries',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        model_name: 'model_name',
        model_version: 'model_version',
        task_type: 'task_type',
        training_dataset_version: 'training_dataset_version',
        feature_schema_version: 'feature_schema_version',
        label_policy_version: 'label_policy_version',
        artifact_payload: 'artifact_payload',
        benchmark_scorecard: 'benchmark_scorecard',
        calibration_report_id: 'calibration_report_id',
        promotion_status: 'promotion_status',
        is_champion: 'is_champion',
        latency_profile: 'latency_profile',
        resource_profile: 'resource_profile',
        parent_model_version: 'parent_model_version',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const LEARNING_SCHEDULER_JOBS = {
    TABLE: 'learning_scheduler_jobs',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        job_name: 'job_name',
        cron_expression: 'cron_expression',
        job_type: 'job_type',
        enabled: 'enabled',
        job_config: 'job_config',
        last_run_at: 'last_run_at',
        next_run_at: 'next_run_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const LEARNING_ROLLBACK_EVENTS = {
    TABLE: 'learning_rollback_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        learning_cycle_id: 'learning_cycle_id',
        previous_model_registry_id: 'previous_model_registry_id',
        restored_model_registry_id: 'restored_model_registry_id',
        trigger_reason: 'trigger_reason',
        trigger_payload: 'trigger_payload',
        created_at: 'created_at',
    },
} as const;

export const LEARNING_AUDIT_EVENTS = {
    TABLE: 'learning_audit_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        learning_cycle_id: 'learning_cycle_id',
        event_type: 'event_type',
        event_payload: 'event_payload',
        created_at: 'created_at',
    },
} as const;

export const FEDERATION_MEMBERSHIPS = {
    TABLE: 'federation_memberships',
    COLUMNS: {
        id: 'id',
        federation_key: 'federation_key',
        tenant_id: 'tenant_id',
        coordinator_tenant_id: 'coordinator_tenant_id',
        status: 'status',
        participation_mode: 'participation_mode',
        weight: 'weight',
        metadata: 'metadata',
        created_by: 'created_by',
        last_snapshot_at: 'last_snapshot_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const FEDERATED_SITE_SNAPSHOTS = {
    TABLE: 'federated_site_snapshots',
    COLUMNS: {
        id: 'id',
        federation_key: 'federation_key',
        tenant_id: 'tenant_id',
        coordinator_tenant_id: 'coordinator_tenant_id',
        snapshot_window_start: 'snapshot_window_start',
        snapshot_window_end: 'snapshot_window_end',
        dataset_version: 'dataset_version',
        dataset_versions: 'dataset_versions',
        total_dataset_rows: 'total_dataset_rows',
        benchmark_reports: 'benchmark_reports',
        calibration_reports: 'calibration_reports',
        audit_events: 'audit_events',
        champion_models: 'champion_models',
        support_summary: 'support_summary',
        quality_summary: 'quality_summary',
        snapshot_payload: 'snapshot_payload',
        created_at: 'created_at',
    },
} as const;

export const FEDERATION_ROUNDS = {
    TABLE: 'federation_rounds',
    COLUMNS: {
        id: 'id',
        federation_key: 'federation_key',
        coordinator_tenant_id: 'coordinator_tenant_id',
        round_key: 'round_key',
        status: 'status',
        aggregation_strategy: 'aggregation_strategy',
        snapshot_cutoff_at: 'snapshot_cutoff_at',
        participant_count: 'participant_count',
        aggregate_payload: 'aggregate_payload',
        candidate_artifact_payload: 'candidate_artifact_payload',
        notes: 'notes',
        started_at: 'started_at',
        completed_at: 'completed_at',
        created_by: 'created_by',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const MODEL_DELTA_ARTIFACTS = {
    TABLE: 'model_delta_artifacts',
    COLUMNS: {
        id: 'id',
        federation_round_id: 'federation_round_id',
        federation_key: 'federation_key',
        coordinator_tenant_id: 'coordinator_tenant_id',
        tenant_id: 'tenant_id',
        artifact_role: 'artifact_role',
        task_type: 'task_type',
        model_version: 'model_version',
        dataset_version: 'dataset_version',
        artifact_payload: 'artifact_payload',
        summary: 'summary',
        created_at: 'created_at',
    },
} as const;

export const EXPERIMENT_RUNS = {
    TABLE: 'experiment_runs',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        experiment_group_id: 'experiment_group_id',
        sweep_id: 'sweep_id',
        parent_run_id: 'parent_run_id',
        baseline_run_id: 'baseline_run_id',
        task_type: 'task_type',
        modality: 'modality',
        target_type: 'target_type',
        model_arch: 'model_arch',
        model_size: 'model_size',
        model_version: 'model_version',
        registry_id: 'registry_id',
        dataset_name: 'dataset_name',
        dataset_version: 'dataset_version',
        feature_schema_version: 'feature_schema_version',
        label_policy_version: 'label_policy_version',
        epochs_planned: 'epochs_planned',
        epochs_completed: 'epochs_completed',
        metric_primary_name: 'metric_primary_name',
        metric_primary_value: 'metric_primary_value',
        status: 'status',
        status_reason: 'status_reason',
        progress_percent: 'progress_percent',
        summary_only: 'summary_only',
        created_by: 'created_by',
        hyperparameters: 'hyperparameters',
        dataset_lineage: 'dataset_lineage',
        config_snapshot: 'config_snapshot',
        safety_metrics: 'safety_metrics',
        resource_usage: 'resource_usage',
        registry_context: 'registry_context',
        last_heartbeat_at: 'last_heartbeat_at',
        started_at: 'started_at',
        ended_at: 'ended_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const EXPERIMENT_METRICS = {
    TABLE: 'experiment_metrics',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        epoch: 'epoch',
        global_step: 'global_step',
        train_loss: 'train_loss',
        val_loss: 'val_loss',
        train_accuracy: 'train_accuracy',
        val_accuracy: 'val_accuracy',
        learning_rate: 'learning_rate',
        gradient_norm: 'gradient_norm',
        macro_f1: 'macro_f1',
        recall_critical: 'recall_critical',
        calibration_error: 'calibration_error',
        adversarial_score: 'adversarial_score',
        false_negative_critical_rate: 'false_negative_critical_rate',
        dangerous_false_reassurance_rate: 'dangerous_false_reassurance_rate',
        abstain_accuracy: 'abstain_accuracy',
        contradiction_detection_rate: 'contradiction_detection_rate',
        wall_clock_time_seconds: 'wall_clock_time_seconds',
        steps_per_second: 'steps_per_second',
        gpu_utilization: 'gpu_utilization',
        cpu_utilization: 'cpu_utilization',
        memory_utilization: 'memory_utilization',
        metric_timestamp: 'metric_timestamp',
        created_at: 'created_at',
    },
} as const;

export const EXPERIMENT_ARTIFACTS = {
    TABLE: 'experiment_artifacts',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        artifact_type: 'artifact_type',
        label: 'label',
        uri: 'uri',
        metadata: 'metadata',
        is_primary: 'is_primary',
        created_at: 'created_at',
    },
} as const;

export const EXPERIMENT_FAILURES = {
    TABLE: 'experiment_failures',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        failure_reason: 'failure_reason',
        failure_epoch: 'failure_epoch',
        failure_step: 'failure_step',
        last_train_loss: 'last_train_loss',
        last_val_loss: 'last_val_loss',
        last_learning_rate: 'last_learning_rate',
        last_gradient_norm: 'last_gradient_norm',
        nan_detected: 'nan_detected',
        checkpoint_recovery_attempted: 'checkpoint_recovery_attempted',
        stack_trace_excerpt: 'stack_trace_excerpt',
        error_summary: 'error_summary',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const EXPERIMENT_BENCHMARKS = {
    TABLE: 'experiment_benchmarks',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        benchmark_family: 'benchmark_family',
        task_type: 'task_type',
        summary_score: 'summary_score',
        pass_status: 'pass_status',
        report_payload: 'report_payload',
        created_at: 'created_at',
    },
} as const;

export const EXPERIMENT_REGISTRY_LINKS = {
    TABLE: 'experiment_registry_links',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        model_registry_entry_id: 'model_registry_entry_id',
        registry_candidate_id: 'registry_candidate_id',
        champion_or_challenger: 'champion_or_challenger',
        promotion_status: 'promotion_status',
        calibration_status: 'calibration_status',
        adversarial_gate_status: 'adversarial_gate_status',
        benchmark_status: 'benchmark_status',
        manual_approval_status: 'manual_approval_status',
        deployment_eligibility: 'deployment_eligibility',
        linked_at: 'linked_at',
        updated_at: 'updated_at',
    },
} as const;

export const MODEL_REGISTRY = {
    TABLE: 'model_registry',
    COLUMNS: {
        registry_id: 'registry_id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        model_name: 'model_name',
        model_version: 'model_version',
        model_family: 'model_family',
        artifact_uri: 'artifact_uri',
        dataset_version: 'dataset_version',
        feature_schema_version: 'feature_schema_version',
        label_policy_version: 'label_policy_version',
        lifecycle_status: 'lifecycle_status',
        registry_role: 'registry_role',
        deployed_at: 'deployed_at',
        archived_at: 'archived_at',
        promoted_from: 'promoted_from',
        rollback_target: 'rollback_target',
        clinical_metrics: 'clinical_metrics',
        lineage: 'lineage',
        rollback_metadata: 'rollback_metadata',
        artifact_path: 'artifact_path',
        status: 'status',
        role: 'role',
        created_at: 'created_at',
        created_by: 'created_by',
        updated_at: 'updated_at',
    },
} as const;

export const PROMOTION_REQUIREMENTS = {
    TABLE: 'promotion_requirements',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        registry_id: 'registry_id',
        run_id: 'run_id',
        calibration_pass: 'calibration_pass',
        adversarial_pass: 'adversarial_pass',
        safety_pass: 'safety_pass',
        benchmark_pass: 'benchmark_pass',
        manual_approval: 'manual_approval',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const CALIBRATION_METRICS = {
    TABLE: 'calibration_metrics',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        ece: 'ece',
        brier_score: 'brier_score',
        reliability_bins: 'reliability_bins',
        confidence_histogram: 'confidence_histogram',
        calibration_pass: 'calibration_pass',
        calibration_notes: 'calibration_notes',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const ADVERSARIAL_METRICS = {
    TABLE: 'adversarial_metrics',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        degradation_score: 'degradation_score',
        contradiction_robustness: 'contradiction_robustness',
        critical_case_recall: 'critical_case_recall',
        false_reassurance_rate: 'false_reassurance_rate',
        dangerous_false_reassurance_rate: 'dangerous_false_reassurance_rate',
        adversarial_pass: 'adversarial_pass',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const AUDIT_LOG = {
    TABLE: 'audit_log',
    COLUMNS: {
        event_id: 'event_id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        event_type: 'event_type',
        actor: 'actor',
        metadata: 'metadata',
        timestamp: 'timestamp',
        created_at: 'created_at',
    },
} as const;

export const REGISTRY_AUDIT_LOG = {
    TABLE: 'registry_audit_log',
    COLUMNS: {
        event_id: 'event_id',
        tenant_id: 'tenant_id',
        registry_id: 'registry_id',
        run_id: 'run_id',
        event_type: 'event_type',
        actor: 'actor',
        metadata: 'metadata',
        timestamp: 'timestamp',
        created_at: 'created_at',
    },
} as const;

export const DEPLOYMENT_DECISIONS = {
    TABLE: 'deployment_decisions',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        decision: 'decision',
        reason: 'reason',
        calibration_pass: 'calibration_pass',
        adversarial_pass: 'adversarial_pass',
        safety_pass: 'safety_pass',
        benchmark_pass: 'benchmark_pass',
        manual_approval: 'manual_approval',
        approved_by: 'approved_by',
        timestamp: 'timestamp',
        created_at: 'created_at',
        updated_at: 'updated_at',
    },
} as const;

export const MODEL_REGISTRY_ROUTING = {
    TABLE: 'model_registry_routing',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        model_family: 'model_family',
        active_registry_id: 'active_registry_id',
        active_run_id: 'active_run_id',
        updated_at: 'updated_at',
        updated_by: 'updated_by',
    },
} as const;

export const SUBGROUP_METRICS = {
    TABLE: 'subgroup_metrics',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        run_id: 'run_id',
        group: 'group',
        group_value: 'group_value',
        metric: 'metric',
        value: 'value',
        created_at: 'created_at',
    },
} as const;
