export type ExperimentRunStatus =
    | 'queued'
    | 'initializing'
    | 'training'
    | 'validating'
    | 'checkpointing'
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

export type ExperimentRegistryRole = 'champion' | 'challenger' | 'candidate' | 'archived' | 'experimental';
export type ModelRegistryStatus = 'candidate' | 'staging' | 'production' | 'archived';
export type DeploymentDecisionStatus = 'approved' | 'rejected' | 'pending';

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
    deployment_eligibility: string | null;
    linked_at: string;
    updated_at: string;
}

export interface ModelRegistryRecord {
    registry_id: string;
    tenant_id: string;
    run_id: string;
    model_version: string;
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

export interface CalibrationMetricRecord {
    id: string;
    tenant_id: string;
    run_id: string;
    ece: number | null;
    brier_score: number | null;
    reliability_bins: CalibrationReliabilityBin[];
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

export interface ExperimentRunDetail {
    run: ExperimentRunRecord;
    metrics: ExperimentMetricRecord[];
    artifacts: ExperimentArtifactRecord[];
    failure: ExperimentFailureRecord | null;
    benchmarks: ExperimentBenchmarkRecord[];
    registry_link: ExperimentRegistryLinkRecord | null;
    model_registry: ModelRegistryRecord | null;
    calibration_metrics: CalibrationMetricRecord | null;
    adversarial_metrics: AdversarialMetricRecord | null;
    deployment_decision: DeploymentDecisionRecord | null;
    subgroup_metrics: SubgroupMetricRecord[];
    audit_history: ExperimentAuditEventRecord[];
    missing_telemetry_fields: string[];
    latest_metric: ExperimentMetricRecord | null;
    heartbeat_freshness: 'fresh' | 'stale' | 'offline';
    failure_guidance: {
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
    getModelRegistryForRun(tenantId: string, runId: string): Promise<ModelRegistryRecord | null>;
    upsertModelRegistry(record: Omit<ModelRegistryRecord, 'created_at' | 'updated_at'>): Promise<ModelRegistryRecord>;
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
