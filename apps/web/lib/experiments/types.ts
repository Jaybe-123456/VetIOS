export type ExperimentRunStatus =
    | 'queued'
    | 'initializing'
    | 'training'
    | 'validating'
    | 'checkpointing'
    | 'stalled'
    | 'interrupted'
    | 'completed'
    | 'failed'
    | 'aborted'
    | 'promoted'
    | 'rolled_back';

export type ExperimentTaskType =
    | 'clinical_diagnosis'
    | 'severity_prediction'
    | 'vision_classification'
    | 'multimodal_fusion'
    | 'calibration_model';

export type ExperimentModality =
    | 'tabular_clinical'
    | 'imaging'
    | 'multimodal'
    | 'text_structured';

export type ModelFamily = 'diagnostics' | 'vision' | 'therapeutics';
export type ExperimentRegistryRole =
    | 'champion'
    | 'challenger'
    | 'candidate'
    | 'archived'
    | 'experimental'
    | 'rollback_target'
    | 'at_risk';
export type ModelRegistryStatus = 'training' | 'candidate' | 'staging' | 'production' | 'archived';
export type DeploymentDecisionStatus = 'approved' | 'rejected' | 'pending';
export type ExperimentHeartbeatFreshness = 'healthy' | 'stale' | 'interrupted';
export type ExperimentRegistryLinkState = 'linked' | 'pending' | 'unlinked';
export type ExperimentSafetyCoverage = 'none' | 'partial' | 'full';
export type GateStatus = 'pass' | 'fail' | 'pending';
export type RegistryControlPlaneHealth = 'healthy' | 'degraded';
export type RegistryControlPlaneCheckStatus = 'pass' | 'fail' | 'warning';
export type RegistryActionBlockCode =
    | 'invalid_artifact_metadata'
    | 'missing_run_link'
    | 'missing_dataset_version'
    | 'missing_artifact_path'
    | 'missing_feature_schema'
    | 'missing_calibration'
    | 'failed_calibration'
    | 'missing_adversarial'
    | 'failed_adversarial'
    | 'missing_safety'
    | 'failed_safety'
    | 'missing_benchmark'
    | 'failed_benchmark'
    | 'missing_manual_approval'
    | 'denied_manual_approval'
    | 'registry_at_risk'
    | 'missing_rollback_target'
    | 'duplicate_champion'
    | 'duplicate_production_model'
    | 'routing_pointer_mismatch'
    | 'audit_log_missing';

export interface ExperimentRunRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    experiment_group_id: string | null;
    sweep_id: string | null;
    parent_run_id: string | null;
    baseline_run_id: string | null;
    task_type: ExperimentTaskType;
    modality: ExperimentModality;
    target_type: string | null;
    model_arch: string;
    model_size: string | null;
    model_version: string | null;
    registry_id: string | null;
    dataset_name: string;
    dataset_version: string | null;
    feature_schema_version: string | null;
    label_policy_version: string | null;
    epochs_planned: number | null;
    epochs_completed: number | null;
    metric_primary_name: string | null;
    metric_primary_value: number | null;
    status: ExperimentRunStatus;
    status_reason: string | null;
    progress_percent: number | null;
    summary_only: boolean;
    created_by: string | null;
    hyperparameters: Record<string, unknown>;
    dataset_lineage: Record<string, unknown>;
    config_snapshot: Record<string, unknown>;
    safety_metrics: Record<string, unknown>;
    resource_usage: Record<string, unknown>;
    registry_context: Record<string, unknown>;
    last_heartbeat_at: string | null;
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ExperimentMetricRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    epoch: number | null;
    global_step: number | null;
    train_loss: number | null;
    val_loss: number | null;
    train_accuracy: number | null;
    val_accuracy: number | null;
    learning_rate: number | null;
    gradient_norm: number | null;
    macro_f1: number | null;
    recall_critical: number | null;
    calibration_error: number | null;
    adversarial_score: number | null;
    false_negative_critical_rate: number | null;
    dangerous_false_reassurance_rate: number | null;
    abstain_accuracy: number | null;
    contradiction_detection_rate: number | null;
    wall_clock_time_seconds: number | null;
    steps_per_second: number | null;
    gpu_utilization: number | null;
    cpu_utilization: number | null;
    memory_utilization: number | null;
    metric_timestamp: string;
    created_at: string;
}

export interface ExperimentArtifactRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    artifact_type: string;
    label: string | null;
    uri: string | null;
    metadata: Record<string, unknown>;
    is_primary: boolean;
    created_at: string;
}

export interface ExperimentFailureRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    failure_reason: string;
    failure_epoch: number | null;
    failure_step: number | null;
    last_train_loss: number | null;
    last_val_loss: number | null;
    last_learning_rate: number | null;
    last_gradient_norm: number | null;
    nan_detected: boolean;
    checkpoint_recovery_attempted: boolean;
    stack_trace_excerpt: string | null;
    error_summary: string | null;
    created_at: string;
    updated_at: string;
}

export interface ExperimentBenchmarkRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    benchmark_family: string;
    task_type: string;
    summary_score: number | null;
    pass_status: string;
    report_payload: Record<string, unknown>;
    created_at: string;
}

export interface ExperimentRegistryLinkRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    model_registry_entry_id: string | null;
    registry_candidate_id: string | null;
    champion_or_challenger: ExperimentRegistryRole | null;
    promotion_status: string | null;
    calibration_status: string | null;
    adversarial_gate_status: string | null;
    benchmark_status: string | null;
    manual_approval_status: string | null;
    deployment_eligibility: string | null;
    linked_at: string;
    updated_at: string;
}

export interface ClinicalMetricsRecord {
    global_accuracy: number | null;
    macro_f1: number | null;
    critical_recall: number | null;
    false_reassurance_rate: number | null;
    fn_critical_rate: number | null;
    ece: number | null;
    brier_score: number | null;
    adversarial_degradation: number | null;
    latency_p99: number | null;
}

export interface RegistryLineageRecord {
    run_id: string;
    experiment_group: string | null;
    dataset_version: string | null;
    benchmark_id: string | null;
    calibration_report_uri: string | null;
    adversarial_report_uri: string | null;
}

export interface RollbackMetadataRecord {
    triggered_at: string;
    triggered_by: string | null;
    reason: string;
    incident_id: string | null;
}

export interface ModelRegistryRecord {
    registry_id: string;
    tenant_id: string;
    run_id: string;
    model_name: string;
    model_version: string;
    model_family: ModelFamily;
    artifact_uri: string | null;
    dataset_version: string | null;
    feature_schema_version: string | null;
    label_policy_version: string | null;
    lifecycle_status: ModelRegistryStatus;
    registry_role: ExperimentRegistryRole;
    deployed_at: string | null;
    archived_at: string | null;
    promoted_from: string | null;
    rollback_target: string | null;
    clinical_metrics: ClinicalMetricsRecord;
    lineage: RegistryLineageRecord;
    rollback_metadata: RollbackMetadataRecord | null;
    artifact_path: string | null;
    status: ModelRegistryStatus;
    role: ExperimentRegistryRole;
    created_at: string;
    created_by: string | null;
    updated_at: string;
}

export interface CalibrationReliabilityBin {
    confidence: number;
    accuracy: number;
    count: number;
}

export interface CalibrationConfidenceHistogramBin {
    confidence: number;
    count: number;
}

export interface CalibrationMetricRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    ece: number | null;
    brier_score: number | null;
    reliability_bins: CalibrationReliabilityBin[];
    confidence_histogram: CalibrationConfidenceHistogramBin[];
    calibration_pass: boolean | null;
    calibration_notes: string | null;
    created_at: string;
    updated_at: string;
}

export interface AdversarialMetricRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    degradation_score: number | null;
    contradiction_robustness: number | null;
    critical_case_recall: number | null;
    false_reassurance_rate: number | null;
    dangerous_false_reassurance_rate: number | null;
    adversarial_pass: boolean | null;
    created_at: string;
    updated_at: string;
}

export interface DeploymentDecisionRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    decision: DeploymentDecisionStatus;
    reason: string | null;
    calibration_pass: boolean | null;
    adversarial_pass: boolean | null;
    safety_pass: boolean | null;
    benchmark_pass: boolean | null;
    manual_approval: boolean | null;
    approved_by: string | null;
    timestamp: string;
    created_at: string;
    updated_at: string;
}

export interface SubgroupMetricRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    group: string;
    group_value: string;
    metric: string;
    value: number;
    created_at: string;
}

export interface ExperimentAuditEventRecord {
    event_id: string;
    tenant_id: string;
    run_id: string | null;
    event_type: string;
    actor: string | null;
    created_at: string;
    payload: Record<string, unknown>;
}

export interface PromotionRequirementsRecord {
    id: string;
    tenant_id: string;
    registry_id: string;
    run_id: string;
    calibration_pass: boolean | null;
    adversarial_pass: boolean | null;
    safety_pass: boolean | null;
    benchmark_pass: boolean | null;
    manual_approval: boolean | null;
    created_at: string;
    updated_at: string;
}

export interface RegistryAuditLogRecord {
    event_id: string;
    tenant_id: string;
    registry_id: string;
    run_id: string | null;
    event_type: string;
    timestamp: string;
    actor: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface RegistryRoutingPointerRecord {
    id: string;
    tenant_id: string;
    model_family: ModelFamily;
    active_registry_id: string | null;
    active_run_id: string | null;
    updated_at: string;
    updated_by: string | null;
}

export interface RegistryDecisionPanel {
    promotion_eligibility: boolean;
    deployment_decision: 'approved' | 'hold' | 'rejected';
    reasons: string[];
    missing_evaluations: string[];
    blocker_codes: RegistryActionBlockCode[];
}

export interface RegistryRegistrationValidation {
    status: 'valid' | 'blocked';
    code: 'VALID_ARTIFACT_METADATA' | 'INVALID_ARTIFACT_METADATA';
    reasons: string[];
}

export interface RegistryRollbackReadiness {
    ready: boolean;
    target_registry_id: string | null;
    reasons: string[];
}

export interface RegistryConsistencyIssue {
    code: RegistryActionBlockCode | 'missing_lifecycle_state' | 'orphan_registry_metadata';
    severity: 'critical' | 'warning';
    message: string;
    model_family?: ModelFamily | null;
    registry_id?: string | null;
    run_id?: string | null;
}

export interface RegistryControlPlaneVerificationCheck {
    key:
        | 'registration_validation'
        | 'promotion_gating'
        | 'atomic_transition'
        | 'rollback_execution'
        | 'audit_logging'
        | 'consistency'
        | 'failure_simulation';
    label: string;
    status: RegistryControlPlaneCheckStatus;
    summary: string;
    failures: string[];
    warnings: string[];
}

export interface RegistryControlPlaneVerificationResult {
    status: 'PASS' | 'FAIL';
    failed_checks: string[];
    warnings: string[];
    summary: string;
    checks: RegistryControlPlaneVerificationCheck[];
    simulated_failures: Array<{
        scenario: 'missing_calibration' | 'duplicate_champions' | 'no_rollback_target' | 'broken_audit_logging';
        detected: boolean;
        summary: string;
    }>;
    verified_at: string;
}

export interface ExperimentRunDetail {
    run: ExperimentRunRecord;
    metrics: ExperimentMetricRecord[];
    artifacts: ExperimentArtifactRecord[];
    failure: ExperimentFailureRecord | null;
    benchmarks: ExperimentBenchmarkRecord[];
    registry_link: ExperimentRegistryLinkRecord | null;
    model_registry: ModelRegistryRecord | null;
    promotion_requirements: PromotionRequirementsRecord | null;
    calibration_metrics: CalibrationMetricRecord | null;
    adversarial_metrics: AdversarialMetricRecord | null;
    deployment_decision: DeploymentDecisionRecord | null;
    decision_panel: RegistryDecisionPanel;
    subgroup_metrics: SubgroupMetricRecord[];
    audit_history: ExperimentAuditEventRecord[];
    registry_audit_history: RegistryAuditLogRecord[];
    missing_telemetry_fields: string[];
    latest_metric: ExperimentMetricRecord | null;
    heartbeat_freshness: ExperimentHeartbeatFreshness;
    registry_link_state: ExperimentRegistryLinkState;
    registry_role: ExperimentRegistryRole | null;
    safety_coverage: ExperimentSafetyCoverage;
    safety_metrics_complete: boolean;
    clinical_scorecard: ClinicalMetricsRecord | null;
    lineage: RegistryLineageRecord | null;
    last_stable_model: ModelRegistryRecord | null;
    artifact_uris: {
        log_uri: string | null;
        checkpoint_uri: string | null;
        best_checkpoint_uri: string | null;
        calibration_report_uri: string | null;
        adversarial_report_uri: string | null;
        benchmark_report_uri: string | null;
    };
    promotion_gating: {
        can_promote: boolean;
        promotion_allowed: boolean;
        missing_requirements: string[];
        blockers: string[];
        blocker_codes: RegistryActionBlockCode[];
        gates: {
            calibration: GateStatus;
            adversarial: GateStatus;
            safety: GateStatus;
            benchmark: GateStatus;
            manual_approval: GateStatus;
        };
        tooltip: string;
    };
    failure_guidance: {
        root_cause_classification: 'high_lr' | 'no_clipping' | 'data_instability' | 'gradient_explosion' | 'unknown';
        suggested_cause: string;
        remediation_suggestions: string[];
    } | null;
}

export interface ExperimentMetricSeriesPoint {
    run_id: string;
    epoch_label: string;
    epoch: number | null;
    global_step: number | null;
    metric_timestamp: string;
    train_loss: number | null;
    val_loss: number | null;
    train_accuracy: number | null;
    val_accuracy: number | null;
    learning_rate: number | null;
    gradient_norm: number | null;
    macro_f1: number | null;
    recall_critical: number | null;
    calibration_error: number | null;
    adversarial_score: number | null;
    false_negative_critical_rate: number | null;
    dangerous_false_reassurance_rate: number | null;
    abstain_accuracy: number | null;
    contradiction_detection_rate: number | null;
    steps_per_second: number | null;
    gpu_utilization: number | null;
    cpu_utilization: number | null;
    memory_utilization: number | null;
}

export interface ExperimentComparison {
    source: 'manual' | 'automatic';
    rationale: string;
    run_ids: string[];
    runs: ExperimentRunRecord[];
    metrics: Record<string, ExperimentMetricRecord[]>;
    calibration: Record<string, CalibrationMetricRecord | null>;
    adversarial: Record<string, AdversarialMetricRecord | null>;
    decisions: Record<string, DeploymentDecisionRecord | null>;
    benchmark_summaries: Array<{
        run_id: string;
        benchmark_family: string;
        summary_score: number | null;
        pass_status: string;
    }>;
    comparison_rows: Array<{
        run_id: string;
        baseline_run_id: string;
        macro_f1: number | null;
        macro_f1_delta: number | null;
        recall_critical: number | null;
        recall_critical_delta: number | null;
        ece: number | null;
        ece_delta: number | null;
        degradation_score: number | null;
        degradation_delta: number | null;
        hyperparameter_diff: string[];
        dataset_diff: string[];
    }>;
}

export interface ExperimentDashboardSummary {
    total_runs: number;
    active_runs: number;
    failed_runs: number;
    summary_only_runs: number;
    telemetry_coverage_pct: number;
    registry_link_coverage_pct: number;
    safety_metric_coverage_pct: number;
    failed_run_ids: string[];
    active_run_ids: string[];
}

export interface ExperimentDashboardSnapshot {
    tenant_id: string;
    summary: ExperimentDashboardSummary;
    runs: ExperimentRunRecord[];
    selected_run_id: string | null;
    selected_run_detail: ExperimentRunDetail | null;
    comparison: ExperimentComparison | null;
    refreshed_at: string;
}

export interface ModelRegistryControlPlaneEntry {
    registry: ModelRegistryRecord;
    run: ExperimentRunRecord | null;
    promotion_requirements: PromotionRequirementsRecord | null;
    decision_panel: RegistryDecisionPanel;
    promotion_gating: ExperimentRunDetail['promotion_gating'];
    registration_validation: RegistryRegistrationValidation;
    rollback_readiness: RegistryRollbackReadiness;
    audit_trail_ready: boolean;
    clinical_scorecard: ClinicalMetricsRecord;
    lineage: RegistryLineageRecord;
    rollback_history: RegistryAuditLogRecord[];
    latest_registry_events: RegistryAuditLogRecord[];
    is_active_route: boolean;
    last_stable_model: ModelRegistryRecord | null;
}

export interface ModelRegistryFamilyGroup {
    model_family: ModelFamily;
    active_registry_id: string | null;
    active_model: ModelRegistryRecord | null;
    last_stable_model: ModelRegistryRecord | null;
    entries: ModelRegistryControlPlaneEntry[];
}

export interface ModelRegistryControlPlaneSnapshot {
    tenant_id: string;
    families: ModelRegistryFamilyGroup[];
    routing_pointers: RegistryRoutingPointerRecord[];
    audit_history: RegistryAuditLogRecord[];
    registry_health: RegistryControlPlaneHealth;
    consistency_issues: RegistryConsistencyIssue[];
    refreshed_at: string;
}

export interface ListExperimentRunsOptions {
    limit?: number;
    includeSummaryOnly?: boolean;
    statuses?: ExperimentRunStatus[];
}

export interface ExperimentTrackingStore {
    listExperimentRuns(tenantId: string, options?: ListExperimentRunsOptions): Promise<ExperimentRunRecord[]>;
    getExperimentRun(tenantId: string, runId: string): Promise<ExperimentRunRecord | null>;
    createExperimentRun(record: Omit<ExperimentRunRecord, 'id' | 'created_at' | 'updated_at'>): Promise<ExperimentRunRecord>;
    updateExperimentRun(runId: string, tenantId: string, patch: Partial<Omit<ExperimentRunRecord, 'id' | 'tenant_id' | 'run_id' | 'created_at'>>): Promise<ExperimentRunRecord>;
    listExperimentMetrics(tenantId: string, runId: string, limit?: number): Promise<ExperimentMetricRecord[]>;
    createExperimentMetrics(records: Array<Omit<ExperimentMetricRecord, 'id' | 'created_at'>>): Promise<ExperimentMetricRecord[]>;
    listExperimentArtifacts(tenantId: string, runId: string): Promise<ExperimentArtifactRecord[]>;
    upsertExperimentArtifact(record: Omit<ExperimentArtifactRecord, 'id' | 'created_at'> & { id?: string }): Promise<ExperimentArtifactRecord>;
    getExperimentFailure(tenantId: string, runId: string): Promise<ExperimentFailureRecord | null>;
    upsertExperimentFailure(record: Omit<ExperimentFailureRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<ExperimentFailureRecord>;
    listExperimentBenchmarks(tenantId: string, runId: string): Promise<ExperimentBenchmarkRecord[]>;
    upsertExperimentBenchmark(record: Omit<ExperimentBenchmarkRecord, 'id' | 'created_at'> & { id?: string }): Promise<ExperimentBenchmarkRecord>;
    getExperimentRegistryLink(tenantId: string, runId: string): Promise<ExperimentRegistryLinkRecord | null>;
    upsertExperimentRegistryLink(record: Omit<ExperimentRegistryLinkRecord, 'id' | 'linked_at' | 'updated_at'> & { id?: string }): Promise<ExperimentRegistryLinkRecord>;
    listModelRegistry(tenantId: string): Promise<ModelRegistryRecord[]>;
    getModelRegistryForRun(tenantId: string, runId: string): Promise<ModelRegistryRecord | null>;
    upsertModelRegistry(record: Omit<ModelRegistryRecord, 'created_at' | 'updated_at'>): Promise<ModelRegistryRecord>;
    getPromotionRequirements(tenantId: string, runId: string): Promise<PromotionRequirementsRecord | null>;
    listPromotionRequirements(tenantId: string): Promise<PromotionRequirementsRecord[]>;
    upsertPromotionRequirements(record: Omit<PromotionRequirementsRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<PromotionRequirementsRecord>;
    getCalibrationMetrics(tenantId: string, runId: string): Promise<CalibrationMetricRecord | null>;
    upsertCalibrationMetrics(record: Omit<CalibrationMetricRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<CalibrationMetricRecord>;
    getAdversarialMetrics(tenantId: string, runId: string): Promise<AdversarialMetricRecord | null>;
    upsertAdversarialMetrics(record: Omit<AdversarialMetricRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<AdversarialMetricRecord>;
    getDeploymentDecision(tenantId: string, runId: string): Promise<DeploymentDecisionRecord | null>;
    upsertDeploymentDecision(record: Omit<DeploymentDecisionRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<DeploymentDecisionRecord>;
    listSubgroupMetrics(tenantId: string, runId: string): Promise<SubgroupMetricRecord[]>;
    upsertSubgroupMetric(record: Omit<SubgroupMetricRecord, 'id' | 'created_at'> & { id?: string }): Promise<SubgroupMetricRecord>;
    listAuditLog(tenantId: string, limit?: number): Promise<ExperimentAuditEventRecord[]>;
    createAuditLog(record: Omit<ExperimentAuditEventRecord, 'created_at'>): Promise<ExperimentAuditEventRecord>;
    listRegistryAuditLog(tenantId: string, limit?: number): Promise<RegistryAuditLogRecord[]>;
    createRegistryAuditLog(record: Omit<RegistryAuditLogRecord, 'created_at'>): Promise<RegistryAuditLogRecord>;
    listRegistryRoutingPointers(tenantId: string): Promise<RegistryRoutingPointerRecord[]>;
    upsertRegistryRoutingPointer(record: Omit<RegistryRoutingPointerRecord, 'id' | 'updated_at'> & { id?: string }): Promise<RegistryRoutingPointerRecord>;
    promoteRegistryToProduction(input: {
        tenantId: string;
        runId: string;
        actor: string | null;
    }): Promise<ModelRegistryRecord>;
    rollbackRegistryToTarget(input: {
        tenantId: string;
        runId: string;
        actor: string | null;
        reason: string;
        incidentId?: string | null;
    }): Promise<ModelRegistryRecord>;
    listModelRegistryEntries(tenantId: string): Promise<Array<{
        id: string;
        tenant_id: string;
        model_name: string;
        model_version: string;
        task_type: string;
        training_dataset_version: string;
        feature_schema_version: string;
        label_policy_version: string;
        artifact_payload: Record<string, unknown>;
        benchmark_scorecard: Record<string, unknown>;
        calibration_report_id: string | null;
        promotion_status: string;
        is_champion: boolean;
        latency_profile: Record<string, unknown> | null;
        resource_profile: Record<string, unknown> | null;
        parent_model_version: string | null;
        created_at: string;
        updated_at: string;
    }>>;
    listLearningDatasetVersions(tenantId: string, limit?: number): Promise<Array<{
        id: string;
        dataset_version: string;
        dataset_kind: string;
        row_count: number;
        summary: Record<string, unknown>;
        created_at: string;
    }>>;
    listLearningBenchmarkReports(tenantId: string, limit?: number): Promise<Array<{
        id: string;
        model_registry_id: string | null;
        benchmark_family: string;
        task_type: string;
        summary_score: number | null;
        pass_status: string;
        report_payload: Record<string, unknown>;
        created_at: string;
    }>>;
    listLearningCalibrationReports(tenantId: string, limit?: number): Promise<Array<{
        id: string;
        model_registry_id: string | null;
        task_type: string;
        brier_score: number | null;
        ece_score: number | null;
        report_payload: Record<string, unknown>;
        created_at: string;
    }>>;
    listLearningAuditEvents(tenantId: string, limit?: number): Promise<Array<{
        id: string;
        event_type: string;
        event_payload: Record<string, unknown>;
        created_at: string;
    }>>;
}
