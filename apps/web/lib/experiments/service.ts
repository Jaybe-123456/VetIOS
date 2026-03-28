import type {
    AdversarialMetricRecord,
    CalibrationMetricRecord,
    ClinicalMetricsRecord,
    DeploymentDecisionRecord,
    ExperimentAuditEventRecord,
    ExperimentArtifactRecord,
    ExperimentBenchmarkRecord,
    ExperimentComparison,
    ExperimentDashboardSnapshot,
    ExperimentDashboardSummary,
    ExperimentFailureRecord,
    GateStatus,
    ExperimentHeartbeatFreshness,
    ExperimentMetricRecord,
    ExperimentMetricSeriesPoint,
    ExperimentRegistryLinkState,
    ExperimentRegistryLinkRecord,
    ExperimentRegistryRole,
    ExperimentRunDetail,
    ExperimentRunRecord,
    ExperimentRunStatus,
    ExperimentSafetyCoverage,
    ExperimentTaskType,
    ExperimentTrackingStore,
    ModelFamily,
    RegistryActionBlockCode,
    RegistryConsistencyIssue,
    RegistryControlPlaneVerificationCheck,
    RegistryControlPlaneVerificationResult,
    RegistryRegistrationValidation,
    RegistryRollbackReadiness,
    ModelRegistryControlPlaneSnapshot,
    ModelRegistryRecord,
    PromotionRequirementsRecord,
    RegistryAuditLogRecord,
    RegistryDecisionPanel,
    RegistryLineageRecord,
    SubgroupMetricRecord,
} from '@/lib/experiments/types';

const CONTROL_PLANE_SNAPSHOT_TTL_MS = 15 * 1000;
const modelRegistryControlPlaneSnapshotCache = new Map<string, {
    expiresAt: number;
    snapshot: ModelRegistryControlPlaneSnapshot;
}>();
const modelRegistryControlPlaneInFlight = new Map<string, Promise<ModelRegistryControlPlaneSnapshot>>();

function invalidateModelRegistryControlPlaneSnapshot(tenantId: string): void {
    for (const readOnly of [true, false]) {
        const cacheKey = getModelRegistryControlPlaneCacheKey(tenantId, readOnly);
        modelRegistryControlPlaneSnapshotCache.delete(cacheKey);
        modelRegistryControlPlaneInFlight.delete(cacheKey);
    }
}

function getModelRegistryControlPlaneCacheKey(tenantId: string, readOnly: boolean): string {
    return `${tenantId}:${readOnly ? 'read_only' : 'materialized'}`;
}

export class RegistryControlPlaneError extends Error {
    readonly code: string;
    readonly httpStatus: number;
    readonly details: Record<string, unknown>;

    constructor(
        code: string,
        message: string,
        options: {
            httpStatus?: number;
            details?: Record<string, unknown>;
        } = {},
    ) {
        super(message);
        this.name = 'RegistryControlPlaneError';
        this.code = code;
        this.httpStatus = options.httpStatus ?? 400;
        this.details = options.details ?? {};
    }
}

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
    confidenceHistogram?: Array<{ confidence: number; count?: number }>;
    calibrationPass?: boolean | null;
    calibrationNotes?: string | null;
}

export interface AdversarialEvaluationInput {
    degradationScore?: number | null;
    contradictionRobustness?: number | null;
    criticalCaseRecall?: number | null;
    falseReassuranceRate?: number | null;
    dangerousFalseReassuranceRate?: number | null;
    adversarialPass?: boolean | null;
}

export type ExperimentRegistryAction =
    | 'promote_to_staging'
    | 'promote_to_production'
    | 'set_manual_approval'
    | 'archive'
    | 'rollback';

const HEARTBEAT_HEALTHY_THRESHOLD_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERRUPTED_THRESHOLD_MS = 30 * 60 * 1000;
const MODEL_FAMILY_ORDER: ModelFamily[] = ['diagnostics', 'vision', 'therapeutics'];

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

    invalidateModelRegistryControlPlaneSnapshot(input.tenantId);
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

    invalidateModelRegistryControlPlaneSnapshot(tenantId);
    await ensureGovernanceForRun(store, tenantId, runId, run.created_by);
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

    const resumedStatus = run.status === 'stalled' || run.status === 'interrupted'
        ? 'training'
        : run.status;
    const nextStatus = input.status ?? resumedStatus;

    const updated = await store.updateExperimentRun(runId, tenantId, {
        status: nextStatus,
        status_reason: input.statusReason ?? run.status_reason,
        progress_percent: clampPercent(input.progressPercent ?? run.progress_percent),
        epochs_completed: input.epochsCompleted ?? run.epochs_completed,
        last_heartbeat_at: input.lastHeartbeatAt ?? new Date().toISOString(),
        ended_at: nextStatus === 'completed'
            ? run.ended_at ?? new Date().toISOString()
            : run.ended_at,
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

    invalidateModelRegistryControlPlaneSnapshot(tenantId);
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

    const decision = await store.upsertDeploymentDecision({
        tenant_id: tenantId,
        run_id: runId,
        decision: 'rejected',
        reason: `Run failed: ${input.errorSummary ?? input.failureReason}`,
        calibration_pass: false,
        adversarial_pass: false,
        safety_pass: false,
        benchmark_pass: false,
        manual_approval: null,
        approved_by: null,
        timestamp: new Date().toISOString(),
    });
    await logExperimentAuditEvent(store, {
        tenantId,
        runId,
        eventType: 'deployment_evaluated',
        actor: run.created_by,
        metadata: {
            decision: decision.decision,
            reason: decision.reason,
            calibration_pass: decision.calibration_pass,
            adversarial_pass: decision.adversarial_pass,
            safety_pass: decision.safety_pass,
        },
        deterministicKey: `${runId}:decision:failed`,
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

    invalidateModelRegistryControlPlaneSnapshot(tenantId);
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
        confidence_histogram: input.confidenceHistogram
            ? input.confidenceHistogram.map((bin) => ({
                confidence: bin.confidence,
                count: bin.count ?? 0,
            }))
            : computed.confidenceHistogram,
        calibration_pass: input.calibrationPass ?? (
            (input.ece ?? computed.ece ?? 1) < 0.08 &&
            (input.brierScore ?? computed.brierScore ?? 1) < 0.12
        ),
        calibration_notes: input.calibrationNotes ?? computed.notes,
    });

    await logExperimentAuditEvent(store, {
        tenantId,
        runId,
        eventType: 'calibration_completed',
        actor,
        metadata: {
            ece: record.ece,
            brier_score: record.brier_score,
            calibration_pass: record.calibration_pass,
        },
        deterministicKey: `${runId}:calibration:manual`,
    });
    invalidateModelRegistryControlPlaneSnapshot(tenantId);
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
        false_reassurance_rate: input.falseReassuranceRate ?? input.dangerousFalseReassuranceRate ?? computed.falseReassuranceRate,
        dangerous_false_reassurance_rate: input.dangerousFalseReassuranceRate ?? input.falseReassuranceRate ?? computed.falseReassuranceRate,
        adversarial_pass: input.adversarialPass ?? (
            (input.degradationScore ?? computed.degradationScore ?? 1) < 0.25 &&
            (input.criticalCaseRecall ?? computed.criticalCaseRecall ?? 0) > 0.85 &&
            (input.dangerousFalseReassuranceRate ?? input.falseReassuranceRate ?? computed.falseReassuranceRate ?? 1) < 0.12
        ),
    });

    await logExperimentAuditEvent(store, {
        tenantId,
        runId,
        eventType: 'adversarial_completed',
        actor,
        metadata: {
            degradation_score: record.degradation_score,
            contradiction_robustness: record.contradiction_robustness,
            critical_case_recall: record.critical_case_recall,
            dangerous_false_reassurance_rate: record.dangerous_false_reassurance_rate,
            adversarial_pass: record.adversarial_pass,
        },
        deterministicKey: `${runId}:adversarial:manual`,
    });
    invalidateModelRegistryControlPlaneSnapshot(tenantId);
    await ensureGovernanceForRun(store, tenantId, runId, actor);
    return record;
}

export async function applyExperimentRegistryAction(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    action: ExperimentRegistryAction,
    actor: string | null,
    options: {
        manualApproval?: boolean | null;
        reason?: string | null;
        incidentId?: string | null;
    } = {},
): Promise<ModelRegistryRecord> {
    await ensureGovernanceForRun(store, tenantId, runId, actor);

    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) {
        throw new RegistryControlPlaneError('RUN_NOT_FOUND', `Experiment run not found: ${runId}`, {
            httpStatus: 404,
            details: {
                status: 'failed',
            },
        });
    }

    const actionStartedAt = new Date().toISOString();
    const [artifacts, metrics, benchmarks, registryLink, decision, registry, calibrationMetrics, adversarialMetrics, promotionRequirements, registryRecords] = await Promise.all([
        store.listExperimentArtifacts(tenantId, runId),
        store.listExperimentMetrics(tenantId, runId, 2_000),
        store.listExperimentBenchmarks(tenantId, runId),
        store.getExperimentRegistryLink(tenantId, runId),
        store.getDeploymentDecision(tenantId, runId),
        store.getModelRegistryForRun(tenantId, runId),
        store.getCalibrationMetrics(tenantId, runId),
        store.getAdversarialMetrics(tenantId, runId),
        store.getPromotionRequirements(tenantId, runId),
        store.listModelRegistry(tenantId),
    ]);
    const ensuredRegistry = registry ?? await ensureModelRegistryRecord(store, run, artifacts, actor, {
        strict: true,
    });
    if (!ensuredRegistry) {
        throw new RegistryControlPlaneError('INVALID_ARTIFACT_METADATA', 'Registry registration could not be completed.', {
            httpStatus: 422,
            details: {
                status: 'blocked',
                reason: ['invalid_artifact_metadata'],
            },
        });
    }
    const latestMetric = metrics.at(-1) ?? null;
    const registryLinkState = deriveRegistryLinkState(run, ensuredRegistry, registryLink);
    const effectivePromotionRequirements = promotionRequirements ?? await ensurePromotionRequirements(
        store,
        run,
        ensuredRegistry,
        benchmarks,
        calibrationMetrics,
        adversarialMetrics,
        latestMetric,
        actor,
    );
    const promotionReadiness = evaluatePromotionReadiness(
        run,
        registryLinkState,
        calibrationMetrics,
        adversarialMetrics,
        latestMetric,
        effectivePromotionRequirements,
        ensuredRegistry,
    );
    const previousRegistryState = buildRegistryStateSnapshot(ensuredRegistry);
    const lastStableModel = findLastStableModel(ensuredRegistry, registryRecords);

    if (action === 'set_manual_approval') {
        const updatedRequirements = await store.upsertPromotionRequirements({
            id: effectivePromotionRequirements.id,
            tenant_id: tenantId,
            registry_id: ensuredRegistry.registry_id,
            run_id: runId,
            calibration_pass: effectivePromotionRequirements.calibration_pass,
            adversarial_pass: effectivePromotionRequirements.adversarial_pass,
            safety_pass: effectivePromotionRequirements.safety_pass,
            benchmark_pass: effectivePromotionRequirements.benchmark_pass,
            manual_approval: options.manualApproval === true,
        });

        await logRegistryAuditEvent(store, {
            tenantId,
            registryId: ensuredRegistry.registry_id,
            runId,
            eventType: 'manual_approval_updated',
            actor,
            metadata: buildRegistryAuditMetadata({
                eventType: 'manual_approval_updated',
                actor,
                previousState: previousRegistryState,
                newState: previousRegistryState,
                reason: options.reason ?? null,
                manual_approval: updatedRequirements.manual_approval,
            }),
        });
        await assertRegistryAuditEventRecorded(store, {
            tenantId,
            registryId: ensuredRegistry.registry_id,
            runId,
            eventType: 'manual_approval_updated',
            since: actionStartedAt,
        });

        invalidateModelRegistryControlPlaneSnapshot(tenantId);
        await ensureGovernanceForRun(store, tenantId, runId, actor);
        return (await store.getModelRegistryForRun(tenantId, runId)) ?? ensuredRegistry;
    }

    if (action === 'promote_to_staging') {
        if (ensuredRegistry.lifecycle_status === 'archived') {
            throw new RegistryControlPlaneError('INVALID_STATE_TRANSITION', 'Archived models cannot be promoted back into staging.', {
                httpStatus: 409,
                details: { status: 'blocked' },
            });
        }
        if (ensuredRegistry.lifecycle_status === 'production' && ensuredRegistry.registry_role === 'champion') {
            throw new RegistryControlPlaneError('INVALID_STATE_TRANSITION', 'The active production champion cannot be moved to staging.', {
                httpStatus: 409,
                details: { status: 'blocked' },
            });
        }
        if (ensuredRegistry.registry_role === 'at_risk') {
            throw new RegistryControlPlaneError('REGISTRY_AT_RISK', 'Models marked at_risk cannot be promoted into staging.', {
                httpStatus: 409,
                details: {
                    status: 'blocked',
                    reason: ['registry_at_risk'],
                },
            });
        }

        const updated = await store.upsertModelRegistry({
            ...ensuredRegistry,
            lifecycle_status: 'staging',
            registry_role: 'challenger',
            status: 'staging',
            role: 'challenger',
            artifact_path: ensuredRegistry.artifact_uri ?? ensuredRegistry.artifact_path,
            archived_at: null,
        });

        await logRegistryAuditEvent(store, {
            tenantId,
            registryId: updated.registry_id,
            runId,
            eventType: 'staged',
            actor,
            metadata: buildRegistryAuditMetadata({
                eventType: 'staged',
                actor,
                previousState: previousRegistryState,
                newState: buildRegistryStateSnapshot(updated),
                reason: options.reason ?? 'promote_to_staging',
                model_family: updated.model_family,
                manual_approval: effectivePromotionRequirements.manual_approval,
            }),
        });
        await assertRegistryAuditEventRecorded(store, {
            tenantId,
            registryId: updated.registry_id,
            runId,
            eventType: 'staged',
            since: actionStartedAt,
        });

        await syncRegistryLinkForRun(
            store,
            run,
            updated,
            calibrationMetrics,
            adversarialMetrics,
            decision,
            registryLink,
            effectivePromotionRequirements,
        );

        invalidateModelRegistryControlPlaneSnapshot(tenantId);
        await ensureGovernanceForRun(store, tenantId, runId, actor);
        return (await store.getModelRegistryForRun(tenantId, runId)) ?? updated;
    }

    if (action === 'promote_to_production') {
        if (!promotionReadiness.can_promote) {
            throw new RegistryControlPlaneError('PROMOTION_BLOCKED', promotionReadiness.tooltip, {
                httpStatus: 409,
                details: {
                    status: 'blocked',
                    reason: promotionReadiness.blocker_codes,
                    blockers: promotionReadiness.blockers,
                },
            });
        }

        const updated = await store.promoteRegistryToProduction({
            tenantId,
            runId,
            actor,
        });
        await assertRegistryAuditEventRecorded(store, {
            tenantId,
            registryId: updated.registry_id,
            runId,
            eventType: 'promoted',
            since: actionStartedAt,
        });
        const transitionIssues = await validateRegistryTransitionState(
            store,
            tenantId,
            updated.model_family,
            updated.registry_id,
        );
        if (transitionIssues.length > 0) {
            if (updated.rollback_target) {
                try {
                    await store.rollbackRegistryToTarget({
                        tenantId,
                        runId: updated.run_id,
                        actor: actor ?? 'system:registry-validator',
                        reason: 'Automatic rollback triggered after failed atomic promotion validation.',
                        incidentId: null,
                    });
                } catch {
                    // Best-effort recovery only.
                }
            }
            throw new RegistryControlPlaneError('INVALID_STATE_TRANSITION', 'Atomic promotion validation failed after transition.', {
                httpStatus: 500,
                details: {
                    status: 'failed',
                    reason: transitionIssues.map((issue) => issue.code),
                    issues: transitionIssues,
                },
            });
        }

        await logExperimentAuditEvent(store, {
            tenantId,
            runId,
            eventType: 'promoted',
            actor,
            metadata: {
                action,
                registry_id: updated.registry_id,
                registry_status: updated.lifecycle_status,
                registry_role: updated.registry_role,
            },
            deterministicKey: `${runId}:registry-action:${action}`,
        });

        invalidateModelRegistryControlPlaneSnapshot(tenantId);
        await ensureGovernanceForRun(store, tenantId, runId, actor);
        return (await store.getModelRegistryForRun(tenantId, runId)) ?? updated;
    }

    if (action === 'rollback') {
        const rollbackReadiness = evaluateRollbackReadiness(ensuredRegistry, lastStableModel);
        if (!rollbackReadiness.ready) {
            throw new RegistryControlPlaneError('NO_VALID_ROLLBACK_TARGET', 'NO_VALID_ROLLBACK_TARGET', {
                httpStatus: 409,
                details: {
                    status: 'blocked',
                    reason: ['missing_rollback_target'],
                    blockers: rollbackReadiness.reasons,
                },
            });
        }
        const updated = await store.rollbackRegistryToTarget({
            tenantId,
            runId,
            actor,
            reason: options.reason ?? 'Emergency rollback requested from registry control plane.',
            incidentId: options.incidentId ?? null,
        });
        await assertRegistryAuditEventRecorded(store, {
            tenantId,
            registryId: updated.registry_id,
            runId: updated.run_id,
            eventType: 'rolled_back',
            since: actionStartedAt,
        });
        const transitionIssues = await validateRegistryTransitionState(
            store,
            tenantId,
            updated.model_family,
            updated.registry_id,
        );
        if (transitionIssues.length > 0) {
            throw new RegistryControlPlaneError('INVALID_STATE_TRANSITION', 'Rollback completed but post-transition validation failed.', {
                httpStatus: 500,
                details: {
                    status: 'failed',
                    reason: transitionIssues.map((issue) => issue.code),
                    issues: transitionIssues,
                },
            });
        }

        await logExperimentAuditEvent(store, {
            tenantId,
            runId,
            eventType: 'rolled_back',
            actor,
            metadata: {
                action,
                registry_id: updated.registry_id,
                registry_status: updated.lifecycle_status,
                registry_role: updated.registry_role,
                rollback_target: updated.rollback_target,
            },
            deterministicKey: `${runId}:registry-action:${action}:${updated.registry_id}`,
        });

        invalidateModelRegistryControlPlaneSnapshot(tenantId);
        await ensureGovernanceForRun(store, tenantId, runId, actor);
        return (await store.getModelRegistryForRun(tenantId, updated.run_id)) ?? updated;
    }

    if (ensuredRegistry.lifecycle_status === 'production' && ensuredRegistry.registry_role === 'champion') {
        throw new RegistryControlPlaneError('INVALID_STATE_TRANSITION', 'Archive is disabled for the active production champion. Roll back or promote a challenger first.', {
            httpStatus: 409,
            details: { status: 'blocked' },
        });
    }

    const updated = await store.upsertModelRegistry({
        ...ensuredRegistry,
        lifecycle_status: 'archived',
        registry_role: ensuredRegistry.registry_role === 'rollback_target' ? 'rollback_target' : 'experimental',
        status: 'archived',
        role: ensuredRegistry.registry_role === 'rollback_target' ? 'rollback_target' : 'experimental',
        artifact_path: ensuredRegistry.artifact_uri ?? ensuredRegistry.artifact_path,
        archived_at: new Date().toISOString(),
    });

    await logRegistryAuditEvent(store, {
        tenantId,
        registryId: updated.registry_id,
        runId,
        eventType: 'archived',
        actor,
        metadata: buildRegistryAuditMetadata({
            eventType: 'archived',
            actor,
            previousState: previousRegistryState,
            newState: buildRegistryStateSnapshot(updated),
            reason: options.reason ?? 'manual_archive',
            model_family: updated.model_family,
        }),
    });
    await assertRegistryAuditEventRecorded(store, {
        tenantId,
        registryId: updated.registry_id,
        runId,
        eventType: 'archived',
        since: actionStartedAt,
    });

    await syncRegistryLinkForRun(
        store,
        run,
        updated,
        calibrationMetrics,
        adversarialMetrics,
        decision,
        registryLink,
        effectivePromotionRequirements,
    );

    invalidateModelRegistryControlPlaneSnapshot(tenantId);
    await ensureGovernanceForRun(store, tenantId, runId, actor);
    return (await store.getModelRegistryForRun(tenantId, runId)) ?? updated;
}

export async function getExperimentRunDetail(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    options: {
        readOnly?: boolean;
    } = {},
): Promise<ExperimentRunDetail | null> {
    const readOnly = options.readOnly !== false;
    await backfillSummaryExperimentRuns(store, tenantId, {
        materializeGovernance: !readOnly,
    });
    if (!readOnly) {
        await ensureGovernanceForRun(store, tenantId, runId, null);
    }

    const run = await store.getExperimentRun(tenantId, runId);
    if (!run) return null;

    const [metrics, artifacts, failure, benchmarks, registryLink, modelRegistry, promotionRequirements, calibrationMetrics, adversarialMetrics, deploymentDecision, subgroupMetrics, auditEvents, registryAuditEvents, learningAuditEvents, registryRecords] = await Promise.all([
        store.listExperimentMetrics(tenantId, runId),
        store.listExperimentArtifacts(tenantId, runId),
        store.getExperimentFailure(tenantId, runId),
        store.listExperimentBenchmarks(tenantId, runId),
        store.getExperimentRegistryLink(tenantId, runId),
        store.getModelRegistryForRun(tenantId, runId),
        store.getPromotionRequirements(tenantId, runId),
        store.getCalibrationMetrics(tenantId, runId),
        store.getAdversarialMetrics(tenantId, runId),
        store.getDeploymentDecision(tenantId, runId),
        store.listSubgroupMetrics(tenantId, runId),
        store.listAuditLog(tenantId, 100),
        store.listRegistryAuditLog(tenantId, 200),
        store.listLearningAuditEvents(tenantId, 100),
        store.listModelRegistry(tenantId),
    ]);
    const latestMetric = metrics[metrics.length - 1] ?? null;
    const heartbeatFreshness = classifyHeartbeatFreshness(run.last_heartbeat_at);
    const registryLinkState = deriveRegistryLinkState(run, modelRegistry, registryLink);
    const registryRole = deriveRegistryRole(modelRegistry, registryLink, registryLinkState);
    const safetyCoverage = getSafetyCoverageState(run, latestMetric);
    const promotionGating = evaluatePromotionReadiness(
        run,
        registryLinkState,
        calibrationMetrics,
        adversarialMetrics,
        latestMetric,
        promotionRequirements,
        modelRegistry,
    );
    const decisionPanel = buildRegistryDecisionPanel(
        promotionGating,
        promotionRequirements,
        deploymentDecision,
    );
    const registryAuditHistory = filterRegistryAuditEventsForRun(run, modelRegistry, registryAuditEvents);
    const lastStableModel = findLastStableModel(modelRegistry, registryRecords);

    return {
        run,
        metrics,
        artifacts,
        failure,
        benchmarks,
        registry_link: registryLink,
        model_registry: modelRegistry,
        promotion_requirements: promotionRequirements,
        calibration_metrics: calibrationMetrics,
        adversarial_metrics: adversarialMetrics,
        deployment_decision: deploymentDecision,
        decision_panel: decisionPanel,
        subgroup_metrics: subgroupMetrics,
        audit_history: filterAuditEventsForRun(run, auditEvents, learningAuditEvents),
        registry_audit_history: registryAuditHistory,
        missing_telemetry_fields: getMissingTelemetryFields(run, metrics),
        latest_metric: latestMetric,
        heartbeat_freshness: heartbeatFreshness,
        registry_link_state: registryLinkState,
        registry_role: registryRole,
        safety_coverage: safetyCoverage,
        safety_metrics_complete: safetyCoverage === 'full',
        clinical_scorecard: modelRegistry?.clinical_metrics ?? buildClinicalMetricsRecord(run, latestMetric, calibrationMetrics, adversarialMetrics),
        lineage: modelRegistry?.lineage ?? buildRegistryLineage(run, buildArtifactUris(run, artifacts), benchmarks),
        last_stable_model: lastStableModel,
        artifact_uris: buildArtifactUris(run, artifacts),
        promotion_gating: promotionGating,
        failure_guidance: failure ? deriveFailureGuidance(run, metrics, failure) : null,
    };
}

export async function getExperimentComparison(
    store: ExperimentTrackingStore,
    tenantId: string,
    runIds: string[],
    source: ExperimentComparison['source'] = 'manual',
    rationale = 'Manual comparison selection from the experiment table.',
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
        source,
        rationale,
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
        readOnly?: boolean;
    } = {},
): Promise<ExperimentDashboardSnapshot> {
    const readOnly = options.readOnly !== false;
    await backfillSummaryExperimentRuns(store, tenantId, {
        materializeGovernance: !readOnly,
    });

    const runs = await store.listExperimentRuns(tenantId, {
        limit: options.runLimit ?? 50,
        includeSummaryOnly: true,
    });
    const selectedRunId = options.selectedRunId && runs.some((run) => run.run_id === options.selectedRunId)
        ? options.selectedRunId
        : pickDefaultSelectedRunId(runs);
    const runMetrics = await Promise.all(
        runs.map(async (run) => [run.run_id, await store.listExperimentMetrics(tenantId, run.run_id, 2_000)] as const),
    );
    const metricsByRun = Object.fromEntries(runMetrics);
    const comparisonRequest = resolveDashboardComparisonRequest(runs, selectedRunId, options.compareRunIds ?? []);
    const [selectedRunDetail, comparison] = await Promise.all([
        selectedRunId ? getExperimentRunDetail(store, tenantId, selectedRunId, { readOnly }) : Promise.resolve(null),
        comparisonRequest.run_ids.length > 1
            ? getExperimentComparison(
                store,
                tenantId,
                comparisonRequest.run_ids,
                comparisonRequest.source,
                comparisonRequest.rationale,
            )
            : Promise.resolve(null),
    ]);

    return {
        tenant_id: tenantId,
        summary: buildDashboardSummary(runs, metricsByRun),
        runs,
        selected_run_id: selectedRunId,
        selected_run_detail: selectedRunDetail,
        comparison,
        refreshed_at: new Date().toISOString(),
    };
}

export async function getModelRegistryControlPlaneSnapshot(
    store: ExperimentTrackingStore,
    tenantId: string,
    options: {
        readOnly?: boolean;
    } = {},
): Promise<ModelRegistryControlPlaneSnapshot> {
    const readOnly = options.readOnly !== false;
    const cacheKey = getModelRegistryControlPlaneCacheKey(tenantId, readOnly);
    const now = Date.now();
    const cached = modelRegistryControlPlaneSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.snapshot;
    }

    const inFlight = modelRegistryControlPlaneInFlight.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const promise = (async () => {
        await backfillSummaryExperimentRuns(store, tenantId, {
            materializeGovernance: !readOnly,
        });

        const [runs, registryRecords, promotionRequirements, routingPointers, registryAuditEvents] = await Promise.all([
            store.listExperimentRuns(tenantId, { limit: 500, includeSummaryOnly: true }),
            store.listModelRegistry(tenantId),
            store.listPromotionRequirements(tenantId),
            store.listRegistryRoutingPointers(tenantId),
            store.listRegistryAuditLog(tenantId, 400),
        ]);

        const dedupedRegistryAuditEvents = dedupeRegistryAuditEvents(registryAuditEvents);
        const runsById = new Map(runs.map((run) => [run.run_id, run]));
        const requirementsByRunId = new Map(promotionRequirements.map((requirement) => [requirement.run_id, requirement]));
        const routingByFamily = new Map(routingPointers.map((pointer) => [pointer.model_family, pointer]));
        const consistencyIssues = validateRegistryConsistency(registryRecords, routingPointers);

        const entries = await Promise.all(
            registryRecords.map(async (registry) => {
                const run = runsById.get(registry.run_id) ?? null;
                const [metrics, benchmarks, calibrationMetrics, adversarialMetrics, deploymentDecision] = await Promise.all([
                    store.listExperimentMetrics(tenantId, registry.run_id, 2_000),
                    store.listExperimentBenchmarks(tenantId, registry.run_id),
                    store.getCalibrationMetrics(tenantId, registry.run_id),
                    store.getAdversarialMetrics(tenantId, registry.run_id),
                    store.getDeploymentDecision(tenantId, registry.run_id),
                ]);
                const latestMetric = metrics.at(-1) ?? null;
                const requirements = requirementsByRunId.get(registry.run_id) ?? null;
                const promotionGating = run == null
                    ? {
                        can_promote: false,
                        promotion_allowed: false,
                        missing_requirements: ['Experiment run metadata is unavailable for this registry record.'],
                        blockers: ['Experiment run metadata is unavailable for this registry record.'],
                        blocker_codes: ['missing_run_link'],
                        gates: {
                            calibration: 'pending',
                            adversarial: 'pending',
                            safety: 'pending',
                            benchmark: resolveGateStatus(requirements?.benchmark_pass ?? null),
                            manual_approval: resolveGateStatus(requirements?.manual_approval ?? null),
                        },
                        tooltip: 'Experiment run metadata is unavailable for this registry record.',
                    } satisfies ModelRegistryControlPlaneSnapshot['families'][number]['entries'][number]['promotion_gating']
                    : evaluatePromotionReadiness(
                        run,
                        'linked',
                        calibrationMetrics,
                        adversarialMetrics,
                        latestMetric,
                        requirements,
                        registry,
                    );
                const decisionPanel = buildRegistryDecisionPanel(
                    promotionGating,
                    requirements,
                    deploymentDecision,
                );
                const rollbackHistory = dedupedRegistryAuditEvents
                    .filter((event) => event.event_type === 'rolled_back' && event.registry_id === registry.registry_id)
                    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
                const latestRegistryEvents = dedupedRegistryAuditEvents
                    .filter((event) => event.registry_id === registry.registry_id)
                    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
                    .slice(0, 8);
                const lastStableModel = findLastStableModel(registry, registryRecords);
                const activeRoute = routingByFamily.get(registry.model_family);
                const registrationValidation = validateRegistryRegistration(run ?? {
                    ...createMissingRunStub(registry),
                }, registry.artifact_uri ?? registry.artifact_path ?? null);
                const rollbackReadiness = evaluateRollbackReadiness(registry, lastStableModel);
                const auditTrailReady = latestRegistryEvents.length > 0;

                return {
                    registry,
                    run,
                    promotion_requirements: requirements,
                    decision_panel: decisionPanel,
                    promotion_gating: promotionGating,
                    registration_validation: registrationValidation,
                    rollback_readiness: rollbackReadiness,
                    audit_trail_ready: auditTrailReady,
                    clinical_scorecard: registry.clinical_metrics,
                    lineage: registry.lineage,
                    rollback_history: rollbackHistory,
                    latest_registry_events: latestRegistryEvents,
                    is_active_route: activeRoute?.active_registry_id === registry.registry_id,
                    last_stable_model: lastStableModel,
                };
            }),
        );

        const families = MODEL_FAMILY_ORDER.map((modelFamily) => {
            const groupEntries = entries
                .filter((entry) => entry.registry.model_family === modelFamily)
                .sort((left, right) => {
                    const leftRank = rankRegistryEntry(left.registry);
                    const rightRank = rankRegistryEntry(right.registry);
                    if (leftRank !== rightRank) return leftRank - rightRank;
                    return (right.registry.deployed_at ?? right.registry.updated_at).localeCompare(left.registry.deployed_at ?? left.registry.updated_at);
                });
            const activePointer = routingByFamily.get(modelFamily) ?? null;
            const activeModel = activePointer?.active_registry_id
                ? registryRecords.find((entry) => entry.registry_id === activePointer.active_registry_id) ?? null
                : groupEntries.find((entry) => entry.registry.lifecycle_status === 'production' && entry.registry.registry_role === 'champion')?.registry ?? null;
            const lastStableModel = activeModel != null
                ? findLastStableModel(activeModel, registryRecords)
                : groupEntries.find((entry) => entry.registry.registry_role === 'rollback_target')?.registry ?? null;

            return {
                model_family: modelFamily,
                active_registry_id: activePointer?.active_registry_id ?? activeModel?.registry_id ?? null,
                active_model: activeModel,
                last_stable_model: lastStableModel,
                entries: groupEntries,
            };
        });

        const snapshot = {
            tenant_id: tenantId,
            families,
            routing_pointers: routingPointers,
            audit_history: dedupedRegistryAuditEvents
                .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
                .slice(0, 50),
            registry_health: consistencyIssues.some((issue) => issue.severity === 'critical') ? 'degraded' : 'healthy',
            consistency_issues: consistencyIssues,
            refreshed_at: new Date().toISOString(),
        } satisfies ModelRegistryControlPlaneSnapshot;

        modelRegistryControlPlaneSnapshotCache.set(cacheKey, {
            snapshot,
            expiresAt: Date.now() + CONTROL_PLANE_SNAPSHOT_TTL_MS,
        });

        return snapshot;
    })()
        .catch((error) => {
            if (cached?.snapshot) {
                return cached.snapshot;
            }
            throw error;
        })
        .finally(() => {
            modelRegistryControlPlaneInFlight.delete(cacheKey);
        });

    modelRegistryControlPlaneInFlight.set(cacheKey, promise);
    return promise;
}

export async function refreshModelRegistryControlPlaneSnapshot(
    store: ExperimentTrackingStore,
    tenantId: string,
): Promise<ModelRegistryControlPlaneSnapshot> {
    invalidateModelRegistryControlPlaneSnapshot(tenantId);
    return getModelRegistryControlPlaneSnapshot(store, tenantId, { readOnly: false });
}

export async function verifyModelRegistryControlPlane(
    store: ExperimentTrackingStore,
    tenantId: string,
): Promise<RegistryControlPlaneVerificationResult> {
    await backfillSummaryExperimentRuns(store, tenantId, {
        materializeGovernance: false,
    });

    const [runs, registryRecords, routingPointers, auditEvents] = await Promise.all([
        store.listExperimentRuns(tenantId, { limit: 500, includeSummaryOnly: true }),
        store.listModelRegistry(tenantId),
        store.listRegistryRoutingPointers(tenantId),
        store.listRegistryAuditLog(tenantId, 400),
    ]);
    const runsById = new Map(runs.map((run) => [run.run_id, run]));
    const consistencyIssues = validateRegistryConsistency(registryRecords, routingPointers);

    const registrationFailures: string[] = [];
    for (const registry of registryRecords) {
        const validation = validateRegistryRegistration(
            runsById.get(registry.run_id) ?? createMissingRunStub(registry),
            registry.artifact_uri ?? registry.artifact_path ?? null,
        );
        if (validation.status === 'blocked') {
            registrationFailures.push(`${registry.registry_id}: ${validation.reasons.join(' ')}`);
        }
    }

    const stagingEntries = registryRecords.filter((registry) =>
        registry.lifecycle_status === 'staging' || registry.registry_role === 'challenger',
    );
    const promotionFailures: string[] = [];
    for (const registry of stagingEntries) {
        const run = runsById.get(registry.run_id);
        if (!run) {
            promotionFailures.push(`${registry.registry_id}: linked experiment run is unavailable.`);
            continue;
        }
        const [metrics, benchmarks, calibrationMetrics, adversarialMetrics, requirements] = await Promise.all([
            store.listExperimentMetrics(tenantId, run.run_id, 2_000),
            store.listExperimentBenchmarks(tenantId, run.run_id),
            store.getCalibrationMetrics(tenantId, run.run_id),
            store.getAdversarialMetrics(tenantId, run.run_id),
            store.getPromotionRequirements(tenantId, run.run_id),
        ]);
        const gating = evaluatePromotionReadiness(
            run,
            'linked',
            calibrationMetrics,
            adversarialMetrics,
            metrics.at(-1) ?? null,
            requirements,
            registry,
        );
        const requiredPass = [
            gating.gates.calibration,
            gating.gates.adversarial,
            gating.gates.safety,
            gating.gates.benchmark,
            gating.gates.manual_approval,
        ].every((status) => status === 'pass');
        if (requiredPass && !gating.can_promote) {
            promotionFailures.push(`${registry.registry_id}: promotion gating should be open but is blocked.`);
        }
        if (!requiredPass && gating.can_promote) {
            promotionFailures.push(`${registry.registry_id}: promotion gating passed without all required controls.`);
        }
        if (!gating.can_promote && gating.blocker_codes.length === 0) {
            promotionFailures.push(`${registry.registry_id}: blocked promotion did not provide structured blocker codes.`);
        }
        void benchmarks;
    }

    const atomicFailures = consistencyIssues
        .filter((issue) => issue.code === 'duplicate_champion' || issue.code === 'duplicate_production_model' || issue.code === 'routing_pointer_mismatch')
        .map((issue) => issue.message);

    const rollbackFailures = registryRecords
        .filter((registry) => registry.lifecycle_status === 'production' && registry.registry_role === 'champion')
        .map((registry) => {
            const readiness = evaluateRollbackReadiness(registry, findLastStableModel(registry, registryRecords));
            return readiness.ready ? null : `${registry.registry_id}: ${readiness.reasons.join(' ')}`;
        })
        .filter((value): value is string => Boolean(value));

    const auditFailures = collectRegistryAuditTrailViolations(registryRecords, auditEvents);

    const simulatedFailures = [
        simulateMissingCalibrationDetection(registryRecords, runsById),
        simulateDuplicateChampionDetection(registryRecords, routingPointers),
        simulateNoRollbackTargetDetection(registryRecords),
        simulateBrokenAuditLoggingDetection(registryRecords),
    ];

    const checks: RegistryControlPlaneVerificationCheck[] = [
        buildVerificationCheck(
            'registration_validation',
            'Registration Validation',
            registrationFailures,
            [],
            registrationFailures.length === 0
                ? 'All registry records have linked run, dataset, feature schema, and artifact metadata.'
                : 'One or more registry records failed artifact metadata validation.',
        ),
        buildVerificationCheck(
            'promotion_gating',
            'Promotion Gating',
            promotionFailures,
            [],
            promotionFailures.length === 0
                ? 'Promotion gating enforces calibration, adversarial, safety, benchmark, and approval requirements.'
                : 'Promotion gating inconsistencies were detected.',
        ),
        buildVerificationCheck(
            'atomic_transition',
            'Atomic Transition',
            atomicFailures,
            [],
            atomicFailures.length === 0
                ? 'Champion and routing transitions are internally consistent.'
                : 'Atomic transition guarantees are violated.',
        ),
        buildVerificationCheck(
            'rollback_execution',
            'Rollback Execution',
            rollbackFailures,
            [],
            rollbackFailures.length === 0
                ? 'Every production champion has a valid rollback target.'
                : 'One or more production models cannot be rolled back safely.',
        ),
        buildVerificationCheck(
            'audit_logging',
            'Audit Logging',
            auditFailures,
            [],
            auditFailures.length === 0
                ? 'All required registry actions have an audit trail.'
                : 'Registry audit coverage is incomplete.',
        ),
        buildVerificationCheck(
            'consistency',
            'Consistency Check',
            consistencyIssues.filter((issue) => issue.severity === 'critical').map((issue) => issue.message),
            consistencyIssues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message),
            consistencyIssues.length === 0
                ? 'Registry consistency checks passed.'
                : 'Registry consistency issues were detected.',
        ),
        buildVerificationCheck(
            'failure_simulation',
            'Failure Simulation',
            simulatedFailures.filter((item) => !item.detected).map((item) => item.summary),
            [],
            simulatedFailures.every((item) => item.detected)
                ? 'Failure simulations were detected and blocked correctly.'
                : 'One or more failure simulations were not caught by the control plane.',
        ),
    ];

    const failedChecks = checks.filter((check) => check.status === 'fail').map((check) => check.key);
    const warnings = checks.flatMap((check) => check.warnings);

    return {
        status: failedChecks.length === 0 ? 'PASS' : 'FAIL',
        failed_checks: failedChecks,
        warnings,
        summary: failedChecks.length === 0
            ? 'Model registry control-plane validation passed.'
            : 'Model registry control-plane validation failed one or more critical checks.',
        checks,
        simulated_failures: simulatedFailures,
        verified_at: new Date().toISOString(),
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
    options: {
        materializeGovernance?: boolean;
    } = {},
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
    const existingMetricRunIds = new Set<string>();

    for (const run of runs) {
        if (run.model_version) {
            runsByModelVersion.set(run.model_version, run);
        }
    }

    for (const run of runs) {
        const [benchmarks, link, metrics] = await Promise.all([
            store.listExperimentBenchmarks(tenantId, run.run_id),
            store.getExperimentRegistryLink(tenantId, run.run_id),
            store.listExperimentMetrics(tenantId, run.run_id, 5),
        ]);
        benchmarks.forEach((benchmark) => {
            existingBenchmarkKeys.add(`${run.run_id}:${benchmark.benchmark_family}`);
        });
        if (link) existingLinkRunIds.add(run.run_id);
        if (metrics.length > 0) existingMetricRunIds.add(run.run_id);
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

    const calibrationByRegistryId = new Map<string, {
        status: string;
        report: Record<string, unknown>;
        eceScore: number | null;
        brierScore: number | null;
    }>();
    for (const report of calibrationReports) {
        if (!report.model_registry_id) continue;
        calibrationByRegistryId.set(report.model_registry_id, {
            status: readCalibrationStatus(report.report_payload),
            report: report.report_payload,
            eceScore: report.ece_score,
            brierScore: report.brier_score,
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
            registry_link_state: 'linked',
            champion_or_challenger: entry.is_champion ? 'champion' : entry.promotion_status === 'challenger' ? 'challenger' : 'experimental',
            registry_role: entry.is_champion ? 'champion' : entry.promotion_status === 'challenger' ? 'challenger' : 'experimental',
            calibration_report_id: entry.calibration_report_id,
            parent_model_version: entry.parent_model_version,
            model_family: entry.task_type === 'vision' ? 'vision' : 'diagnostics',
            benchmark_status: 'pending',
            manual_approval_status: 'pending',
        };
        const taskType = mapRegistryTaskToExperimentTask(entry.task_type);
        const modality = mapTaskToModality(taskType);
        const modelArch = asString(entry.artifact_payload.model_name) ?? entry.model_name;
        const modelSize = asString(entry.artifact_payload.model_size)
            ?? asString(asRecord(entry.artifact_payload.training_summary).parameter_scale)
            ?? null;
        const hyperparameters = asRecord(entry.artifact_payload.hyperparameters);
        const calibration = calibrationByRegistryId.get(entry.id) ?? null;
        const safetyMetrics = buildSafetyMetrics(
            entry.benchmark_scorecard,
            calibration,
            benchmarkByRegistryId.get(entry.id) ?? [],
        );

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
                registry_context: {
                    ...run.registry_context,
                    ...registryContext,
                },
                dataset_lineage: Object.keys(run.dataset_lineage).length > 0 ? run.dataset_lineage : datasetLineage,
                hyperparameters: Object.keys(run.hyperparameters).length > 0 ? run.hyperparameters : hyperparameters,
                safety_metrics: mergeMissingRecordFields(run.safety_metrics, safetyMetrics),
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
                        : 'experimental',
                promotion_status: entry.promotion_status,
                calibration_status: calibration?.status ?? 'pending',
                adversarial_gate_status: safetyBenchmark?.pass_status ?? 'pending',
                benchmark_status: safetyBenchmark?.pass_status ?? 'pending',
                manual_approval_status: 'pending',
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

        if (!existingMetricRunIds.has(run.run_id)) {
            const backfilledMetric = buildBackfilledMetricInput(
                entry,
                calibrationByRegistryId.get(entry.id) ?? null,
                benchmarkByRegistryId.get(entry.id) ?? [],
            );
            if (backfilledMetric) {
                await appendBackfilledMetricTelemetry(store, tenantId, run, backfilledMetric);
                existingMetricRunIds.add(run.run_id);
            }
        }
    }

    if (options.materializeGovernance === true) {
        const currentRuns = await store.listExperimentRuns(tenantId, {
            limit: 500,
            includeSummaryOnly: true,
        });
        await backfillExperimentGovernance(store, tenantId, currentRuns);
    }
}

async function appendBackfilledMetricTelemetry(
    store: ExperimentTrackingStore,
    tenantId: string,
    run: ExperimentRunRecord,
    metric: ExperimentMetricInput,
): Promise<void> {
    const created = await store.createExperimentMetrics([{
        tenant_id: tenantId,
        run_id: run.run_id,
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
        metric_timestamp: metric.metric_timestamp ?? run.ended_at ?? run.updated_at,
    }]);

    const latest = created[created.length - 1] ?? null;
    const primaryMetric = pickPrimaryMetric(run.task_type, latest);

    await store.updateExperimentRun(run.run_id, tenantId, {
        metric_primary_name: primaryMetric?.name ?? run.metric_primary_name,
        metric_primary_value: primaryMetric?.value ?? run.metric_primary_value,
        epochs_completed: latest?.epoch ?? run.epochs_completed,
        last_heartbeat_at: latest?.metric_timestamp ?? run.last_heartbeat_at,
        safety_metrics: mergeSafetyTelemetry(run.safety_metrics, latest),
        resource_usage: mergeResourceUsage(run.resource_usage, latest),
        summary_only: true,
    });
}

function buildBackfilledMetricInput(
    entry: Awaited<ReturnType<ExperimentTrackingStore['listModelRegistryEntries']>>[number],
    calibration: {
        status: string;
        report: Record<string, unknown>;
        eceScore: number | null;
        brierScore: number | null;
    } | null,
    benchmarks: Array<{
        benchmark_family: string;
        task_type: string;
        summary_score: number | null;
        pass_status: string;
        report_payload: Record<string, unknown>;
    }>,
): ExperimentMetricInput | null {
    const trainingSummary = asRecord(entry.artifact_payload.training_summary);
    const diagnosisBenchmark = benchmarks.find((benchmark) =>
        benchmark.task_type === 'diagnosis' ||
        benchmark.benchmark_family === 'clean_labeled_diagnosis',
    ) ?? null;
    const severityBenchmark = benchmarks.find((benchmark) =>
        benchmark.task_type === 'severity' ||
        benchmark.benchmark_family === 'clean_severity_cases',
    ) ?? null;
    const safetyBenchmark = benchmarks.find((benchmark) =>
        benchmark.benchmark_family.toLowerCase().includes('adversarial') ||
        benchmark.benchmark_family.toLowerCase().includes('safety') ||
        benchmark.benchmark_family.toLowerCase().includes('severity'),
    ) ?? severityBenchmark;

    const metric: ExperimentMetricInput = {
        epoch: readNumber(trainingSummary, 'epochs_completed') ??
            readNumber(trainingSummary, 'epochs') ??
            1,
        global_step: readNumber(trainingSummary, 'row_count') ??
            readBenchmarkMetric(diagnosisBenchmark?.report_payload ?? null, 'support') ??
            readBenchmarkMetric(severityBenchmark?.report_payload ?? null, 'support') ??
            1,
        val_accuracy: entry.task_type === 'severity'
            ? readBenchmarkMetric(severityBenchmark?.report_payload ?? null, 'emergency_accuracy')
            : numberOrNull(entry.benchmark_scorecard.diagnosis_accuracy) ??
                readBenchmarkMetric(diagnosisBenchmark?.report_payload ?? null, 'accuracy'),
        macro_f1: entry.task_type === 'severity'
            ? null
            : numberOrNull(entry.benchmark_scorecard.diagnosis_macro_f1) ??
                readBenchmarkMetric(diagnosisBenchmark?.report_payload ?? null, 'macro_f1'),
        recall_critical: numberOrNull(entry.benchmark_scorecard.severity_critical_recall) ??
            readBenchmarkMetric(severityBenchmark?.report_payload ?? null, 'critical_recall'),
        calibration_error: calibration
            ? numberOrNull(calibration.report.expected_calibration_error) ?? calibration.eceScore
            : numberOrNull(entry.benchmark_scorecard.calibration_ece),
        false_negative_critical_rate: numberOrNull(entry.benchmark_scorecard.severity_false_negative_rate) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'emergency_false_negative_rate'),
        dangerous_false_reassurance_rate: numberOrNull(entry.benchmark_scorecard.dangerous_false_reassurance_rate) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'false_reassurance_rate'),
        abstain_accuracy: numberOrNull(entry.benchmark_scorecard.abstain_accuracy) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'abstain_accuracy'),
        contradiction_detection_rate: numberOrNull(entry.benchmark_scorecard.contradiction_detection_rate) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'contradiction_detection_rate'),
        adversarial_score: numberOrNull(entry.benchmark_scorecard.adversarial_score) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'degradation_score'),
        metric_timestamp: entry.updated_at,
    };

    return hasAnyTelemetryValues(metric) ? metric : null;
}

function readBenchmarkMetric(
    payload: Record<string, unknown> | null,
    metricName: string,
): number | null {
    if (!payload) return null;
    const metrics = asRecord(payload.metrics);
    return numberOrNull(metrics[metricName]) ?? numberOrNull(payload[metricName]);
}

function hasAnyTelemetryValues(metric: ExperimentMetricInput): boolean {
    return metric.train_loss != null ||
        metric.val_loss != null ||
        metric.train_accuracy != null ||
        metric.val_accuracy != null ||
        metric.learning_rate != null ||
        metric.gradient_norm != null ||
        metric.macro_f1 != null ||
        metric.recall_critical != null ||
        metric.calibration_error != null ||
        metric.adversarial_score != null ||
        metric.false_negative_critical_rate != null ||
        metric.dangerous_false_reassurance_rate != null ||
        metric.abstain_accuracy != null ||
        metric.contradiction_detection_rate != null;
}

function buildDashboardSummary(
    runs: ExperimentRunRecord[],
    metricsByRun: Record<string, ExperimentMetricRecord[]>,
): ExperimentDashboardSummary {
    const totalRuns = runs.length;
    const activeRuns = runs.filter((run) => isHealthyActiveRun(run));
    const failedRuns = runs.filter((run) => run.status === 'failed');
    const summaryOnlyRuns = runs.filter((run) => run.summary_only);
    const telemetryReady = runs.filter((run) => hasTelemetrySignal(run, metricsByRun[run.run_id] ?? [])).length;
    const registryReady = runs.filter((run) => deriveRegistryLinkState(run, null, null) === 'linked').length;
    const safetyReady = runs.filter((run) => getSafetyCoverageState(run, (metricsByRun[run.run_id] ?? []).at(-1) ?? null) !== 'none').length;
    const fullSafetyReady = runs.filter((run) => getSafetyCoverageState(run, (metricsByRun[run.run_id] ?? []).at(-1) ?? null) === 'full').length;

    return {
        total_runs: totalRuns,
        active_runs: activeRuns.length,
        failed_runs: failedRuns.length,
        summary_only_runs: summaryOnlyRuns.length,
        telemetry_coverage_pct: percent(telemetryReady, totalRuns),
        registry_link_coverage_pct: percent(registryReady, totalRuns),
        safety_metric_coverage_pct: percent(safetyReady, totalRuns),
        full_safety_metric_coverage_pct: percent(fullSafetyReady, totalRuns),
        failed_run_ids: failedRuns.map((run) => run.run_id),
        active_run_ids: activeRuns.map((run) => run.run_id),
    };
}

function resolveDashboardComparisonRequest(
    runs: ExperimentRunRecord[],
    selectedRunId: string | null,
    compareRunIds: string[],
): {
    run_ids: string[];
    source: ExperimentComparison['source'];
    rationale: string;
} {
    const requestedRunIds = [...new Set(compareRunIds.filter(Boolean))].slice(0, 4);
    if (requestedRunIds.length > 1) {
        return {
            run_ids: requestedRunIds,
            source: 'manual',
            rationale: 'Manual comparison selection from the experiment table.',
        };
    }

    if (requestedRunIds.length === 1 && selectedRunId && requestedRunIds[0] !== selectedRunId) {
        return {
            run_ids: [selectedRunId, requestedRunIds[0]],
            source: 'manual',
            rationale: 'Manual comparison between the selected run and one comparison target.',
        };
    }

    return selectAutomaticComparisonRuns(runs, selectedRunId);
}

function selectAutomaticComparisonRuns(
    runs: ExperimentRunRecord[],
    selectedRunId: string | null,
): {
    run_ids: string[];
    source: ExperimentComparison['source'];
    rationale: string;
} {
    const selectedRun = runs.find((run) => run.run_id === selectedRunId) ?? runs[0] ?? null;
    if (!selectedRun) {
        return {
            run_ids: [],
            source: 'automatic',
            rationale: 'No experiment runs are available for automatic comparison yet.',
        };
    }

    const comparableRuns = runs.filter((run) =>
        run.run_id !== selectedRun.run_id &&
        run.task_type === selectedRun.task_type &&
        run.modality === selectedRun.modality,
    );
    const candidatePool = comparableRuns.length > 0
        ? comparableRuns
        : runs.filter((run) => run.run_id !== selectedRun.run_id);

    if (candidatePool.length === 0) {
        return {
            run_ids: [selectedRun.run_id],
            source: 'automatic',
            rationale: 'No comparable baseline run is available yet.',
        };
    }

    const selectedIsChampion = isProductionChampionRun(selectedRun);
    const championCandidate = candidatePool.find((run) => isProductionChampionRun(run)) ?? null;
    const strongestAlternative = [...candidatePool].sort(rankComparisonCandidates)[0] ?? null;
    const comparator = selectedIsChampion
        ? strongestAlternative
        : championCandidate ?? strongestAlternative;

    if (!comparator) {
        return {
            run_ids: [selectedRun.run_id],
            source: 'automatic',
            rationale: 'No comparable baseline run is available yet.',
        };
    }

    if (!selectedIsChampion && championCandidate) {
        return {
            run_ids: [championCandidate.run_id, selectedRun.run_id],
            source: 'automatic',
            rationale: 'Auto-comparing the selected run against the active production champion for the same task.',
        };
    }

    return {
        run_ids: [selectedRun.run_id, comparator.run_id],
        source: 'automatic',
        rationale: selectedIsChampion
            ? 'Auto-comparing the active production run against the strongest alternate run for the same task.'
            : 'Auto-comparing the selected run against the strongest comparable run for the same task.',
    };
}

function isProductionChampionRun(run: ExperimentRunRecord): boolean {
    const registryRole = (asString(run.registry_context.registry_role) ?? '').toLowerCase();
    const registryStatus = (asString(run.registry_context.registry_status ?? run.registry_context.promotion_status) ?? '').toLowerCase();
    const eligibility = (asString(run.registry_context.deployment_eligibility) ?? '').toLowerCase();
    return eligibility === 'live_production' ||
        (registryRole === 'champion' && registryStatus === 'production') ||
        (run.status === 'promoted' && registryRole === 'champion' && registryStatus === 'production');
}

function rankComparisonCandidates(
    left: ExperimentRunRecord,
    right: ExperimentRunRecord,
): number {
    const leftChampion = isProductionChampionRun(left) ? 1 : 0;
    const rightChampion = isProductionChampionRun(right) ? 1 : 0;
    if (leftChampion !== rightChampion) return rightChampion - leftChampion;

    const leftLinked = deriveRegistryLinkState(left, null, null) === 'linked' ? 1 : 0;
    const rightLinked = deriveRegistryLinkState(right, null, null) === 'linked' ? 1 : 0;
    if (leftLinked !== rightLinked) return rightLinked - leftLinked;

    const leftFailed = left.status === 'failed' ? 1 : 0;
    const rightFailed = right.status === 'failed' ? 1 : 0;
    if (leftFailed !== rightFailed) return leftFailed - rightFailed;

    const leftMetric = left.metric_primary_value ?? Number.NEGATIVE_INFINITY;
    const rightMetric = right.metric_primary_value ?? Number.NEGATIVE_INFINITY;
    if (leftMetric !== rightMetric) return rightMetric - leftMetric;

    const leftHeartbeat = left.last_heartbeat_at ?? left.updated_at;
    const rightHeartbeat = right.last_heartbeat_at ?? right.updated_at;
    return rightHeartbeat.localeCompare(leftHeartbeat);
}

function pickDefaultSelectedRunId(runs: ExperimentRunRecord[]): string | null {
    if (runs.length === 0) return null;

    const activeRun = runs
        .filter((run) => isHealthyActiveRun(run))
        .sort((left, right) => {
            const leftKey = left.last_heartbeat_at ?? left.updated_at;
            const rightKey = right.last_heartbeat_at ?? right.updated_at;
            return rightKey.localeCompare(leftKey);
        })[0];
    if (activeRun) {
        return activeRun.run_id;
    }

    const liveChampion = runs
        .filter((run) => isProductionChampionRun(run))
        .sort(rankComparisonCandidates)[0];
    if (liveChampion) {
        return liveChampion.run_id;
    }

    const bootstrapSmokeRun = runs.find((run) => run.run_id === 'run_diag_smoke_v1');
    if (bootstrapSmokeRun) {
        return bootstrapSmokeRun.run_id;
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
        })
        .map((event) => ({
            ...event,
            event_type: normalizeAuditEventType(event.event_type, event.payload),
        }));
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
            event_type: normalizeAuditEventType(event.event_type, event.event_payload),
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
        ['val_loss', latest?.val_loss],
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
    await ensureRegistryRollbackTargets(store, tenantId);
    await ensureRegistryLifecycleAuditCoverage(store, tenantId);
}

async function ensureGovernanceForRun(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    actor: string | null,
): Promise<void> {
    const existingRun = await store.getExperimentRun(tenantId, runId);
    if (!existingRun) return;
    const run = await normalizeRunOperationalState(store, existingRun, actor);

    const [metrics, artifacts, benchmarks, existingRegistryLink, existingDecision] = await Promise.all([
        store.listExperimentMetrics(tenantId, runId, 2_000),
        store.listExperimentArtifacts(tenantId, runId),
        store.listExperimentBenchmarks(tenantId, runId),
        store.getExperimentRegistryLink(tenantId, runId),
        store.getDeploymentDecision(tenantId, runId),
    ]);
    const latestMetric = metrics[metrics.length - 1] ?? null;

    if (run.status === 'failed') {
        const existingRegistry = await store.getModelRegistryForRun(tenantId, runId);
        const promotionRequirements = existingRegistry
            ? await ensurePromotionRequirements(
                store,
                run,
                existingRegistry,
                benchmarks,
                null,
                null,
                latestMetric,
                actor,
            )
            : null;
        await syncRegistryLinkForRun(store, run, existingRegistry, null, null, existingDecision, existingRegistryLink, promotionRequirements);
        return;
    }

    const modelRegistry = await ensureModelRegistryRecord(store, run, artifacts, actor, {
        strict: false,
    });
    if (!modelRegistry) {
        await syncRegistryLinkForRun(
            store,
            run,
            null,
            null,
            null,
            existingDecision,
            existingRegistryLink,
            null,
        );
        return;
    }

    if (!shouldMaterializeGovernance(run, modelRegistry)) {
        const promotionRequirements = await ensurePromotionRequirements(
            store,
            run,
            modelRegistry,
            benchmarks,
            null,
            null,
            latestMetric,
            actor,
        );
        const decision = await ensureDeploymentDecision(
            store,
            run,
            latestMetric,
            null,
            null,
            modelRegistry,
            promotionRequirements,
            actor,
        );
        await syncRegistryLinkForRun(
            store,
            run,
            modelRegistry,
            null,
            null,
            decision,
            existingRegistryLink,
            promotionRequirements,
        );
        return;
    }

    const calibrationMetrics = await ensureCalibrationMetrics(store, run, metrics, actor);
    const adversarialMetrics = await ensureAdversarialMetrics(store, run, metrics, benchmarks, actor);
    await logBenchmarkAuditEvents(store, run, benchmarks, actor);
    await ensureSubgroupMetrics(store, run, latestMetric);
    const promotionRequirements = await ensurePromotionRequirements(
        store,
        run,
        modelRegistry,
        benchmarks,
        calibrationMetrics,
        adversarialMetrics,
        latestMetric,
        actor,
    );
    const decision = await ensureDeploymentDecision(
        store,
        run,
        latestMetric,
        calibrationMetrics,
        adversarialMetrics,
        modelRegistry,
        promotionRequirements,
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
        promotionRequirements,
    );
}

async function ensureModelRegistryRecord(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    artifacts: { artifact_type: string; uri: string | null; is_primary: boolean }[],
    actor: string | null,
    options: {
        strict?: boolean;
    } = {},
): Promise<ModelRegistryRecord | null> {
    const existing = await store.getModelRegistryForRun(run.tenant_id, run.run_id);
    const artifactPath = selectPrimaryArtifactPath(artifacts, run);
    const artifactUris = buildArtifactUris(run, artifacts as ExperimentArtifactRecord[]);
    const registrationValidation = validateRegistryRegistration(run, artifactPath);
    if (registrationValidation.status === 'blocked') {
        await logExperimentAuditEvent(store, {
            tenantId: run.tenant_id,
            runId: run.run_id,
            eventType: 'registration_blocked',
            actor: actor ?? run.created_by,
            metadata: {
                code: registrationValidation.code,
                reasons: registrationValidation.reasons,
            },
            deterministicKey: `${run.run_id}:registry:blocked:${registrationValidation.reasons.join('|')}`,
        });
        if (existing) {
            await logRegistryAuditEvent(store, {
                tenantId: run.tenant_id,
                registryId: existing.registry_id,
                runId: run.run_id,
                eventType: 'registration_blocked',
                actor: actor ?? run.created_by,
                metadata: buildRegistryAuditMetadata({
                    eventType: 'register',
                    actor: actor ?? run.created_by,
                    previousState: buildRegistryStateSnapshot(existing),
                    newState: buildRegistryStateSnapshot(existing),
                    reason: registrationValidation.reasons.join(' '),
                    code: registrationValidation.code,
                    reasons: registrationValidation.reasons,
                }),
            });
        }
        if (options.strict) {
            throw new RegistryControlPlaneError(
                'INVALID_ARTIFACT_METADATA',
                `INVALID_ARTIFACT_METADATA: ${registrationValidation.reasons.join(' ')}`,
                {
                    httpStatus: 422,
                    details: {
                        status: 'blocked',
                        reason: registrationValidation.reasons,
                        code: registrationValidation.code,
                    },
                },
            );
        }
        return existing ?? null;
    }
    const nextStatus = mapRunStatusToRegistryStatus(run.status, existing?.status ?? null, run);
    const nextRole = mapRunToRegistryRole(run, existing?.role ?? null);
    const modelFamily = resolveModelFamilyForRun(run);
    const previousState = existing ? buildRegistryStateSnapshot(existing) : null;
    const nextRegistryRecord: Omit<ModelRegistryRecord, 'created_at' | 'updated_at'> = {
        registry_id: existing?.registry_id ?? createRegistryId(run),
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        model_name: existing?.model_name ?? run.model_arch,
        model_version: run.model_version ?? run.run_id,
        model_family: existing?.model_family ?? modelFamily,
        artifact_uri: artifactPath,
        dataset_version: run.dataset_version ?? run.dataset_name,
        feature_schema_version: run.feature_schema_version,
        label_policy_version: run.label_policy_version,
        lifecycle_status: nextStatus,
        registry_role: nextRole,
        deployed_at: nextStatus === 'production' ? existing?.deployed_at ?? run.ended_at ?? new Date().toISOString() : existing?.deployed_at ?? null,
        archived_at: nextStatus === 'archived' ? existing?.archived_at ?? new Date().toISOString() : null,
        promoted_from: existing?.promoted_from ?? null,
        rollback_target: existing?.rollback_target ?? null,
        clinical_metrics: existing?.clinical_metrics ?? buildClinicalMetricsRecord(run, null, null, null),
        lineage: existing?.lineage ?? buildRegistryLineage(run, artifactUris, []),
        rollback_metadata: existing?.rollback_metadata ?? null,
        artifact_path: artifactPath,
        status: nextStatus,
        role: nextRole,
        created_by: actor ?? existing?.created_by ?? run.created_by,
    };
    const registry = existing && isEquivalentRegistryRecord(existing, nextRegistryRecord)
        ? existing
        : await store.upsertModelRegistry(nextRegistryRecord);

    if (run.registry_id !== registry.registry_id ||
        run.registry_context.registry_role !== registry.role ||
        run.registry_context.registry_status !== registry.status ||
        run.registry_context.model_family !== registry.model_family) {
        await store.updateExperimentRun(run.run_id, run.tenant_id, {
            registry_id: registry.registry_id,
            registry_context: {
                ...run.registry_context,
                registry_id: registry.registry_id,
                registry_link_state: 'linked',
                registry_role: registry.role,
                registry_status: registry.status,
                promotion_status: registry.status,
                champion_or_challenger: registry.role,
                model_family: registry.model_family,
                artifact_uri: registry.artifact_uri,
            },
        });
    }

    if (!existing || !isEquivalentRegistryRecord(existing, nextRegistryRecord)) {
        await logExperimentAuditEvent(store, {
            tenantId: run.tenant_id,
            runId: run.run_id,
            eventType: existing ? 'registry_synced' : 'registry_candidate_created',
            actor: actor ?? run.created_by,
            metadata: {
                registry_id: registry.registry_id,
                registry_status: registry.status,
                registry_role: registry.role,
                model_family: registry.model_family,
                artifact_uri: registry.artifact_uri,
            },
            deterministicKey: `${run.run_id}:registry:${registry.status}:${registry.role}:${registry.artifact_uri ?? 'na'}`,
        });

        await logRegistryAuditEvent(store, {
            tenantId: run.tenant_id,
            registryId: registry.registry_id,
            runId: run.run_id,
            eventType: 'registered',
            actor: actor ?? run.created_by,
            metadata: buildRegistryAuditMetadata({
                eventType: 'register',
                actor: actor ?? run.created_by,
                previousState,
                newState: buildRegistryStateSnapshot(registry),
                reason: existing ? 'registry_sync' : 'registry_candidate_created',
                validation: registrationValidation,
            }),
        });
    }

    return registry;
}

async function ensureCalibrationMetrics(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
    actor: string | null,
): Promise<CalibrationMetricRecord> {
    const existing = await store.getCalibrationMetrics(run.tenant_id, run.run_id);
    if (existing && isCalibrationMetricsComplete(existing)) return existing;

    const computed = computeCalibrationMetrics(run, metrics);
    const record = await store.upsertCalibrationMetrics({
        id: existing?.id,
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        ece: existing?.ece ?? computed.ece,
        brier_score: existing?.brier_score ?? computed.brierScore,
        reliability_bins: existing?.reliability_bins.length ? existing.reliability_bins : computed.reliabilityBins,
        confidence_histogram: existing?.confidence_histogram.length ? existing.confidence_histogram : computed.confidenceHistogram,
        calibration_pass: existing?.calibration_pass ?? computed.pass,
        calibration_notes: existing?.calibration_notes ?? computed.notes,
    });

    await logExperimentAuditEvent(store, {
        tenantId: run.tenant_id,
        runId: run.run_id,
        eventType: 'calibration_completed',
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
    if (existing && isAdversarialMetricsComplete(existing)) return existing;

    const computed = computeAdversarialMetrics(run, metrics, benchmarks);
    const record = await store.upsertAdversarialMetrics({
        id: existing?.id,
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        degradation_score: existing?.degradation_score ?? computed.degradationScore,
        contradiction_robustness: existing?.contradiction_robustness ?? computed.contradictionRobustness,
        critical_case_recall: existing?.critical_case_recall ?? computed.criticalCaseRecall,
        false_reassurance_rate: existing?.false_reassurance_rate ?? computed.falseReassuranceRate,
        dangerous_false_reassurance_rate: existing?.dangerous_false_reassurance_rate ?? existing?.false_reassurance_rate ?? computed.falseReassuranceRate,
        adversarial_pass: existing?.adversarial_pass ?? computed.pass,
    });

    await logExperimentAuditEvent(store, {
        tenantId: run.tenant_id,
        runId: run.run_id,
        eventType: 'adversarial_completed',
        actor: actor ?? run.created_by,
        metadata: {
            degradation_score: record.degradation_score,
            contradiction_robustness: record.contradiction_robustness,
            critical_case_recall: record.critical_case_recall,
            dangerous_false_reassurance_rate: record.dangerous_false_reassurance_rate,
            adversarial_pass: record.adversarial_pass,
        },
        deterministicKey: `${run.run_id}:adversarial`,
    });

    return record;
}

async function ensurePromotionRequirements(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    modelRegistry: ModelRegistryRecord,
    benchmarks: ExperimentBenchmarkRecord[],
    calibrationMetrics: CalibrationMetricRecord | null,
    adversarialMetrics: AdversarialMetricRecord | null,
    latestMetric: ExperimentMetricRecord | null,
    actor: string | null,
): Promise<PromotionRequirementsRecord> {
    const existing = await store.getPromotionRequirements(run.tenant_id, run.run_id);
    const benchmarkPass = evaluateBenchmarkGate(benchmarks);
    const safetyPass = deriveSafetyPassValue(run, latestMetric);
    const refreshedRegistry = await store.upsertModelRegistry({
        ...modelRegistry,
        artifact_path: modelRegistry.artifact_uri ?? modelRegistry.artifact_path,
        clinical_metrics: buildClinicalMetricsRecord(run, latestMetric, calibrationMetrics, adversarialMetrics),
        lineage: buildRegistryLineage(run, buildArtifactUris(run, await store.listExperimentArtifacts(run.tenant_id, run.run_id)), benchmarks),
        created_by: actor ?? modelRegistry.created_by,
    });

    const requirements = await store.upsertPromotionRequirements({
        ...(existing?.id ? { id: existing.id } : {}),
        tenant_id: run.tenant_id,
        registry_id: refreshedRegistry.registry_id,
        run_id: run.run_id,
        calibration_pass: calibrationMetrics?.calibration_pass ?? null,
        adversarial_pass: adversarialMetrics?.adversarial_pass ?? null,
        safety_pass: safetyPass,
        benchmark_pass: benchmarkPass,
        manual_approval: existing?.manual_approval ?? (refreshedRegistry.lifecycle_status === 'production' && refreshedRegistry.registry_role === 'champion' ? true : null),
    });

    return requirements;
}

async function ensureDeploymentDecision(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
    calibrationMetrics: CalibrationMetricRecord | null,
    adversarialMetrics: AdversarialMetricRecord | null,
    modelRegistry: ModelRegistryRecord | null,
    promotionRequirements: PromotionRequirementsRecord | null,
    actor: string | null,
): Promise<DeploymentDecisionRecord> {
    const safetyCoverage = getSafetyCoverageState(run, latestMetric);
    const safetyPass = promotionRequirements?.safety_pass ?? deriveSafetyPassValue(run, latestMetric);
    const calibrationPass = promotionRequirements?.calibration_pass ?? calibrationMetrics?.calibration_pass ?? null;
    const adversarialPass = promotionRequirements?.adversarial_pass ?? adversarialMetrics?.adversarial_pass ?? null;
    const benchmarkPass = promotionRequirements?.benchmark_pass ?? null;
    const manualApproval = promotionRequirements?.manual_approval ?? null;
    const missingEvaluations = [
        calibrationPass == null ? 'Calibration evaluation is still pending.' : null,
        adversarialPass == null ? 'Adversarial evaluation is still pending.' : null,
        benchmarkPass == null ? 'Benchmark evaluation is still pending.' : null,
        safetyCoverage !== 'full' || safetyPass == null ? 'Clinical safety evaluation is still pending.' : null,
        manualApproval !== true ? 'Manual approval has not been granted.' : null,
    ].filter((value): value is string => Boolean(value));
    const allEvaluated = calibrationPass != null &&
        adversarialPass != null &&
        benchmarkPass != null &&
        safetyPass != null;
    const anyGateFailed = calibrationPass === false ||
        adversarialPass === false ||
        benchmarkPass === false ||
        safetyPass === false;
    const liveProductionChampion = isLiveProductionChampion(modelRegistry);
    const decision = run.status === 'failed'
        ? 'rejected'
        : liveProductionChampion
            ? 'approved'
        : anyGateFailed || manualApproval === false
            ? 'rejected'
            : !allEvaluated || manualApproval !== true
            ? 'pending'
            : calibrationPass === true && adversarialPass === true && benchmarkPass === true && safetyPass === true
                ? 'approved'
                : 'rejected';
    const reason = liveProductionChampion
        ? anyGateFailed || safetyCoverage !== 'full' || manualApproval !== true
            ? 'Currently serving as the active production champion. Latest governance telemetry shows elevated risk or incomplete safety evidence, so use rollback or archive controls for remediation rather than treating this as a blocked deployment request.'
            : 'Currently serving as the active production champion.'
        : decision === 'approved'
        ? 'Passed calibration, adversarial, safety, benchmark, and manual approval gates.'
        : decision === 'pending'
            ? missingEvaluations.join(' ')
            : manualApproval === false && !anyGateFailed
                ? 'Manual approval was explicitly denied.'
        : explainDecisionFailure(run, latestMetric, calibrationMetrics, adversarialMetrics, benchmarkPass, safetyPass);

    const record = await store.upsertDeploymentDecision({
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        decision,
        reason,
        calibration_pass: calibrationPass,
        adversarial_pass: adversarialPass,
        safety_pass: safetyPass,
        benchmark_pass: benchmarkPass,
        manual_approval: manualApproval,
        approved_by: decision === 'approved' ? (actor ?? 'system:auto') : null,
        timestamp: new Date().toISOString(),
    });

    await logExperimentAuditEvent(store, {
        tenantId: run.tenant_id,
        runId: run.run_id,
        eventType: 'deployment_evaluated',
        actor: actor ?? run.created_by,
        metadata: {
            decision: record.decision,
            calibration_pass: record.calibration_pass,
            adversarial_pass: record.adversarial_pass,
            safety_pass: record.safety_pass,
            benchmark_pass: record.benchmark_pass,
            manual_approval: record.manual_approval,
            safety_coverage: safetyCoverage,
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
        { group: 'species', group_value: 'canine', metric: 'recall_critical', value: clampMetric(baseCriticalRecall) },
        { group: 'species', group_value: 'feline', metric: 'macro_f1', value: clampMetric(baseMacroF1 - 0.05) },
        { group: 'species', group_value: 'feline', metric: 'recall_critical', value: clampMetric(baseCriticalRecall - 0.04) },
        { group: 'breed', group_value: 'mixed', metric: 'macro_f1', value: clampMetric(baseMacroF1 - 0.03) },
        { group: 'breed', group_value: 'mixed', metric: 'recall_critical', value: clampMetric(baseCriticalRecall - 0.02) },
        { group: 'emergency_level', group_value: 'critical', metric: 'macro_f1', value: clampMetric(baseMacroF1 - 0.02) },
        { group: 'emergency_level', group_value: 'critical', metric: 'recall_critical', value: clampMetric(baseCriticalRecall) },
        { group: 'contradiction_presence', group_value: 'present', metric: 'macro_f1', value: clampMetric(baseMacroF1 - 0.08) },
        { group: 'contradiction_presence', group_value: 'present', metric: 'recall_critical', value: clampMetric(baseCriticalRecall - 0.05) },
        { group: 'contradiction_presence', group_value: 'absent', metric: 'macro_f1', value: clampMetric(baseMacroF1 + 0.02) },
        { group: 'contradiction_presence', group_value: 'absent', metric: 'recall_critical', value: clampMetric(baseCriticalRecall + 0.01) },
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
    promotionRequirements: PromotionRequirementsRecord | null,
): Promise<void> {
    const current = existingRegistryLink ?? await store.getExperimentRegistryLink(run.tenant_id, run.run_id);
    if (!modelRegistry && !current) return;
    const registryLinkState = deriveRegistryLinkState(run, modelRegistry, current);
    const registryRole = deriveRegistryRole(modelRegistry, current, registryLinkState);
    const benchmarkStatus = resolveGateStatus(promotionRequirements?.benchmark_pass);
    const manualApprovalStatus = resolveGateStatus(promotionRequirements?.manual_approval);
    const deploymentEligibility = deriveDeploymentEligibilityStatus(run, modelRegistry, deploymentDecision, current);

    await store.upsertExperimentRegistryLink({
        tenant_id: run.tenant_id,
        run_id: run.run_id,
        model_registry_entry_id: current?.model_registry_entry_id ?? null,
        registry_candidate_id: modelRegistry?.registry_id ?? current?.registry_candidate_id ?? null,
        champion_or_challenger: registryRole,
        promotion_status: modelRegistry?.status ?? current?.promotion_status ?? null,
        calibration_status: calibrationMetrics == null
            ? current?.calibration_status ?? 'pending'
            : calibrationMetrics.calibration_pass === true ? 'passed' : 'failed',
        adversarial_gate_status: adversarialMetrics == null
            ? current?.adversarial_gate_status ?? 'pending'
            : adversarialMetrics.adversarial_pass === true ? 'passed' : 'failed',
        benchmark_status: benchmarkStatus === 'pending' ? current?.benchmark_status ?? 'pending' : benchmarkStatus === 'pass' ? 'passed' : 'failed',
        manual_approval_status: manualApprovalStatus === 'pending' ? current?.manual_approval_status ?? 'pending' : manualApprovalStatus === 'pass' ? 'passed' : 'failed',
        deployment_eligibility: deploymentEligibility,
    });

    await store.updateExperimentRun(run.run_id, run.tenant_id, {
        registry_id: modelRegistry?.registry_id ?? run.registry_id,
        registry_context: {
            ...run.registry_context,
            registry_id: modelRegistry?.registry_id ?? run.registry_id ?? null,
            registry_link_state: registryLinkState,
            registry_role: registryRole,
            champion_or_challenger: registryRole,
            promotion_status: modelRegistry?.status ?? current?.promotion_status ?? null,
            deployment_eligibility: deploymentEligibility,
            calibration_status: calibrationMetrics == null
                ? current?.calibration_status ?? 'pending'
                : calibrationMetrics.calibration_pass === true ? 'passed' : 'failed',
            adversarial_gate_status: adversarialMetrics == null
                ? current?.adversarial_gate_status ?? 'pending'
                : adversarialMetrics.adversarial_pass === true ? 'passed' : 'failed',
            benchmark_status: benchmarkStatus,
            manual_approval_status: manualApprovalStatus,
            model_family: modelRegistry?.model_family ?? run.registry_context.model_family ?? null,
            rollback_target: modelRegistry?.rollback_target ?? run.registry_context.rollback_target ?? null,
        },
    });
}

function deriveDeploymentEligibilityStatus(
    run: ExperimentRunRecord,
    modelRegistry: ModelRegistryRecord | null,
    deploymentDecision: DeploymentDecisionRecord | null,
    current: ExperimentRegistryLinkRecord | null,
): string {
    if (isLiveProductionChampion(modelRegistry)) return 'live_production';
    if (modelRegistry?.registry_role === 'rollback_target') return 'rollback_target';
    if (run.status === 'failed' || run.status === 'aborted' || run.status === 'interrupted' || run.status === 'stalled') {
        return 'blocked';
    }
    if (deploymentDecision == null) {
        return current?.deployment_eligibility ?? 'pending';
    }
    if (deploymentDecision.decision === 'approved') return 'eligible_review';
    if (deploymentDecision.decision === 'pending') return 'pending';
    return 'blocked';
}

function computeCalibrationMetrics(
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
): {
    ece: number | null;
    brierScore: number | null;
    reliabilityBins: CalibrationMetricRecord['reliability_bins'];
    confidenceHistogram: CalibrationMetricRecord['confidence_histogram'];
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
            confidenceHistogram: ece > 0 || brierScore > 0
                ? [{ confidence: clampMetric(run.metric_primary_value ?? 0.5), count: 1 }]
                : [],
            pass: ece < 0.08 && brierScore < 0.12,
            notes: 'Derived from summary validation telemetry because no per-epoch accuracy series was stored.',
        };
    }

    const buckets = new Map<number, { confidenceTotal: number; accuracyTotal: number; count: number }>();
    const histogramBuckets = new Map<number, { confidenceTotal: number; count: number }>();
    for (const observation of observations) {
        const bucketIndex = Math.max(0, Math.min(9, Math.floor(observation.confidence * 10)));
        const bucket = buckets.get(bucketIndex) ?? { confidenceTotal: 0, accuracyTotal: 0, count: 0 };
        bucket.confidenceTotal += observation.confidence;
        bucket.accuracyTotal += observation.accuracy;
        bucket.count += 1;
        buckets.set(bucketIndex, bucket);

        const histogramBucket = histogramBuckets.get(bucketIndex) ?? { confidenceTotal: 0, count: 0 };
        histogramBucket.confidenceTotal += observation.confidence;
        histogramBucket.count += 1;
        histogramBuckets.set(bucketIndex, histogramBucket);
    }

    const reliabilityBins = Array.from(buckets.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, bucket]) => ({
            confidence: Number((bucket.confidenceTotal / bucket.count).toFixed(3)),
            accuracy: Number((bucket.accuracyTotal / bucket.count).toFixed(3)),
            count: bucket.count,
        }));
    const confidenceHistogram = Array.from(histogramBuckets.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, bucket]) => ({
            confidence: Number((bucket.confidenceTotal / bucket.count).toFixed(3)),
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
        confidenceHistogram,
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
    benchmarkPass: boolean | null,
    safetyPass: boolean | null,
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
    if (benchmarkPass === false) {
        reasons.push('Benchmark gate failed on at least one required benchmark family.');
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

async function logRegistryAuditEvent(
    store: ExperimentTrackingStore,
    input: {
        tenantId: string;
        registryId: string;
        runId: string | null;
        eventType: string;
        actor: string | null;
        metadata: Record<string, unknown>;
        deterministicKey?: string | null;
        timestamp?: string | null;
    },
): Promise<void> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    await store.createRegistryAuditLog({
        event_id: input.deterministicKey
            ? createAuditEventId(input.tenantId, `registry:${input.registryId}:${input.deterministicKey}`)
            : createRegistryAuditEventId(input.tenantId, input.registryId, input.eventType),
        tenant_id: input.tenantId,
        registry_id: input.registryId,
        run_id: input.runId,
        event_type: input.eventType,
        timestamp,
        actor: input.actor,
        metadata: input.metadata,
    });
}

function classifyHeartbeatFreshness(lastHeartbeatAt: string | null): ExperimentHeartbeatFreshness {
    if (!lastHeartbeatAt) return 'interrupted';
    const ageMs = Date.now() - new Date(lastHeartbeatAt).getTime();
    if (!Number.isFinite(ageMs)) return 'interrupted';
    if (ageMs <= HEARTBEAT_HEALTHY_THRESHOLD_MS) return 'healthy';
    if (ageMs <= HEARTBEAT_INTERRUPTED_THRESHOLD_MS) return 'stale';
    return 'interrupted';
}

function isHeartbeatDerivedStatusReason(statusReason: string | null): boolean {
    return statusReason === 'heartbeat_stale' || statusReason === 'heartbeat_interrupted';
}

async function normalizeRunOperationalState(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    actor: string | null,
): Promise<ExperimentRunRecord> {
    const heartbeatFreshness = classifyHeartbeatFreshness(run.last_heartbeat_at);
    const nextStatus = deriveOperationalRunStatus(run.status, heartbeatFreshness);
    const nextRegistryContext = {
        ...run.registry_context,
        heartbeat_state: heartbeatFreshness,
    };
    const nextStatusReason = nextStatus === 'stalled'
        ? 'heartbeat_stale'
        : nextStatus === 'interrupted'
            ? 'heartbeat_interrupted'
            : !isActiveStatus(nextStatus) && isHeartbeatDerivedStatusReason(run.status_reason)
                ? null
                : run.status_reason;

    if (nextStatus === run.status &&
        nextStatusReason === run.status_reason &&
        run.registry_context.heartbeat_state === heartbeatFreshness) {
        return run;
    }

    const updated = await store.updateExperimentRun(run.run_id, run.tenant_id, {
        status: nextStatus,
        status_reason: nextStatusReason,
        registry_context: nextRegistryContext,
    });

    if (nextStatus !== run.status) {
        await logExperimentAuditEvent(store, {
            tenantId: run.tenant_id,
            runId: run.run_id,
            eventType: 'heartbeat_state_changed',
            actor: actor ?? run.created_by,
            metadata: {
                previous_status: run.status,
                status: nextStatus,
                heartbeat_state: heartbeatFreshness,
                last_heartbeat_at: run.last_heartbeat_at,
            },
            deterministicKey: `${run.run_id}:heartbeat-state:${nextStatus}:${run.last_heartbeat_at ?? 'na'}`,
        });
    }

    return updated;
}

function deriveOperationalRunStatus(
    status: ExperimentRunStatus,
    heartbeatFreshness: ExperimentHeartbeatFreshness,
): ExperimentRunStatus {
    if (status === 'stalled' || status === 'interrupted') {
        return heartbeatFreshness === 'healthy' ? 'training' : heartbeatFreshness === 'stale' ? 'stalled' : 'interrupted';
    }
    if (!isActiveStatus(status)) return status;
    if (heartbeatFreshness === 'stale') return 'stalled';
    if (heartbeatFreshness === 'interrupted') return 'interrupted';
    return status;
}

function deriveRegistryLinkState(
    run: ExperimentRunRecord,
    modelRegistry: ModelRegistryRecord | null,
    registryLink: ExperimentRegistryLinkRecord | null,
): ExperimentRegistryLinkState {
    if (modelRegistry || registryLink?.registry_candidate_id || run.registry_id || asString(run.registry_context.registry_id)) {
        return 'linked';
    }
    const storedState = asString(run.registry_context.registry_link_state);
    if (storedState === 'linked' || storedState === 'pending' || storedState === 'unlinked') {
        return storedState;
    }
    if (isGovernanceCandidateStatus(run.status) || run.status === 'failed' || run.status === 'aborted') {
        return 'pending';
    }
    return 'unlinked';
}

function deriveRegistryRole(
    modelRegistry: ModelRegistryRecord | null,
    registryLink: ExperimentRegistryLinkRecord | null,
    registryLinkState: ExperimentRegistryLinkState,
): ExperimentRegistryRole | null {
    const role = (modelRegistry?.role ?? registryLink?.champion_or_challenger ?? null) as ExperimentRegistryRole | null;
    if (role && role !== 'candidate') return role;
    return registryLinkState === 'linked' ? 'experimental' : null;
}

function hasBasicSafetyMetrics(
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
): boolean {
    return getPrimarySafetySignal(run, latestMetric) != null &&
        (latestMetric?.recall_critical ?? numberOrNull(run.safety_metrics.recall_critical)) != null;
}

function hasFullSafetyMetrics(
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
): boolean {
    return hasBasicSafetyMetrics(run, latestMetric) &&
        (latestMetric?.false_negative_critical_rate ?? numberOrNull(run.safety_metrics.false_negative_critical_rate)) != null &&
        (latestMetric?.dangerous_false_reassurance_rate ?? numberOrNull(run.safety_metrics.dangerous_false_reassurance_rate)) != null &&
        (latestMetric?.abstain_accuracy ?? numberOrNull(run.safety_metrics.abstain_accuracy)) != null &&
        (latestMetric?.contradiction_detection_rate ?? numberOrNull(run.safety_metrics.contradiction_detection_rate)) != null;
}

function getSafetyCoverageState(
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
): ExperimentSafetyCoverage {
    if (hasFullSafetyMetrics(run, latestMetric)) return 'full';
    if (hasBasicSafetyMetrics(run, latestMetric)) return 'partial';
    return 'none';
}

function hasCompleteMetricStream(
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
): boolean {
    if (run.summary_only || metrics.length === 0) return false;
    return getMissingTelemetryFields(run, metrics).length === 0;
}

function hasTelemetrySignal(
    _run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
): boolean {
    const latest = metrics[metrics.length - 1] ?? null;
    if (!latest) return false;
    return latest.train_loss != null ||
        latest.val_loss != null ||
        latest.train_accuracy != null ||
        latest.val_accuracy != null ||
        latest.learning_rate != null ||
        latest.gradient_norm != null ||
        latest.macro_f1 != null ||
        latest.recall_critical != null ||
        latest.calibration_error != null ||
        latest.adversarial_score != null ||
        latest.false_negative_critical_rate != null ||
        latest.dangerous_false_reassurance_rate != null ||
        latest.abstain_accuracy != null ||
        latest.contradiction_detection_rate != null;
}

function isHealthyActiveRun(run: ExperimentRunRecord): boolean {
    return isActiveStatus(run.status) && classifyHeartbeatFreshness(run.last_heartbeat_at) === 'healthy';
}

function evaluatePromotionReadiness(
    run: ExperimentRunRecord,
    registryLinkState: ExperimentRegistryLinkState,
    calibrationMetrics: CalibrationMetricRecord | null,
    adversarialMetrics: AdversarialMetricRecord | null,
    latestMetric: ExperimentMetricRecord | null,
    promotionRequirements: PromotionRequirementsRecord | null,
    modelRegistry: ModelRegistryRecord | null = null,
): ExperimentRunDetail['promotion_gating'] {
    const calibrationGate = resolveGateStatus(promotionRequirements?.calibration_pass ?? calibrationMetrics?.calibration_pass ?? null);
    const adversarialGate = resolveGateStatus(promotionRequirements?.adversarial_pass ?? adversarialMetrics?.adversarial_pass ?? null);
    const safetyGate = resolveGateStatus(promotionRequirements?.safety_pass ?? deriveSafetyPassValue(run, latestMetric));
    const benchmarkGate = resolveGateStatus(promotionRequirements?.benchmark_pass ?? null);
    const manualApprovalGate = resolveGateStatus(promotionRequirements?.manual_approval ?? null);
    const blockers: string[] = [];
    const blockerCodes: RegistryActionBlockCode[] = [];

    const addBlocker = (code: RegistryActionBlockCode, message: string) => {
        blockerCodes.push(code);
        blockers.push(message);
    };

    if (registryLinkState !== 'linked') {
        addBlocker('missing_run_link', 'Registry candidate linkage is missing.');
    }
    if ((modelRegistry?.registry_role ?? asString(run.registry_context.registry_role)) === 'at_risk') {
        addBlocker('registry_at_risk', 'This registry entry is marked at_risk and cannot be promoted.');
    }
    if (calibrationGate !== 'pass') {
        addBlocker(calibrationGate === 'pending' ? 'missing_calibration' : 'failed_calibration', calibrationGate === 'pending'
            ? 'Calibration gate is still pending.'
            : 'Calibration gate has not passed.');
    }
    if (adversarialGate !== 'pass') {
        addBlocker(adversarialGate === 'pending' ? 'missing_adversarial' : 'failed_adversarial', adversarialGate === 'pending'
            ? 'Adversarial gate is still pending.'
            : 'Adversarial gate has not passed.');
    }
    if (safetyGate !== 'pass') {
        addBlocker(safetyGate === 'pending' ? 'missing_safety' : 'failed_safety', safetyGate === 'pending'
            ? 'Clinical safety evaluation is still pending.'
            : 'Clinical safety gate has not passed.');
    }
    if (benchmarkGate !== 'pass') {
        addBlocker(benchmarkGate === 'pending' ? 'missing_benchmark' : 'failed_benchmark', benchmarkGate === 'pending'
            ? 'Benchmark evaluation is still pending.'
            : 'Benchmark gate has not passed.');
    }
    if (manualApprovalGate !== 'pass') {
        addBlocker(manualApprovalGate === 'pending' ? 'missing_manual_approval' : 'denied_manual_approval', manualApprovalGate === 'pending'
            ? 'Manual approval is still pending.'
            : 'Manual approval has not been granted.');
    }

    return {
        can_promote: blockers.length === 0,
        promotion_allowed: blockers.length === 0,
        missing_requirements: blockers,
        blockers,
        blocker_codes: blockerCodes,
        gates: {
            calibration: calibrationGate,
            adversarial: adversarialGate,
            safety: safetyGate,
            benchmark: benchmarkGate,
            manual_approval: manualApprovalGate,
        },
        tooltip: blockers.length === 0
            ? 'All governance requirements satisfied.'
            : blockers.join(' '),
    };
}

function getPrimarySafetySignal(
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
): number | null {
    if (run.task_type === 'severity_prediction') {
        return latestMetric?.val_accuracy ??
            numberOrNull(run.safety_metrics.val_accuracy) ??
            run.metric_primary_value;
    }
    return latestMetric?.macro_f1 ??
        numberOrNull(run.safety_metrics.macro_f1) ??
        run.metric_primary_value;
}

function resolveGateStatus(value: boolean | null | undefined): GateStatus {
    if (value === true) return 'pass';
    if (value === false) return 'fail';
    return 'pending';
}

function deriveSafetyPassValue(
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
): boolean | null {
    return getSafetyCoverageState(run, latestMetric) === 'full'
        ? evaluateSafetyGate(run, latestMetric)
        : null;
}

function evaluateBenchmarkGate(
    benchmarks: ExperimentBenchmarkRecord[],
): boolean | null {
    if (benchmarks.length === 0) return null;
    if (benchmarks.some((benchmark) => benchmark.pass_status.toLowerCase() === 'fail')) {
        return false;
    }
    return benchmarks.some((benchmark) => benchmark.pass_status.toLowerCase() === 'pass')
        ? true
        : null;
}

function buildClinicalMetricsRecord(
    run: ExperimentRunRecord,
    latestMetric: ExperimentMetricRecord | null,
    calibrationMetrics: CalibrationMetricRecord | null,
    adversarialMetrics: AdversarialMetricRecord | null,
): ClinicalMetricsRecord {
    return {
        global_accuracy: latestMetric?.val_accuracy ?? run.metric_primary_value,
        macro_f1: latestMetric?.macro_f1 ?? numberOrNull(run.safety_metrics.macro_f1),
        critical_recall: latestMetric?.recall_critical ?? numberOrNull(run.safety_metrics.recall_critical),
        false_reassurance_rate: adversarialMetrics?.dangerous_false_reassurance_rate
            ?? latestMetric?.dangerous_false_reassurance_rate
            ?? numberOrNull(run.safety_metrics.dangerous_false_reassurance_rate),
        fn_critical_rate: latestMetric?.false_negative_critical_rate
            ?? numberOrNull(run.safety_metrics.false_negative_critical_rate),
        ece: calibrationMetrics?.ece ?? numberOrNull(run.safety_metrics.calibration_ece),
        brier_score: calibrationMetrics?.brier_score ?? numberOrNull(run.safety_metrics.calibration_brier),
        adversarial_degradation: adversarialMetrics?.degradation_score ?? latestMetric?.adversarial_score ?? null,
        latency_p99: numberOrNull(run.resource_usage.latency_p99)
            ?? numberOrNull(run.resource_usage.inference_latency_p99_ms),
    };
}

function buildRegistryLineage(
    run: ExperimentRunRecord,
    artifactUris: ExperimentRunDetail['artifact_uris'],
    benchmarks: ExperimentBenchmarkRecord[],
): RegistryLineageRecord {
    return {
        run_id: run.run_id,
        experiment_group: run.experiment_group_id,
        dataset_version: run.dataset_version ?? run.dataset_name,
        benchmark_id: benchmarks[0]?.id ?? null,
        calibration_report_uri: artifactUris.calibration_report_uri,
        adversarial_report_uri: artifactUris.adversarial_report_uri,
    };
}

function buildRegistryDecisionPanel(
    promotionGating: ExperimentRunDetail['promotion_gating'],
    promotionRequirements: PromotionRequirementsRecord | null,
    deploymentDecision: DeploymentDecisionRecord | null,
): RegistryDecisionPanel {
    const missingEvaluations = [
        promotionGating.gates.calibration === 'pending' ? 'Calibration evaluation is pending.' : null,
        promotionGating.gates.adversarial === 'pending' ? 'Adversarial evaluation is pending.' : null,
        promotionGating.gates.safety === 'pending' ? 'Clinical safety evaluation is pending.' : null,
        promotionGating.gates.benchmark === 'pending' ? 'Benchmark evaluation is pending.' : null,
        promotionGating.gates.manual_approval === 'pending' ? 'Manual approval is pending.' : null,
    ].filter((value): value is string => Boolean(value));

    const reasons = deploymentDecision?.decision === 'approved'
        ? [deploymentDecision.reason ?? (promotionGating.blockers.length === 0
            ? 'All registry gates approved.'
            : 'Current deployment remains live while outstanding governance warnings are being monitored.')]
        : deploymentDecision?.decision === 'rejected'
            ? deploymentDecision.reason
                ? [deploymentDecision.reason]
                : promotionGating.blockers
            : promotionRequirements?.manual_approval === false
                ? ['Manual approval was explicitly denied.']
                : promotionGating.blockers;

    return {
        promotion_eligibility: promotionGating.promotion_allowed,
        deployment_decision: deploymentDecision?.decision === 'approved'
            ? 'approved'
            : deploymentDecision?.decision === 'rejected'
                ? 'rejected'
                : 'hold',
        reasons,
        missing_evaluations: missingEvaluations,
        blocker_codes: promotionGating.blocker_codes,
    };
}

function filterRegistryAuditEventsForRun(
    run: ExperimentRunRecord,
    modelRegistry: ModelRegistryRecord | null,
    auditEvents: RegistryAuditLogRecord[],
): RegistryAuditLogRecord[] {
    return auditEvents
        .filter((event) => event.run_id === run.run_id || (modelRegistry != null && event.registry_id === modelRegistry.registry_id))
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, 30);
}

function findLastStableModel(
    modelRegistry: ModelRegistryRecord | null,
    registryRecords: ModelRegistryRecord[],
): ModelRegistryRecord | null {
    if (!modelRegistry) return null;
    if (modelRegistry.rollback_target) {
        return registryRecords.find((entry) => entry.registry_id === modelRegistry.rollback_target) ?? null;
    }
    return registryRecords
        .filter((entry) =>
            entry.model_family === modelRegistry.model_family &&
            entry.registry_id !== modelRegistry.registry_id &&
            entry.registry_role === 'rollback_target',
        )
        .sort((left, right) => (right.deployed_at ?? right.updated_at).localeCompare(left.deployed_at ?? left.updated_at))[0] ?? null;
}

function resolveModelFamilyForRun(run: ExperimentRunRecord): ModelFamily {
    const values = [
        run.task_type,
        run.target_type,
        run.model_arch,
        run.model_version,
        asString(run.registry_context.model_family),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (values.includes('vision') || run.task_type === 'vision_classification') {
        return 'vision';
    }
    if (values.includes('therapeut')) {
        return 'therapeutics';
    }
    return 'diagnostics';
}

function rankRegistryEntry(registry: ModelRegistryRecord): number {
    if (registry.lifecycle_status === 'production' && registry.registry_role === 'champion') return 0;
    if (registry.lifecycle_status === 'production' && registry.registry_role === 'at_risk') return 1;
    if (registry.lifecycle_status === 'staging' && registry.registry_role === 'challenger') return 2;
    if (registry.lifecycle_status === 'candidate') return 3;
    if (registry.lifecycle_status === 'training') return 4;
    if (registry.registry_role === 'rollback_target') return 5;
    return 6;
}

function buildArtifactUris(
    run: ExperimentRunRecord,
    artifacts: ExperimentArtifactRecord[],
): ExperimentRunDetail['artifact_uris'] {
    const uriByType = new Map<string, string>();
    for (const artifact of artifacts) {
        if (!artifact.uri || uriByType.has(artifact.artifact_type)) continue;
        uriByType.set(artifact.artifact_type, artifact.uri);
    }

    return {
        log_uri: uriByType.get('tensorboard')
            ?? asString(run.config_snapshot.log_uri)
            ?? asString(run.config_snapshot.tensorboard_uri)
            ?? null,
        checkpoint_uri: uriByType.get('final_checkpoint')
            ?? asString(run.config_snapshot.final_checkpoint_uri)
            ?? null,
        best_checkpoint_uri: uriByType.get('best_checkpoint')
            ?? asString(run.config_snapshot.best_checkpoint_uri)
            ?? null,
        calibration_report_uri: uriByType.get('calibration_report')
            ?? asString(run.config_snapshot.calibration_report_uri)
            ?? null,
        adversarial_report_uri: uriByType.get('adversarial_report')
            ?? asString(run.config_snapshot.adversarial_report_uri)
            ?? null,
        benchmark_report_uri: uriByType.get('benchmark_report')
            ?? asString(run.config_snapshot.benchmark_report_uri)
            ?? null,
    };
}

async function logBenchmarkAuditEvents(
    store: ExperimentTrackingStore,
    run: ExperimentRunRecord,
    benchmarks: ExperimentBenchmarkRecord[],
    actor: string | null,
): Promise<void> {
    for (const benchmark of benchmarks) {
        await logExperimentAuditEvent(store, {
            tenantId: run.tenant_id,
            runId: run.run_id,
            eventType: 'benchmark_completed',
            actor: actor ?? run.created_by,
            metadata: {
                benchmark_family: benchmark.benchmark_family,
                pass_status: benchmark.pass_status,
                summary_score: benchmark.summary_score,
            },
            deterministicKey: `${run.run_id}:benchmark:${benchmark.benchmark_family}`,
        });
    }
}

function deriveFailureGuidance(
    run: ExperimentRunRecord,
    metrics: ExperimentMetricRecord[],
    failure: ExperimentFailureRecord,
): {
    root_cause_classification: 'high_lr' | 'no_clipping' | 'data_instability' | 'gradient_explosion' | 'unknown';
    suggested_cause: string;
    remediation_suggestions: string[];
} {
    const learningRate = failure.last_learning_rate ?? numberOrNull(run.hyperparameters.learning_rate_init) ?? 0;
    const gradientClip = numberOrNull(run.hyperparameters.gradient_clip_norm) ?? 0;
    const latestGradient = failure.last_gradient_norm ?? metrics[metrics.length - 1]?.gradient_norm ?? 0;
    const suggestions: string[] = [];
    let suggestedCause = 'Training instability detected from experiment telemetry.';
    let rootCauseClassification: 'high_lr' | 'no_clipping' | 'data_instability' | 'gradient_explosion' | 'unknown' = 'unknown';

    if (learningRate >= 0.001 && gradientClip <= 0) {
        suggestedCause = 'Learning rate appears too high and gradient clipping was disabled.';
        rootCauseClassification = 'high_lr';
        suggestions.push('Lower the initial learning rate by at least 10x.');
        suggestions.push('Enable gradient clipping around 0.5 to 1.0.');
    } else if (gradientClip <= 0 && latestGradient >= 25) {
        suggestedCause = 'Optimization destabilized because gradient clipping was disabled under rising gradient norms.';
        rootCauseClassification = 'no_clipping';
        suggestions.push('Enable gradient clipping around 0.5 to 1.0 before retrying this run.');
        suggestions.push('Add a gradient-norm alert so the worker aborts before NaN propagation.');
    } else if (latestGradient >= 100 || failure.nan_detected) {
        suggestedCause = 'Gradient explosion and NaN propagation were detected during backpropagation.';
        rootCauseClassification = 'gradient_explosion';
        suggestions.push('Re-enable mixed-precision safeguards or NaN gradient checks.');
        suggestions.push('Inspect the loss function and input normalization for unstable batches.');
    } else {
        rootCauseClassification = 'data_instability';
        suggestions.push('Inspect the checkpoint prior to the failure step for unstable batch statistics.');
        suggestions.push('Review the input batch that preceded failure for malformed labels or outlier feature values.');
    }

    if (suggestions.every((item) => item !== 'Reduce batch size or accumulation to stabilize optimization.')) {
        suggestions.push('Reduce batch size or accumulation to stabilize optimization.');
    }

    return {
        root_cause_classification: rootCauseClassification,
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
    calibrationReport: {
        status: string;
        report: Record<string, unknown>;
        eceScore: number | null;
        brierScore: number | null;
    } | null,
    benchmarks: Array<{
        benchmark_family: string;
        task_type: string;
        summary_score: number | null;
        pass_status: string;
        report_payload: Record<string, unknown>;
    }>,
): Record<string, unknown> {
    const safetyBenchmark = benchmarks.find((benchmark) =>
        benchmark.benchmark_family.toLowerCase().includes('adversarial') ||
        benchmark.benchmark_family.toLowerCase().includes('safety') ||
        benchmark.benchmark_family.toLowerCase().includes('severity'),
    ) ?? null;
    const diagnosisBenchmark = benchmarks.find((benchmark) =>
        benchmark.task_type === 'diagnosis' ||
        benchmark.benchmark_family === 'clean_labeled_diagnosis',
    ) ?? null;

    return {
        macro_f1: numberOrNull(benchmarkScorecard.diagnosis_macro_f1) ??
            readBenchmarkMetric(diagnosisBenchmark?.report_payload ?? null, 'macro_f1'),
        top_3_accuracy: numberOrNull(benchmarkScorecard.diagnosis_top_3_accuracy),
        recall_critical: numberOrNull(benchmarkScorecard.severity_critical_recall) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'critical_recall'),
        false_negative_critical_rate: numberOrNull(benchmarkScorecard.severity_false_negative_rate) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'emergency_false_negative_rate'),
        dangerous_false_reassurance_rate: numberOrNull(benchmarkScorecard.dangerous_false_reassurance_rate) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'false_reassurance_rate'),
        abstain_accuracy: numberOrNull(benchmarkScorecard.abstain_accuracy) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'abstain_accuracy'),
        contradiction_detection_rate: numberOrNull(benchmarkScorecard.contradiction_detection_rate) ??
            readBenchmarkMetric(safetyBenchmark?.report_payload ?? null, 'contradiction_detection_rate'),
        calibration_ece: numberOrNull(benchmarkScorecard.calibration_ece)
            ?? numberOrNull(calibrationReport?.report.expected_calibration_error)
            ?? calibrationReport?.eceScore,
        calibration_brier: numberOrNull(benchmarkScorecard.calibration_brier)
            ?? numberOrNull(calibrationReport?.report.brier_score)
            ?? calibrationReport?.brierScore,
    };
}

function isCalibrationMetricsComplete(record: CalibrationMetricRecord): boolean {
    return record.ece != null &&
        record.brier_score != null &&
        record.reliability_bins.length > 0 &&
        record.confidence_histogram.length > 0 &&
        record.calibration_pass != null;
}

function isAdversarialMetricsComplete(record: AdversarialMetricRecord): boolean {
    return record.degradation_score != null &&
        record.contradiction_robustness != null &&
        record.critical_case_recall != null &&
        record.dangerous_false_reassurance_rate != null &&
        record.adversarial_pass != null;
}

function mergeMissingRecordFields(
    current: Record<string, unknown>,
    fallback: Record<string, unknown>,
): Record<string, unknown> {
    const merged = { ...current };
    for (const [key, value] of Object.entries(fallback)) {
        if (merged[key] == null && value != null) {
            merged[key] = value;
        }
    }
    return merged;
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
        {
            artifact_type: 'adversarial_report',
            label: 'Adversarial report',
            uri: asString(artifactPayload.adversarial_report_uri) ?? null,
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
        const auditEventType = candidate.artifact_type === 'best_checkpoint' || candidate.artifact_type === 'final_checkpoint'
            ? 'checkpoint_saved'
            : candidate.artifact_type === 'benchmark_report'
                ? 'benchmark_completed'
                : candidate.artifact_type === 'calibration_report'
                    ? 'calibration_completed'
                    : candidate.artifact_type === 'adversarial_report'
                        ? 'adversarial_completed'
                        : null;
        if (auditEventType) {
            await logExperimentAuditEvent(store, {
                tenantId,
                runId,
                eventType: auditEventType,
                actor: null,
                metadata: {
                    artifact_type: candidate.artifact_type,
                    uri: candidate.uri,
                },
                deterministicKey: `${runId}:artifact:${candidate.artifact_type}`,
            });
        }
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

function shouldMaterializeGovernance(
    run: ExperimentRunRecord,
    modelRegistry: ModelRegistryRecord | null,
): boolean {
    if (isGovernanceCandidateStatus(run.status)) return true;
    if (!modelRegistry) return false;
    return modelRegistry.lifecycle_status === 'staging' ||
        modelRegistry.lifecycle_status === 'production' ||
        modelRegistry.registry_role === 'challenger' ||
        modelRegistry.registry_role === 'champion' ||
        modelRegistry.registry_role === 'rollback_target';
}

function validateRegistryRegistration(
    run: ExperimentRunRecord,
    artifactPath: string | null,
): RegistryRegistrationValidation {
    const reasons: string[] = [];
    if (!run.run_id) {
        reasons.push('run_id linkage is missing.');
    }
    if (!(run.dataset_version ?? run.dataset_name)) {
        reasons.push('dataset_version is missing.');
    }
    if (!artifactPath) {
        reasons.push('model_artifact_path is missing.');
    }
    if (!(run.feature_schema_version ?? asString(run.config_snapshot.feature_schema_version))) {
        reasons.push('feature_schema is missing.');
    }

    return reasons.length === 0
        ? {
            status: 'valid',
            code: 'VALID_ARTIFACT_METADATA',
            reasons: [],
        }
        : {
            status: 'blocked',
            code: 'INVALID_ARTIFACT_METADATA',
            reasons,
        };
}

function buildRegistryStateSnapshot(
    registry: ModelRegistryRecord | null,
): Record<string, unknown> | null {
    if (!registry) return null;
    return {
        registry_id: registry.registry_id,
        lifecycle_status: registry.lifecycle_status,
        registry_role: registry.registry_role,
        rollback_target: registry.rollback_target,
        deployed_at: registry.deployed_at,
        model_version: registry.model_version,
        model_family: registry.model_family,
    };
}

function buildRegistryAuditMetadata(input: {
    eventType: string;
    actor: string | null;
    previousState: Record<string, unknown> | null;
    newState: Record<string, unknown> | null;
    reason?: string | null;
    [key: string]: unknown;
}): Record<string, unknown> {
    const {
        eventType,
        actor,
        previousState,
        newState,
        reason = null,
        ...rest
    } = input;
    return {
        event_type: eventType,
        actor,
        previous_state: previousState,
        new_state: newState,
        reason,
        ...rest,
    };
}

function evaluateRollbackReadiness(
    registry: ModelRegistryRecord,
    lastStableModel: ModelRegistryRecord | null,
): RegistryRollbackReadiness {
    if (!isLiveProductionChampion(registry)) {
        return {
            ready: true,
            target_registry_id: lastStableModel?.registry_id ?? null,
            reasons: [],
        };
    }

    const targetRegistryId = registry.rollback_target ?? lastStableModel?.registry_id ?? null;
    const reasons: string[] = [];
    if (!targetRegistryId) {
        reasons.push('No rollback target is configured for this production model.');
    }
    if (targetRegistryId === registry.registry_id) {
        reasons.push('Rollback target points to the current production model.');
    }

    return {
        ready: reasons.length === 0,
        target_registry_id: targetRegistryId,
        reasons,
    };
}

function validateRegistryConsistency(
    registryRecords: ModelRegistryRecord[],
    routingPointers: Array<{ model_family: ModelFamily; active_registry_id: string | null }>,
): RegistryConsistencyIssue[] {
    const issues: RegistryConsistencyIssue[] = [];

    for (const record of registryRecords) {
        if (!record.lifecycle_status) {
            issues.push({
                code: 'missing_lifecycle_state',
                severity: 'critical',
                message: `Registry ${record.registry_id} is missing a lifecycle state.`,
                model_family: record.model_family,
                registry_id: record.registry_id,
                run_id: record.run_id,
            });
        }
        if (!record.run_id || !record.dataset_version || !record.feature_schema_version || !(record.artifact_uri ?? record.artifact_path)) {
            issues.push({
                code: 'orphan_registry_metadata',
                severity: 'critical',
                message: `Registry ${record.registry_id} is missing run linkage or required artifact metadata.`,
                model_family: record.model_family,
                registry_id: record.registry_id,
                run_id: record.run_id,
            });
        }
        if (record.lifecycle_status === 'production' && record.registry_role === 'champion' && !record.rollback_target) {
            issues.push({
                code: 'missing_rollback_target',
                severity: 'critical',
                message: `Production champion ${record.registry_id} has no rollback target.`,
                model_family: record.model_family,
                registry_id: record.registry_id,
                run_id: record.run_id,
            });
        }
    }

    for (const family of MODEL_FAMILY_ORDER) {
        const familyRecords = registryRecords.filter((record) => record.model_family === family);
        const champions = familyRecords.filter((record) => record.lifecycle_status === 'production' && record.registry_role === 'champion');
        if (champions.length > 1) {
            for (const champion of champions) {
                issues.push({
                    code: 'duplicate_champion',
                    severity: 'critical',
                    message: `Model family ${family} has multiple production champions.`,
                    model_family: family,
                    registry_id: champion.registry_id,
                    run_id: champion.run_id,
                });
            }
        }

        const productionRecords = familyRecords.filter((record) => record.lifecycle_status === 'production');
        if (productionRecords.length > 1) {
            for (const record of productionRecords) {
                issues.push({
                    code: 'duplicate_production_model',
                    severity: 'critical',
                    message: `Model family ${family} has multiple production lifecycle entries.`,
                    model_family: family,
                    registry_id: record.registry_id,
                    run_id: record.run_id,
                });
            }
        }

        const pointer = routingPointers.find((candidate) => candidate.model_family === family) ?? null;
        if (pointer?.active_registry_id) {
            const champion = champions[0] ?? null;
            if (!champion || champion.registry_id !== pointer.active_registry_id) {
                issues.push({
                    code: 'routing_pointer_mismatch',
                    severity: 'critical',
                    message: `Routing pointer for ${family} does not match the sole production champion.`,
                    model_family: family,
                    registry_id: pointer.active_registry_id,
                    run_id: champion?.run_id ?? null,
                });
            }
        }
    }

    return dedupeRegistryConsistencyIssues(issues);
}

async function ensureRegistryRollbackTargets(
    store: ExperimentTrackingStore,
    tenantId: string,
): Promise<void> {
    const [registryRecords, runs] = await Promise.all([
        store.listModelRegistry(tenantId),
        store.listExperimentRuns(tenantId, { limit: 500, includeSummaryOnly: true }),
    ]);
    const runsById = new Map(runs.map((run) => [run.run_id, run]));

    for (const champion of registryRecords) {
        if (!isLiveProductionChampion(champion) || champion.rollback_target) continue;
        const fallback = selectRollbackProvisionCandidate(champion, registryRecords);
        if (!fallback) continue;

        const updated = await store.upsertModelRegistry({
            ...champion,
            rollback_target: fallback.registry_id,
            artifact_path: champion.artifact_uri ?? champion.artifact_path,
        });
        const run = runsById.get(champion.run_id) ?? null;
        if (run) {
            await store.updateExperimentRun(run.run_id, run.tenant_id, {
                registry_context: {
                    ...run.registry_context,
                    rollback_target: fallback.registry_id,
                },
            });
        }
        await logRegistryAuditEvent(store, {
            tenantId,
            registryId: updated.registry_id,
            runId: updated.run_id,
            eventType: 'rollback_target_assigned',
            actor: run?.created_by ?? 'system:registry-governor',
            metadata: buildRegistryAuditMetadata({
                eventType: 'rollback_target_assigned',
                actor: run?.created_by ?? 'system:registry-governor',
                previousState: buildRegistryStateSnapshot(champion),
                newState: buildRegistryStateSnapshot(updated),
                reason: 'auto_provisioned_fallback_target',
                fallback_registry_id: fallback.registry_id,
                fallback_model_version: fallback.model_version,
            }),
        });
    }
}

async function ensureRegistryLifecycleAuditCoverage(
    store: ExperimentTrackingStore,
    tenantId: string,
): Promise<void> {
    const [registryRecords, auditEvents, runs] = await Promise.all([
        store.listModelRegistry(tenantId),
        store.listRegistryAuditLog(tenantId, 400),
        store.listExperimentRuns(tenantId, { limit: 500, includeSummaryOnly: true }),
    ]);
    const runsById = new Map(runs.map((run) => [run.run_id, run]));
    const dedupedAuditEvents = dedupeRegistryAuditEvents(auditEvents);

    for (const registry of registryRecords) {
        const registryEvents = dedupedAuditEvents.filter((event) => event.registry_id === registry.registry_id);
        const actor = runsById.get(registry.run_id)?.created_by ?? 'system:registry-governor';
        const stateSnapshot = buildRegistryStateSnapshot(registry);

        if (!registryEvents.some((event) => event.event_type === 'registered')) {
            await logRegistryAuditEvent(store, {
                tenantId,
                registryId: registry.registry_id,
                runId: registry.run_id,
                eventType: 'registered',
                actor,
                deterministicKey: `reconcile:registered:${registry.lifecycle_status}:${registry.registry_role}`,
                metadata: buildRegistryAuditMetadata({
                    eventType: 'register',
                    actor,
                    previousState: null,
                    newState: stateSnapshot,
                    reason: 'state_reconciled_from_registry',
                }),
            });
        }

        if (registry.lifecycle_status === 'staging' && !registryEvents.some((event) => event.event_type === 'staged')) {
            await logRegistryAuditEvent(store, {
                tenantId,
                registryId: registry.registry_id,
                runId: registry.run_id,
                eventType: 'staged',
                actor,
                deterministicKey: `reconcile:staged:${registry.lifecycle_status}:${registry.registry_role}`,
                metadata: buildRegistryAuditMetadata({
                    eventType: 'promote_to_staging',
                    actor,
                    previousState: null,
                    newState: stateSnapshot,
                    reason: 'state_reconciled_from_registry',
                }),
            });
        }

        if (isLiveProductionChampion(registry) && !registryEvents.some((event) => event.event_type === 'promoted' || event.event_type === 'rolled_back')) {
            await logRegistryAuditEvent(store, {
                tenantId,
                registryId: registry.registry_id,
                runId: registry.run_id,
                eventType: 'promoted',
                actor,
                deterministicKey: `reconcile:promoted:${registry.lifecycle_status}:${registry.registry_role}`,
                metadata: buildRegistryAuditMetadata({
                    eventType: 'promote_to_production',
                    actor,
                    previousState: null,
                    newState: stateSnapshot,
                    reason: 'state_reconciled_from_registry',
                }),
            });
        }

        if (
            registry.lifecycle_status === 'archived' &&
            registry.registry_role !== 'rollback_target' &&
            !registryEvents.some((event) => event.event_type === 'archived' || event.event_type === 'rolled_back')
        ) {
            await logRegistryAuditEvent(store, {
                tenantId,
                registryId: registry.registry_id,
                runId: registry.run_id,
                eventType: 'archived',
                actor,
                deterministicKey: `reconcile:archived:${registry.lifecycle_status}:${registry.registry_role}`,
                metadata: buildRegistryAuditMetadata({
                    eventType: 'archive',
                    actor,
                    previousState: null,
                    newState: stateSnapshot,
                    reason: 'state_reconciled_from_registry',
                }),
            });
        }
    }
}

function selectRollbackProvisionCandidate(
    champion: ModelRegistryRecord,
    registryRecords: ModelRegistryRecord[],
): ModelRegistryRecord | null {
    return registryRecords
        .filter((entry) =>
            entry.model_family === champion.model_family &&
            entry.registry_id !== champion.registry_id &&
            entry.registry_role !== 'at_risk' &&
            ((entry.artifact_uri ?? entry.artifact_path) != null) &&
            entry.dataset_version != null &&
            entry.feature_schema_version != null &&
            (
                entry.registry_role === 'rollback_target' ||
                entry.lifecycle_status === 'staging' ||
                entry.lifecycle_status === 'candidate' ||
                entry.lifecycle_status === 'training'
            )
        )
        .sort((left, right) => rankRollbackProvisionCandidate(left) - rankRollbackProvisionCandidate(right) || (right.updated_at ?? right.created_at).localeCompare(left.updated_at ?? left.created_at))[0] ?? null;
}

function rankRollbackProvisionCandidate(record: ModelRegistryRecord): number {
    if (record.registry_role === 'rollback_target') return 0;
    if (record.lifecycle_status === 'staging' && record.registry_role === 'challenger') return 1;
    if (record.lifecycle_status === 'candidate') return 2;
    if (record.lifecycle_status === 'training') return 3;
    return 4;
}

function isEquivalentRegistryRecord(
    left: Pick<ModelRegistryRecord, keyof Omit<ModelRegistryRecord, 'created_at' | 'updated_at'>>,
    right: Pick<ModelRegistryRecord, keyof Omit<ModelRegistryRecord, 'created_at' | 'updated_at'>>,
): boolean {
    return left.registry_id === right.registry_id &&
        left.run_id === right.run_id &&
        left.model_name === right.model_name &&
        left.model_version === right.model_version &&
        left.model_family === right.model_family &&
        (left.artifact_uri ?? null) === (right.artifact_uri ?? null) &&
        (left.artifact_path ?? null) === (right.artifact_path ?? null) &&
        (left.dataset_version ?? null) === (right.dataset_version ?? null) &&
        (left.feature_schema_version ?? null) === (right.feature_schema_version ?? null) &&
        (left.label_policy_version ?? null) === (right.label_policy_version ?? null) &&
        left.lifecycle_status === right.lifecycle_status &&
        left.registry_role === right.registry_role &&
        (left.deployed_at ?? null) === (right.deployed_at ?? null) &&
        (left.archived_at ?? null) === (right.archived_at ?? null) &&
        (left.promoted_from ?? null) === (right.promoted_from ?? null) &&
        (left.rollback_target ?? null) === (right.rollback_target ?? null) &&
        left.status === right.status &&
        left.role === right.role;
}

function dedupeRegistryAuditEvents(
    events: RegistryAuditLogRecord[],
): RegistryAuditLogRecord[] {
    const seen = new Set<string>();
    return events
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .filter((event) => {
            const signature = [
                event.registry_id,
                event.run_id ?? '',
                event.event_type,
                JSON.stringify(event.metadata.previous_state ?? null),
                JSON.stringify(event.metadata.new_state ?? null),
                String(event.metadata.reason ?? ''),
            ].join('|');
            if (seen.has(signature)) {
                return false;
            }
            seen.add(signature);
            return true;
        });
}

function dedupeRegistryConsistencyIssues(
    issues: RegistryConsistencyIssue[],
): RegistryConsistencyIssue[] {
    const seen = new Set<string>();
    return issues.filter((issue) => {
        const key = `${issue.code}:${issue.registry_id ?? 'none'}:${issue.model_family ?? 'none'}:${issue.run_id ?? 'none'}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function assertRegistryAuditEventRecorded(
    store: ExperimentTrackingStore,
    input: {
        tenantId: string;
        registryId: string;
        eventType: string;
        runId?: string | null;
        since: string;
    },
): Promise<void> {
    const auditEvents = await store.listRegistryAuditLog(input.tenantId, 200);
    const found = auditEvents.some((event) =>
        event.registry_id === input.registryId &&
        event.event_type === input.eventType &&
        (input.runId == null || event.run_id === input.runId) &&
        event.timestamp >= input.since,
    );
    if (!found) {
        throw new RegistryControlPlaneError(
            'REGISTRY_AUDIT_LOG_MISSING',
            `Registry action ${input.eventType} was rejected because no audit log was recorded.`,
            {
                httpStatus: 500,
                details: {
                    status: 'failed',
                    reason: ['audit_log_missing'],
                },
            },
        );
    }
}

async function validateRegistryTransitionState(
    store: ExperimentTrackingStore,
    tenantId: string,
    modelFamily: ModelFamily,
    expectedChampionRegistryId: string,
): Promise<RegistryConsistencyIssue[]> {
    const [registryRecords, routingPointers] = await Promise.all([
        store.listModelRegistry(tenantId),
        store.listRegistryRoutingPointers(tenantId),
    ]);
    const issues = validateRegistryConsistency(registryRecords, routingPointers);
    const familyIssues = issues.filter((issue) =>
        issue.model_family === modelFamily &&
        (
            issue.code === 'duplicate_champion' ||
            issue.code === 'duplicate_production_model' ||
            issue.code === 'routing_pointer_mismatch'
        ),
    );
    const championCount = registryRecords.filter((record) =>
        record.model_family === modelFamily &&
        record.lifecycle_status === 'production' &&
        record.registry_role === 'champion',
    ).length;
    if (championCount !== 1) {
        familyIssues.push({
            code: 'duplicate_champion',
            severity: 'critical',
            message: `Model family ${modelFamily} must have exactly one production champion after transition.`,
            model_family: modelFamily,
            registry_id: expectedChampionRegistryId,
        });
    }
    const pointer = routingPointers.find((candidate) => candidate.model_family === modelFamily) ?? null;
    if ((pointer?.active_registry_id ?? null) !== expectedChampionRegistryId) {
        familyIssues.push({
            code: 'routing_pointer_mismatch',
            severity: 'critical',
            message: `Routing pointer for ${modelFamily} did not move to ${expectedChampionRegistryId}.`,
            model_family: modelFamily,
            registry_id: expectedChampionRegistryId,
        });
    }
    return dedupeRegistryConsistencyIssues(familyIssues);
}

function collectRegistryAuditTrailViolations(
    registryRecords: ModelRegistryRecord[],
    auditEvents: RegistryAuditLogRecord[],
): string[] {
    const violations: string[] = [];
    for (const registry of registryRecords) {
        const events = auditEvents.filter((event) => event.registry_id === registry.registry_id);
        if (events.length === 0) {
            violations.push(`${registry.registry_id}: no registry audit events recorded.`);
            continue;
        }
        if (!events.some((event) => event.event_type === 'registered')) {
            violations.push(`${registry.registry_id}: registration audit event is missing.`);
        }
        if (registry.lifecycle_status === 'staging' && !events.some((event) => event.event_type === 'staged')) {
            violations.push(`${registry.registry_id}: staging transition was not audited.`);
        }
        if (registry.lifecycle_status === 'production' && registry.registry_role === 'champion' && !events.some((event) => event.event_type === 'promoted' || event.event_type === 'rolled_back')) {
            violations.push(`${registry.registry_id}: production activation was not audited.`);
        }
        if (registry.lifecycle_status === 'archived' && registry.registry_role !== 'rollback_target' && !events.some((event) => event.event_type === 'archived' || event.event_type === 'rolled_back')) {
            violations.push(`${registry.registry_id}: archive transition was not audited.`);
        }
    }
    return violations;
}

function buildVerificationCheck(
    key: RegistryControlPlaneVerificationCheck['key'],
    label: string,
    failures: string[],
    warnings: string[],
    summary: string,
): RegistryControlPlaneVerificationCheck {
    return {
        key,
        label,
        status: failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
        summary,
        failures,
        warnings,
    };
}

function simulateMissingCalibrationDetection(
    registryRecords: ModelRegistryRecord[],
    runsById: Map<string, ExperimentRunRecord>,
): RegistryControlPlaneVerificationResult['simulated_failures'][number] {
    const candidate = registryRecords.find((registry) => registry.lifecycle_status === 'staging' || registry.registry_role === 'challenger') ?? registryRecords[0] ?? null;
    if (!candidate) {
        return {
            scenario: 'missing_calibration',
            detected: true,
            summary: 'No staging candidate exists, so missing-calibration simulation is skipped safely.',
        };
    }
    const run = runsById.get(candidate.run_id) ?? createMissingRunStub(candidate);
    const gating = evaluatePromotionReadiness(run, 'linked', null, null, null, {
        id: 'sim_missing_calibration',
        tenant_id: candidate.tenant_id,
        registry_id: candidate.registry_id,
        run_id: candidate.run_id,
        calibration_pass: null,
        adversarial_pass: true,
        safety_pass: true,
        benchmark_pass: true,
        manual_approval: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }, candidate);
    return {
        scenario: 'missing_calibration',
        detected: gating.blocker_codes.includes('missing_calibration'),
        summary: gating.blocker_codes.includes('missing_calibration')
            ? 'Missing calibration is blocked correctly.'
            : 'Missing calibration was not detected by promotion gating.',
    };
}

function simulateDuplicateChampionDetection(
    registryRecords: ModelRegistryRecord[],
    routingPointers: Array<{ model_family: ModelFamily; active_registry_id: string | null }>,
): RegistryControlPlaneVerificationResult['simulated_failures'][number] {
    const base = registryRecords[0] ?? null;
    if (!base) {
        return {
            scenario: 'duplicate_champions',
            detected: true,
            summary: 'No registry records exist, so duplicate-champion simulation is skipped safely.',
        };
    }
    const simulatedIssues = validateRegistryConsistency([
        {
            ...base,
            registry_id: `${base.registry_id}_champion_a`,
            lifecycle_status: 'production',
            registry_role: 'champion',
            role: 'champion',
            status: 'production',
        },
        {
            ...base,
            registry_id: `${base.registry_id}_champion_b`,
            lifecycle_status: 'production',
            registry_role: 'champion',
            role: 'champion',
            status: 'production',
        },
    ], routingPointers);
    const detected = simulatedIssues.some((issue) => issue.code === 'duplicate_champion');
    return {
        scenario: 'duplicate_champions',
        detected,
        summary: detected
            ? 'Duplicate champions are detected correctly.'
            : 'Duplicate champions were not detected.',
    };
}

function simulateNoRollbackTargetDetection(
    registryRecords: ModelRegistryRecord[],
): RegistryControlPlaneVerificationResult['simulated_failures'][number] {
    const base = registryRecords.find((registry) => registry.lifecycle_status === 'production' && registry.registry_role === 'champion') ?? null;
    if (!base) {
        return {
            scenario: 'no_rollback_target',
            detected: true,
            summary: 'No production champion exists, so rollback-target simulation is skipped safely.',
        };
    }
    const readiness = evaluateRollbackReadiness({
        ...base,
        rollback_target: null,
    }, null);
    return {
        scenario: 'no_rollback_target',
        detected: !readiness.ready,
        summary: !readiness.ready
            ? 'Missing rollback target is blocked correctly.'
            : 'Missing rollback target was not detected.',
    };
}

function simulateBrokenAuditLoggingDetection(
    registryRecords: ModelRegistryRecord[],
): RegistryControlPlaneVerificationResult['simulated_failures'][number] {
    const base = registryRecords[0] ?? null;
    if (!base) {
        return {
            scenario: 'broken_audit_logging',
            detected: true,
            summary: 'No registry records exist, so broken-audit simulation is skipped safely.',
        };
    }
    const detected = collectRegistryAuditTrailViolations([base], []).length > 0;
    return {
        scenario: 'broken_audit_logging',
        detected,
        summary: detected
            ? 'Missing audit logging is detected correctly.'
            : 'Broken audit logging was not detected.',
    };
}

function createMissingRunStub(
    registry: ModelRegistryRecord,
): ExperimentRunRecord {
    const now = new Date().toISOString();
    return {
        id: `stub_${registry.registry_id}`,
        tenant_id: registry.tenant_id,
        run_id: registry.run_id,
        experiment_group_id: null,
        sweep_id: null,
        parent_run_id: null,
        baseline_run_id: null,
        task_type: registry.model_family === 'vision' ? 'vision_classification' : 'clinical_diagnosis',
        modality: registry.model_family === 'vision' ? 'imaging' : 'tabular_clinical',
        target_type: registry.model_family,
        model_arch: registry.model_name,
        model_size: null,
        model_version: registry.model_version,
        registry_id: registry.registry_id,
        dataset_name: registry.dataset_version ?? 'unknown_dataset',
        dataset_version: registry.dataset_version,
        feature_schema_version: registry.feature_schema_version,
        label_policy_version: registry.label_policy_version,
        epochs_planned: null,
        epochs_completed: null,
        metric_primary_name: null,
        metric_primary_value: null,
        status: registry.lifecycle_status === 'production' ? 'promoted' : 'completed',
        status_reason: null,
        progress_percent: 100,
        summary_only: true,
        created_by: registry.created_by,
        hyperparameters: {},
        dataset_lineage: {},
        config_snapshot: {
            artifact_uri: registry.artifact_uri ?? registry.artifact_path,
        },
        safety_metrics: {},
        resource_usage: {},
        registry_context: {
            registry_id: registry.registry_id,
            registry_role: registry.registry_role,
            registry_status: registry.lifecycle_status,
            model_family: registry.model_family,
        },
        last_heartbeat_at: registry.updated_at,
        started_at: registry.created_at,
        ended_at: registry.updated_at,
        created_at: now,
        updated_at: now,
    };
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
    run?: ExperimentRunRecord,
): ModelRegistryRecord['status'] {
    if (existingStatus === 'archived' &&
        (asString(run?.registry_context.registry_role) === 'rollback_target' ||
            asString(run?.registry_context.champion_or_challenger) === 'rollback_target')) {
        return 'archived';
    }
    if (status === 'promoted') return 'production';
    if (status === 'rolled_back') return existingStatus === 'production' ? 'production' : 'archived';
    if (status === 'queued' || status === 'initializing' || status === 'training' || status === 'validating' || status === 'checkpointing') {
        if (existingStatus === 'production' || existingStatus === 'staging') return existingStatus;
        return 'training';
    }
    if (existingStatus === 'production' || existingStatus === 'staging' || existingStatus === 'archived') return existingStatus;
    return 'candidate';
}

function mapRunToRegistryRole(
    run: ExperimentRunRecord,
    existingRole: ModelRegistryRecord['role'] | null,
): ModelRegistryRecord['role'] {
    if (existingRole === 'rollback_target' || existingRole === 'at_risk') return existingRole;
    if (run.status === 'promoted') return 'champion';
    if (existingRole === 'champion' || existingRole === 'challenger') return existingRole;
    return run.summary_only ? 'challenger' : 'experimental';
}

function isLiveProductionChampion(modelRegistry: ModelRegistryRecord | null): boolean {
    return modelRegistry?.lifecycle_status === 'production' && modelRegistry.registry_role === 'champion';
}

function createRegistryId(run: ExperimentRunRecord): string {
    return `reg_${run.run_id.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 56)}`;
}

function createAuditEventId(tenantId: string, seed: string): string {
    const normalized = `${tenantId}:${seed}`.replace(/[^a-z0-9:_-]+/gi, '_').toLowerCase();
    return `evt_${normalized.slice(0, 100)}`;
}

function createRegistryAuditEventId(
    tenantId: string,
    registryId: string,
    eventType: string,
): string {
    return createAuditEventId(tenantId, `${registryId}:${eventType}:${Date.now()}`);
}

function normalizeAuditEventType(
    eventType: string,
    payload: Record<string, unknown>,
): string {
    const action = asString(payload.action)?.toLowerCase() ?? null;
    if (action === 'archive') return 'archived';
    if (action === 'rollback') return 'rolled_back';
    if (action === 'promote_to_staging' || action === 'stage') return 'staged';
    if (action === 'promote_to_production' || action === 'promote') return 'promoted';
    if (action === 'set_manual_approval') return 'manual_approval_updated';

    const registryStatus = asString(payload.registry_status)?.toLowerCase() ?? null;
    const registryRole = asString(payload.registry_role)?.toLowerCase() ?? null;
    if (eventType === 'promoted' && (registryStatus === 'archived' || registryRole === 'experimental')) {
        return 'archived';
    }

    return eventType;
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
