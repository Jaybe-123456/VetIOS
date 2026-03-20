import { logLearningAuditEvent, logLearningDatasetSnapshot, logLearningPromotionDecision } from '@/lib/learningEngine/auditLogger';
import { runAdversarialEvaluation } from '@/lib/learningEngine/adversarialEvalRunner';
import { runBenchmarkSuite } from '@/lib/learningEngine/benchmarkRunner';
import { buildCalibrationReport } from '@/lib/learningEngine/calibrationEngine';
import { buildLearningDatasetBundle, type DatasetBuilderConfig } from '@/lib/learningEngine/datasetBuilder';
import { trainDiagnosisModel } from '@/lib/learningEngine/diagnosisTrainer';
import { trainSeverityModel } from '@/lib/learningEngine/severityTrainer';
import { seedDefaultLearningSchedulerJobs } from '@/lib/learningEngine/learningScheduler';
import { registerCandidateModels, applyPromotionDecisionToRegistry, decodeDiagnosisArtifact, decodeSeverityArtifact, getChampionRegistryEntries } from '@/lib/learningEngine/modelRegistryConnector';
import { selectChampionChallengerDecision } from '@/lib/learningEngine/modelSelector';
import {
    DEFAULT_FEATURE_SCHEMA_VERSION,
    DEFAULT_LABEL_POLICY_VERSION,
    type LearningDatasetKind,
    type LearningCycleRunResult,
    type LearningCycleType,
    type LearningEngineStore,
} from '@/lib/learningEngine/types';

export interface RunLearningCycleInput {
    tenantId: string;
    cycleType: LearningCycleType;
    triggerMode: 'scheduled' | 'manual' | 'dry_run';
    requestPayload?: Record<string, unknown>;
    datasetFilters?: Partial<DatasetBuilderConfig>;
}

export async function runLearningCycle(
    store: LearningEngineStore,
    input: RunLearningCycleInput,
): Promise<LearningCycleRunResult> {
    await seedDefaultLearningSchedulerJobs(store, input.tenantId);

    const cycle = await store.createLearningCycle({
        tenant_id: input.tenantId,
        cycle_type: input.cycleType,
        trigger_mode: input.triggerMode,
        status: 'running',
        request_payload: input.requestPayload ?? {},
        summary: {},
        started_at: new Date().toISOString(),
        completed_at: null,
    });

    try {
        const datasetBundle = await buildLearningDatasetBundle(store, {
            tenantId: input.tenantId,
            includeAdversarial: true,
            includeSynthetic: true,
            includeQuarantine: true,
            featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
            labelPolicyVersion: DEFAULT_LABEL_POLICY_VERSION,
            ...input.datasetFilters,
        });

        await persistDatasetVersions(store, input.tenantId, datasetBundle);
        await logLearningDatasetSnapshot(store, {
            tenantId: input.tenantId,
            learningCycleId: cycle.id,
            datasetVersion: datasetBundle.dataset_version,
            summary: toJsonValue(datasetBundle.summary) as Record<string, unknown>,
            filters: toJsonValue(datasetBundle.filters) as Record<string, unknown>,
        });

        const shouldTrain = input.cycleType === 'weekly_candidate_training' ||
            input.cycleType === 'weekly_benchmark_run' ||
            input.cycleType === 'manual_review' ||
            input.triggerMode === 'dry_run';

        const diagnosisRun = shouldTrain && datasetBundle.diagnosis_training_set.length > 0
            ? trainDiagnosisModel(datasetBundle.diagnosis_training_set, {
                datasetVersion: datasetBundle.dataset_version,
                featureSchemaVersion: datasetBundle.feature_schema_version,
                labelPolicyVersion: datasetBundle.label_policy_version,
            })
            : null;
        const severityRun = shouldTrain && datasetBundle.severity_training_set.length > 0
            ? trainSeverityModel(datasetBundle.severity_training_set, {
                datasetVersion: datasetBundle.dataset_version,
                featureSchemaVersion: datasetBundle.feature_schema_version,
                labelPolicyVersion: datasetBundle.label_policy_version,
            })
            : null;

        const candidateModelVersion = diagnosisRun?.artifact.model_version ??
            severityRun?.artifact.model_version ??
            `${input.cycleType}_${datasetBundle.dataset_version}`;
        const calibrationReport = buildCalibrationReport(datasetBundle.calibration_eval_set, 'diagnosis');
        const benchmarkSummary = shouldTrain
            ? runBenchmarkSuite(datasetBundle, {
                diagnosis: diagnosisRun?.artifact ?? null,
                severity: severityRun?.artifact ?? null,
                candidateModelVersion,
            })
            : null;
        const adversarialReport = shouldTrain
            ? runAdversarialEvaluation(datasetBundle.adversarial_benchmark_set, {
                diagnosis: diagnosisRun?.artifact ?? null,
                severity: severityRun?.artifact ?? null,
                candidateModelVersion,
            })
            : null;

        const championEntries = await getChampionRegistryEntries(store, input.tenantId);
        const championBenchmark = await evaluateChampionBenchmark(store, input.tenantId, datasetBundle, championEntries);
        const championAdversarial = await evaluateChampionAdversarial(datasetBundle, championEntries);

        const selectionDecision = benchmarkSummary
            ? selectChampionChallengerDecision({
                candidateModelVersion,
                championModelVersion: championEntries.diagnosis?.model_version ?? championEntries.severity?.model_version ?? null,
                candidateBenchmark: benchmarkSummary,
                championBenchmark,
                candidateAdversarial: adversarialReport,
                championAdversarial,
            })
            : null;

        let registeredModels = [] as Awaited<ReturnType<typeof registerCandidateModels>>;
        if (input.triggerMode !== 'dry_run' && shouldTrain) {
            registeredModels = await registerCandidateModels(store, {
                tenantId: input.tenantId,
                diagnosisArtifact: diagnosisRun?.artifact ?? null,
                severityArtifact: severityRun?.artifact ?? null,
                benchmarkSummary,
                featureSchemaVersion: datasetBundle.feature_schema_version,
                labelPolicyVersion: datasetBundle.label_policy_version,
            });
            await persistReports(store, {
                tenantId: input.tenantId,
                learningCycleId: cycle.id,
                benchmarkSummary,
                calibrationReport,
                registeredModels,
            });
            if (selectionDecision) {
                registeredModels = await applyPromotionDecisionToRegistry(
                    store,
                    input.tenantId,
                    registeredModels,
                    selectionDecision.decision,
                );
                await logLearningPromotionDecision(store, {
                    tenantId: input.tenantId,
                    learningCycleId: cycle.id,
                    candidateModelVersion: selectionDecision.candidate_model,
                    championModelVersion: selectionDecision.champion_model,
                    decision: selectionDecision.decision,
                    reasons: selectionDecision.reasons,
                });
            }
        }

        const completedCycle = await store.updateLearningCycle(cycle.id, input.tenantId, {
            status: 'completed',
            completed_at: new Date().toISOString(),
            summary: {
                dataset_version: datasetBundle.dataset_version,
                diagnosis_rows: datasetBundle.diagnosis_training_set.length,
                severity_rows: datasetBundle.severity_training_set.length,
                calibration_rows: datasetBundle.calibration_eval_set.length,
                adversarial_rows: datasetBundle.adversarial_benchmark_set.length,
                candidate_model_version: candidateModelVersion,
                benchmark_pass: benchmarkSummary?.pass ?? null,
                adversarial_pass: adversarialReport?.pass ?? null,
                decision: selectionDecision?.decision ?? null,
            },
        });

        await logLearningAuditEvent(store, {
            tenantId: input.tenantId,
            learningCycleId: completedCycle.id,
            eventType: 'learning_cycle_completed',
            payload: completedCycle.summary,
        });

        return {
            cycle: completedCycle,
            dataset_bundle: datasetBundle,
            diagnosis_artifact: diagnosisRun?.artifact ?? null,
            diagnosis_metrics: diagnosisRun?.metrics ?? null,
            severity_artifact: severityRun?.artifact ?? null,
            severity_metrics: severityRun?.metrics ?? null,
            calibration_report: calibrationReport,
            benchmark_summary: benchmarkSummary,
            adversarial_report: adversarialReport,
            selection_decision: selectionDecision,
            registered_models: registeredModels,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown learning engine error';
        await store.updateLearningCycle(cycle.id, input.tenantId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            summary: {
                error: message,
            },
        });
        await logLearningAuditEvent(store, {
            tenantId: input.tenantId,
            learningCycleId: cycle.id,
            eventType: 'learning_cycle_failed',
            payload: { error: message },
        });
        throw error;
    }
}

async function persistDatasetVersions(
    store: LearningEngineStore,
    tenantId: string,
    datasetBundle: Awaited<ReturnType<typeof buildLearningDatasetBundle>>,
) {
    const datasets: Array<[LearningDatasetKind, Array<Record<string, unknown>>]> = [
        ['diagnosis_training_set', datasetBundle.diagnosis_training_set.map((row) => toRecord(row))],
        ['severity_training_set', datasetBundle.severity_training_set.map((row) => toRecord(row))],
        ['calibration_eval_set', datasetBundle.calibration_eval_set.map((row) => toRecord(row))],
        ['adversarial_benchmark_set', datasetBundle.adversarial_benchmark_set.map((row) => toRecord(row))],
        ['quarantine_set', datasetBundle.quarantine_set.map((row) => toRecord(row))],
    ];

    await Promise.all(datasets.map(async ([datasetKind, rows]) => {
        await store.createDatasetVersion({
            tenant_id: tenantId,
            dataset_version: datasetBundle.dataset_version,
            dataset_kind: datasetKind,
            feature_schema_version: datasetBundle.feature_schema_version,
            label_policy_version: datasetBundle.label_policy_version,
            row_count: rows.length,
            case_ids: datasetBundle.case_ids,
            filters: toRecord(datasetBundle.filters),
            summary: toRecord(datasetBundle.summary),
            dataset_rows: rows,
        });
    }));
}

async function persistReports(
    store: LearningEngineStore,
    input: {
        tenantId: string;
        learningCycleId: string;
        benchmarkSummary: ReturnType<typeof runBenchmarkSuite> | null;
        calibrationReport: ReturnType<typeof buildCalibrationReport> | null;
        registeredModels: Awaited<ReturnType<typeof registerCandidateModels>>;
    },
) {
    const diagnosisRegistry = input.registeredModels.find((entry) => entry.task_type === 'diagnosis') ?? null;
    const severityRegistry = input.registeredModels.find((entry) => entry.task_type === 'severity') ?? null;

    if (input.calibrationReport && diagnosisRegistry) {
        const calibrationRecord = await store.createCalibrationReport({
            tenant_id: input.tenantId,
            learning_cycle_id: input.learningCycleId,
            model_registry_id: diagnosisRegistry.id,
            task_type: input.calibrationReport.task_type,
            report_payload: toRecord(input.calibrationReport),
            brier_score: input.calibrationReport.brier_score,
            ece_score: input.calibrationReport.expected_calibration_error,
        });
        await store.updateModelRegistryEntry(diagnosisRegistry.id, input.tenantId, {
            calibration_report_id: calibrationRecord.id,
        });
    }

    if (!input.benchmarkSummary) return;

    for (const family of input.benchmarkSummary.families) {
        const modelRegistryId = family.task_type === 'severity'
            ? severityRegistry?.id ?? diagnosisRegistry?.id ?? null
            : diagnosisRegistry?.id ?? severityRegistry?.id ?? null;
        await store.createBenchmarkReport({
            tenant_id: input.tenantId,
            learning_cycle_id: input.learningCycleId,
            model_registry_id: modelRegistryId,
            benchmark_family: family.family,
            task_type: family.task_type,
            report_payload: toRecord(family),
            summary_score: family.pass ? 1 : 0,
            pass_status: family.pass ? 'pass' : 'fail',
        });
    }
}

async function evaluateChampionBenchmark(
    store: LearningEngineStore,
    tenantId: string,
    datasetBundle: Awaited<ReturnType<typeof buildLearningDatasetBundle>>,
    champions: Awaited<ReturnType<typeof getChampionRegistryEntries>>,
) {
    const diagnosisArtifact = decodeDiagnosisArtifact(champions.diagnosis?.artifact_payload ?? null);
    const severityArtifact = decodeSeverityArtifact(champions.severity?.artifact_payload ?? null);
    if (!diagnosisArtifact && !severityArtifact) {
        return null;
    }

    return runBenchmarkSuite(datasetBundle, {
        diagnosis: diagnosisArtifact,
        severity: severityArtifact,
        candidateModelVersion: champions.diagnosis?.model_version ?? champions.severity?.model_version ?? `champion_${tenantId}`,
    });
}

async function evaluateChampionAdversarial(
    datasetBundle: Awaited<ReturnType<typeof buildLearningDatasetBundle>>,
    champions: Awaited<ReturnType<typeof getChampionRegistryEntries>>,
) {
    const diagnosisArtifact = decodeDiagnosisArtifact(champions.diagnosis?.artifact_payload ?? null);
    const severityArtifact = decodeSeverityArtifact(champions.severity?.artifact_payload ?? null);
    if (!diagnosisArtifact && !severityArtifact) {
        return null;
    }

    return runAdversarialEvaluation(datasetBundle.adversarial_benchmark_set, {
        diagnosis: diagnosisArtifact,
        severity: severityArtifact,
        candidateModelVersion: champions.diagnosis?.model_version ?? champions.severity?.model_version ?? 'champion',
    });
}

function toRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    throw new Error('Expected a JSON object payload for persistence.');
}

function toJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => toJsonValue(entry));
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toJsonValue(entry)]),
        );
    }
    return value;
}
