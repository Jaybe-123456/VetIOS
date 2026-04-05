import { describe, expect, it } from 'vitest';
import { runClinicalInferenceEngine } from '../engine';
import type { InferenceRequest } from '../types';

describe('clinical inference engine deep upgrade', () => {
    it('returns dirofilariosis first at high probability when confirmatory evidence is present', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Labrador Retriever',
            weight_kg: 31.4,
            presenting_signs: ['chronic_cough', 'exercise_intolerance', 'lethargy', 'weight_loss', 'dyspnea'],
            preventive_history: {
                heartworm_prevention: 'none',
                vector_exposure: { mosquito_endemic: true },
            },
            diagnostic_tests: {
                serology: { dirofilaria_immitis_antigen: 'positive' },
                cbc: { eosinophilia: 'moderate' },
                thoracic_radiograph: {
                    pulmonary_artery_enlargement: 'present',
                    cardiomegaly: 'right_sided',
                },
                echocardiography: {
                    worms_visualised: 'present',
                    right_heart_enlargement: 'present',
                },
            },
        };

        const result = runClinicalInferenceEngine(request);

        expect(result.differentials[0]?.condition).toContain('Dirofilariosis');
        expect(result.differentials[0]?.probability ?? 0).toBeGreaterThanOrEqual(0.85);
        expect(result.differentials[0]?.determination_basis).toBe('pathognomonic_test');
        expect(result.differentials.every((entry) => !entry.condition.includes('Tracheal Collapse'))).toBe(true);
        expect(result.differentials.every((entry) => !entry.condition.includes('Diabetes'))).toBe(true);
        expect(result.inference_explanation.excluded_conditions.some((entry) => entry.condition.includes('Tracheal Collapse'))).toBe(true);
        expect(result.ground_truth_summary.primary_diagnosis_status).toBe('confirmed');
    });

    it('penalises tracheal collapse in a Labrador to below five percent without imaging confirmation', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Labrador Retriever',
            presenting_signs: ['chronic_cough', 'exercise_intolerance', 'dyspnea'],
            diagnostic_tests: {
                thoracic_radiograph: {
                    pulmonary_artery_enlargement: 'present',
                    cardiomegaly: 'right_sided',
                },
            },
            preventive_history: {
                heartworm_prevention: 'none',
                vector_exposure: { mosquito_endemic: true },
            },
        };

        const result = runClinicalInferenceEngine(request);
        const trachealCollapse = result.differentials.find((entry) => entry.condition.includes('Tracheal Collapse'));

        expect(trachealCollapse?.probability ?? 0).toBeLessThan(0.05);
    });

    it('excludes diabetes mellitus when hyperglycaemia and glucosuria are absent', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Labrador Retriever',
            presenting_signs: ['weight_loss', 'lethargy', 'dyspnea'],
            diagnostic_tests: {
                cbc: { eosinophilia: 'mild' },
                biochemistry: { glucose: 'normal' },
                urinalysis: { glucose_in_urine: 'absent' },
            },
        };

        const result = runClinicalInferenceEngine(request);
        const diabetes = result.differentials.find((entry) => entry.condition.includes('Diabetes'));

        expect(diabetes?.probability ?? 0).toBeLessThan(0.02);
    });

    it('flags right-sided CHF as incomplete when no primary cause is identified', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Mixed Breed',
            presenting_signs: ['ascites', 'exercise_intolerance', 'dyspnea'],
            diagnostic_tests: {
                echocardiography: {
                    right_heart_enlargement: 'present',
                },
            },
        };

        const result = runClinicalInferenceEngine(request);
        const rightChf = result.differentials.find((entry) => entry.condition.includes('Right-sided CHF'));

        if (rightChf) {
            expect(rightChf.condition).toContain('primary cause not identified');
            expect(rightChf.recommended_next_steps?.some((step) => step.includes('Identify primary cause'))).toBe(true);
        }
    });

    it('prioritises East Africa tick-borne conditions when exposure and thrombocytopenia are present', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Mixed Breed',
            region: 'nairobi_ke',
            presenting_signs: ['lethargy', 'fever'],
            preventive_history: {
                ectoparasite_prevention: 'none',
                vector_exposure: {
                    tick_endemic: true,
                },
            },
            diagnostic_tests: {
                cbc: {
                    thrombocytopenia: 'severe',
                },
            },
        };

        const result = runClinicalInferenceEngine(request);
        const topThree = result.differentials.slice(0, 3).map((entry) => entry.condition);

        expect(topThree.some((entry) => entry.includes('Ehrlichiosis'))).toBe(true);
        expect(topThree.some((entry) => entry.includes('Anaplasmosis'))).toBe(true);
        expect(topThree.some((entry) => entry.includes('Babesiosis'))).toBe(true);
        expect(result.differentials.slice(0, 3).every((entry) => (entry.recommended_confirmatory_tests ?? []).length > 0)).toBe(true);
    });

    it('builds a class II dirofilariosis treatment plan with all major phases and protocols', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Labrador Retriever',
            weight_kg: 31.4,
            presenting_signs: ['chronic_cough', 'exercise_intolerance', 'lethargy', 'weight_loss', 'dyspnea'],
            preventive_history: {
                heartworm_prevention: 'none',
                vector_exposure: { mosquito_endemic: true },
            },
            diagnostic_tests: {
                serology: { dirofilaria_immitis_antigen: 'positive' },
                cbc: { eosinophilia: 'moderate' },
                thoracic_radiograph: {
                    pulmonary_artery_enlargement: 'present',
                    cardiomegaly: 'right_sided',
                },
                echocardiography: {
                    worms_visualised: 'present',
                    right_heart_enlargement: 'present',
                },
            },
        };

        const result = runClinicalInferenceEngine(request);
        const plan = result.treatment_plans.dirofilariosis_canine;
        const protocolIds = plan.treatment_phases.flatMap((phase) => phase.protocols.map((protocol) => protocol.protocol_id));

        expect(plan.severity_class).toBe('II');
        expect(protocolIds).toContain('exercise_restriction');
        expect(protocolIds).toContain('doxycycline_wolbachia');
        expect(protocolIds).toContain('macrocyclic_lactone_microfilaricidal');
        expect(protocolIds).toContain('melarsomine_split_dose');
        expect(plan.monitoring_schedule.length).toBeGreaterThan(0);
    });
});
