import { describe, expect, it } from 'vitest';
import {
    buildGovernedTrainingDatasetConfig,
    evaluateTrainingPipelineReadiness,
} from '../trainingPipeline';
import type { LearningDatasetBundle } from '../types';

describe('governed training pipeline', () => {
    it('forces training datasets onto trusted real labels only', () => {
        const config = buildGovernedTrainingDatasetConfig('tenant-1', {
            includeSynthetic: true,
            labelTypes: ['synthetic', 'expert_reviewed', 'lab_confirmed'],
            labelResolver: {
                allowSynthetic: true,
                allowInferredForSeverity: true,
            },
        });

        expect(config.includeSynthetic).toBe(false);
        expect(config.labelTypes).toEqual(['expert_reviewed', 'lab_confirmed']);
        expect(config.labelResolver?.allowSynthetic).toBe(false);
        expect(config.labelResolver?.allowInferredForSeverity).toBe(false);
    });

    it('blocks VVRB and synthetic benchmark rows from candidate training', () => {
        const readiness = evaluateTrainingPipelineReadiness(datasetBundle({
            labelPolicyVersion: 'learning-label-policy-v1:vvrb-benchmark-only',
            labelType: 'synthetic',
            includeSynthetic: true,
            diagnosisRows: 12,
            severityRows: 12,
            calibrationRows: 12,
            uniqueDiagnoses: 12,
        }), {
            minimum_diagnosis_rows: 1,
            minimum_severity_rows: 1,
            minimum_calibration_rows: 1,
            minimum_unique_diagnoses: 1,
            minimum_lab_confirmed_rows: 0,
        });

        expect(readiness.ready).toBe(false);
        expect(readiness.blockers).toContain('synthetic_filter_enabled');
        expect(readiness.blockers).toContain('vvrb_benchmark_policy_cannot_train');
        expect(readiness.blockers).toContain('synthetic_rows_present');
        expect(readiness.counts.synthetic_rows).toBeGreaterThan(0);
    });

    it('allows a real expert/lab-confirmed dataset that meets minimums', () => {
        const readiness = evaluateTrainingPipelineReadiness(datasetBundle({
            labelType: 'lab_confirmed',
            diagnosisRows: 12,
            severityRows: 8,
            calibrationRows: 6,
            uniqueDiagnoses: 6,
        }), {
            minimum_diagnosis_rows: 10,
            minimum_severity_rows: 8,
            minimum_calibration_rows: 6,
            minimum_unique_diagnoses: 6,
            minimum_lab_confirmed_rows: 10,
        });

        expect(readiness.ready).toBe(true);
        expect(readiness.blockers).toEqual([]);
        expect(readiness.counts.lab_confirmed_rows).toBe(12);
        expect(readiness.policy.vvrb_allowed_for_training).toBe(false);
    });
});

function datasetBundle(input: {
    labelPolicyVersion?: string;
    labelType: 'synthetic' | 'expert_reviewed' | 'lab_confirmed';
    includeSynthetic?: boolean;
    diagnosisRows: number;
    severityRows: number;
    calibrationRows: number;
    uniqueDiagnoses: number;
}): LearningDatasetBundle {
    const diagnosisLabels = Array.from({ length: input.uniqueDiagnoses }, (_, index) => `Diagnosis ${index + 1}`);
    return {
        diagnosis_training_set: Array.from({ length: input.diagnosisRows }, (_, index) => ({
            case_id: `case-${index + 1}`,
            tenant_id: 'tenant-1',
            species_canonical: 'canine',
            breed: null,
            case_cluster: 'test',
            feature_vector: featureVector(`case-${index + 1}`),
            confirmed_diagnosis: diagnosisLabels[index % diagnosisLabels.length] ?? 'Diagnosis 1',
            primary_condition_class: 'test',
            label_type: input.labelType,
            label_weight: input.labelType === 'lab_confirmed' ? 1 : input.labelType === 'expert_reviewed' ? 0.85 : 0.65,
            contradiction_score: null,
            contradiction_flags: [],
            adversarial_case: false,
            model_version: null,
            created_at: '2026-06-28T00:00:00.000Z',
        })),
        severity_training_set: Array.from({ length: input.severityRows }, (_, index) => ({
            case_id: `case-${index + 1}`,
            tenant_id: 'tenant-1',
            species_canonical: 'canine',
            breed: null,
            feature_vector: featureVector(`case-${index + 1}`),
            severity_score: 0.5,
            emergency_level: 'MODERATE',
            triage_priority: 'standard',
            label_type: input.labelType,
            label_weight: input.labelType === 'lab_confirmed' ? 1 : input.labelType === 'expert_reviewed' ? 0.85 : 0.65,
            contradiction_score: null,
            adversarial_case: false,
            created_at: '2026-06-28T00:00:00.000Z',
        })),
        calibration_eval_set: Array.from({ length: input.calibrationRows }, (_, index) => ({
            case_id: `case-${index + 1}`,
            tenant_id: 'tenant-1',
            predicted_diagnosis: diagnosisLabels[index % diagnosisLabels.length] ?? 'Diagnosis 1',
            predicted_confidence: 0.8,
            confirmed_diagnosis: diagnosisLabels[index % diagnosisLabels.length] ?? 'Diagnosis 1',
            prediction_correct: true,
            confidence_error: 0.2,
            calibration_bucket: '0.8-0.9',
            label_type: input.labelType,
            model_version: null,
            case_cluster: 'test',
            species_canonical: 'canine',
            created_at: '2026-06-28T00:00:00.000Z',
        })),
        adversarial_benchmark_set: [],
        quarantine_set: [],
        summary: {
            total_cases: input.diagnosisRows,
            diagnosis_training_cases: input.diagnosisRows,
            severity_training_cases: input.severityRows,
            calibration_eval_cases: input.calibrationRows,
            adversarial_cases: 0,
            quarantined_cases: 0,
            label_composition: { [input.labelType]: input.diagnosisRows },
            excluded_counts: {},
        },
        dataset_version: 'dataset-v1',
        feature_schema_version: 'clinical-case-vector-v2',
        label_policy_version: input.labelPolicyVersion ?? 'learning-label-policy-v1:governed-real-labels',
        filters: {
            tenantId: 'tenant-1',
            includeSynthetic: input.includeSynthetic ?? false,
            labelTypes: [input.labelType],
        },
        case_ids: Array.from({ length: input.diagnosisRows }, (_, index) => `case-${index + 1}`),
    };
}

function featureVector(caseId: string): LearningDatasetBundle['diagnosis_training_set'][number]['feature_vector'] {
    return {
        case_id: caseId,
        feature_schema_version: 'clinical-case-vector-v2',
        raw_snapshot: {},
        dense_features: {},
        symptom_flags: {},
    };
}
