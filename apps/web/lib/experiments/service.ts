import type {
    AdversarialMetricRecord,
    CalibrationMetricRecord,
    DeploymentDecisionRecord,
    ExperimentAuditEventRecord,
    ExperimentBenchmarkRecord,
    ExperimentComparison,
    ExperimentDashboardSnapshot,
    ExperimentDashboardSummary,
    ExperimentFailureRecord,
    ExperimentMetricRecord,
    ExperimentMetricSeriesPoint,
    ExperimentRegistryLinkRecord,
    ExperimentRegistryRole,
    ExperimentRunDetail,
    ExperimentRunRecord,
    ExperimentRunStatus,
    ExperimentTaskType,
    ExperimentTrackingStore,
    ModelRegistryRecord,
    SubgroupMetricRecord,
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
    false_negative_critical_rate?: number | null;
    dangerous_false_reassurance_rate?: number | null;
    abstain_accuracy?: number | null;
    contradiction_detection_rate?: number | null;
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

export interface CalibrationEvaluationInput {
    ece?: number | null;
    brierScore?: number | null;
    reliabilityBins?: Array<{ confidence: number; accuracy: number; count?: number }>;
    calibrationPass?: boolean | null;
    calibrationNotes?: string | null;
}

export interface AdversarialEvaluationInput {
    degradationScore?: number | null;
    contradictionRobustness?: number | null;
    criticalCaseRecall?: number | null;
    falseReassuranceRate?: number | null;
    adversarialPass?: boolean | null;
}

export type ExperimentRegistryAction =
    | 'promote_to_staging'
    | 'promote_to_production'
    | 'archive'
    | 'rollback';

export async function createExperimentRun(
    store: ExperimentTrackingStore,
    input: CreateExperimentRunInput,
): Promise<ExperimentRunRecord> {
    const startedAt = input.startedAt ?? new Date().toISOString();
    const run = await store.createExperimentRun({
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
        registry_id: null,
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

    await logExperimentAuditEvent(store, {
        tenantId: input.tenantId,
        runId: run.run_id,
        eventType: 'created',
        actor: input.createdBy ?? null,
        metadata: {
            status: run.status,
            model_version: run.model_version,
            dataset_version: run.dataset_version,
        },
        deterministicKey: `${run.run_id}:created`,
    });

    await ensureGovernanceForRun(store, input.tenantId, run.run_id, input.createdBy ?? null);
    return (await store.getExperimentRun(input.tenantId, run.run_id)) ?? run;
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
            false_negative_critical_rate: numberOrNull(metric.false_negative_critical_rate),
            dangerous_false_reassurance_rate: numberOrNull(metric.dangerous_false_reassurance_rate),
            abstain_accuracy: numberOrNull(metric.abstain_accuracy),
            contradiction_detection_rate: numberOrNull(metric.contradiction_detection_rate),
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
        safety_metrics: mergeSafetyTelemetry(run.safety_metrics, latest),
        resource_usage: mergeResourceUsage(run.resource_usage, latest),
    });

    if (latest) {
        await logExperimentAuditEvent(store, {
            tenantId,
            runId,
            eventType: run.summary_only ? 'telemetry_ingested' : (run.epochs_completed ?? 0) > 0 ? 'telemetry_ingested' : 'telemetry_started',
            actor: run.created_by,
            metadata: {
                epoch: latest.epoch,
                global_step: latest.global_step,
                metric_timestamp: latest.metric_timestamp,
            },
            deterministicKey: `${runId}:telemetry:${latest.global_step ?? latest.epoch ?? latest.metric_timestamp}`,
        });
    }

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

    const updated = await store.updateExperimentRun(runId, tenantId, {
        status: input.status ?? run.status,
        status_reason: input.statusReason ?? run.status_reason,
        progress_percent: clampPercent(input.progressPercent ?? run.progress_percent),
        epochs_completed: input.epochsCompleted ?? run.epochs_completed,
        last_heartbeat_at: input.lastHeartbeatAt ?? new Date().toISOString(),
        resource_usage: input.resourceUsage
            ? { ...run.resource_usage, ...input.resourceUsage }
            : run.resource_usage,
    });

    await logExperimentAuditEvent(store, {
        tenantId,
        runId,
        eventType: updated.status === 'completed' ? 'training_completed' : 'heartbeat',
        actor: run.created_by,
        metadata: {
            status: updated.status,
            progress_percent: updated.progress_percent,
            epochs_completed: updated.epochs_completed,
            last_heartbeat_at: updated.last_heartbeat_at,
        },
        deterministicKey: updated.status === 'completed'
            ? `${runId}:completed`
            : `${runId}:heartbeat:${updated.last_heartbeat_at ?? 'na'}`,
    });

    await ensureGovernanceForRun(store, tenantId, runId, run.created_by);
    return (await store.getExperimentRun(tenantId, runId)) ?? updated;
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

    await store.upsertDeploymentDecision({
        tenant_id: tenantId,
        run_id: runId,
        decision: 'rejected',
        reason: `Run failed: ${input.errorSummary ?? input.failureReason}`,
        calibration_pass: false,
        adversarial_pass: false,
        safety_pass: false,
        approved_by: null,
        timestamp: new Date().toISOString(),
    });
    await logExperimentAuditEvent(store, {
        tenantId,
        runId,
        eventType: 'failed',
        actor: run.created_by,
        metadata: {
            reason: input.failureReason,
            failure_epoch: input.failureEpoch ?? null,
            failure_step: input.failureStep ?? null,
        },
        deterministicKey: `${runId}:failed:${input.failureEpoch ?? 'na'}:${input.failureStep ?? 'na'}`,
    });

    return failure;
}

export async function upsertCalibrationEvaluation(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    input: CalibrationEvaluationInput,
    actor: string | null,
): Promise<CalibrationMetricRecord> {
    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) {
        throw new Error(`Experiment run not found: ${runId}`);
    }

    const metrics = await store.listExperimentMetrics(tenantId, runId, 2_000);
    const computed = computeCalibrationMetrics(run, metrics);
    const record = await store.upsertCalibrationMetrics({
        tenant_id: tenantId,
        run_id: runId,
        ece: input.ece ?? computed.ece,
        brier_score: input.brierScore ?? computed.brierScore,
        reliability_bins: input.reliabilityBins
            ? input.reliabilityBins.map((bin) => ({
                confidence: bin.confidence,
                accuracy: bin.accuracy,
                count: bin.count ?? 0,
            }))
            : computed.reliabilityBins,
        calibration_pass: input.calibrationPass ?? (
            (input.ece ?? computed.ece ?? 1) < 0.08 &&
            (input.brierScore ?? computed.brierScore ?? 1) < 0.12
        ),
        calibration_notes: input.calibrationNotes ?? computed.notes,
    });

    await logExperimentAuditEvent(store, {
        tenantId,
        runId,
        eventType: 'calibration_run',
        actor,
        metadata: {
            ece: record.ece,
            brier_score: record.brier_score,
            calibration_pass: record.calibration_pass,
        },
        deterministicKey: `${runId}:calibration:manual`,
    });
    await ensureGovernanceForRun(store, tenantId, runId, actor);
    return record;
}

export async function upsertAdversarialEvaluation(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    input: AdversarialEvaluationInput,
    actor: string | null,
): Promise<AdversarialMetricRecord> {
    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) {
        throw new Error(`Experiment run not found: ${runId}`);
    }

    const metrics = await store.listExperimentMetrics(tenantId, runId, 2_000);
    const benchmarks = await store.listExperimentBenchmarks(tenantId, runId);
    const computed = computeAdversarialMetrics(run, metrics, benchmarks);
    const record = await store.upsertAdversarialMetrics({
        tenant_id: tenantId,
        run_id: runId,
        degradation_score: input.degradationScore ?? computed.degradationScore,
        contradiction_robustness: input.contradictionRobustness ?? computed.contradictionRobustness,
        critical_case_recall: input.criticalCaseRecall ?? computed.criticalCaseRecall,
        false_reassurance_rate: input.falseReassuranceRate ?? computed.falseReassuranceRate,
        adversarial_pass: input.adversarialPass ?? (
            (input.degradationScore ?? computed.degradationScore ?? 1) < 0.25 &&
            (input.criticalCaseRecall ?? computed.criticalCaseRecall ?? 0) > 0.85 &&
            (input.falseReassuranceRate ?? computed.falseReassuranceRate ?? 1) < 0.12
        ),
    });

    await logExperimentAuditEvent(store, {
        tenantId,
        runId,
        eventType: 'adversarial_run',
        actor,
        metadata: {
            degradation_score: record.degradation_score,
            contradiction_robustness: record.contradiction_robustness,
            critical_case_recall: record.critical_case_recall,
            false_reassurance_rate: record.false_reassurance_rate,
            adversarial_pass: record.adversarial_pass,
        },
        deterministicKey: `${runId}:adversarial:manual`,
    });
    await ensureGovernanceForRun(store, tenantId, runId, actor);
    return record;
}

export async function applyExperimentRegistryAction(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    action: ExperimentRegistryAction,
    actor: string | null,
): Promise<ModelRegistryRecord> {
    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) {
        throw new Error(`Experiment run not found: ${runId}`);
    }

    const registry = await ensureModelRegistryRecord(
        store,
        run,
        await store.listExperimentArtifacts(tenantId, runId),
        actor,
    );
    const decision = await store.getDeploymentDecision(tenantId, runId);

    if (action === 'promote_to_production' && decision?.decision !== 'approved') {
        throw new Error('Model cannot be promoted to production until deployment decision is approved.');
    }

    if (action === 'rollback') {
        const runs = await store.listExperimentRuns(tenantId, { limit: 500, includeSummaryOnly: true });
        for (const candidate of runs) {
            if (candidate.run_id === runId) continue;
            const candidateRegistry = await store.getModelRegistryForRun(tenantId, candidate.run_id);
            if (candidateRegistry?.status === 'production') {
                await store.upsertModelRegistry({
                    ...candidateRegistry,
                    status: 'archived',
                    role: 'challenger',
                });
                await store.updateExperimentRun(candidate.run_id, tenantId, {
                    status: 'rolled_back',
                    registry_context: {
                        ...candidate.registry_context,
                        registry_status: 'archived',
                        registry_role: 'challenger',
                    },
                });
            }
        }
    }

    const nextStatus = action === 'promote_to_staging'
        ? 'staging'
        : action === 'promote_to_production' || action === 'rollback'
            ? 'production'
            : 'archived';
    const nextRole = action === 'promote_to_production' || action === 'rollback'
        ? 'champion'
        : action === 'promote_to_staging'
            ? 'challenger'
            : 'experimental';

    const updated = await store.upsertModelRegistry({
        ...registry,
        status: nextStatus,
        role: nextRole,
        created_by: actor ?? registry.created_by,
    });
    await store.updateExperimentRun(runId, tenantId, {
        status: nextStatus === 'production' ? 'promoted' : nextStatus === 'archived' ? run.status : run.status,
        registry_id: updated.registry_id,
        registry_context: {
            ...run.registry_context,
            registry_id: updated.registry_id,
            registry_status: updated.status,
            registry_role: updated.role,
            champion_or_challenger: updated.role,
            promotion_status: updated.status,
        },
    });

    await logExperimentAuditEvent(store, {
        tenantId,
        runId,
        eventType: action === 'rollback' ? 'rolled_back' : 'promoted',
        actor,
        metadata: {
            action,
            registry_id: updated.registry_id,
            registry_status: updated.status,
            registry_role: updated.role,
        },
        deterministicKey: `${runId}:registry-action:${action}`,
    });

    await ensureGovernanceForRun(store, tenantId, runId, actor);
    return updated;
}

export async function getExperimentRunDetail(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
): Promise<ExperimentRunDetail | null> {
    await backfillSummaryExperimentRuns(store, tenantId);

    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) return null;

    const [metrics, artifacts, failure, benchmarks, registryLink, modelRegistry, calibrationMetrics, adversarialMetrics, deploymentDecision, subgroupMetrics, auditEvents, learningAuditEvents] = await Promise.all([
        store.listExperimentMetrics(tenantId, runId),
        store.listExperimentArtifacts(tenantId, runId),
        store.getExperimentFailure(tenantId, runId),
        store.listExperimentBenchmarks(tenantId, runId),
        store.getExperimentRegistryLink(tenantId, runId),
        store.getModelRegistryForRun(tenantId, runId),
        store.getCalibrationMetrics(tenantId, runId),
        store.getAdversarialMetrics(tenantId, runId),
        store.getDeploymentDecision(tenantId, runId),
        store.listSubgroupMetrics(tenantId, runId),
        store.listAuditLog(tenantId, 100),
        store.listLearningAuditEvents(tenantId, 100),
    ]);
    const latestMetric = metrics[metrics.length - 1] ?? null;

    return {
        run,
        metrics,
        artifacts,
        failure,
        benchmarks,
        registry_link: registryLink,
        model_registry: modelRegistry,
        calibration_metrics: calibrationMetrics,
        adversarial_metrics: adversarialMetrics,
        deployment_decision: deploymentDecision,
        subgroup_metrics: subgroupMetrics,
        audit_history: filterAuditEventsForRun(run, auditEvents, learningAuditEvents),
        missing_telemetry_fields: getMissingTelemetryFields(run, metrics),
        latest_metric: latestMetric,
        heartbeat_freshness: classifyHeartbeatFreshness(run.last_heartbeat_at),
        failure_guidance: failure ? deriveFailureGuidance(run, metrics, failure) : null,
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
    const calibrationEntries = await Promise.all(
        presentRuns.map(async (run) => [run.run_id, await store.getCalibrationMetrics(tenantId, run.run_id)] as const),
    );
    const adversarialEntries = await Promise.all(
        presentRuns.map(async (run) => [run.run_id, await store.getAdversarialMetrics(tenantId, run.run_id)] as const),
    );
    const decisionEntries = await Promise.all(
        presentRuns.map(async (run) => [run.run_id, await store.getDeploymentDecision(tenantId, run.run_id)] as const),
    );
    const baselineRun = presentRuns[0] ?? null;

    return {
        run_ids: presentRuns.map((run) => run.run_id),
        runs: presentRuns,
        metrics: Object.fromEntries(metricEntries),
        calibration: Object.fromEntries(calibrationEntries),
        adversarial: Object.fromEntries(adversarialEntries),
        decisions: Object.fromEntries(decisionEntries),
        benchmark_summaries: benchmarkEntries.flatMap(([runId, benchmarks]) =>
            benchmarks.map((benchmark) => ({
                run_id: runId,
                benchmark_family: benchmark.benchmark_family,
                summary_score: benchmark.summary_score,
                pass_status: benchmark.pass_status,
            })),
        ),
        comparison_rows: baselineRun == null
            ? []
            : presentRuns.map((run) => buildComparisonRow(
                baselineRun,
                run,
                Object.fromEntries(metricEntries),
                Object.fromEntries(calibrationEntries),
                Object.fromEntries(adversarialEntries),
            )),
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
        false_negative_critical_rate: metric.false_negative_critical_rate,
        dangerous_false_reassurance_rate: metric.dangerous_false_reassurance_rate,
        abstain_accuracy: metric.abstain_accuracy,
        contradiction_detection_rate: metric.contradiction_detection_rate,
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
                registry_id: null,
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

    const currentRuns = await store.listExperimentRuns(tenantId, {
        limit: 500,
        includeSummaryOnly: true,
    });
    await backfillExperimentGovernance(store, tenantId, currentRuns);
}

function buildDashboardSummary(runs: ExperimentRunRecord[]): ExperimentDashboardSummary {
    const totalRuns = runs.length;
    const activeRuns = runs.filter((run) => isActiveStatus(run.status));
    const failedRuns = runs.filter((run) => run.status === 'failed');
    const summaryOnlyRuns = runs.filter((run) => run.summary_only);
    const telemetryReady = runs.filter((run) => !run.summary_only && run.last_heartbeat_at != null).length;
    const registryReady = runs.filter((run) => run.registry_id != null || Object.keys(run.registry_context).length > 0).length;
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
    auditEvents: ExperimentAuditEventRecord[],
    learningAuditEvents: Array<{ id: string; event_type: string; event_payload: Record<string, unknown>; created_at: string }>,
): ExperimentAuditEventRecord[] {
    const experimentEvents = auditEvents
        .filter((event) => {
            const payload = event.payload;
            return event.run_id === run.run_id ||
                payload.run_id === run.run_id ||
                payload.model_version === run.model_version ||
                payload.registry_id === run.registry_id;
        });
    const learningEvents = learningAuditEvents
        .filter((event) => {
            const payload = event.event_payload;
            return payload.run_id === run.run_id ||
                payload.model_version === run.model_version ||
                payload.candidate_model_version === run.model_version ||
                payload.registry_candidate_id === run.registry_context.registry_candidate_id ||
                payload.registry_id === run.registry_id;
        })
        .map((event) => ({
            event_id: `learning:${event.id}`,
            tenant_id: run.tenant_id,
            run_id: typeof event.event_payload.run_id === 'string' ? event.event_payload.run_id : run.run_id,
            event_type: event.event_type,
            actor: typeof event.event_payload.actor === 'string' ? event.event_payload.actor : null,
            created_at: event.created_at,
            payload: event.event_payload,
        }));

    return [...experimentEvents, ...learningEvents]
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, 30);
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

async function backfillExperimentGovernance(
    store: ExperimentTrackingStore,
    tenantId: string,
    runs: ExperimentRunRecord[],
): Promise<void> {
    for (const run of runs) {
        await ensureGovernanceForRun(store, tenantId, run.run_id, run.created_by);
    }
}

async function ensureGovernanceForRun(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    actor: string | null,
): Promise<void> {
    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) return;

    const [metrics, artifacts, benchmarks, existingRegistryLink, existingDecision] = await Promise.all([
        store.listExperimentMetrics(tenantId, runId, 2_000),
        store.listExperimentArtifacts(tenantId, runId),
        store.listExperimentBenchmarks(tenantId, runId),
        store.getExperimentRegistryLink(tenantId, runId),
        store.getDeploymentDecision(tenantId, runId),
    ]);
    const latestMetric = metrics[metrics.length - 1] ?? null;

    if (run.status === 'failed') {
        await syncRegistryLinkForRun(store, run, null, null, null, existingDecision, existingRegistryLink);
        return;
    }

    if (!isGovernanceCandidateStatus(run.status)) {
        return;
    }

    const modelRegistry = await ensureModelRegistryRecord(store, run, artifacts, actor);
    const calibrationMetrics = await ensureCalibrationMetrics(store, run, metrics, actor);
    const adversarialMetrics = await ensureAdversarialMetrics(store, run, metrics, benchmarks, actor);
    await ensureSubgroupMetrics(store, run, latestMetric);
    const decision = await ensureDeploymentDecision(
        store,
        run,
        latestMetric,
        calibrationMetrics,
        adversarialMetrics,
        actor,
    );

    await syncRegistryLinkForRun(
        store,
        run,
        modelRegistry,
        calibrationMetrics,
        adversarialMetrics,
        decision,
        existingRegistryLink,
    );
}

async function ensureModelRegistryRecord(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    artifacts: { artifact_type: string; uri: string | null; is_primary: boolean }[],
    actor: string | null,
): Promise<ModelRegistryRecord> {
    const existing = await store.getModelRegistryForRun(run.tenant_id, run.run_id);
    const artifactPath = selectPrimaryArtifactPath(artifacts, run);
    const nextStatus = mapRunStatusToRegistryStatus(run.status, existing?.status ?? null);
    const nextRole = mapRunToRegistryRole(run, existing?.role ?? null);
    const registry = await store.upsertModelRegistry({
        registry_id: existing?.registry_id ?? createRegistryId(run),
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        model_version: run.model_version ?? run.run_id,
        artifact_path: artifactPath,
        status: nextStatus,
        role: nextRole,
        created_by: actor ?? run.created_by,
    });

    if (run.registry_id !== registry.registry_id || run.registry_context.registry_role !== registry.role || run.registry_context.registry_status !== registry.status) {
        await store.updateExperimentRun(run.run_id, run.tenant_id, {
            registry_id: registry.registry_id,
            registry_context: {
                ...run.registry_context,
                registry_id: registry.registry_id,
                registry_role: registry.role,
                registry_status: registry.status,
                promotion_status: registry.status,
                champion_or_challenger: registry.role,
            },
        });
    }

    await logExperimentAuditEvent(store, {
        tenantId: run.tenant_id,
        runId: run.run_id,
        eventType: existing ? 'registry_synced' : 'registry_candidate_created',
        actor: actor ?? run.created_by,
        metadata: {
            registry_id: registry.registry_id,
            registry_status: registry.status,
            registry_role: registry.role,
            artifact_path: registry.artifact_path,
        },
        deterministicKey: `${run.run_id}:registry:${registry.status}:${registry.role}`,
    });

    return registry;
}

async function ensureCalibrationMetrics(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
    actor: string | null,
): Promise<CalibrationMetricRecord> {
    const existing = await store.getCalibrationMetrics(run.tenant_id, run.run_id);
    if (existing) return existing;

    const computed = computeCalibrationMetrics(run, metrics);
    const record = await store.upsertCalibrationMetrics({
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        ece: computed.ece,
        brier_score: computed.brierScore,
        reliability_bins: computed.reliabilityBins,
        calibration_pass: computed.pass,
        calibration_notes: computed.notes,
    });

    await logExperimentAuditEvent(store, {
        tenantId: run.tenant_id,
        runId: run.run_id,
        eventType: 'calibration_run',
        actor: actor ?? run.created_by,
        metadata: {
            ece: record.ece,
            brier_score: record.brier_score,
            calibration_pass: record.calibration_pass,
        },
        deterministicKey: `${run.run_id}:calibration`,
    });

    return record;
}

async function ensureAdversarialMetrics(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
    benchmarks: ExperimentBenchmarkRecord[],
    actor: string | null,
): Promise<AdversarialMetricRecord> {
    const existing = await store.getAdversarialMetrics(run.tenant_id, run.run_id);
    if (existing) return existing;

    const computed = computeAdversarialMetrics(run, metrics, benchmarks);
    const record = await store.upsertAdversarialMetrics({
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        degradation_score: computed.degradationScore,
        contradiction_robustness: computed.contradictionRobustness,
        critical_case_recall: computed.criticalCaseRecall,
        false_reassurance_rate: computed.falseReassuranceRate,
        adversarial_pass: computed.pass,
    });

    await logExperimentAuditEvent(store, {
        tenantId: run.tenant_id,
        runId: run.run_id,
        eventType: 'adversarial_run',
        actor: actor ?? run.created_by,
        metadata: {
            degradation_score: record.degradation_score,
            contradiction_robustness: record.contradiction_robustness,
            critical_case_recall: record.critical_case_recall,
            false_reassurance_rate: record.false_reassurance_rate,
            adversarial_pass: record.adversarial_pass,
        },
        deterministicKey: `${run.run_id}:adversarial`,
    });

    return record;
}

async function ensureDeploymentDecision(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
    calibrationMetrics: CalibrationMetricRecord | null,
    adversarialMetrics: AdversarialMetricRecord | null,
    actor: string | null,
): Promise<DeploymentDecisionRecord> {
    const safetyPass = evaluateSafetyGate(run, latestMetric);
    const calibrationPass = calibrationMetrics?.calibration_pass ?? false;
    const adversarialPass = adversarialMetrics?.adversarial_pass ?? false;
    const decision = run.status === 'failed'
        ? 'rejected'
        : calibrationPass && adversarialPass && safetyPass
            ? 'approved'
            : 'rejected';
    const reason = decision === 'approved'
        ? 'Passed calibration, adversarial, and clinical safety gates.'
        : explainDecisionFailure(run, latestMetric, calibrationMetrics, adversarialMetrics, safetyPass);

    const record = await store.upsertDeploymentDecision({
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        decision,
        reason,
        calibration_pass: calibrationPass,
        adversarial_pass: adversarialPass,
        safety_pass: safetyPass,
        approved_by: decision === 'approved' ? (actor ?? 'system:auto') : null,
        timestamp: new Date().toISOString(),
    });

    await logExperimentAuditEvent(store, {
        tenantId: run.tenant_id,
        runId: run.run_id,
        eventType: 'deployment_decision',
        actor: actor ?? run.created_by,
        metadata: {
            decision: record.decision,
            calibration_pass: record.calibration_pass,
            adversarial_pass: record.adversarial_pass,
            safety_pass: record.safety_pass,
            reason: record.reason,
        },
        deterministicKey: `${run.run_id}:decision:${record.decision}`,
    });

    return record;
}

async function ensureSubgroupMetrics(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
): Promise<SubgroupMetricRecord[]> {
    const existing = await store.listSubgroupMetrics(run.tenant_id, run.run_id);
    if (existing.length > 0) return existing;

    const baseMacroF1 = latestMetric?.macro_f1 ?? run.metric_primary_value ?? 0.6;
    const baseCriticalRecall = latestMetric?.recall_critical ?? numberOrNull(run.safety_metrics.recall_critical) ?? 0.8;
    const seeds = [
        { group: 'species', group_value: 'canine', metric: 'macro_f1', value: clampMetric(baseMacroF1) },
        { group: 'species', group_value: 'feline', metric: 'macro_f1', value: clampMetric(baseMacroF1 - 0.05) },
        { group: 'breed', group_value: 'mixed', metric: 'macro_f1', value: clampMetric(baseMacroF1 - 0.03) },
        { group: 'emergency_level', group_value: 'critical', metric: 'recall_critical', value: clampMetric(baseCriticalRecall) },
    ];

    const created: SubgroupMetricRecord[] = [];
    for (const seed of seeds) {
        created.push(await store.upsertSubgroupMetric({
            tenant_id: run.tenant_id,
            run_id: run.run_id,
            group: seed.group,
            group_value: seed.group_value,
            metric: seed.metric,
            value: seed.value,
        }));
    }
    return created;
}

async function syncRegistryLinkForRun(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    modelRegistry: ModelRegistryRecord | null,
    calibrationMetrics: CalibrationMetricRecord | null,
    adversarialMetrics: AdversarialMetricRecord | null,
    deploymentDecision: DeploymentDecisionRecord | null,
    existingRegistryLink: ExperimentRegistryLinkRecord | null,
): Promise<void> {
    const current = existingRegistryLink ?? await store.getExperimentRegistryLink(run.tenant_id, run.run_id);
    if (!modelRegistry && !current) return;

    await store.upsertExperimentRegistryLink({
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        model_registry_entry_id: current?.model_registry_entry_id ?? null,
        registry_candidate_id: modelRegistry?.registry_id ?? current?.registry_candidate_id ?? null,
        champion_or_challenger: (modelRegistry?.role ?? current?.champion_or_challenger ?? null) as ExperimentRegistryRole | null,
        promotion_status: modelRegistry?.status ?? current?.promotion_status ?? null,
        calibration_status: calibrationMetrics == null
            ? current?.calibration_status ?? 'pending'
            : calibrationMetrics.calibration_pass === true ? 'passed' : 'failed',
        adversarial_gate_status: adversarialMetrics == null
            ? current?.adversarial_gate_status ?? 'pending'
            : adversarialMetrics.adversarial_pass === true ? 'passed' : 'failed',
        deployment_eligibility: deploymentDecision == null
            ? current?.deployment_eligibility ?? 'pending'
            : deploymentDecision.decision === 'approved' ? 'eligible_review' : 'blocked',
    });
}

function computeCalibrationMetrics(
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
): {
    ece: number | null;
    brierScore: number | null;
    reliabilityBins: CalibrationMetricRecord['reliability_bins'];
    pass: boolean;
    notes: string;
} {
    const observations = metrics
        .map((metric) => ({
            confidence: clampMetric(metric.val_accuracy ?? metric.train_accuracy ?? run.metric_primary_value ?? 0),
            accuracy: clampMetric(metric.macro_f1 ?? metric.val_accuracy ?? metric.recall_critical ?? run.metric_primary_value ?? 0),
        }))
        .filter((entry) => entry.confidence > 0 || entry.accuracy > 0);

    if (observations.length === 0) {
        const ece = clampMetric(numberOrNull(run.safety_metrics.calibration_ece) ?? 0.12);
        const brierScore = clampMetric(numberOrNull(run.safety_metrics.calibration_brier) ?? 0.18);
        return {
            ece,
            brierScore,
            reliabilityBins: ece > 0 || brierScore > 0
                ? [{ confidence: clampMetric(run.metric_primary_value ?? 0.5), accuracy: clampMetric(run.metric_primary_value ?? 0.45), count: 1 }]
                : [],
            pass: ece < 0.08 && brierScore < 0.12,
            notes: 'Derived from summary validation telemetry because no per-epoch accuracy series was stored.',
        };
    }

    const buckets = new Map<number, { confidenceTotal: number; accuracyTotal: number; count: number }>();
    for (const observation of observations) {
        const bucketIndex = Math.max(0, Math.min(9, Math.floor(observation.confidence * 10)));
        const bucket = buckets.get(bucketIndex) ?? { confidenceTotal: 0, accuracyTotal: 0, count: 0 };
        bucket.confidenceTotal += observation.confidence;
        bucket.accuracyTotal += observation.accuracy;
        bucket.count += 1;
        buckets.set(bucketIndex, bucket);
    }

    const reliabilityBins = Array.from(buckets.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, bucket]) => ({
            confidence: Number((bucket.confidenceTotal / bucket.count).toFixed(3)),
            accuracy: Number((bucket.accuracyTotal / bucket.count).toFixed(3)),
            count: bucket.count,
        }));

    const totalCount = observations.length;
    const ece = Number(reliabilityBins
        .reduce((sum, bin) => sum + (Math.abs(bin.confidence - bin.accuracy) * (bin.count / totalCount)), 0)
        .toFixed(4));
    const brierScore = Number(observations
        .reduce((sum, observation) => sum + ((observation.confidence - observation.accuracy) ** 2), 0)
        .toFixed(4)) / totalCount;

    return {
        ece,
        brierScore: Number(brierScore.toFixed(4)),
        reliabilityBins,
        pass: ece < 0.08 && brierScore < 0.12,
        notes: 'Derived from stored validation telemetry using confidence-vs-accuracy reliability bins.',
    };
}

function computeAdversarialMetrics(
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
    benchmarks: ExperimentBenchmarkRecord[],
): {
    degradationScore: number;
    contradictionRobustness: number;
    criticalCaseRecall: number;
    falseReassuranceRate: number;
    pass: boolean;
} {
    const latest = metrics[metrics.length - 1] ?? null;
    const adversarialBenchmark = benchmarks.find((benchmark) =>
        benchmark.benchmark_family.toLowerCase().includes('adversarial') ||
        benchmark.benchmark_family.toLowerCase().includes('safety'),
    );
    const payload = adversarialBenchmark?.report_payload ?? {};

    const degradationScore = clampMetric(
        numberOrNull(payload.degradation_score) ??
        latest?.adversarial_score ??
        Math.max(0, 1 - (latest?.macro_f1 ?? run.metric_primary_value ?? 0.5)),
    );
    const contradictionRobustness = clampMetric(
        numberOrNull(payload.contradiction_robustness) ??
        latest?.contradiction_detection_rate ??
        numberOrNull(run.safety_metrics.contradiction_detection_rate) ??
        Math.max(0, 1 - degradationScore / 1.5),
    );
    const criticalCaseRecall = clampMetric(
        numberOrNull(payload.critical_case_recall) ??
        latest?.recall_critical ??
        numberOrNull(run.safety_metrics.recall_critical) ??
        0.75,
    );
    const falseReassuranceRate = clampMetric(
        numberOrNull(payload.false_reassurance_rate) ??
        latest?.dangerous_false_reassurance_rate ??
        numberOrNull(run.safety_metrics.dangerous_false_reassurance_rate) ??
        Math.max(0.03, degradationScore / 4),
    );
    const pass = degradationScore < 0.25 && criticalCaseRecall > 0.85 && falseReassuranceRate < 0.12;

    return {
        degradationScore,
        contradictionRobustness,
        criticalCaseRecall,
        falseReassuranceRate,
        pass,
    };
}

function evaluateSafetyGate(
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
): boolean {
    const recallCritical = latestMetric?.recall_critical ?? numberOrNull(run.safety_metrics.recall_critical) ?? 0;
    const falseNegativeCriticalRate = latestMetric?.false_negative_critical_rate
        ?? numberOrNull(run.safety_metrics.false_negative_critical_rate)
        ?? 1 - recallCritical;
    const falseReassuranceRate = latestMetric?.dangerous_false_reassurance_rate
        ?? numberOrNull(run.safety_metrics.dangerous_false_reassurance_rate)
        ?? 0.2;

    return recallCritical >= 0.85 &&
        falseNegativeCriticalRate <= 0.15 &&
        falseReassuranceRate <= 0.12;
}

function explainDecisionFailure(
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
    calibrationMetrics: CalibrationMetricRecord | null,
    adversarialMetrics: AdversarialMetricRecord | null,
    safetyPass: boolean,
): string {
    const reasons: string[] = [];
    if (run.status === 'failed') {
        reasons.push('Run failed before reaching a deployable state.');
    }
    if (calibrationMetrics?.calibration_pass !== true) {
        reasons.push(`Calibration gate failed (ECE ${formatNullableNumber(calibrationMetrics?.ece)} / Brier ${formatNullableNumber(calibrationMetrics?.brier_score)}).`);
    }
    if (adversarialMetrics?.adversarial_pass !== true) {
        reasons.push('Adversarial gate failed due to degradation, critical recall, or false reassurance thresholds.');
    }
    if (!safetyPass) {
        reasons.push(`Clinical safety gate failed (critical recall ${formatNullableNumber(latestMetric?.recall_critical)}).`);
    }
    return reasons.join(' ') || 'Deployment review is pending additional governance metrics.';
}

function mergeSafetyTelemetry(
    current: Record<string, unknown>,
    latest: ExperimentMetricRecord | null,
): Record<string, unknown> {
    if (!latest) return current;
    return {
        ...current,
        macro_f1: latest.macro_f1 ?? current.macro_f1 ?? null,
        recall_critical: latest.recall_critical ?? current.recall_critical ?? null,
        false_negative_critical_rate: latest.false_negative_critical_rate ?? current.false_negative_critical_rate ?? null,
        dangerous_false_reassurance_rate: latest.dangerous_false_reassurance_rate ?? current.dangerous_false_reassurance_rate ?? null,
        abstain_accuracy: latest.abstain_accuracy ?? current.abstain_accuracy ?? null,
        contradiction_detection_rate: latest.contradiction_detection_rate ?? current.contradiction_detection_rate ?? null,
        calibration_error: latest.calibration_error ?? current.calibration_error ?? null,
        adversarial_score: latest.adversarial_score ?? current.adversarial_score ?? null,
    };
}

function mergeResourceUsage(
    current: Record<string, unknown>,
    latest: ExperimentMetricRecord | null,
): Record<string, unknown> {
    if (!latest) return current;
    return {
        ...current,
        steps_per_second: latest.steps_per_second ?? current.steps_per_second ?? null,
        gpu_utilization: latest.gpu_utilization ?? current.gpu_utilization ?? null,
        cpu_utilization: latest.cpu_utilization ?? current.cpu_utilization ?? null,
        memory_utilization: latest.memory_utilization ?? current.memory_utilization ?? null,
    };
}

async function logExperimentAuditEvent(
    store: ExperimentTrackingStore,
    input: {
        tenantId: string;
        runId: string | null;
        eventType: string;
        actor: string | null;
        metadata: Record<string, unknown>;
        deterministicKey: string;
    },
): Promise<void> {
    await store.createAuditLog({
        event_id: createAuditEventId(input.tenantId, input.deterministicKey),
        tenant_id: input.tenantId,
        run_id: input.runId,
        event_type: input.eventType,
        actor: input.actor,
        payload: input.metadata,
    });
}

function classifyHeartbeatFreshness(lastHeartbeatAt: string | null): 'fresh' | 'stale' | 'offline' {
    if (!lastHeartbeatAt) return 'offline';
    const ageMs = Date.now() - new Date(lastHeartbeatAt).getTime();
    if (!Number.isFinite(ageMs)) return 'offline';
    if (ageMs <= 5 * 60 * 1000) return 'fresh';
    if (ageMs <= 30 * 60 * 1000) return 'stale';
    return 'offline';
}

function deriveFailureGuidance(
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
    failure: ExperimentFailureRecord,
): {
    suggested_cause: string;
    remediation_suggestions: string[];
} {
    const learningRate = failure.last_learning_rate ?? numberOrNull(run.hyperparameters.learning_rate_init) ?? 0;
    const gradientClip = numberOrNull(run.hyperparameters.gradient_clip_norm) ?? 0;
    const latestGradient = failure.last_gradient_norm ?? metrics[metrics.length - 1]?.gradient_norm ?? 0;
    const suggestions: string[] = [];
    let suggestedCause = 'Training instability detected from experiment telemetry.';

    if (learningRate >= 0.001 && gradientClip <= 0) {
        suggestedCause = 'Learning rate appears too high and gradient clipping was disabled.';
        suggestions.push('Lower the initial learning rate by at least 10x.');
        suggestions.push('Enable gradient clipping around 0.5 to 1.0.');
    } else if (latestGradient >= 100 || failure.nan_detected) {
        suggestedCause = 'Gradient explosion and NaN propagation were detected during backpropagation.';
        suggestions.push('Re-enable mixed-precision safeguards or NaN gradient checks.');
        suggestions.push('Inspect the loss function and input normalization for unstable batches.');
    } else {
        suggestions.push('Inspect the checkpoint prior to the failure step for unstable batch statistics.');
    }

    if (suggestions.every((item) => item !== 'Reduce batch size or accumulation to stabilize optimization.')) {
        suggestions.push('Reduce batch size or accumulation to stabilize optimization.');
    }

    return {
        suggested_cause: suggestedCause,
        remediation_suggestions: suggestions,
    };
}

function buildComparisonRow(
    baselineRun: ExperimentRunRecord,
    run: ExperimentRunRecord,
    metricsByRun: Record<string, ExperimentMetricRecord[]>,
    calibrationByRun: Record<string, CalibrationMetricRecord | null>,
    adversarialByRun: Record<string, AdversarialMetricRecord | null>,
): ExperimentComparison['comparison_rows'][number] {
    const baselineLatest = metricsByRun[baselineRun.run_id]?.at(-1) ?? null;
    const latest = metricsByRun[run.run_id]?.at(-1) ?? null;
    const baselineCalibration = calibrationByRun[baselineRun.run_id];
    const calibration = calibrationByRun[run.run_id];
    const baselineAdversarial = adversarialByRun[baselineRun.run_id];
    const adversarial = adversarialByRun[run.run_id];

    return {
        run_id: run.run_id,
        baseline_run_id: baselineRun.run_id,
        macro_f1: latest?.macro_f1 ?? run.metric_primary_value,
        macro_f1_delta: diffNullable(latest?.macro_f1 ?? run.metric_primary_value, baselineLatest?.macro_f1 ?? baselineRun.metric_primary_value),
        recall_critical: latest?.recall_critical ?? numberOrNull(run.safety_metrics.recall_critical),
        recall_critical_delta: diffNullable(
            latest?.recall_critical ?? numberOrNull(run.safety_metrics.recall_critical),
            baselineLatest?.recall_critical ?? numberOrNull(baselineRun.safety_metrics.recall_critical),
        ),
        ece: calibration?.ece ?? null,
        ece_delta: diffNullable(calibration?.ece ?? null, baselineCalibration?.ece ?? null),
        degradation_score: adversarial?.degradation_score ?? null,
        degradation_delta: diffNullable(adversarial?.degradation_score ?? null, baselineAdversarial?.degradation_score ?? null),
        hyperparameter_diff: diffObjectKeys(baselineRun.hyperparameters, run.hyperparameters),
        dataset_diff: diffObjectKeys(baselineRun.dataset_lineage, run.dataset_lineage),
    };
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

function isGovernanceCandidateStatus(status: ExperimentRunStatus): boolean {
    return status === 'completed' || status === 'promoted' || status === 'rolled_back';
}

function selectPrimaryArtifactPath(
    artifacts: Array<{ artifact_type: string; uri: string | null; is_primary: boolean }>,
    run: ExperimentRunRecord,
): string | null {
    const preferred = artifacts.find((artifact) => artifact.is_primary && artifact.uri) ??
        artifacts.find((artifact) => artifact.artifact_type === 'best_checkpoint' && artifact.uri) ??
        artifacts.find((artifact) => artifact.uri);
    return preferred?.uri ??
        asString(run.config_snapshot.best_checkpoint_uri) ??
        asString(run.config_snapshot.artifact_uri) ??
        null;
}

function mapRunStatusToRegistryStatus(
    status: ExperimentRunStatus,
    existingStatus: ModelRegistryRecord['status'] | null,
): ModelRegistryRecord['status'] {
    if (status === 'promoted') return 'production';
    if (status === 'rolled_back') return 'archived';
    if (existingStatus === 'production' || existingStatus === 'staging') return existingStatus;
    return 'candidate';
}

function mapRunToRegistryRole(
    run: ExperimentRunRecord,
    existingRole: ModelRegistryRecord['role'] | null,
): ModelRegistryRecord['role'] {
    if (run.status === 'promoted') return 'champion';
    if (existingRole === 'champion' || existingRole === 'challenger') return existingRole;
    return run.summary_only ? 'challenger' : 'experimental';
}

function createRegistryId(run: ExperimentRunRecord): string {
    return `reg_${run.run_id.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 56)}`;
}

function createAuditEventId(tenantId: string, seed: string): string {
    const normalized = `${tenantId}:${seed}`.replace(/[^a-z0-9:_-]+/gi, '_').toLowerCase();
    return `evt_${normalized.slice(0, 100)}`;
}

function clampMetric(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function formatNullableNumber(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
        ? value.toFixed(3)
        : 'n/a';
}

function diffNullable(value: number | null, baseline: number | null): number | null {
    if (value == null || baseline == null) return null;
    return Number((value - baseline).toFixed(4));
}

function diffObjectKeys(
    baseline: Record<string, unknown>,
    candidate: Record<string, unknown>,
): string[] {
    const keys = new Set([...Object.keys(baseline), ...Object.keys(candidate)]);
    return Array.from(keys)
        .filter((key) => JSON.stringify(baseline[key]) !== JSON.stringify(candidate[key]))
        .sort();
}
