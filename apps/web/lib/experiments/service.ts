import type {
    ExperimentAuditEventRecord,
    ExperimentComparison,
    ExperimentDashboardSnapshot,
    ExperimentDashboardSummary,
    ExperimentFailureRecord,
    ExperimentMetricRecord,
    ExperimentMetricSeriesPoint,
    ExperimentRunDetail,
    ExperimentRunRecord,
    ExperimentRunStatus,
    ExperimentTaskType,
    ExperimentTrackingStore,
} from '@/lib/experiments/types';

export interface CreateExperimentRunInput {
    tenantId: string;
    runId: string;
    experimentGroupId?: string | null;
    sweepId?: string | null;
    parentRunId?: string | null;
    baselineRunId?: string | null;
    taskType: ExperimentTaskType;
    modality: ExperimentRunRecord['modality'];
    targetType?: string | null;
    modelArch: string;
    modelSize?: string | null;
    modelVersion?: string | null;
    datasetName: string;
    datasetVersion?: string | null;
    featureSchemaVersion?: string | null;
    labelPolicyVersion?: string | null;
    epochsPlanned?: number | null;
    epochsCompleted?: number | null;
    metricPrimaryName?: string | null;
    metricPrimaryValue?: number | null;
    status?: ExperimentRunStatus;
    statusReason?: string | null;
    progressPercent?: number | null;
    summaryOnly?: boolean;
    createdBy?: string | null;
    hyperparameters?: Record<string, unknown>;
    datasetLineage?: Record<string, unknown>;
    configSnapshot?: Record<string, unknown>;
    safetyMetrics?: Record<string, unknown>;
    resourceUsage?: Record<string, unknown>;
    registryContext?: Record<string, unknown>;
    lastHeartbeatAt?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
}

export interface ExperimentMetricInput {
    epoch?: number | null;
    global_step?: number | null;
    train_loss?: number | null;
    val_loss?: number | null;
    train_accuracy?: number | null;
    val_accuracy?: number | null;
    learning_rate?: number | null;
    gradient_norm?: number | null;
    macro_f1?: number | null;
    recall_critical?: number | null;
    calibration_error?: number | null;
    adversarial_score?: number | null;
    wall_clock_time_seconds?: number | null;
    steps_per_second?: number | null;
    gpu_utilization?: number | null;
    cpu_utilization?: number | null;
    memory_utilization?: number | null;
    metric_timestamp?: string;
}

export interface ExperimentHeartbeatInput {
    status?: ExperimentRunStatus;
    statusReason?: string | null;
    progressPercent?: number | null;
    epochsCompleted?: number | null;
    lastHeartbeatAt?: string | null;
    resourceUsage?: Record<string, unknown>;
}

export interface ExperimentFailureInput {
    failureReason: string;
    failureEpoch?: number | null;
    failureStep?: number | null;
    lastTrainLoss?: number | null;
    lastValLoss?: number | null;
    lastLearningRate?: number | null;
    lastGradientNorm?: number | null;
    nanDetected?: boolean;
    checkpointRecoveryAttempted?: boolean;
    stackTraceExcerpt?: string | null;
    errorSummary?: string | null;
}

export async function createExperimentRun(
    store: ExperimentTrackingStore,
    input: CreateExperimentRunInput,
): Promise<ExperimentRunRecord> {
    const startedAt = input.startedAt ?? new Date().toISOString();
    return store.createExperimentRun({
        tenant_id: input.tenantId,
        run_id: input.runId,
        experiment_group_id: input.experimentGroupId ?? null,
        sweep_id: input.sweepId ?? null,
        parent_run_id: input.parentRunId ?? null,
        baseline_run_id: input.baselineRunId ?? null,
        task_type: input.taskType,
        modality: input.modality,
        target_type: input.targetType ?? null,
        model_arch: input.modelArch,
        model_size: input.modelSize ?? null,
        model_version: input.modelVersion ?? null,
        dataset_name: input.datasetName,
        dataset_version: input.datasetVersion ?? null,
        feature_schema_version: input.featureSchemaVersion ?? null,
        label_policy_version: input.labelPolicyVersion ?? null,
        epochs_planned: input.epochsPlanned ?? null,
        epochs_completed: input.epochsCompleted ?? 0,
        metric_primary_name: input.metricPrimaryName ?? null,
        metric_primary_value: input.metricPrimaryValue ?? null,
        status: input.status ?? 'queued',
        status_reason: input.statusReason ?? null,
        progress_percent: clampPercent(input.progressPercent ?? 0),
        summary_only: input.summaryOnly ?? false,
        created_by: input.createdBy ?? null,
        hyperparameters: input.hyperparameters ?? {},
        dataset_lineage: input.datasetLineage ?? {},
        config_snapshot: input.configSnapshot ?? {},
        safety_metrics: input.safetyMetrics ?? {},
        resource_usage: input.resourceUsage ?? {},
        registry_context: input.registryContext ?? {},
        last_heartbeat_at: input.lastHeartbeatAt ?? startedAt,
        started_at: startedAt,
        ended_at: input.endedAt ?? null,
    });
}

export async function logExperimentMetrics(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    metrics: ExperimentMetricInput[],
): Promise<ExperimentMetricRecord[]> {
    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) {
        throw new Error(`Experiment run not found: ${runId}`);
    }

    const created = await store.createExperimentMetrics(
        metrics.map((metric) => ({
            tenant_id: tenantId,
            run_id: runId,
            epoch: numberOrNull(metric.epoch),
            global_step: numberOrNull(metric.global_step),
            train_loss: numberOrNull(metric.train_loss),
            val_loss: numberOrNull(metric.val_loss),
            train_accuracy: numberOrNull(metric.train_accuracy),
            val_accuracy: numberOrNull(metric.val_accuracy),
            learning_rate: numberOrNull(metric.learning_rate),
            gradient_norm: numberOrNull(metric.gradient_norm),
            macro_f1: numberOrNull(metric.macro_f1),
            recall_critical: numberOrNull(metric.recall_critical),
            calibration_error: numberOrNull(metric.calibration_error),
            adversarial_score: numberOrNull(metric.adversarial_score),
            wall_clock_time_seconds: numberOrNull(metric.wall_clock_time_seconds),
            steps_per_second: numberOrNull(metric.steps_per_second),
            gpu_utilization: numberOrNull(metric.gpu_utilization),
            cpu_utilization: numberOrNull(metric.cpu_utilization),
            memory_utilization: numberOrNull(metric.memory_utilization),
            metric_timestamp: metric.metric_timestamp ?? new Date().toISOString(),
        })),
    );

    const latest = created[created.length - 1] ?? null;
    const primaryMetric = pickPrimaryMetric(run.task_type, latest);
    await store.updateExperimentRun(runId, tenantId, {
        epochs_completed: latest?.epoch ?? run.epochs_completed,
        progress_percent: resolveProgressPercent(run, latest),
        last_heartbeat_at: latest?.metric_timestamp ?? new Date().toISOString(),
        metric_primary_name: primaryMetric?.name ?? run.metric_primary_name,
        metric_primary_value: primaryMetric?.value ?? run.metric_primary_value,
        status: isTerminalStatus(run.status) ? run.status : 'training',
        summary_only: false,
    });

    return created;
}

export async function updateExperimentHeartbeat(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    input: ExperimentHeartbeatInput,
): Promise<ExperimentRunRecord> {
    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) {
        throw new Error(`Experiment run not found: ${runId}`);
    }

    return store.updateExperimentRun(runId, tenantId, {
        status: input.status ?? run.status,
        status_reason: input.statusReason ?? run.status_reason,
        progress_percent: clampPercent(input.progressPercent ?? run.progress_percent),
        epochs_completed: input.epochsCompleted ?? run.epochs_completed,
        last_heartbeat_at: input.lastHeartbeatAt ?? new Date().toISOString(),
        resource_usage: input.resourceUsage
            ? { ...run.resource_usage, ...input.resourceUsage }
            : run.resource_usage,
    });
}

export async function recordExperimentFailure(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    input: ExperimentFailureInput,
): Promise<ExperimentFailureRecord> {
    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) {
        throw new Error(`Experiment run not found: ${runId}`);
    }

    const failure = await store.upsertExperimentFailure({
        tenant_id: tenantId,
        run_id: runId,
        failure_reason: input.failureReason,
        failure_epoch: input.failureEpoch ?? null,
        failure_step: input.failureStep ?? null,
        last_train_loss: input.lastTrainLoss ?? null,
        last_val_loss: input.lastValLoss ?? null,
        last_learning_rate: input.lastLearningRate ?? null,
        last_gradient_norm: input.lastGradientNorm ?? null,
        nan_detected: input.nanDetected === true,
        checkpoint_recovery_attempted: input.checkpointRecoveryAttempted === true,
        stack_trace_excerpt: input.stackTraceExcerpt ?? null,
        error_summary: input.errorSummary ?? null,
    });

    await store.updateExperimentRun(runId, tenantId, {
        status: 'failed',
        status_reason: input.failureReason,
        ended_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
    });

    return failure;
}

export async function getExperimentRunDetail(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
): Promise<ExperimentRunDetail | null> {
    await backfillSummaryExperimentRuns(store, tenantId);

    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) return null;

    const [metrics, artifacts, failure, benchmarks, registryLink, auditEvents] = await Promise.all([
        store.listExperimentMetrics(tenantId, runId),
        store.listExperimentArtifacts(tenantId, runId),
        store.getExperimentFailure(tenantId, runId),
        store.listExperimentBenchmarks(tenantId, runId),
        store.getExperimentRegistryLink(tenantId, runId),
        store.listLearningAuditEvents(tenantId, 100),
    ]);

    return {
        run,
        metrics,
        artifacts,
        failure,
        benchmarks,
        registry_link: registryLink,
        audit_history: filterAuditEventsForRun(run, auditEvents),
        missing_telemetry_fields: getMissingTelemetryFields(run, metrics),
    };
}

export async function getExperimentComparison(
    store: ExperimentTrackingStore,
    tenantId: string,
    runIds: string[],
): Promise<ExperimentComparison | null> {
    const uniqueRunIds = [...new Set(runIds)].filter(Boolean).slice(0, 4);
    if (uniqueRunIds.length === 0) return null;

    const runs = await Promise.all(uniqueRunIds.map((runId) => store.getExperimentRun(tenantId, runId)));
    const presentRuns = runs.filter((run): run is ExperimentRunRecord => Boolean(run));
    if (presentRuns.length === 0) return null;

    const metricEntries = await Promise.all(
        presentRuns.map(async (run) => [run.run_id, await store.listExperimentMetrics(tenantId, run.run_id)] as const),
    );
    const benchmarkEntries = await Promise.all(
        presentRuns.map(async (run) => [run.run_id, await store.listExperimentBenchmarks(tenantId, run.run_id)] as const),
    );

    return {
        run_ids: presentRuns.map((run) => run.run_id),
        runs: presentRuns,
        metrics: Object.fromEntries(metricEntries),
        benchmark_summaries: benchmarkEntries.flatMap(([runId, benchmarks]) =>
            benchmarks.map((benchmark) => ({
                run_id: runId,
                benchmark_family: benchmark.benchmark_family,
                summary_score: benchmark.summary_score,
                pass_status: benchmark.pass_status,
            })),
        ),
    };
}

export async function getExperimentDashboardSnapshot(
    store: ExperimentTrackingStore,
    tenantId: string,
    options: {
        selectedRunId?: string | null;
        compareRunIds?: string[];
        runLimit?: number;
    } = {},
): Promise<ExperimentDashboardSnapshot> {
    await backfillSummaryExperimentRuns(store, tenantId);

    const runs = await store.listExperimentRuns(tenantId, {
        limit: options.runLimit ?? 50,
        includeSummaryOnly: true,
    });
    const selectedRunId = options.selectedRunId && runs.some((run) => run.run_id === options.selectedRunId)
        ? options.selectedRunId
        : pickDefaultSelectedRunId(runs);
    const [selectedRunDetail, comparison] = await Promise.all([
        selectedRunId ? getExperimentRunDetail(store, tenantId, selectedRunId) : Promise.resolve(null),
        options.compareRunIds?.length ? getExperimentComparison(store, tenantId, options.compareRunIds) : Promise.resolve(null),
    ]);

    return {
        tenant_id: tenantId,
        summary: buildDashboardSummary(runs),
        runs,
        selected_run_id: selectedRunId,
        selected_run_detail: selectedRunDetail,
        comparison,
        refreshed_at: new Date().toISOString(),
    };
}

export function buildExperimentMetricSeries(
    metrics: ExperimentMetricRecord[],
): ExperimentMetricSeriesPoint[] {
    return metrics.map((metric) => ({
        run_id: metric.run_id,
        epoch_label: metric.epoch != null
            ? `E${metric.epoch}`
            : metric.global_step != null
                ? `S${metric.global_step}`
                : formatMetricTimestamp(metric.metric_timestamp),
        epoch: metric.epoch,
        global_step: metric.global_step,
        metric_timestamp: metric.metric_timestamp,
        train_loss: metric.train_loss,
        val_loss: metric.val_loss,
        train_accuracy: metric.train_accuracy,
        val_accuracy: metric.val_accuracy,
        learning_rate: metric.learning_rate,
        gradient_norm: metric.gradient_norm,
        macro_f1: metric.macro_f1,
        recall_critical: metric.recall_critical,
        calibration_error: metric.calibration_error,
        adversarial_score: metric.adversarial_score,
        steps_per_second: metric.steps_per_second,
        gpu_utilization: metric.gpu_utilization,
        cpu_utilization: metric.cpu_utilization,
        memory_utilization: metric.memory_utilization,
    }));
}

export function getEmptyMetricStateMessage(
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
): string {
    if (metrics.length > 0) return '';
    if (run.summary_only) {
        return 'No metric telemetry available for this run yet. This is a summary-only historical run backfilled from registry metadata.';
    }
    return 'No metric telemetry available for this run yet. Ensure the training worker is posting experiment_metrics for each epoch or step.';
}

export async function backfillSummaryExperimentRuns(
    store: ExperimentTrackingStore,
    tenantId: string,
): Promise<void> {
    const [runs, registryEntries, datasetVersions, benchmarkReports, calibrationReports] = await Promise.all([
        store.listExperimentRuns(tenantId, { limit: 500, includeSummaryOnly: true }),
        store.listModelRegistryEntries(tenantId),
        store.listLearningDatasetVersions(tenantId, 500),
        store.listLearningBenchmarkReports(tenantId, 500),
        store.listLearningCalibrationReports(tenantId, 500),
    ]);

    const runsByModelVersion = new Map<string, ExperimentRunRecord>();
    const existingBenchmarkKeys = new Set<string>();
    const existingLinkRunIds = new Set<string>();

    for (const run of runs) {
        if (run.model_version) {
            runsByModelVersion.set(run.model_version, run);
        }
    }

    for (const run of runs) {
        const [benchmarks, link] = await Promise.all([
            store.listExperimentBenchmarks(tenantId, run.run_id),
            store.getExperimentRegistryLink(tenantId, run.run_id),
        ]);
        benchmarks.forEach((benchmark) => {
            existingBenchmarkKeys.add(`${run.run_id}:${benchmark.benchmark_family}`);
        });
        if (link) existingLinkRunIds.add(run.run_id);
    }

    const datasetSummaryByVersion = new Map<string, Array<{ dataset_kind: string; row_count: number; summary: Record<string, unknown> }>>();
    for (const datasetVersion of datasetVersions) {
        const bucket = datasetSummaryByVersion.get(datasetVersion.dataset_version) ?? [];
        bucket.push({
            dataset_kind: datasetVersion.dataset_kind,
            row_count: datasetVersion.row_count,
            summary: datasetVersion.summary,
        });
        datasetSummaryByVersion.set(datasetVersion.dataset_version, bucket);
    }

    const calibrationByRegistryId = new Map<string, { status: string; report: Record<string, unknown> }>();
    for (const report of calibrationReports) {
        if (!report.model_registry_id) continue;
        calibrationByRegistryId.set(report.model_registry_id, {
            status: readCalibrationStatus(report.report_payload),
            report: report.report_payload,
        });
    }

    const benchmarkByRegistryId = new Map<string, Array<{
        benchmark_family: string;
        task_type: string;
        summary_score: number | null;
        pass_status: string;
        report_payload: Record<string, unknown>;
    }>>();
    for (const report of benchmarkReports) {
        if (!report.model_registry_id) continue;
        const bucket = benchmarkByRegistryId.get(report.model_registry_id) ?? [];
        bucket.push({
            benchmark_family: report.benchmark_family,
            task_type: report.task_type,
            summary_score: report.summary_score,
            pass_status: report.pass_status,
            report_payload: report.report_payload,
        });
        benchmarkByRegistryId.set(report.model_registry_id, bucket);
    }

    for (const entry of registryEntries) {
        let run = entry.model_version ? runsByModelVersion.get(entry.model_version) ?? null : null;
        const datasetLineage = buildDatasetLineage(entry.training_dataset_version, datasetSummaryByVersion.get(entry.training_dataset_version) ?? []);
        const primaryMetric = pickPrimaryMetricFromScorecard(entry.task_type, entry.benchmark_scorecard);
        const registryContext = {
            promotion_status: entry.promotion_status,
            champion_or_challenger: entry.is_champion ? 'champion' : entry.promotion_status === 'challenger' ? 'challenger' : 'candidate',
            calibration_report_id: entry.calibration_report_id,
            parent_model_version: entry.parent_model_version,
        };
        const taskType = mapRegistryTaskToExperimentTask(entry.task_type);
        const modality = mapTaskToModality(taskType);
        const modelArch = asString(entry.artifact_payload.model_name) ?? entry.model_name;
        const modelSize = asString(entry.artifact_payload.model_size)
            ?? asString(asRecord(entry.artifact_payload.training_summary).parameter_scale)
            ?? null;
        const hyperparameters = asRecord(entry.artifact_payload.hyperparameters);
        const safetyMetrics = buildSafetyMetrics(entry.benchmark_scorecard, calibrationByRegistryId.get(entry.id)?.report ?? null);

        if (!run) {
            run = await store.createExperimentRun({
                tenant_id: tenantId,
                run_id: createBackfillRunId(entry.model_version),
                experiment_group_id: `${entry.task_type}_registry_backfill`,
                sweep_id: null,
                parent_run_id: entry.parent_model_version ? createBackfillRunId(entry.parent_model_version) : null,
                baseline_run_id: null,
                task_type: taskType,
                modality,
                target_type: entry.task_type,
                model_arch: modelArch,
                model_size: modelSize,
                model_version: entry.model_version,
                dataset_name: entry.training_dataset_version,
                dataset_version: entry.training_dataset_version,
                feature_schema_version: entry.feature_schema_version,
                label_policy_version: entry.label_policy_version,
                epochs_planned: readNumber(asRecord(entry.artifact_payload.training_summary), 'epochs_planned'),
                epochs_completed: readNumber(asRecord(entry.artifact_payload.training_summary), 'epochs_completed')
                    ?? readNumber(asRecord(entry.artifact_payload.training_summary), 'epochs')
                    ?? 0,
                metric_primary_name: primaryMetric.name,
                metric_primary_value: primaryMetric.value,
                status: entry.promotion_status === 'rolled_back' ? 'rolled_back' : entry.is_champion ? 'promoted' : 'completed',
                status_reason: 'summary_only_backfill',
                progress_percent: 100,
                summary_only: true,
                created_by: null,
                hyperparameters,
                dataset_lineage: datasetLineage,
                config_snapshot: entry.artifact_payload,
                safety_metrics: safetyMetrics,
                resource_usage: entry.resource_profile ?? {},
                registry_context: registryContext,
                last_heartbeat_at: entry.updated_at,
                started_at: entry.created_at,
                ended_at: entry.updated_at,
            });
            runsByModelVersion.set(entry.model_version, run);
        } else if (run.summary_only) {
            run = await store.updateExperimentRun(run.run_id, tenantId, {
                experiment_group_id: run.experiment_group_id ?? `${entry.task_type}_registry_backfill`,
                parent_run_id: run.parent_run_id ?? (entry.parent_model_version ? createBackfillRunId(entry.parent_model_version) : null),
                task_type: run.task_type,
                modality: run.modality,
                target_type: run.target_type ?? entry.task_type,
                model_arch: run.model_arch || modelArch,
                model_size: run.model_size ?? modelSize,
                model_version: run.model_version ?? entry.model_version,
                dataset_name: run.dataset_name || entry.training_dataset_version,
                dataset_version: run.dataset_version ?? entry.training_dataset_version,
                feature_schema_version: run.feature_schema_version ?? entry.feature_schema_version,
                label_policy_version: run.label_policy_version ?? entry.label_policy_version,
                metric_primary_name: run.metric_primary_name ?? primaryMetric.name,
                metric_primary_value: run.metric_primary_value ?? primaryMetric.value,
                registry_context: Object.keys(run.registry_context).length > 0 ? run.registry_context : registryContext,
                dataset_lineage: Object.keys(run.dataset_lineage).length > 0 ? run.dataset_lineage : datasetLineage,
                hyperparameters: Object.keys(run.hyperparameters).length > 0 ? run.hyperparameters : hyperparameters,
                safety_metrics: Object.keys(run.safety_metrics).length > 0 ? run.safety_metrics : safetyMetrics,
                resource_usage: Object.keys(run.resource_usage).length > 0 ? run.resource_usage : (entry.resource_profile ?? {}),
            });
        }

        if (!existingLinkRunIds.has(run.run_id)) {
            const calibration = calibrationByRegistryId.get(entry.id);
            const safetyBenchmark = (benchmarkByRegistryId.get(entry.id) ?? []).find((item) =>
                item.benchmark_family.includes('adversarial') ||
                item.benchmark_family.includes('safety') ||
                item.benchmark_family.includes('severity'),
            ) ?? null;
            await store.upsertExperimentRegistryLink({
                tenant_id: tenantId,
                run_id: run.run_id,
                model_registry_entry_id: entry.id,
                registry_candidate_id: entry.id,
                champion_or_challenger: entry.is_champion
                    ? 'champion'
                    : entry.promotion_status === 'challenger'
                        ? 'challenger'
                        : 'candidate',
                promotion_status: entry.promotion_status,
                calibration_status: calibration?.status ?? 'pending',
                adversarial_gate_status: safetyBenchmark?.pass_status ?? 'pending',
                deployment_eligibility: entry.promotion_status === 'rejected'
                    ? 'blocked'
                    : calibration?.status === 'fail'
                        ? 'blocked'
                        : safetyBenchmark?.pass_status === 'fail'
                            ? 'blocked'
                            : 'eligible_review',
            });
            existingLinkRunIds.add(run.run_id);
        }

        for (const report of benchmarkByRegistryId.get(entry.id) ?? []) {
            const key = `${run.run_id}:${report.benchmark_family}`;
            if (existingBenchmarkKeys.has(key)) continue;
            await store.upsertExperimentBenchmark({
                tenant_id: tenantId,
                run_id: run.run_id,
                benchmark_family: report.benchmark_family,
                task_type: report.task_type,
                summary_score: report.summary_score,
                pass_status: report.pass_status,
                report_payload: report.report_payload,
            });
            existingBenchmarkKeys.add(key);
        }

        await backfillArtifactsFromRegistryPayload(store, tenantId, run.run_id, entry.artifact_payload);
    }
}

function buildDashboardSummary(runs: ExperimentRunRecord[]): ExperimentDashboardSummary {
    const totalRuns = runs.length;
    const activeRuns = runs.filter((run) => isActiveStatus(run.status));
    const failedRuns = runs.filter((run) => run.status === 'failed');
    const summaryOnlyRuns = runs.filter((run) => run.summary_only);
    const telemetryReady = runs.filter((run) => !run.summary_only && run.last_heartbeat_at != null).length;
    const registryReady = runs.filter((run) => Object.keys(run.registry_context).length > 0).length;
    const safetyReady = runs.filter((run) => Object.keys(run.safety_metrics).length > 0).length;

    return {
        total_runs: totalRuns,
        active_runs: activeRuns.length,
        failed_runs: failedRuns.length,
        summary_only_runs: summaryOnlyRuns.length,
        telemetry_coverage_pct: percent(telemetryReady, totalRuns),
        registry_link_coverage_pct: percent(registryReady, totalRuns),
        safety_metric_coverage_pct: percent(safetyReady, totalRuns),
        failed_run_ids: failedRuns.map((run) => run.run_id),
        active_run_ids: activeRuns.map((run) => run.run_id),
    };
}

function pickDefaultSelectedRunId(runs: ExperimentRunRecord[]): string | null {
    if (runs.length === 0) return null;

    const bootstrapSmokeRun = runs.find((run) => run.run_id === 'run_diag_smoke_v1');
    if (bootstrapSmokeRun) {
        return bootstrapSmokeRun.run_id;
    }

    const activeRun = runs
        .filter((run) => isActiveStatus(run.status))
        .sort((left, right) => {
            const leftKey = left.last_heartbeat_at ?? left.updated_at;
            const rightKey = right.last_heartbeat_at ?? right.updated_at;
            return rightKey.localeCompare(leftKey);
        })[0];
    if (activeRun) {
        return activeRun.run_id;
    }

    return runs[0]?.run_id ?? null;
}

function filterAuditEventsForRun(
    run: ExperimentRunRecord,
    auditEvents: Array<{ event_type: string; event_payload: Record<string, unknown>; created_at: string }>,
): ExperimentAuditEventRecord[] {
    return auditEvents
        .filter((event) => {
            const payload = event.event_payload;
            return payload.run_id === run.run_id ||
                payload.model_version === run.model_version ||
                payload.candidate_model_version === run.model_version ||
                payload.registry_candidate_id === run.registry_context.registry_candidate_id;
        })
        .slice(0, 20)
        .map((event) => ({
            event_type: event.event_type,
            created_at: event.created_at,
            payload: event.event_payload,
        }));
}

function getMissingTelemetryFields(
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
): string[] {
    const latest = metrics[metrics.length - 1] ?? null;
    const fields = [
        ['epoch', latest?.epoch],
        ['global_step', latest?.global_step],
        ['train_loss', latest?.train_loss],
        ['val_accuracy', latest?.val_accuracy],
        ['learning_rate', latest?.learning_rate],
        ['gradient_norm', latest?.gradient_norm],
        ['last_heartbeat_at', run.last_heartbeat_at],
    ] as const;

    return fields
        .filter(([, value]) => value == null)
        .map(([label]) => label);
}

function pickPrimaryMetric(
    taskType: ExperimentTaskType,
    latest: ExperimentMetricRecord | null,
): { name: string; value: number } | null {
    if (!latest) return null;
    if (taskType === 'clinical_diagnosis') {
        return latest.macro_f1 != null
            ? { name: 'macro_f1', value: latest.macro_f1 }
            : latest.val_accuracy != null
                ? { name: 'val_accuracy', value: latest.val_accuracy }
                : null;
    }
    if (taskType === 'severity_prediction') {
        return latest.recall_critical != null
            ? { name: 'recall_critical', value: latest.recall_critical }
            : latest.val_accuracy != null
                ? { name: 'val_accuracy', value: latest.val_accuracy }
                : null;
    }
    return latest.val_accuracy != null ? { name: 'val_accuracy', value: latest.val_accuracy } : null;
}

function pickPrimaryMetricFromScorecard(
    taskType: string,
    scorecard: Record<string, unknown>,
): { name: string | null; value: number | null } {
    const orderedKeys = taskType === 'severity'
        ? ['severity_critical_recall', 'severity_high_recall', 'severity_false_negative_rate']
        : ['diagnosis_macro_f1', 'diagnosis_accuracy', 'calibration_ece'];

    for (const key of orderedKeys) {
        const value = numberOrNull(scorecard[key]);
        if (value != null) {
            return { name: key, value };
        }
    }

    const firstNumeric = Object.entries(scorecard).find(([, value]) => numberOrNull(value) != null);
    return {
        name: firstNumeric?.[0] ?? null,
        value: firstNumeric ? numberOrNull(firstNumeric[1]) : null,
    };
}

function buildDatasetLineage(
    datasetVersion: string,
    rows: Array<{ dataset_kind: string; row_count: number; summary: Record<string, unknown> }>,
): Record<string, unknown> {
    const diagnosis = rows.find((row) => row.dataset_kind === 'diagnosis_training_set');
    const severity = rows.find((row) => row.dataset_kind === 'severity_training_set');
    const calibration = rows.find((row) => row.dataset_kind === 'calibration_eval_set');
    const adversarial = rows.find((row) => row.dataset_kind === 'adversarial_benchmark_set');
    const quarantine = rows.find((row) => row.dataset_kind === 'quarantine_set');

    return {
        dataset_version: datasetVersion,
        total_cases: numberOrNull(diagnosis?.summary.total_cases) ?? diagnosis?.row_count ?? 0,
        clean_labeled_count: diagnosis?.row_count ?? 0,
        severity_ready_count: severity?.row_count ?? 0,
        contradiction_ready_count: numberOrNull(diagnosis?.summary.contradiction_ready_count)
            ?? numberOrNull(adversarial?.summary.adversarial_cases)
            ?? 0,
        adversarial_count: adversarial?.row_count ?? 0,
        quarantined_excluded_count: quarantine?.row_count ?? 0,
        calibration_eval_count: calibration?.row_count ?? 0,
        train_val_test_split_policy: diagnosis?.summary.split_policy ?? 'holdout_or_resubstitution',
        label_composition: asRecord(diagnosis?.summary.label_composition),
    };
}

function buildSafetyMetrics(
    benchmarkScorecard: Record<string, unknown>,
    calibrationReport: Record<string, unknown> | null,
): Record<string, unknown> {
    return {
        macro_f1: numberOrNull(benchmarkScorecard.diagnosis_macro_f1),
        top_3_accuracy: numberOrNull(benchmarkScorecard.diagnosis_top_3_accuracy),
        recall_critical: numberOrNull(benchmarkScorecard.severity_critical_recall),
        emergency_false_negative_rate: numberOrNull(benchmarkScorecard.severity_false_negative_rate),
        calibration_ece: numberOrNull(benchmarkScorecard.calibration_ece)
            ?? numberOrNull(calibrationReport?.expected_calibration_error),
        calibration_brier: numberOrNull(benchmarkScorecard.calibration_brier)
            ?? numberOrNull(calibrationReport?.brier_score),
    };
}

async function backfillArtifactsFromRegistryPayload(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    artifactPayload: Record<string, unknown>,
): Promise<void> {
    const existing = await store.listExperimentArtifacts(tenantId, runId);
    const existingKeys = new Set(existing.map((artifact) => `${artifact.artifact_type}:${artifact.uri ?? ''}`));
    const candidates: Array<{ artifact_type: string; label: string; uri: string | null; is_primary: boolean }> = [
        {
            artifact_type: 'best_checkpoint',
            label: 'Best checkpoint',
            uri: asString(artifactPayload.best_checkpoint_uri) ?? null,
            is_primary: true,
        },
        {
            artifact_type: 'final_checkpoint',
            label: 'Final checkpoint',
            uri: asString(artifactPayload.final_checkpoint_uri) ?? null,
            is_primary: false,
        },
        {
            artifact_type: 'artifact_bundle',
            label: 'Artifact bundle',
            uri: asString(artifactPayload.artifact_uri) ?? null,
            is_primary: false,
        },
        {
            artifact_type: 'tensorboard',
            label: 'Tensorboard / logs',
            uri: asString(artifactPayload.tensorboard_uri) ?? asString(artifactPayload.log_uri) ?? null,
            is_primary: false,
        },
        {
            artifact_type: 'benchmark_report',
            label: 'Benchmark report',
            uri: asString(artifactPayload.benchmark_report_uri) ?? null,
            is_primary: false,
        },
        {
            artifact_type: 'calibration_report',
            label: 'Calibration report',
            uri: asString(artifactPayload.calibration_report_uri) ?? null,
            is_primary: false,
        },
    ];

    for (const candidate of candidates) {
        const key = `${candidate.artifact_type}:${candidate.uri ?? ''}`;
        if (!candidate.uri || existingKeys.has(key)) continue;
        await store.upsertExperimentArtifact({
            tenant_id: tenantId,
            run_id: runId,
            artifact_type: candidate.artifact_type,
            label: candidate.label,
            uri: candidate.uri,
            metadata: {},
            is_primary: candidate.is_primary,
        });
        existingKeys.add(key);
    }
}

function readCalibrationStatus(reportPayload: Record<string, unknown>): string {
    const recommendation = asRecord(reportPayload.recommendation);
    const status = asString(recommendation.status);
    if (status === 'pass') return 'passed';
    if (status === 'needs_recalibration') return 'fail';
    return status ?? 'pending';
}

function mapRegistryTaskToExperimentTask(taskType: string): ExperimentTaskType {
    if (taskType === 'severity') return 'severity_prediction';
    if (taskType === 'hybrid') return 'multimodal_fusion';
    return 'clinical_diagnosis';
}

function mapTaskToModality(taskType: ExperimentTaskType): ExperimentRunRecord['modality'] {
    if (taskType === 'vision_classification') return 'imaging';
    if (taskType === 'multimodal_fusion') return 'multimodal';
    if (taskType === 'calibration_model') return 'text_structured';
    return 'tabular_clinical';
}

function createBackfillRunId(modelVersion: string): string {
    return `run_${modelVersion.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 56)}`;
}

function resolveProgressPercent(
    run: ExperimentRunRecord,
    latest: ExperimentMetricRecord | null,
): number {
    if (!latest) return clampPercent(run.progress_percent ?? 0);
    if (run.epochs_planned && latest.epoch != null) {
        return clampPercent((latest.epoch / Math.max(run.epochs_planned, 1)) * 100);
    }
    return clampPercent(run.progress_percent ?? 0);
}

function percent(value: number, total: number): number {
    if (total === 0) return 0;
    return Number(((value / total) * 100).toFixed(1));
}

function clampPercent(value: number | null): number {
    const normalized = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(0, Math.min(100, Number(normalized.toFixed(1))));
}

function isActiveStatus(status: ExperimentRunStatus): boolean {
    return status === 'queued' ||
        status === 'initializing' ||
        status === 'training' ||
        status === 'validating' ||
        status === 'checkpointing';
}

function isTerminalStatus(status: ExperimentRunStatus): boolean {
    return status === 'completed' ||
        status === 'failed' ||
        status === 'aborted' ||
        status === 'promoted' ||
        status === 'rolled_back';
}

function formatMetricTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
    return numberOrNull(record[key]);
}
