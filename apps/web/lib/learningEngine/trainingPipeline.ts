import { logLearningAuditEvent } from '@/lib/learningEngine/auditLogger';
import { buildLearningDatasetBundle, type DatasetBuilderConfig } from '@/lib/learningEngine/datasetBuilder';
import { runLearningCycle, type RunLearningCycleInput } from '@/lib/learningEngine/engine';
import {
    DEFAULT_FEATURE_SCHEMA_VERSION,
    DEFAULT_LABEL_POLICY_VERSION,
    type LearningCycleRunResult,
    type LearningDatasetBundle,
    type LearningEngineStore,
    type SupportedLabelType,
} from '@/lib/learningEngine/types';

export const TRUSTED_TRAINING_LABEL_TYPES = ['expert_reviewed', 'lab_confirmed'] as const satisfies SupportedLabelType[];

export interface TrainingPipelineMinimums {
    minimum_diagnosis_rows: number;
    minimum_severity_rows: number;
    minimum_calibration_rows: number;
    minimum_unique_diagnoses: number;
    minimum_lab_confirmed_rows: number;
    maximum_synthetic_rows: number;
}

export interface TrainingPipelineReadiness {
    ready: boolean;
    blockers: string[];
    warnings: string[];
    counts: {
        diagnosis_rows: number;
        severity_rows: number;
        calibration_rows: number;
        unique_diagnoses: number;
        expert_reviewed_rows: number;
        lab_confirmed_rows: number;
        synthetic_rows: number;
        untrusted_label_rows: number;
    };
    minimums: TrainingPipelineMinimums;
    policy: {
        trusted_label_types: SupportedLabelType[];
        include_synthetic: false;
        vvrb_allowed_for_training: false;
    };
}

export interface GovernedTrainingPipelineInput extends Omit<RunLearningCycleInput, 'cycleType' | 'datasetFilters'> {
    cycleType?: RunLearningCycleInput['cycleType'];
    datasetFilters?: Partial<DatasetBuilderConfig>;
    minimums?: Partial<TrainingPipelineMinimums>;
}

export interface GovernedTrainingPipelineResult {
    readiness: TrainingPipelineReadiness;
    dataset_bundle: LearningDatasetBundle;
    learning_cycle: LearningCycleRunResult | null;
}

export const DEFAULT_TRAINING_PIPELINE_MINIMUMS: TrainingPipelineMinimums = {
    minimum_diagnosis_rows: 100,
    minimum_severity_rows: 50,
    minimum_calibration_rows: 30,
    minimum_unique_diagnoses: 8,
    minimum_lab_confirmed_rows: 10,
    maximum_synthetic_rows: 0,
};

export function buildGovernedTrainingDatasetConfig(
    tenantId: string,
    overrides: Partial<DatasetBuilderConfig> = {},
): DatasetBuilderConfig {
    const {
        includeSynthetic: _includeSynthetic,
        labelTypes,
        labelResolver,
        ...safeOverrides
    } = overrides;

    return {
        tenantId,
        includeAdversarial: true,
        includeQuarantine: false,
        featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
        labelPolicyVersion: `${DEFAULT_LABEL_POLICY_VERSION}:governed-real-labels`,
        ...safeOverrides,
        includeSynthetic: false,
        labelTypes: restrictToTrustedLabelTypes(labelTypes),
        labelResolver: {
            ...(labelResolver ?? {}),
            allowSynthetic: false,
            allowInferredForSeverity: false,
        },
    };
}

export function evaluateTrainingPipelineReadiness(
    datasetBundle: LearningDatasetBundle,
    minimumOverrides: Partial<TrainingPipelineMinimums> = {},
): TrainingPipelineReadiness {
    const minimums = { ...DEFAULT_TRAINING_PIPELINE_MINIMUMS, ...minimumOverrides };
    const diagnosisLabels = new Set(datasetBundle.diagnosis_training_set.map((row) => row.confirmed_diagnosis));
    const allLabelRows = [
        ...datasetBundle.diagnosis_training_set.map((row) => row.label_type),
        ...datasetBundle.severity_training_set.map((row) => row.label_type),
        ...datasetBundle.calibration_eval_set.map((row) => row.label_type),
    ];
    const syntheticRows = allLabelRows.filter((labelType) => labelType === 'synthetic').length;
    const untrustedLabelRows = allLabelRows.filter((labelType) => !isTrustedTrainingLabelType(labelType)).length;
    const expertReviewedRows = datasetBundle.diagnosis_training_set.filter((row) => row.label_type === 'expert_reviewed').length;
    const labConfirmedRows = datasetBundle.diagnosis_training_set.filter((row) => row.label_type === 'lab_confirmed').length;
    const blockers = [
        datasetBundle.filters.includeSynthetic === true ? 'synthetic_filter_enabled' : null,
        datasetBundle.label_policy_version.includes('vvrb') ? 'vvrb_benchmark_policy_cannot_train' : null,
        syntheticRows > minimums.maximum_synthetic_rows ? 'synthetic_rows_present' : null,
        untrustedLabelRows > 0 ? 'untrusted_label_rows_present' : null,
        datasetBundle.diagnosis_training_set.length < minimums.minimum_diagnosis_rows ? 'diagnosis_rows_below_minimum' : null,
        datasetBundle.severity_training_set.length < minimums.minimum_severity_rows ? 'severity_rows_below_minimum' : null,
        datasetBundle.calibration_eval_set.length < minimums.minimum_calibration_rows ? 'calibration_rows_below_minimum' : null,
        diagnosisLabels.size < minimums.minimum_unique_diagnoses ? 'diagnosis_diversity_below_minimum' : null,
        labConfirmedRows < minimums.minimum_lab_confirmed_rows ? 'lab_confirmed_rows_below_minimum' : null,
    ].filter(isString);
    const warnings = [
        expertReviewedRows > 0 && labConfirmedRows === 0 ? 'expert_reviewed_only_no_lab_confirmed_labels' : null,
        datasetBundle.adversarial_benchmark_set.length === 0 ? 'no_adversarial_benchmark_rows' : null,
        datasetBundle.summary.quarantined_cases > 0 ? 'quarantined_cases_present_in_source_window' : null,
    ].filter(isString);

    return {
        ready: blockers.length === 0,
        blockers,
        warnings,
        counts: {
            diagnosis_rows: datasetBundle.diagnosis_training_set.length,
            severity_rows: datasetBundle.severity_training_set.length,
            calibration_rows: datasetBundle.calibration_eval_set.length,
            unique_diagnoses: diagnosisLabels.size,
            expert_reviewed_rows: expertReviewedRows,
            lab_confirmed_rows: labConfirmedRows,
            synthetic_rows: syntheticRows,
            untrusted_label_rows: untrustedLabelRows,
        },
        minimums,
        policy: {
            trusted_label_types: [...TRUSTED_TRAINING_LABEL_TYPES],
            include_synthetic: false,
            vvrb_allowed_for_training: false,
        },
    };
}

export async function runGovernedTrainingPipeline(
    store: LearningEngineStore,
    input: GovernedTrainingPipelineInput,
): Promise<GovernedTrainingPipelineResult> {
    const datasetFilters = buildGovernedTrainingDatasetConfig(input.tenantId, input.datasetFilters);
    const datasetBundle = await buildLearningDatasetBundle(store, datasetFilters);
    const readiness = evaluateTrainingPipelineReadiness(datasetBundle, input.minimums);

    await logLearningAuditEvent(store, {
        tenantId: input.tenantId,
        eventType: readiness.ready ? 'training_pipeline_ready' : 'training_pipeline_blocked',
        payload: {
            readiness,
            dataset_version: datasetBundle.dataset_version,
            trigger_mode: input.triggerMode,
            request_payload: input.requestPayload ?? {},
        },
    });

    if (!readiness.ready || input.triggerMode === 'dry_run') {
        return {
            readiness,
            dataset_bundle: datasetBundle,
            learning_cycle: null,
        };
    }

    const learningCycle = await runLearningCycle(store, {
        tenantId: input.tenantId,
        cycleType: input.cycleType ?? 'weekly_candidate_training',
        triggerMode: input.triggerMode,
        requestPayload: {
            ...(input.requestPayload ?? {}),
            governed_training_readiness: readiness,
        },
        datasetFilters,
    });

    return {
        readiness,
        dataset_bundle: datasetBundle,
        learning_cycle: learningCycle,
    };
}

function restrictToTrustedLabelTypes(labelTypes: SupportedLabelType[] | null | undefined): SupportedLabelType[] {
    if (!labelTypes || labelTypes.length === 0) return [...TRUSTED_TRAINING_LABEL_TYPES];
    return labelTypes.filter(isTrustedTrainingLabelType);
}

function isTrustedTrainingLabelType(value: SupportedLabelType | null): value is typeof TRUSTED_TRAINING_LABEL_TYPES[number] {
    return value === 'expert_reviewed' || value === 'lab_confirmed';
}

function isString(value: string | null): value is string {
    return value != null;
}
