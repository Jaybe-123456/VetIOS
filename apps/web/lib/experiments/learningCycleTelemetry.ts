import {
    backfillSummaryExperimentRuns,
    createExperimentRun,
    logExperimentMetrics,
    updateExperimentHeartbeat,
    upsertAdversarialEvaluation,
    upsertCalibrationEvaluation,
} from '@/lib/experiments/service';
import type { CreateExperimentRunInput, ExperimentMetricInput } from '@/lib/experiments/service';
import type { ExperimentTaskType, ExperimentTrackingStore } from '@/lib/experiments/types';
import type {
    AdversarialEvaluationReport,
    BenchmarkFamilyReport,
    CalibrationReport,
    DiagnosisModelArtifact,
    DiagnosisTrainingMetrics,
    LearningCycleRunResult,
    SeverityModelArtifact,
    SeverityTrainingMetrics,
} from '@/lib/learningEngine/types';

export interface MaterializeLearningCycleTelemetryInput {
    tenantId: string;
    actorId: string | null;
    result: LearningCycleRunResult;
}

export interface MaterializeLearningCycleTelemetryResult {
    status: 'materialized' | 'skipped';
    run_ids: string[];
}

interface LearningCycleRunSpec {
    runId: string;
    taskType: ExperimentTaskType;
    targetType: string;
    modelArch: string;
    modelVersion: string;
    datasetVersion: string;
    featureSchemaVersion: string;
    labelPolicyVersion: string;
    modelSize: string | null;
    metricPrimaryName: string | null;
    metricPrimaryValue: number | null;
    safetyMetrics: Record<string, unknown>;
    hyperparameters: Record<string, unknown>;
    datasetLineage: Record<string, unknown>;
    configSnapshot: Record<string, unknown>;
    registryContext: Record<string, unknown>;
    metric: ExperimentMetricInput | null;
    benchmarks: BenchmarkFamilyReport[];
    calibrationInput: CalibrationInput | null;
    adversarialInput: AdversarialInput | null;
    startedAt: string | null;
    endedAt: string | null;
}

interface CalibrationInput {
    ece: number | null;
    brierScore: number | null;
    reliabilityBins: Array<{ confidence: number; accuracy: number; count?: number }>;
    confidenceHistogram: Array<{ confidence: number; count?: number }>;
    calibrationPass: boolean | null;
    calibrationNotes: string | null;
}

interface AdversarialInput {
    degradationScore: number | null;
    contradictionRobustness: number | null;
    criticalCaseRecall: number | null;
    dangerousFalseReassuranceRate: number | null;
    adversarialPass: boolean | null;
}

export async function materializeLearningCycleTelemetry(
    store: ExperimentTrackingStore,
    input: MaterializeLearningCycleTelemetryInput,
): Promise<MaterializeLearningCycleTelemetryResult> {
    const specs = buildRunSpecs(input.result);
    if (specs.length === 0) {
        return {
            status: 'skipped',
            run_ids: [],
        };
    }

    for (const spec of specs) {
        const existing = await store.getExperimentRun(input.tenantId, spec.runId);
        const runInput: CreateExperimentRunInput = {
            tenantId: input.tenantId,
            runId: spec.runId,
            experimentGroupId: `learning_cycle_${input.result.cycle.id}`,
            taskType: spec.taskType,
            modality: 'tabular_clinical',
            targetType: spec.targetType,
            modelArch: spec.modelArch,
            modelSize: spec.modelSize,
            modelVersion: spec.modelVersion,
            datasetName: spec.datasetVersion,
            datasetVersion: spec.datasetVersion,
            featureSchemaVersion: spec.featureSchemaVersion,
            labelPolicyVersion: spec.labelPolicyVersion,
            metricPrimaryName: spec.metricPrimaryName,
            metricPrimaryValue: spec.metricPrimaryValue,
            status: 'completed',
            statusReason: `learning_cycle_${input.result.cycle.cycle_type}`,
            progressPercent: 100,
            summaryOnly: false,
            createdBy: input.actorId,
            hyperparameters: spec.hyperparameters,
            datasetLineage: spec.datasetLineage,
            configSnapshot: spec.configSnapshot,
            safetyMetrics: spec.safetyMetrics,
            registryContext: spec.registryContext,
            lastHeartbeatAt: spec.endedAt ?? spec.startedAt ?? null,
            startedAt: spec.startedAt,
            endedAt: spec.endedAt,
        };

        if (existing) {
            await store.updateExperimentRun(spec.runId, input.tenantId, {
                experiment_group_id: runInput.experimentGroupId ?? existing.experiment_group_id,
                target_type: runInput.targetType ?? existing.target_type,
                model_arch: runInput.modelArch,
                model_size: runInput.modelSize,
                model_version: runInput.modelVersion,
                dataset_name: runInput.datasetName,
                dataset_version: runInput.datasetVersion,
                feature_schema_version: runInput.featureSchemaVersion,
                label_policy_version: runInput.labelPolicyVersion,
                metric_primary_name: runInput.metricPrimaryName,
                metric_primary_value: runInput.metricPrimaryValue,
                status: 'completed',
                status_reason: runInput.statusReason,
                progress_percent: 100,
                summary_only: false,
                created_by: runInput.createdBy,
                hyperparameters: runInput.hyperparameters ?? existing.hyperparameters,
                dataset_lineage: runInput.datasetLineage ?? existing.dataset_lineage,
                config_snapshot: runInput.configSnapshot ?? existing.config_snapshot,
                safety_metrics: runInput.safetyMetrics ?? existing.safety_metrics,
                registry_context: {
                    ...existing.registry_context,
                    ...(runInput.registryContext ?? {}),
                },
                last_heartbeat_at: runInput.lastHeartbeatAt,
                started_at: runInput.startedAt,
                ended_at: runInput.endedAt,
            });
        } else {
            await createExperimentRun(store, runInput);
        }

        const existingMetrics = await store.listExperimentMetrics(input.tenantId, spec.runId, 5);
        if (existingMetrics.length === 0 && spec.metric) {
            await logExperimentMetrics(store, input.tenantId, spec.runId, [spec.metric]);
        }

        await updateExperimentHeartbeat(store, input.tenantId, spec.runId, {
            status: 'completed',
            progressPercent: 100,
            epochsCompleted: spec.metric?.epoch ?? existing?.epochs_completed ?? 1,
            lastHeartbeatAt: spec.endedAt ?? spec.startedAt ?? new Date().toISOString(),
        });

        for (const benchmark of spec.benchmarks) {
            await store.upsertExperimentBenchmark({
                tenant_id: input.tenantId,
                run_id: spec.runId,
                benchmark_family: benchmark.family,
                task_type: benchmark.task_type,
                summary_score: benchmark.pass ? 1 : 0,
                pass_status: benchmark.pass ? 'pass' : 'fail',
                report_payload: toRecord(benchmark),
            });
        }

        if (spec.calibrationInput) {
            await upsertCalibrationEvaluation(store, input.tenantId, spec.runId, spec.calibrationInput, input.actorId);
        }

        if (spec.adversarialInput) {
            await upsertAdversarialEvaluation(store, input.tenantId, spec.runId, spec.adversarialInput, input.actorId);
        }
    }

    await backfillSummaryExperimentRuns(store, input.tenantId, {
        materializeGovernance: true,
    });

    return {
        status: 'materialized',
        run_ids: specs.map((spec) => spec.runId),
    };
}

function buildRunSpecs(result: LearningCycleRunResult): LearningCycleRunSpec[] {
    const diagnosisSpec = result.diagnosis_artifact
        ? buildDiagnosisRunSpec(
            result,
            result.diagnosis_artifact,
            result.diagnosis_metrics,
            result.calibration_report,
            result.adversarial_report,
        )
        : null;
    const severitySpec = result.severity_artifact
        ? buildSeverityRunSpec(
            result,
            result.severity_artifact,
            result.severity_metrics,
            result.adversarial_report,
        )
        : null;

    return [diagnosisSpec, severitySpec].filter((spec): spec is LearningCycleRunSpec => Boolean(spec));
}

function buildDiagnosisRunSpec(
    result: LearningCycleRunResult,
    artifact: DiagnosisModelArtifact,
    metrics: DiagnosisTrainingMetrics | null,
    calibrationReport: CalibrationReport | null,
    adversarialReport: AdversarialEvaluationReport | null,
): LearningCycleRunSpec {
    const benchmarkFamilies = filterBenchmarkFamilies(result.benchmark_summary?.families ?? [], 'clinical_diagnosis');
    const metric = buildDiagnosisMetric(metrics, calibrationReport, adversarialReport);
    const cycleEndedAt = result.cycle.completed_at ?? artifact.trained_at;

    return {
        runId: createLearningCycleRunId(result.cycle.id, 'diagnosis'),
        taskType: 'clinical_diagnosis',
        targetType: 'diagnosis',
        modelArch: artifact.model_name,
        modelVersion: artifact.model_version,
        datasetVersion: artifact.dataset_version,
        featureSchemaVersion: artifact.feature_schema_version,
        labelPolicyVersion: artifact.label_policy_version,
        modelSize: asString(artifact.training_summary.parameter_scale),
        metricPrimaryName: metrics ? 'macro_f1' : null,
        metricPrimaryValue: metrics?.macro_f1 ?? null,
        safetyMetrics: {
            macro_f1: metrics?.macro_f1 ?? null,
            recall_critical: adversarialReport?.emergency_preservation_rate ?? null,
            false_negative_critical_rate: adversarialReport?.emergency_preservation_rate != null
                ? round(1 - adversarialReport.emergency_preservation_rate)
                : null,
            dangerous_false_reassurance_rate: adversarialReport?.dangerous_false_reassurance_rate ?? null,
            abstain_accuracy: adversarialReport?.abstention_correctness ?? null,
            contradiction_detection_rate: adversarialReport?.contradiction_detection_rate ?? null,
            calibration_ece: calibrationReport?.expected_calibration_error ?? null,
            calibration_brier: calibrationReport?.brier_score ?? null,
            val_accuracy: metrics?.accuracy ?? null,
            top_3_accuracy: metrics?.top_3_accuracy ?? null,
        },
        hyperparameters: {},
        datasetLineage: buildDatasetLineage(result),
        configSnapshot: buildConfigSnapshot(result, artifact.model_version),
        registryContext: buildRegistryContext(result, artifact.model_version, 'diagnosis'),
        metric,
        benchmarks: benchmarkFamilies,
        calibrationInput: calibrationReport
            ? {
                ece: calibrationReport.expected_calibration_error,
                brierScore: calibrationReport.brier_score,
                reliabilityBins: calibrationReport.reliability_bins.map((bin) => ({
                    confidence: bin.avg_confidence,
                    accuracy: bin.accuracy,
                    count: bin.count,
                })),
                confidenceHistogram: calibrationReport.confidence_histogram.map((bin) => ({
                    confidence: parseConfidenceBucket(bin.bucket),
                    count: bin.count,
                })),
                calibrationPass: calibrationReport.recommendation.status === 'pass'
                    ? true
                    : calibrationReport.recommendation.status === 'needs_recalibration'
                        ? false
                        : null,
                calibrationNotes: calibrationReport.recommendation.reasons.join(' ') || null,
            }
            : null,
        adversarialInput: adversarialReport ? buildAdversarialInput(adversarialReport) : null,
        startedAt: result.cycle.started_at,
        endedAt: cycleEndedAt,
    };
}

function buildSeverityRunSpec(
    result: LearningCycleRunResult,
    artifact: SeverityModelArtifact,
    metrics: SeverityTrainingMetrics | null,
    adversarialReport: AdversarialEvaluationReport | null,
): LearningCycleRunSpec {
    const benchmarkFamilies = filterBenchmarkFamilies(result.benchmark_summary?.families ?? [], 'severity_prediction');
    const metric = buildSeverityMetric(metrics, adversarialReport);
    const cycleEndedAt = result.cycle.completed_at ?? artifact.trained_at;

    return {
        runId: createLearningCycleRunId(result.cycle.id, 'severity'),
        taskType: 'severity_prediction',
        targetType: 'severity',
        modelArch: artifact.model_name,
        modelVersion: artifact.model_version,
        datasetVersion: artifact.dataset_version,
        featureSchemaVersion: artifact.feature_schema_version,
        labelPolicyVersion: artifact.label_policy_version,
        modelSize: asString(artifact.training_summary.parameter_scale),
        metricPrimaryName: metrics ? 'recall_critical' : null,
        metricPrimaryValue: metrics?.critical_recall ?? null,
        safetyMetrics: {
            val_accuracy: metrics?.emergency_accuracy ?? null,
            recall_critical: metrics?.critical_recall ?? null,
            false_negative_critical_rate: metrics?.emergency_false_negative_rate ?? null,
            dangerous_false_reassurance_rate: adversarialReport?.dangerous_false_reassurance_rate ?? null,
            abstain_accuracy: adversarialReport?.abstention_correctness ?? null,
            contradiction_detection_rate: adversarialReport?.contradiction_detection_rate ?? null,
            critical_recall: metrics?.critical_recall ?? null,
            high_recall: metrics?.high_recall ?? null,
            severity_rmse: metrics?.severity_rmse ?? null,
        },
        hyperparameters: {},
        datasetLineage: buildDatasetLineage(result),
        configSnapshot: buildConfigSnapshot(result, artifact.model_version),
        registryContext: buildRegistryContext(result, artifact.model_version, 'severity'),
        metric,
        benchmarks: benchmarkFamilies,
        calibrationInput: null,
        adversarialInput: adversarialReport ? buildAdversarialInput(adversarialReport) : null,
        startedAt: result.cycle.started_at,
        endedAt: cycleEndedAt,
    };
}

function buildDiagnosisMetric(
    metrics: DiagnosisTrainingMetrics | null,
    calibrationReport: CalibrationReport | null,
    adversarialReport: AdversarialEvaluationReport | null,
): ExperimentMetricInput | null {
    if (!metrics && !calibrationReport && !adversarialReport) {
        return null;
    }

    return {
        epoch: 1,
        global_step: metrics?.support ?? calibrationReport?.support ?? adversarialReport?.support ?? 1,
        val_accuracy: metrics?.accuracy ?? null,
        macro_f1: metrics?.macro_f1 ?? null,
        recall_critical: adversarialReport?.emergency_preservation_rate ?? null,
        calibration_error: calibrationReport?.expected_calibration_error ?? null,
        adversarial_score: adversarialReport?.model_degradation_score ?? null,
        false_negative_critical_rate: adversarialReport?.emergency_preservation_rate != null
            ? round(1 - adversarialReport.emergency_preservation_rate)
            : null,
        dangerous_false_reassurance_rate: adversarialReport?.dangerous_false_reassurance_rate ?? null,
        abstain_accuracy: adversarialReport?.abstention_correctness ?? null,
        contradiction_detection_rate: adversarialReport?.contradiction_detection_rate ?? null,
        metric_timestamp: new Date().toISOString(),
    };
}

function buildSeverityMetric(
    metrics: SeverityTrainingMetrics | null,
    adversarialReport: AdversarialEvaluationReport | null,
): ExperimentMetricInput | null {
    if (!metrics && !adversarialReport) {
        return null;
    }

    return {
        epoch: 1,
        global_step: metrics?.support ?? adversarialReport?.support ?? 1,
        val_accuracy: metrics?.emergency_accuracy ?? null,
        recall_critical: metrics?.critical_recall ?? adversarialReport?.emergency_preservation_rate ?? null,
        adversarial_score: adversarialReport?.model_degradation_score ?? null,
        false_negative_critical_rate: metrics?.emergency_false_negative_rate ?? (
            adversarialReport?.emergency_preservation_rate != null
                ? round(1 - adversarialReport.emergency_preservation_rate)
                : null
        ),
        dangerous_false_reassurance_rate: adversarialReport?.dangerous_false_reassurance_rate ?? null,
        abstain_accuracy: adversarialReport?.abstention_correctness ?? null,
        contradiction_detection_rate: adversarialReport?.contradiction_detection_rate ?? null,
        metric_timestamp: new Date().toISOString(),
    };
}

function buildDatasetLineage(result: LearningCycleRunResult): Record<string, unknown> {
    return {
        learning_cycle_id: result.cycle.id,
        dataset_version: result.dataset_bundle.dataset_version,
        feature_schema_version: result.dataset_bundle.feature_schema_version,
        label_policy_version: result.dataset_bundle.label_policy_version,
        summary: result.dataset_bundle.summary,
        filters: result.dataset_bundle.filters,
        case_count: result.dataset_bundle.case_ids.length,
    };
}

function buildConfigSnapshot(
    result: LearningCycleRunResult,
    modelVersion: string,
): Record<string, unknown> {
    return {
        learning_cycle_id: result.cycle.id,
        learning_cycle_type: result.cycle.cycle_type,
        trigger_mode: result.cycle.trigger_mode,
        dataset_version: result.dataset_bundle.dataset_version,
        candidate_model_version: modelVersion,
        benchmark_summary: result.benchmark_summary ? toRecord(result.benchmark_summary) : {},
        adversarial_report: result.adversarial_report ? toRecord(result.adversarial_report) : {},
        selection_decision: result.selection_decision ? toRecord(result.selection_decision) : {},
    };
}

function buildRegistryContext(
    result: LearningCycleRunResult,
    modelVersion: string,
    taskType: 'diagnosis' | 'severity',
): Record<string, unknown> {
    const registeredModel = result.registered_models.find((entry) => entry.task_type === taskType) ?? null;
    return {
        learning_cycle_id: result.cycle.id,
        learning_cycle_type: result.cycle.cycle_type,
        trigger_mode: result.cycle.trigger_mode,
        candidate_model_version: modelVersion,
        selection_decision: result.selection_decision?.decision ?? null,
        selection_reasons: result.selection_decision?.reasons ?? [],
        registry_candidate_id: registeredModel?.id ?? null,
        promotion_status: registeredModel?.promotion_status ?? null,
        is_champion: registeredModel?.is_champion ?? false,
    };
}

function filterBenchmarkFamilies(
    families: BenchmarkFamilyReport[],
    taskType: ExperimentTaskType,
): BenchmarkFamilyReport[] {
    return families.filter((family) => {
        if (family.task_type === 'safety') return true;
        if (taskType === 'clinical_diagnosis') return family.task_type === 'diagnosis';
        if (taskType === 'severity_prediction') return family.task_type === 'severity';
        return false;
    });
}

function buildAdversarialInput(
    report: AdversarialEvaluationReport,
): AdversarialInput {
    return {
        degradationScore: report.model_degradation_score,
        contradictionRobustness: report.contradiction_detection_rate,
        criticalCaseRecall: report.emergency_preservation_rate,
        dangerousFalseReassuranceRate: report.dangerous_false_reassurance_rate,
        adversarialPass: report.pass,
    };
}

function createLearningCycleRunId(
    cycleId: string,
    suffix: 'diagnosis' | 'severity',
): string {
    return `learning_cycle_${suffix}_${cycleId}`;
}

function parseConfidenceBucket(bucket: string): number {
    const [lowerBound, upperBound] = bucket.split('-').map((value) => Number(value));
    if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) {
        return 0;
    }
    return round(((lowerBound + upperBound) / 2) / 100);
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function round(value: number): number {
    return Number(value.toFixed(4));
}

function toRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}
