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

export type ExperimentRegistryRole = 'champion' | 'challenger' | 'candidate' | 'archived';

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

export interface ExperimentAuditEventRecord {
    event_type: string;
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
    audit_history: ExperimentAuditEventRecord[];
    missing_telemetry_fields: string[];
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
    steps_per_second: number | null;
    gpu_utilization: number | null;
    cpu_utilization: number | null;
    memory_utilization: number | null;
}

export interface ExperimentComparison {
    run_ids: string[];
    runs: ExperimentRunRecord[];
    metrics: Record<string, ExperimentMetricRecord[]>;
    benchmark_summaries: Array<{
        run_id: string;
        benchmark_family: string;
        summary_score: number | null;
        pass_status: string;
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
