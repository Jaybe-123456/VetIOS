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

export const MODEL_EVALUATION_EVENTS = {
    TABLE: 'model_evaluation_events',
    COLUMNS: {
        id: 'id',
        tenant_id: 'tenant_id',
        trigger_type: 'trigger_type',
        inference_event_id: 'inference_event_id',
        outcome_event_id: 'outcome_event_id',
        model_name: 'model_name',
        model_version: 'model_version',
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
        deployment_eligibility: 'deployment_eligibility',
        linked_at: 'linked_at',
        updated_at: 'updated_at',
    },
} as const;
