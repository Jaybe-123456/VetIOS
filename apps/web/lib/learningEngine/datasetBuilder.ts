import { createHash } from 'crypto';
import { resolveCalibrationEligibility, resolveDiagnosisLabel, resolveSeverityLabel, type LabelResolverConfig } from '@/lib/learningEngine/labelResolver';
import { vectorizeClinicalCase } from '@/lib/learningEngine/featureStore';
import {
    DEFAULT_FEATURE_SCHEMA_VERSION,
    DEFAULT_LABEL_POLICY_VERSION,
    type AdversarialBenchmarkRow,
    type CalibrationEvalRow,
    type DatasetBuildSummary,
    type DiagnosisTrainingRow,
    type LearningCaseRecord,
    type LearningDatasetBundle,
    type LearningDatasetFilters,
    type LearningEngineStore,
    type LearningInferenceEvent,
    type LearningOutcomeEvent,
    type LearningSimulationEvent,
    type QuarantineRow,
    type SeverityTrainingRow,
} from '@/lib/learningEngine/types';

export interface DatasetBuilderConfig extends LearningDatasetFilters {
    labelResolver?: LabelResolverConfig;
    featureSchemaVersion?: string;
    labelPolicyVersion?: string;
}

export async function buildLearningDatasetBundle(
    store: LearningEngineStore,
    config: DatasetBuilderConfig,
): Promise<LearningDatasetBundle> {
    const [clinicalCases, inferenceEvents, outcomeEvents, simulationEvents] = await Promise.all([
        store.listClinicalCases(config),
        store.listInferenceEvents(config),
        store.listOutcomeEvents(config),
        store.listSimulationEvents(config),
    ]);

    const inferenceByCase = indexByCaseId(inferenceEvents);
    const outcomeByCase = indexByCaseId(outcomeEvents);
    const simulationByCase = indexByCaseId(simulationEvents);

    const diagnosisTrainingSet: DiagnosisTrainingRow[] = [];
    const severityTrainingSet: SeverityTrainingRow[] = [];
    const calibrationEvalSet: CalibrationEvalRow[] = [];
    const adversarialBenchmarkSet: AdversarialBenchmarkRow[] = [];
    const quarantineSet: QuarantineRow[] = [];

    const labelComposition: Record<string, number> = {};
    const excludedCounts: Record<string, number> = {
        invalid_case: 0,
        unresolved_diagnosis: 0,
        unresolved_severity: 0,
        calibration_ineligible: 0,
        adversarial_excluded: 0,
    };

    for (const clinicalCase of clinicalCases) {
        if (clinicalCase.invalid_case || clinicalCase.ingestion_status !== 'accepted') {
            quarantineSet.push({
                case_id: clinicalCase.case_id,
                tenant_id: clinicalCase.tenant_id,
                invalid_case: clinicalCase.invalid_case,
                ingestion_status: clinicalCase.ingestion_status,
                validation_error_code: clinicalCase.validation_error_code,
                species_canonical: clinicalCase.species_canonical,
                symptom_text_raw: clinicalCase.symptom_text_raw,
                created_at: clinicalCase.created_at,
            });
            excludedCounts.invalid_case += 1;
            continue;
        }

        const featureVector = vectorizeClinicalCase(
            clinicalCase,
            config.featureSchemaVersion ?? DEFAULT_FEATURE_SCHEMA_VERSION,
        );
        const diagnosisLabel = resolveDiagnosisLabel(clinicalCase, config.labelResolver);
        if (diagnosisLabel.trusted && diagnosisLabel.resolvedLabel && diagnosisLabel.labelType) {
            diagnosisTrainingSet.push({
                case_id: clinicalCase.case_id,
                tenant_id: clinicalCase.tenant_id,
                species_canonical: clinicalCase.species_canonical,
                breed: clinicalCase.breed,
                case_cluster: clinicalCase.case_cluster,
                feature_vector: featureVector,
                confirmed_diagnosis: diagnosisLabel.resolvedLabel,
                primary_condition_class: clinicalCase.primary_condition_class,
                label_type: diagnosisLabel.labelType,
                label_weight: diagnosisLabel.labelWeight,
                contradiction_score: clinicalCase.contradiction_score,
                contradiction_flags: clinicalCase.contradiction_flags,
                adversarial_case: clinicalCase.adversarial_case,
                model_version: clinicalCase.model_version,
                created_at: clinicalCase.created_at,
            });
            labelComposition[diagnosisLabel.labelType] = (labelComposition[diagnosisLabel.labelType] ?? 0) + 1;
        } else {
            excludedCounts.unresolved_diagnosis += 1;
        }

        const severityLabel = resolveSeverityLabel(clinicalCase, config.labelResolver);
        if (severityLabel) {
            severityTrainingSet.push({
                case_id: clinicalCase.case_id,
                tenant_id: clinicalCase.tenant_id,
                species_canonical: clinicalCase.species_canonical,
                breed: clinicalCase.breed,
                feature_vector: featureVector,
                severity_score: severityLabel.severity_score,
                emergency_level: severityLabel.emergency_level,
                triage_priority: severityLabel.triage_priority,
                label_type: severityLabel.label_type,
                label_weight: severityLabel.label_weight,
                contradiction_score: clinicalCase.contradiction_score,
                adversarial_case: clinicalCase.adversarial_case,
                created_at: clinicalCase.created_at,
            });
        } else {
            excludedCounts.unresolved_severity += 1;
        }

        const calibrationEligibility = resolveCalibrationEligibility(clinicalCase);
        if (calibrationEligibility) {
            calibrationEvalSet.push({
                case_id: clinicalCase.case_id,
                tenant_id: clinicalCase.tenant_id,
                model_version: clinicalCase.model_version,
                case_cluster: clinicalCase.case_cluster,
                species_canonical: clinicalCase.species_canonical,
                created_at: clinicalCase.created_at,
                ...calibrationEligibility,
            });
        } else {
            excludedCounts.calibration_ineligible += 1;
        }

        if (clinicalCase.adversarial_case) {
            if (config.includeAdversarial === false) {
                excludedCounts.adversarial_excluded += 1;
            } else {
                adversarialBenchmarkSet.push(buildAdversarialRow(
                    clinicalCase,
                    featureVector,
                    inferenceByCase.get(clinicalCase.case_id) ?? [],
                    outcomeByCase.get(clinicalCase.case_id) ?? [],
                    simulationByCase.get(clinicalCase.case_id) ?? [],
                ));
            }
        }
    }

    const datasetVersion = buildDatasetVersion({
        tenantId: config.tenantId,
        featureSchemaVersion: config.featureSchemaVersion ?? DEFAULT_FEATURE_SCHEMA_VERSION,
        labelPolicyVersion: config.labelPolicyVersion ?? DEFAULT_LABEL_POLICY_VERSION,
        caseIds: clinicalCases.map((clinicalCase) => clinicalCase.case_id),
        summary: {
            diagnosis_training_cases: diagnosisTrainingSet.length,
            severity_training_cases: severityTrainingSet.length,
            calibration_eval_cases: calibrationEvalSet.length,
            adversarial_cases: adversarialBenchmarkSet.length,
            quarantined_cases: quarantineSet.length,
        },
    });

    const summary: DatasetBuildSummary = {
        total_cases: clinicalCases.length,
        diagnosis_training_cases: diagnosisTrainingSet.length,
        severity_training_cases: severityTrainingSet.length,
        calibration_eval_cases: calibrationEvalSet.length,
        adversarial_cases: adversarialBenchmarkSet.length,
        quarantined_cases: quarantineSet.length,
        label_composition: labelComposition,
        excluded_counts: excludedCounts,
    };

    return {
        diagnosis_training_set: diagnosisTrainingSet,
        severity_training_set: severityTrainingSet,
        calibration_eval_set: calibrationEvalSet,
        adversarial_benchmark_set: adversarialBenchmarkSet,
        quarantine_set: quarantineSet,
        summary,
        dataset_version: datasetVersion,
        feature_schema_version: config.featureSchemaVersion ?? DEFAULT_FEATURE_SCHEMA_VERSION,
        label_policy_version: config.labelPolicyVersion ?? DEFAULT_LABEL_POLICY_VERSION,
        filters: config,
        case_ids: clinicalCases.map((clinicalCase) => clinicalCase.case_id),
    };
}

function buildAdversarialRow(
    clinicalCase: LearningCaseRecord,
    featureVector: ReturnType<typeof vectorizeClinicalCase>,
    inferenceEvents: LearningInferenceEvent[],
    outcomeEvents: LearningOutcomeEvent[],
    simulationEvents: LearningSimulationEvent[],
): AdversarialBenchmarkRow {
    const latestInference = inferenceEvents[0] ?? null;
    const latestOutcome = outcomeEvents[0] ?? null;
    const latestSimulation = simulationEvents[0] ?? null;
    const targetBiasEval = latestSimulation?.stress_metrics &&
        typeof latestSimulation.stress_metrics.target_evaluation === 'object' &&
        latestSimulation.stress_metrics.target_evaluation !== null &&
        !Array.isArray(latestSimulation.stress_metrics.target_evaluation)
        ? latestSimulation.stress_metrics.target_evaluation as Record<string, unknown>
        : null;

    return {
        case_id: clinicalCase.case_id,
        tenant_id: clinicalCase.tenant_id,
        feature_vector: featureVector,
        perturbation_metadata: {
            simulation_type: latestSimulation?.simulation_type ?? clinicalCase.adversarial_case_type,
            failure_mode: latestSimulation?.failure_mode ?? null,
            simulation_parameters: latestSimulation?.simulation_parameters ?? {},
        },
        contradiction_score: clinicalCase.contradiction_score ?? 0,
        contradiction_flags: clinicalCase.contradiction_flags,
        adversarial_case_type: clinicalCase.adversarial_case_type,
        degraded_confidence: clinicalCase.degraded_confidence,
        baseline_confidence: latestInference?.confidence_score ?? clinicalCase.diagnosis_confidence,
        differential_spread: clinicalCase.differential_spread,
        target_bias_eval: targetBiasEval,
        top_diagnosis: clinicalCase.top_diagnosis,
        confirmed_diagnosis: clinicalCase.confirmed_diagnosis ?? readText(latestOutcome?.outcome_payload?.confirmed_diagnosis) ?? null,
        primary_condition_class: clinicalCase.primary_condition_class,
        emergency_level: clinicalCase.emergency_level,
        created_at: clinicalCase.created_at,
    };
}

function buildDatasetVersion(input: {
    tenantId: string;
    featureSchemaVersion: string;
    labelPolicyVersion: string;
    caseIds: string[];
    summary: Record<string, unknown>;
}): string {
    const hash = createHash('sha1')
        .update(JSON.stringify({
            tenant_id: input.tenantId,
            feature_schema_version: input.featureSchemaVersion,
            label_policy_version: input.labelPolicyVersion,
            case_ids: [...input.caseIds].sort(),
            summary: input.summary,
        }))
        .digest('hex')
        .slice(0, 12);

    return `ldv_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${hash}`;
}

function indexByCaseId<T extends { case_id: string | null; created_at: string }>(rows: T[]): Map<string, T[]> {
    const indexed = new Map<string, T[]>();

    for (const row of rows) {
        if (!row.case_id) continue;
        const bucket = indexed.get(row.case_id) ?? [];
        bucket.push(row);
        indexed.set(row.case_id, bucket);
    }

    for (const bucket of indexed.values()) {
        bucket.sort((left, right) => right.created_at.localeCompare(left.created_at));
    }

    return indexed;
}

function readText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}
