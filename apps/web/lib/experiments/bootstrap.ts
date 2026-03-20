import {
    createExperimentRun,
    logExperimentMetrics,
    recordExperimentFailure,
    updateExperimentHeartbeat,
} from '@/lib/experiments/service';
import type {
    CreateExperimentRunInput,
    ExperimentFailureInput,
    ExperimentHeartbeatInput,
    ExperimentMetricInput,
} from '@/lib/experiments/service';
import type { ExperimentTrackingStore } from '@/lib/experiments/types';

interface ExperimentArtifactSeed {
    artifactType: string;
    label: string;
    uri: string;
    isPrimary?: boolean;
    metadata?: Record<string, unknown>;
}

interface ExperimentBenchmarkSeed {
    benchmarkFamily: string;
    taskType: string;
    summaryScore: number;
    passStatus: string;
    reportPayload: Record<string, unknown>;
}

interface ExperimentRunSeedDefinition {
    run: CreateExperimentRunInput;
    metrics: ExperimentMetricInput[];
    heartbeat?: ExperimentHeartbeatInput | null;
    failure?: ExperimentFailureInput | null;
    artifacts?: ExperimentArtifactSeed[];
    benchmarks?: ExperimentBenchmarkSeed[];
}

export interface ExperimentBootstrapSummary {
    tenant_id: string;
    total_runs: number;
    active_runs: number;
    failed_runs: number;
    summary_only_runs: number;
    telemetry_coverage_pct: number;
    seeded_run_ids: string[];
    active_run_ids: string[];
}

export const EXPERIMENT_BOOTSTRAP_CREATED_BY = 'johnbruce12@gmail.com';

export const EXPERIMENT_BOOTSTRAP_RUN_IDS = [
    'run_diag_smoke_v1',
    'run_diag_complete_v1',
    'run_diag_fail_v1',
] as const;

export async function seedExperimentTrackingBootstrap(
    store: ExperimentTrackingStore,
    tenantId: string,
    options: {
        createdBy?: string | null;
    } = {},
): Promise<ExperimentBootstrapSummary> {
    const createdBy = options.createdBy ?? EXPERIMENT_BOOTSTRAP_CREATED_BY;
    const seeds = buildBootstrapSeeds(tenantId, createdBy);

    for (const seed of seeds) {
        await upsertSeedRun(store, tenantId, seed);
    }

    const runs = await store.listExperimentRuns(tenantId, {
        limit: 50,
        includeSummaryOnly: true,
    });
    const seededRuns = runs.filter((run) => EXPERIMENT_BOOTSTRAP_RUN_IDS.includes(run.run_id as typeof EXPERIMENT_BOOTSTRAP_RUN_IDS[number]));
    const activeRuns = seededRuns.filter((run) => isHealthyBootstrapRun(run));
    const telemetryReadiness = await Promise.all(
        seededRuns.map(async (run) => {
            const metrics = await store.listExperimentMetrics(tenantId, run.run_id, 2_000);
            const latest = metrics.at(-1) ?? null;
            return !run.summary_only &&
                latest?.epoch != null &&
                latest?.global_step != null &&
                latest?.train_loss != null &&
                latest?.val_loss != null &&
                latest?.val_accuracy != null &&
                latest?.learning_rate != null &&
                latest?.gradient_norm != null &&
                run.last_heartbeat_at != null;
        }),
    );
    const telemetryReady = telemetryReadiness.filter(Boolean).length;

    return {
        tenant_id: tenantId,
        total_runs: seededRuns.length,
        active_runs: activeRuns.length,
        failed_runs: seededRuns.filter((run) => run.status === 'failed').length,
        summary_only_runs: seededRuns.filter((run) => run.summary_only).length,
        telemetry_coverage_pct: seededRuns.length === 0
            ? 0
            : Number(((telemetryReady / seededRuns.length) * 100).toFixed(1)),
        seeded_run_ids: seededRuns.map((run) => run.run_id),
        active_run_ids: activeRuns.map((run) => run.run_id),
    };
}

function buildBootstrapSeeds(tenantId: string, createdBy: string | null): ExperimentRunSeedDefinition[] {
    const now = Date.now();
    const minutesAgo = (minutes: number) => new Date(now - minutes * 60 * 1000).toISOString();
    const smokeStartAt = minutesAgo(58);
    const smokeMetricTimestamps = [46, 35, 24, 13, 2].map(minutesAgo);
    const smokeHeartbeatAt = smokeMetricTimestamps[4];
    const completeStartAt = minutesAgo(180);
    const completeMetricTimestamps = [168, 154, 140, 126, 112, 98, 84, 70].map(minutesAgo);
    const completeHeartbeatAt = completeMetricTimestamps[7];
    const failStartAt = minutesAgo(120);
    const failMetricTimestamps = [108, 92, 76].map(minutesAgo);
    const failHeartbeatAt = failMetricTimestamps[2];

    return [
        {
            run: {
                tenantId,
                runId: 'run_diag_smoke_v1',
                experimentGroupId: 'exp_diag_bootstrap_v1',
                sweepId: 'sweep_smoke_v1',
                parentRunId: null,
                baselineRunId: null,
                taskType: 'clinical_diagnosis',
                modality: 'tabular_clinical',
                targetType: 'multiclass_condition_classification',
                modelArch: 'Transformer-Clinical-Small',
                modelSize: 'small',
                modelVersion: 'diag_smoke_v1',
                datasetName: 'vet_clinical_subset_b',
                datasetVersion: 'dset_v1_smoke',
                featureSchemaVersion: 'feat_v1',
                labelPolicyVersion: 'label_v1',
                epochsPlanned: 10,
                epochsCompleted: 5,
                metricPrimaryName: 'macro_f1',
                metricPrimaryValue: 0.73,
                status: 'training',
                statusReason: 'manual_smoke_test',
                progressPercent: 50,
                summaryOnly: false,
                createdBy,
                hyperparameters: {
                    optimizer: 'adamw',
                    learning_rate_init: 0.0003,
                    batch_size: 8,
                    weight_decay: 0.01,
                    scheduler: 'cosine',
                    warmup_steps: 10,
                    gradient_clip_norm: 1.0,
                    dropout: 0.1,
                    seed: 42,
                    mixed_precision: false,
                    accumulation_steps: 1,
                },
                datasetLineage: {
                    dataset_name: 'vet_clinical_subset_b',
                    dataset_version: 'dset_v1_smoke',
                    total_cases: 5,
                    clean_labeled_count: 1,
                    severity_ready_count: 1,
                    contradiction_ready_count: 2,
                    adversarial_count: 0,
                    quarantined_excluded_count: 1,
                    split_policy: 'manual_smoke_split_v1',
                },
                configSnapshot: {
                    bootstrap_profile: 'experiment_tracking_seed_v1',
                    run_purpose: 'active_smoke_test',
                    created_by_label: createdBy,
                },
                safetyMetrics: {
                    macro_f1: 0.73,
                    recall_critical: 0.9,
                    top_3_accuracy: 0.86,
                },
                resourceUsage: {
                    gpu_utilization: 0.54,
                    cpu_utilization: 0.31,
                    memory_utilization: 0.42,
                    steps_per_second: 1.8,
                },
                registryContext: {},
                startedAt: smokeStartAt,
            },
            metrics: [
                metricPoint(1, 10, 1.18, 1.02, 0.42, 0.00030, 0.91, 0.39, 0.70, smokeMetricTimestamps[0], 420, 1.2, 0.44, 0.26, 0.35),
                metricPoint(2, 20, 0.96, 0.88, 0.56, 0.00028, 0.83, 0.51, 0.78, smokeMetricTimestamps[1], 840, 1.4, 0.48, 0.28, 0.37),
                metricPoint(3, 30, 0.81, 0.74, 0.64, 0.00025, 0.77, 0.59, 0.82, smokeMetricTimestamps[2], 1260, 1.5, 0.5, 0.29, 0.39),
                metricPoint(4, 40, 0.68, 0.65, 0.72, 0.00022, 0.73, 0.66, 0.87, smokeMetricTimestamps[3], 1680, 1.7, 0.53, 0.31, 0.4),
                metricPoint(5, 50, 0.59, 0.58, 0.78, 0.00019, 0.69, 0.73, 0.90, smokeMetricTimestamps[4], 2100, 1.8, 0.54, 0.31, 0.42),
            ],
            heartbeat: {
                status: 'training',
                statusReason: 'manual_smoke_test',
                epochsCompleted: 5,
                progressPercent: 50,
                lastHeartbeatAt: smokeHeartbeatAt,
                resourceUsage: {
                    gpu_utilization: 0.54,
                    cpu_utilization: 0.31,
                    memory_utilization: 0.42,
                    steps_per_second: 1.8,
                },
            },
            artifacts: [
                {
                    artifactType: 'tensorboard',
                    label: 'Live telemetry stream',
                    uri: 's3://vetios-experiments/run_diag_smoke_v1/logs',
                    isPrimary: true,
                },
                {
                    artifactType: 'best_checkpoint',
                    label: 'Current best checkpoint',
                    uri: 's3://vetios-experiments/run_diag_smoke_v1/checkpoints/epoch_5.ckpt',
                },
            ],
            benchmarks: [
                {
                    benchmarkFamily: 'smoke_validation',
                    taskType: 'clinical_diagnosis',
                    summaryScore: 0.73,
                    passStatus: 'pass',
                    reportPayload: {
                        macro_f1: 0.73,
                        recall_critical: 0.90,
                        telemetry_source: 'bootstrap_seed',
                    },
                },
            ],
        },
        {
            run: {
                tenantId,
                runId: 'run_diag_complete_v1',
                experimentGroupId: 'exp_diag_bootstrap_v1',
                sweepId: 'sweep_smoke_v1',
                parentRunId: null,
                baselineRunId: 'run_diag_smoke_v1',
                taskType: 'clinical_diagnosis',
                modality: 'tabular_clinical',
                targetType: 'multiclass_condition_classification',
                modelArch: 'Transformer-Clinical-Base',
                modelSize: 'base',
                modelVersion: 'diag_complete_v1',
                datasetName: 'vet_clinical_base',
                datasetVersion: 'dset_v1_base',
                featureSchemaVersion: 'feat_v1',
                labelPolicyVersion: 'label_v1',
                epochsPlanned: 8,
                epochsCompleted: 8,
                metricPrimaryName: 'macro_f1',
                metricPrimaryValue: 0.81,
                status: 'completed',
                statusReason: 'training_finished',
                progressPercent: 100,
                summaryOnly: false,
                createdBy,
                hyperparameters: {
                    optimizer: 'adamw',
                    learning_rate_init: 0.0002,
                    batch_size: 8,
                    weight_decay: 0.01,
                    scheduler: 'cosine',
                    warmup_steps: 8,
                    gradient_clip_norm: 1.0,
                    dropout: 0.1,
                    seed: 7,
                    mixed_precision: false,
                    accumulation_steps: 1,
                },
                datasetLineage: {
                    dataset_name: 'vet_clinical_base',
                    dataset_version: 'dset_v1_base',
                    total_cases: 12,
                    clean_labeled_count: 3,
                    severity_ready_count: 4,
                    contradiction_ready_count: 2,
                    adversarial_count: 1,
                    quarantined_excluded_count: 1,
                    split_policy: 'bootstrap_split_v1',
                },
                configSnapshot: {
                    bootstrap_profile: 'experiment_tracking_seed_v1',
                    run_purpose: 'completed_baseline',
                    created_by_label: createdBy,
                },
                safetyMetrics: {
                    macro_f1: 0.81,
                    recall_critical: 0.94,
                    top_3_accuracy: 0.91,
                },
                resourceUsage: {
                    gpu_utilization: 0.58,
                    cpu_utilization: 0.35,
                    memory_utilization: 0.45,
                    steps_per_second: 2.0,
                },
                registryContext: {},
                startedAt: completeStartAt,
                endedAt: completeHeartbeatAt,
            },
            metrics: [
                metricPoint(1, 12, 1.05, 0.97, 0.48, 0.00020, 0.88, 0.43, 0.72, completeMetricTimestamps[0], 380, 1.3, 0.45, 0.25, 0.36),
                metricPoint(2, 24, 0.88, 0.79, 0.58, 0.00018, 0.82, 0.54, 0.79, completeMetricTimestamps[1], 760, 1.5, 0.49, 0.28, 0.38),
                metricPoint(3, 36, 0.76, 0.70, 0.66, 0.00016, 0.76, 0.62, 0.84, completeMetricTimestamps[2], 1140, 1.7, 0.52, 0.30, 0.40),
                metricPoint(4, 48, 0.67, 0.63, 0.73, 0.00014, 0.71, 0.69, 0.88, completeMetricTimestamps[3], 1520, 1.8, 0.55, 0.33, 0.41),
                metricPoint(5, 60, 0.61, 0.57, 0.77, 0.00012, 0.69, 0.73, 0.90, completeMetricTimestamps[4], 1900, 1.9, 0.56, 0.34, 0.43),
                metricPoint(6, 72, 0.55, 0.52, 0.80, 0.00010, 0.66, 0.77, 0.92, completeMetricTimestamps[5], 2280, 2.0, 0.57, 0.35, 0.44),
                metricPoint(7, 84, 0.51, 0.49, 0.82, 0.00008, 0.63, 0.79, 0.93, completeMetricTimestamps[6], 2660, 2.0, 0.58, 0.35, 0.45),
                metricPoint(8, 96, 0.48, 0.46, 0.84, 0.00006, 0.61, 0.81, 0.94, completeMetricTimestamps[7], 3040, 2.1, 0.58, 0.35, 0.45),
            ],
            heartbeat: {
                status: 'completed',
                statusReason: 'training_finished',
                epochsCompleted: 8,
                progressPercent: 100,
                lastHeartbeatAt: completeHeartbeatAt,
                resourceUsage: {
                    gpu_utilization: 0.58,
                    cpu_utilization: 0.35,
                    memory_utilization: 0.45,
                    steps_per_second: 2.1,
                },
            },
            artifacts: [
                {
                    artifactType: 'best_checkpoint',
                    label: 'Best checkpoint',
                    uri: 's3://vetios-experiments/run_diag_complete_v1/checkpoints/best.ckpt',
                    isPrimary: true,
                },
                {
                    artifactType: 'final_checkpoint',
                    label: 'Final checkpoint',
                    uri: 's3://vetios-experiments/run_diag_complete_v1/checkpoints/final.ckpt',
                },
                {
                    artifactType: 'benchmark_report',
                    label: 'Benchmark report',
                    uri: 's3://vetios-experiments/run_diag_complete_v1/reports/benchmark.json',
                },
            ],
            benchmarks: [
                {
                    benchmarkFamily: 'clean_labeled_diagnosis',
                    taskType: 'clinical_diagnosis',
                    summaryScore: 0.81,
                    passStatus: 'pass',
                    reportPayload: {
                        macro_f1: 0.81,
                        recall_critical: 0.94,
                        val_accuracy: 0.84,
                    },
                },
            ],
        },
        {
            run: {
                tenantId,
                runId: 'run_diag_fail_v1',
                experimentGroupId: 'exp_diag_bootstrap_v1',
                sweepId: 'sweep_failure_v1',
                parentRunId: null,
                baselineRunId: 'run_diag_complete_v1',
                taskType: 'clinical_diagnosis',
                modality: 'tabular_clinical',
                targetType: 'multiclass_condition_classification',
                modelArch: 'Transformer-Clinical-Base',
                modelSize: 'base',
                modelVersion: 'diag_fail_v1',
                datasetName: 'vet_clinical_base',
                datasetVersion: 'dset_v1_base',
                featureSchemaVersion: 'feat_v1',
                labelPolicyVersion: 'label_v1',
                epochsPlanned: 10,
                epochsCompleted: 3,
                metricPrimaryName: 'macro_f1',
                metricPrimaryValue: 0.31,
                status: 'failed',
                statusReason: 'exploded_gradient',
                progressPercent: 30,
                summaryOnly: false,
                createdBy,
                hyperparameters: {
                    optimizer: 'adamw',
                    learning_rate_init: 0.003,
                    batch_size: 16,
                    weight_decay: 0.01,
                    scheduler: 'none',
                    warmup_steps: 0,
                    gradient_clip_norm: 0.0,
                    dropout: 0.1,
                    seed: 99,
                    mixed_precision: false,
                    accumulation_steps: 1,
                },
                datasetLineage: {
                    dataset_name: 'vet_clinical_base',
                    dataset_version: 'dset_v1_base',
                    total_cases: 12,
                    clean_labeled_count: 3,
                    severity_ready_count: 4,
                    contradiction_ready_count: 2,
                    adversarial_count: 1,
                    quarantined_excluded_count: 1,
                    split_policy: 'bootstrap_split_v1',
                },
                configSnapshot: {
                    bootstrap_profile: 'experiment_tracking_seed_v1',
                    run_purpose: 'failure_diagnostics',
                    created_by_label: createdBy,
                },
                safetyMetrics: {
                    macro_f1: 0.31,
                    recall_critical: 0.42,
                    dangerous_false_reassurance_rate: 0.18,
                },
                resourceUsage: {
                    gpu_utilization: 0.73,
                    cpu_utilization: 0.39,
                    memory_utilization: 0.52,
                    steps_per_second: 1.1,
                },
                registryContext: {},
                startedAt: failStartAt,
                endedAt: failHeartbeatAt,
            },
            metrics: [
                metricPoint(1, 12, 1.24, 1.09, 0.41, 0.003, 1.9, 0.35, 0.71, failMetricTimestamps[0], 300, 1.3, 0.64, 0.32, 0.47),
                metricPoint(2, 24, 1.87, 1.96, 0.33, 0.003, 14.6, 0.31, 0.66, failMetricTimestamps[1], 600, 1.2, 0.68, 0.35, 0.50),
                metricPoint(3, 36, 4.92, 5.87, 0.19, 0.003, 148.2, 0.18, 0.42, failMetricTimestamps[2], 900, 0.8, 0.73, 0.39, 0.52),
            ],
            heartbeat: {
                status: 'failed',
                statusReason: 'exploded_gradient',
                epochsCompleted: 3,
                progressPercent: 30,
                lastHeartbeatAt: failHeartbeatAt,
                resourceUsage: {
                    gpu_utilization: 0.73,
                    cpu_utilization: 0.39,
                    memory_utilization: 0.52,
                    steps_per_second: 0.8,
                },
            },
            failure: {
                failureReason: 'exploded_gradient',
                failureEpoch: 3,
                failureStep: 36,
                lastTrainLoss: 4.92,
                lastValLoss: 5.87,
                lastLearningRate: 0.003,
                lastGradientNorm: 148.2,
                nanDetected: true,
                checkpointRecoveryAttempted: false,
                errorSummary: 'Gradient norm exceeded safe threshold and NaN values detected during backward pass.',
            },
            artifacts: [
                {
                    artifactType: 'tensorboard',
                    label: 'Failure telemetry',
                    uri: 's3://vetios-experiments/run_diag_fail_v1/logs',
                    isPrimary: true,
                },
                {
                    artifactType: 'artifact_bundle',
                    label: 'Crash dump',
                    uri: 's3://vetios-experiments/run_diag_fail_v1/artifacts/crash_bundle.tar.gz',
                },
            ],
            benchmarks: [
                {
                    benchmarkFamily: 'training_instability',
                    taskType: 'clinical_diagnosis',
                    summaryScore: 0.18,
                    passStatus: 'fail',
                    reportPayload: {
                        macro_f1: 0.18,
                        recall_critical: 0.42,
                        failure_reason: 'exploded_gradient',
                    },
                },
            ],
        },
    ];
}

function metricPoint(
    epoch: number,
    globalStep: number,
    trainLoss: number,
    valLoss: number,
    valAccuracy: number,
    learningRate: number,
    gradientNorm: number,
    macroF1: number,
    recallCritical: number,
    metricTimestamp: string,
    wallClockTimeSeconds: number,
    stepsPerSecond: number,
    gpuUtilization: number,
    cpuUtilization: number,
    memoryUtilization: number,
): ExperimentMetricInput {
    return {
        epoch,
        global_step: globalStep,
        train_loss: trainLoss,
        val_loss: valLoss,
        val_accuracy: valAccuracy,
        learning_rate: learningRate,
        gradient_norm: gradientNorm,
        macro_f1: macroF1,
        recall_critical: recallCritical,
        metric_timestamp: metricTimestamp,
        wall_clock_time_seconds: wallClockTimeSeconds,
        steps_per_second: stepsPerSecond,
        gpu_utilization: gpuUtilization,
        cpu_utilization: cpuUtilization,
        memory_utilization: memoryUtilization,
    };
}

async function upsertSeedRun(
    store: ExperimentTrackingStore,
    tenantId: string,
    seed: ExperimentRunSeedDefinition,
): Promise<void> {
    const existing = await store.getExperimentRun(tenantId, seed.run.runId);

    if (existing) {
        await store.updateExperimentRun(seed.run.runId, tenantId, {
            experiment_group_id: seed.run.experimentGroupId ?? null,
            sweep_id: seed.run.sweepId ?? null,
            parent_run_id: seed.run.parentRunId ?? null,
            baseline_run_id: seed.run.baselineRunId ?? null,
            task_type: seed.run.taskType,
            modality: seed.run.modality,
            target_type: seed.run.targetType ?? null,
            model_arch: seed.run.modelArch,
            model_size: seed.run.modelSize ?? null,
            model_version: seed.run.modelVersion ?? null,
            dataset_name: seed.run.datasetName,
            dataset_version: seed.run.datasetVersion ?? null,
            feature_schema_version: seed.run.featureSchemaVersion ?? null,
            label_policy_version: seed.run.labelPolicyVersion ?? null,
            epochs_planned: seed.run.epochsPlanned ?? null,
            epochs_completed: seed.run.epochsCompleted ?? 0,
            metric_primary_name: seed.run.metricPrimaryName ?? null,
            metric_primary_value: seed.run.metricPrimaryValue ?? null,
            status: seed.run.status ?? 'queued',
            status_reason: seed.run.statusReason ?? null,
            progress_percent: seed.run.progressPercent ?? 0,
            summary_only: seed.run.summaryOnly ?? false,
            created_by: seed.run.createdBy ?? null,
            hyperparameters: seed.run.hyperparameters ?? {},
            dataset_lineage: seed.run.datasetLineage ?? {},
            config_snapshot: seed.run.configSnapshot ?? {},
            safety_metrics: seed.run.safetyMetrics ?? {},
            resource_usage: seed.run.resourceUsage ?? {},
            registry_context: seed.run.registryContext ?? {},
            last_heartbeat_at: seed.heartbeat?.lastHeartbeatAt ?? existing.last_heartbeat_at,
            started_at: seed.run.startedAt ?? existing.started_at,
            ended_at: seed.run.endedAt ?? null,
        });
    } else {
        await createExperimentRun(store, seed.run);
    }

    await syncMetrics(store, tenantId, seed.run.runId, seed.metrics);

    if (seed.heartbeat) {
        await updateExperimentHeartbeat(store, tenantId, seed.run.runId, seed.heartbeat);
    }

    if (seed.failure) {
        await recordExperimentFailure(store, tenantId, seed.run.runId, seed.failure);
    }

    await store.updateExperimentRun(seed.run.runId, tenantId, {
        epochs_completed: seed.run.epochsCompleted ?? 0,
        metric_primary_name: seed.run.metricPrimaryName ?? null,
        metric_primary_value: seed.run.metricPrimaryValue ?? null,
        status: seed.run.status ?? 'queued',
        status_reason: seed.run.statusReason ?? null,
        progress_percent: seed.run.progressPercent ?? 0,
        summary_only: false,
        created_by: seed.run.createdBy ?? null,
        hyperparameters: seed.run.hyperparameters ?? {},
        dataset_lineage: seed.run.datasetLineage ?? {},
        config_snapshot: seed.run.configSnapshot ?? {},
        safety_metrics: seed.run.safetyMetrics ?? {},
        resource_usage: seed.heartbeat?.resourceUsage ?? seed.run.resourceUsage ?? {},
        last_heartbeat_at: seed.heartbeat?.lastHeartbeatAt ?? seed.run.startedAt ?? null,
        started_at: seed.run.startedAt ?? null,
        ended_at: seed.run.endedAt ?? null,
    });

    for (const artifact of seed.artifacts ?? []) {
        await store.upsertExperimentArtifact({
            tenant_id: tenantId,
            run_id: seed.run.runId,
            artifact_type: artifact.artifactType,
            label: artifact.label,
            uri: artifact.uri,
            metadata: artifact.metadata ?? {},
            is_primary: artifact.isPrimary === true,
        });
    }

    for (const benchmark of seed.benchmarks ?? []) {
        await store.upsertExperimentBenchmark({
            tenant_id: tenantId,
            run_id: seed.run.runId,
            benchmark_family: benchmark.benchmarkFamily,
            task_type: benchmark.taskType,
            summary_score: benchmark.summaryScore,
            pass_status: benchmark.passStatus,
            report_payload: benchmark.reportPayload,
        });
    }
}

async function syncMetrics(
    store: ExperimentTrackingStore,
    tenantId: string,
    runId: string,
    metrics: ExperimentMetricInput[],
): Promise<void> {
    const existing = await store.listExperimentMetrics(tenantId, runId, 2_000);
    const existingKeys = new Set(existing.map((metric) => `${metric.epoch ?? 'na'}:${metric.global_step ?? 'na'}`));
    const missingMetrics = metrics.filter((metric) => !existingKeys.has(`${metric.epoch ?? 'na'}:${metric.global_step ?? 'na'}`));

    if (missingMetrics.length > 0) {
        await logExperimentMetrics(store, tenantId, runId, missingMetrics);
    }
}

function isActiveStatus(status: string): boolean {
    return status === 'queued' ||
        status === 'initializing' ||
        status === 'training' ||
        status === 'validating' ||
        status === 'checkpointing';
}

function isHealthyBootstrapRun(run: { status: string; last_heartbeat_at: string | null }) {
    if (!isActiveStatus(run.status) || !run.last_heartbeat_at) return false;
    const ageMs = Date.now() - new Date(run.last_heartbeat_at).getTime();
    return Number.isFinite(ageMs) && ageMs <= 10 * 60 * 1000;
}
