export type LearningDatasetKind =
    | 'diagnosis_training_set'
    | 'severity_training_set'
    | 'calibration_eval_set'
    | 'adversarial_benchmark_set'
    | 'quarantine_set';

export type LearningTaskType = 'diagnosis' | 'severity' | 'hybrid';

export type LearningCycleType =
    | 'daily_dataset_refresh'
    | 'daily_calibration_update'
    | 'weekly_candidate_training'
    | 'weekly_benchmark_run'
    | 'manual_review'
    | 'rollback_review';

export type LearningTriggerMode = 'scheduled' | 'manual' | 'dry_run';
export type LearningCycleStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';
export type ModelPromotionDecision = 'promote' | 'hold' | 'reject';
export type ModelPromotionStatus =
    | 'candidate'
    | 'champion'
    | 'challenger'
    | 'hold'
    | 'rejected'
    | 'rolled_back'
    | 'archived';

export type SupportedLabelType = 'inferred_only' | 'synthetic' | 'expert_reviewed' | 'lab_confirmed';

export interface LearningTimeframe {
    from?: string | null;
    to?: string | null;
}

export interface LearningDatasetFilters extends LearningTimeframe {
    tenantId: string;
    species?: string[] | null;
    caseClusters?: string[] | null;
    labelTypes?: SupportedLabelType[] | null;
    includeSynthetic?: boolean;
    includeAdversarial?: boolean;
    includeQuarantine?: boolean;
    limit?: number | null;
}

export interface LearningCaseRecord {
    case_id: string;
    tenant_id: string;
    user_id: string | null;
    clinic_id: string | null;
    source_module: string | null;
    species_canonical: string | null;
    species_display: string | null;
    breed: string | null;
    symptom_text_raw: string | null;
    symptom_keys: string[];
    symptom_vector_normalized: Record<string, boolean>;
    patient_metadata: Record<string, unknown>;
    latest_input_signature: Record<string, unknown>;
    ingestion_status: string;
    invalid_case: boolean;
    validation_error_code: string | null;
    primary_condition_class: string | null;
    top_diagnosis: string | null;
    predicted_diagnosis: string | null;
    confirmed_diagnosis: string | null;
    label_type: SupportedLabelType;
    diagnosis_confidence: number | null;
    severity_score: number | null;
    emergency_level: string | null;
    triage_priority: string | null;
    contradiction_score: number | null;
    contradiction_flags: string[];
    adversarial_case: boolean;
    adversarial_case_type: string | null;
    uncertainty_notes: string[];
    case_cluster: string | null;
    model_version: string | null;
    telemetry_status: string | null;
    calibration_status: string | null;
    prediction_correct: boolean | null;
    confidence_error: number | null;
    calibration_bucket: string | null;
    degraded_confidence: number | null;
    differential_spread: Record<string, unknown> | null;
    latest_inference_event_id: string | null;
    latest_outcome_event_id: string | null;
    latest_simulation_event_id: string | null;
    first_inference_at: string;
    last_inference_at: string;
    created_at: string;
    updated_at: string;
}

export interface LearningInferenceEvent {
    id: string;
    tenant_id: string;
    case_id: string | null;
    user_id: string | null;
    source_module: string | null;
    model_name: string;
    model_version: string;
    input_signature: Record<string, unknown>;
    output_payload: Record<string, unknown>;
    confidence_score: number | null;
    uncertainty_metrics: Record<string, unknown> | null;
    compute_profile: Record<string, unknown> | null;
    inference_latency_ms: number | null;
    created_at: string;
}

export interface LearningOutcomeEvent {
    id: string;
    tenant_id: string;
    case_id: string | null;
    user_id: string | null;
    source_module: string | null;
    inference_event_id: string | null;
    outcome_type: string;
    outcome_payload: Record<string, unknown>;
    outcome_timestamp: string;
    label_type: string | null;
    created_at: string;
}

export interface LearningSimulationEvent {
    id: string;
    tenant_id: string;
    case_id: string | null;
    user_id: string | null;
    source_module: string | null;
    simulation_type: string;
    simulation_parameters: Record<string, unknown>;
    triggered_inference_id: string | null;
    failure_mode: string | null;
    stress_metrics: Record<string, unknown> | null;
    is_real_world: boolean;
    created_at: string;
}

export interface LearningEvaluationEvent {
    id: string;
    evaluation_event_id: string | null;
    tenant_id: string;
    trigger_type: string;
    inference_event_id: string | null;
    outcome_event_id: string | null;
    case_id: string | null;
    model_name: string | null;
    model_version: string | null;
    prediction: string | null;
    prediction_confidence: number | null;
    ground_truth: string | null;
    prediction_correct: boolean | null;
    condition_class_pred: string | null;
    condition_class_true: string | null;
    severity_pred: string | null;
    severity_true: string | null;
    contradiction_score: number | null;
    adversarial_case: boolean;
    calibration_error: number | null;
    drift_score: number | null;
    outcome_alignment_delta: number | null;
    simulation_degradation: number | null;
    calibrated_confidence: number | null;
    epistemic_uncertainty: number | null;
    aleatoric_uncertainty: number | null;
    evaluation_payload: Record<string, unknown> | null;
    created_at: string;
}

export interface LabelTrustConfig {
    inferred_only: number;
    synthetic: number;
    expert_reviewed: number;
    lab_confirmed: number;
}

export interface LabelResolutionResult {
    resolvedLabel: string | null;
    labelType: SupportedLabelType | null;
    labelWeight: number;
    trusted: boolean;
    reasons: string[];
}

export interface CaseFeatureVector {
    case_id: string;
    feature_schema_version: string;
    raw_snapshot: Record<string, unknown>;
    dense_features: Record<string, number | string | boolean | null>;
    symptom_flags: Record<string, boolean>;
}

export interface DiagnosisTrainingRow {
    case_id: string;
    tenant_id: string;
    species_canonical: string | null;
    breed: string | null;
    case_cluster: string | null;
    feature_vector: CaseFeatureVector;
    confirmed_diagnosis: string;
    primary_condition_class: string | null;
    label_type: SupportedLabelType;
    label_weight: number;
    contradiction_score: number | null;
    contradiction_flags: string[];
    adversarial_case: boolean;
    model_version: string | null;
    created_at: string;
}

export interface SeverityTrainingRow {
    case_id: string;
    tenant_id: string;
    species_canonical: string | null;
    breed: string | null;
    feature_vector: CaseFeatureVector;
    severity_score: number;
    emergency_level: string;
    triage_priority: string | null;
    label_type: SupportedLabelType | null;
    label_weight: number;
    contradiction_score: number | null;
    adversarial_case: boolean;
    created_at: string;
}

export interface CalibrationEvalRow {
    case_id: string;
    tenant_id: string;
    predicted_diagnosis: string;
    predicted_confidence: number;
    confirmed_diagnosis: string;
    prediction_correct: boolean;
    confidence_error: number;
    calibration_bucket: string | null;
    label_type: SupportedLabelType;
    model_version: string | null;
    case_cluster: string | null;
    species_canonical: string | null;
    created_at: string;
}

export interface AdversarialBenchmarkRow {
    case_id: string;
    tenant_id: string;
    feature_vector: CaseFeatureVector;
    perturbation_metadata: Record<string, unknown>;
    contradiction_score: number;
    contradiction_flags: string[];
    adversarial_case_type: string | null;
    degraded_confidence: number | null;
    baseline_confidence: number | null;
    differential_spread: Record<string, unknown> | null;
    target_bias_eval: Record<string, unknown> | null;
    top_diagnosis: string | null;
    confirmed_diagnosis: string | null;
    primary_condition_class: string | null;
    emergency_level: string | null;
    created_at: string;
}

export interface QuarantineRow {
    case_id: string;
    tenant_id: string;
    invalid_case: boolean;
    ingestion_status: string;
    validation_error_code: string | null;
    species_canonical: string | null;
    symptom_text_raw: string | null;
    created_at: string;
}

export interface DatasetBuildSummary {
    total_cases: number;
    diagnosis_training_cases: number;
    severity_training_cases: number;
    calibration_eval_cases: number;
    adversarial_cases: number;
    quarantined_cases: number;
    label_composition: Record<string, number>;
    excluded_counts: Record<string, number>;
}

export interface LearningDatasetBundle {
    diagnosis_training_set: DiagnosisTrainingRow[];
    severity_training_set: SeverityTrainingRow[];
    calibration_eval_set: CalibrationEvalRow[];
    adversarial_benchmark_set: AdversarialBenchmarkRow[];
    quarantine_set: QuarantineRow[];
    summary: DatasetBuildSummary;
    dataset_version: string;
    feature_schema_version: string;
    label_policy_version: string;
    filters: LearningDatasetFilters;
    case_ids: string[];
}

export interface DiagnosisDifferential {
    name: string;
    probability: number;
}

export interface DiagnosisPrediction {
    top_diagnosis: string | null;
    primary_condition_class: string | null;
    confidence: number | null;
    top_differentials: DiagnosisDifferential[];
    abstain: boolean;
    detected_contradiction: boolean;
}

export interface SeverityPrediction {
    severity_score: number | null;
    emergency_level: string | null;
    triage_priority: string | null;
    confidence: number | null;
}

export interface DiagnosisModelArtifact {
    artifact_type: 'diagnosis_frequency_bayes_v1';
    task_type: 'diagnosis';
    model_name: string;
    model_version: string;
    dataset_version: string;
    feature_schema_version: string;
    label_policy_version: string;
    trained_at: string;
    labels: string[];
    priors: Record<string, number>;
    symptom_weights: Record<string, Record<string, number>>;
    species_weights: Record<string, Record<string, number>>;
    breed_weights: Record<string, Record<string, number>>;
    cluster_weights: Record<string, Record<string, number>>;
    label_to_condition_class: Record<string, string | null>;
    training_summary: Record<string, unknown>;
}

export interface SeverityModelArtifact {
    artifact_type: 'severity_risk_regression_v1';
    task_type: 'severity';
    model_name: string;
    model_version: string;
    dataset_version: string;
    feature_schema_version: string;
    label_policy_version: string;
    trained_at: string;
    average_severity: number;
    symptom_risk_weights: Record<string, number>;
    condition_class_weights: Record<string, number>;
    cluster_weights: Record<string, number>;
    emergency_distribution_by_class: Record<string, Record<string, number>>;
    training_summary: Record<string, unknown>;
}

export interface PerClassMetrics {
    support: number;
    precision: number;
    recall: number;
    f1: number;
}

export interface SubgroupMetric {
    group: string;
    support: number;
    accuracy: number;
    macro_f1?: number;
    critical_recall?: number;
}

export interface DiagnosisTrainingMetrics {
    evaluation_mode: 'holdout' | 'resubstitution';
    accuracy: number;
    macro_f1: number;
    top_3_accuracy: number;
    per_class: Record<string, PerClassMetrics>;
    confusion_matrix: Record<string, Record<string, number>>;
    subgroup_performance: {
        species: SubgroupMetric[];
        breed: SubgroupMetric[];
        cluster: SubgroupMetric[];
    };
    support: number;
}

export interface SeverityTrainingMetrics {
    evaluation_mode: 'holdout' | 'resubstitution';
    emergency_accuracy: number;
    severity_mae: number;
    severity_rmse: number;
    critical_recall: number;
    high_recall: number;
    emergency_false_negative_rate: number;
    subgroup_performance: {
        species: SubgroupMetric[];
        cluster: SubgroupMetric[];
    };
    support: number;
}

export interface CalibrationBin {
    lower_bound: number;
    upper_bound: number;
    count: number;
    avg_confidence: number;
    accuracy: number;
    brier_score: number;
}

export interface CalibrationReport {
    task_type: LearningTaskType;
    support: number;
    brier_score: number | null;
    expected_calibration_error: number | null;
    reliability_bins: CalibrationBin[];
    confidence_histogram: Array<{ bucket: string; count: number }>;
    recommendation: {
        status: 'pass' | 'needs_recalibration' | 'insufficient_data';
        reasons: string[];
        recommended_method: 'none' | 'temperature_scaling' | 'isotonic_regression';
        recommended_temperature: number | null;
    };
}

export interface BenchmarkFamilyReport {
    family: string;
    task_type: LearningTaskType | 'safety';
    support: number;
    pass: boolean;
    metrics: Record<string, unknown>;
    regressions: string[];
}

export interface BenchmarkSummary {
    candidate_model_version: string;
    diagnosis_metrics: DiagnosisTrainingMetrics | null;
    severity_metrics: SeverityTrainingMetrics | null;
    calibration_report: CalibrationReport | null;
    families: BenchmarkFamilyReport[];
    scorecard: Record<string, number>;
    pass: boolean;
}

export interface AdversarialEvaluationReport {
    candidate_model_version: string;
    support: number;
    model_degradation_score: number | null;
    contradiction_detection_rate: number;
    confidence_capping_rate: number;
    abstention_correctness: number;
    emergency_preservation_rate: number;
    dangerous_false_reassurance_rate: number;
    pass: boolean;
    reasons: string[];
}

export interface ModelSelectionDecision {
    candidate_model: string;
    champion_model: string | null;
    decision: ModelPromotionDecision;
    reasons: string[];
}

export interface ModelRegistryEntryRecord {
    id: string;
    tenant_id: string;
    model_name: string;
    model_version: string;
    task_type: LearningTaskType;
    training_dataset_version: string;
    feature_schema_version: string;
    label_policy_version: string;
    artifact_payload: Record<string, unknown>;
    benchmark_scorecard: Record<string, unknown>;
    calibration_report_id: string | null;
    promotion_status: ModelPromotionStatus;
    is_champion: boolean;
    latency_profile: Record<string, unknown> | null;
    resource_profile: Record<string, unknown> | null;
    parent_model_version: string | null;
    created_at: string;
    updated_at: string;
}

export interface LearningDatasetVersionRecord {
    id: string;
    tenant_id: string;
    dataset_version: string;
    dataset_kind: LearningDatasetKind;
    feature_schema_version: string;
    label_policy_version: string;
    row_count: number;
    case_ids: string[];
    filters: Record<string, unknown>;
    summary: Record<string, unknown>;
    dataset_rows: Record<string, unknown>[];
    created_at: string;
}

export interface LearningCycleRecord {
    id: string;
    tenant_id: string;
    cycle_type: LearningCycleType;
    trigger_mode: LearningTriggerMode;
    status: LearningCycleStatus;
    request_payload: Record<string, unknown>;
    summary: Record<string, unknown>;
    started_at: string;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface LearningBenchmarkReportRecord {
    id: string;
    tenant_id: string;
    learning_cycle_id: string | null;
    model_registry_id: string | null;
    benchmark_family: string;
    task_type: string;
    report_payload: Record<string, unknown>;
    summary_score: number | null;
    pass_status: string;
    created_at: string;
}

export interface LearningCalibrationReportRecord {
    id: string;
    tenant_id: string;
    learning_cycle_id: string | null;
    model_registry_id: string | null;
    task_type: string;
    report_payload: Record<string, unknown>;
    brier_score: number | null;
    ece_score: number | null;
    created_at: string;
}

export interface LearningSchedulerJobRecord {
    id: string;
    tenant_id: string;
    job_name: string;
    cron_expression: string;
    job_type: string;
    enabled: boolean;
    job_config: Record<string, unknown>;
    last_run_at: string | null;
    next_run_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface LearningRollbackEventRecord {
    id: string;
    tenant_id: string;
    learning_cycle_id: string | null;
    previous_model_registry_id: string | null;
    restored_model_registry_id: string | null;
    trigger_reason: string;
    trigger_payload: Record<string, unknown>;
    created_at: string;
}

export interface LearningAuditEventRecord {
    id: string;
    tenant_id: string;
    learning_cycle_id: string | null;
    event_type: string;
    event_payload: Record<string, unknown>;
    created_at: string;
}

export interface RollbackGuardResult {
    should_rollback: boolean;
    reasons: string[];
    rollback_target_model_registry_id: string | null;
}

export interface LearningCycleRunResult {
    cycle: LearningCycleRecord;
    dataset_bundle: LearningDatasetBundle;
    diagnosis_artifact: DiagnosisModelArtifact | null;
    diagnosis_metrics: DiagnosisTrainingMetrics | null;
    severity_artifact: SeverityModelArtifact | null;
    severity_metrics: SeverityTrainingMetrics | null;
    calibration_report: CalibrationReport | null;
    benchmark_summary: BenchmarkSummary | null;
    adversarial_report: AdversarialEvaluationReport | null;
    selection_decision: ModelSelectionDecision | null;
    registered_models: ModelRegistryEntryRecord[];
}

export interface LearningDashboardSnapshot {
    tenant_id: string;
    dataset_summary: DatasetBuildSummary;
    latest_cycles: LearningCycleRecord[];
    champion_models: ModelRegistryEntryRecord[];
    challenger_models: ModelRegistryEntryRecord[];
    recent_benchmarks: LearningBenchmarkReportRecord[];
    recent_calibration_reports: LearningCalibrationReportRecord[];
    rollback_history: LearningRollbackEventRecord[];
    coverage_metrics: {
        label_coverage_pct: number;
        calibration_readiness_pct: number;
        adversarial_coverage_pct: number;
        severity_coverage_pct: number;
    };
}

export interface LearningEngineStore {
    listClinicalCases(filters: LearningDatasetFilters): Promise<LearningCaseRecord[]>;
    listInferenceEvents(filters: LearningDatasetFilters): Promise<LearningInferenceEvent[]>;
    listOutcomeEvents(filters: LearningDatasetFilters): Promise<LearningOutcomeEvent[]>;
    listSimulationEvents(filters: LearningDatasetFilters): Promise<LearningSimulationEvent[]>;
    listEvaluationEvents(filters: LearningDatasetFilters): Promise<LearningEvaluationEvent[]>;
    createDatasetVersion(record: Omit<LearningDatasetVersionRecord, 'id' | 'created_at'>): Promise<LearningDatasetVersionRecord>;
    createLearningCycle(record: Omit<LearningCycleRecord, 'id' | 'created_at' | 'updated_at'>): Promise<LearningCycleRecord>;
    updateLearningCycle(id: string, tenantId: string, patch: Partial<Omit<LearningCycleRecord, 'id' | 'tenant_id' | 'created_at'>>): Promise<LearningCycleRecord>;
    createBenchmarkReport(record: Omit<LearningBenchmarkReportRecord, 'id' | 'created_at'>): Promise<LearningBenchmarkReportRecord>;
    createCalibrationReport(record: Omit<LearningCalibrationReportRecord, 'id' | 'created_at'>): Promise<LearningCalibrationReportRecord>;
    createAuditEvent(record: Omit<LearningAuditEventRecord, 'id' | 'created_at'>): Promise<LearningAuditEventRecord>;
    createRollbackEvent(record: Omit<LearningRollbackEventRecord, 'id' | 'created_at'>): Promise<LearningRollbackEventRecord>;
    listModelRegistryEntries(tenantId: string, taskType?: LearningTaskType | null): Promise<ModelRegistryEntryRecord[]>;
    createModelRegistryEntry(record: Omit<ModelRegistryEntryRecord, 'id' | 'created_at' | 'updated_at'>): Promise<ModelRegistryEntryRecord>;
    updateModelRegistryEntry(id: string, tenantId: string, patch: Partial<Omit<ModelRegistryEntryRecord, 'id' | 'tenant_id' | 'created_at'>>): Promise<ModelRegistryEntryRecord>;
    listLearningCycles(tenantId: string, limit: number): Promise<LearningCycleRecord[]>;
    listBenchmarkReports(tenantId: string, limit: number): Promise<LearningBenchmarkReportRecord[]>;
    listCalibrationReports(tenantId: string, limit: number): Promise<LearningCalibrationReportRecord[]>;
    listRollbackEvents(tenantId: string, limit: number): Promise<LearningRollbackEventRecord[]>;
    listSchedulerJobs(tenantId: string): Promise<LearningSchedulerJobRecord[]>;
    upsertSchedulerJob(record: Omit<LearningSchedulerJobRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<LearningSchedulerJobRecord>;
}

export const DEFAULT_LABEL_TRUST: LabelTrustConfig = {
    inferred_only: 0.1,
    synthetic: 0.65,
    expert_reviewed: 0.85,
    lab_confirmed: 1,
};

export const DEFAULT_FEATURE_SCHEMA_VERSION = 'clinical-case-vector-v1';
export const DEFAULT_LABEL_POLICY_VERSION = 'learning-label-policy-v1';
