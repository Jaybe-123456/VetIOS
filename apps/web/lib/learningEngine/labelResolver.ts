import {
    DEFAULT_LABEL_TRUST,
    type CalibrationEvalRow,
    type LabelResolutionResult,
    type LearningCaseRecord,
    type SeverityTrainingRow,
    type SupportedLabelType,
} from '@/lib/learningEngine/types';

export interface LabelResolverConfig {
    allowSynthetic?: boolean;
    allowInferredForSeverity?: boolean;
    trustWeights?: Partial<typeof DEFAULT_LABEL_TRUST>;
}

export function resolveDiagnosisLabel(
    clinicalCase: LearningCaseRecord,
    config: LabelResolverConfig = {},
): LabelResolutionResult {
    const labelType = normalizeLabelType(clinicalCase.label_type);
    const trustWeights = { ...DEFAULT_LABEL_TRUST, ...(config.trustWeights ?? {}) };
    const reasons: string[] = [];

    if (!clinicalCase.confirmed_diagnosis) {
        reasons.push('missing_confirmed_diagnosis');
        return {
            resolvedLabel: null,
            labelType,
            labelWeight: 0,
            trusted: false,
            reasons,
        };
    }

    if (labelType === 'inferred_only') {
        reasons.push('inferred_only_not_allowed_for_supervised_diagnosis');
        return {
            resolvedLabel: null,
            labelType,
            labelWeight: 0,
            trusted: false,
            reasons,
        };
    }

    if (labelType === 'synthetic' && config.allowSynthetic === false) {
        reasons.push('synthetic_labels_disabled');
        return {
            resolvedLabel: null,
            labelType,
            labelWeight: 0,
            trusted: false,
            reasons,
        };
    }

    return {
        resolvedLabel: clinicalCase.confirmed_diagnosis,
        labelType,
        labelWeight: trustWeights[labelType],
        trusted: true,
        reasons,
    };
}

export function resolveSeverityLabel(
    clinicalCase: LearningCaseRecord,
    config: LabelResolverConfig = {},
): Pick<SeverityTrainingRow, 'severity_score' | 'emergency_level' | 'triage_priority' | 'label_type' | 'label_weight'> | null {
    const labelType = normalizeLabelType(clinicalCase.label_type);
    const trustWeights = { ...DEFAULT_LABEL_TRUST, ...(config.trustWeights ?? {}) };

    if (clinicalCase.severity_score == null || !clinicalCase.emergency_level) {
        return null;
    }

    if (labelType === 'inferred_only' && !config.allowInferredForSeverity) {
        return null;
    }

    if (labelType === 'synthetic' && config.allowSynthetic === false) {
        return null;
    }

    return {
        severity_score: clinicalCase.severity_score,
        emergency_level: clinicalCase.emergency_level,
        triage_priority: clinicalCase.triage_priority,
        label_type: labelType,
        label_weight: trustWeights[labelType],
    };
}

export function resolveCalibrationEligibility(clinicalCase: LearningCaseRecord): Omit<CalibrationEvalRow, 'case_id' | 'tenant_id' | 'model_version' | 'case_cluster' | 'species_canonical' | 'created_at'> | null {
    const predictedDiagnosis = clinicalCase.predicted_diagnosis ?? clinicalCase.top_diagnosis;
    const confidence = clinicalCase.degraded_confidence ?? clinicalCase.diagnosis_confidence;

    if (!predictedDiagnosis || !clinicalCase.confirmed_diagnosis || confidence == null || clinicalCase.prediction_correct == null || clinicalCase.confidence_error == null) {
        return null;
    }

    return {
        predicted_diagnosis: predictedDiagnosis,
        predicted_confidence: confidence,
        confirmed_diagnosis: clinicalCase.confirmed_diagnosis,
        prediction_correct: clinicalCase.prediction_correct,
        confidence_error: clinicalCase.confidence_error,
        calibration_bucket: clinicalCase.calibration_bucket,
        label_type: normalizeLabelType(clinicalCase.label_type),
    };
}

function normalizeLabelType(value: string | null): SupportedLabelType {
    if (value === 'lab_confirmed' || value === 'expert_reviewed' || value === 'synthetic' || value === 'inferred_only') {
        return value;
    }
    return 'inferred_only';
}
