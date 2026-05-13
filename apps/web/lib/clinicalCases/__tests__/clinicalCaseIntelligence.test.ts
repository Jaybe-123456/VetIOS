import { describe, expect, test } from 'vitest';
import { buildOutcomeLearningPatch } from '@/lib/clinicalCases/clinicalCaseIntelligence';

describe('buildOutcomeLearningPatch', () => {
    test('treats clinician outcome label as a confirmed diagnosis', () => {
        const patch = buildOutcomeLearningPatch({
            outcomeType: 'confirmed_diagnosis',
            outcomePayload: {
                label: 'canine_pancreatitis',
                confidence: 1,
                predicted_probability: 0.72,
            },
            existing: {
                top_diagnosis: 'canine_pancreatitis',
                predicted_diagnosis: 'canine_pancreatitis',
                primary_condition_class: 'Inflammatory',
                confirmed_diagnosis: null,
                label_type: 'inferred_only',
                diagnosis_confidence: 0.72,
                severity_score: 0.5,
                emergency_level: 'MODERATE',
                contradiction_score: 0,
                contradiction_flags: [],
                uncertainty_notes: [],
                case_cluster: null,
                model_version: 'diag_smoke_v1',
                telemetry_status: 'learning_ready',
                adversarial_case: false,
                adversarial_case_type: null,
                calibration_status: 'pending_outcome',
                prediction_correct: null,
                confidence_error: null,
                calibration_bucket: '0.7-0.8',
                degraded_confidence: null,
                differential_spread: null,
            },
        });

        expect(patch.confirmed_diagnosis).toBe('canine_pancreatitis');
        expect(patch.prediction_correct).toBe(true);
        expect(patch.calibration_status).toBe('calibrated_match');
    });
});
