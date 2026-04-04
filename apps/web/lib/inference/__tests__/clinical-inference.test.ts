import { describe, expect, it } from 'vitest';
import { runClinicalInferenceEngine } from '../engine';
import type { InferenceRequest } from '../types';

describe('clinical inference engine', () => {
    it('ranks dirofilariosis first when confirmatory evidence is present', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Labrador',
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
                biochemistry: { alt_ast: 'mildly_elevated' },
            },
        };

        const result = runClinicalInferenceEngine(request);

        expect(result.differentials[0]?.condition).toContain('Dirofilariosis');
        expect(result.differentials[0]?.probability ?? 0).toBeGreaterThanOrEqual(0.85);
        expect(result.differentials[0]?.determination_basis).toBe('pathognomonic_test');
        expect(result.differentials.every((entry) => !entry.condition.includes('Tracheal Collapse'))).toBe(true);
        expect(result.differentials.every((entry) => !entry.condition.includes('Diabetes'))).toBe(true);
        expect(result.differentials.every((entry) => !entry.condition.includes('Bronchitis') || entry.relationship_to_primary?.type === 'secondary')).toBe(true);
    });

    it('keeps dirofilariosis in the top three without overcalling it before confirmatory testing', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Labrador',
            presenting_signs: ['chronic_cough', 'exercise_intolerance', 'lethargy', 'weight_loss', 'dyspnea'],
            preventive_history: {
                heartworm_prevention: 'none',
                vector_exposure: { mosquito_endemic: true },
            },
        };

        const result = runClinicalInferenceEngine(request);
        const heartworm = result.differentials.find((entry) => entry.condition.includes('Dirofilariosis'));

        expect(result.differentials.slice(0, 3).some((entry) => entry.condition.includes('Dirofilariosis'))).toBe(true);
        expect(heartworm?.probability ?? 0).toBeGreaterThanOrEqual(0.25);
        expect(heartworm?.probability ?? 0).toBeLessThanOrEqual(0.55);
        expect(heartworm?.recommended_confirmatory_tests ?? []).toContain('Dirofilaria immitis antigen test');
    });

    it('treats babesiosis as pathognomonic when organisms are seen', () => {
        const request: InferenceRequest = {
            species: 'canine',
            presenting_signs: ['lethargy', 'pale_mucous_membranes', 'weakness'],
            preventive_history: {
                ectoparasite_prevention: 'none',
                vector_exposure: { tick_endemic: true },
            },
            diagnostic_tests: {
                cbc: {
                    anemia_type: 'regenerative',
                    thrombocytopenia: 'severe',
                },
                parasitology: {
                    buffy_coat_smear: ['Babesia spp observed'],
                },
            },
            physical_exam: {
                mucous_membrane_color: 'pale',
            },
        };

        const result = runClinicalInferenceEngine(request);

        expect(result.differentials[0]?.condition).toContain('Babesiosis');
        expect(result.differentials[0]?.probability ?? 0).toBeGreaterThanOrEqual(0.85);
        expect(result.differentials[0]?.determination_basis).toBe('pathognomonic_test');
        expect(result.differentials[0]?.condition.includes('Immune-mediated haemolytic anaemia')).toBe(false);
    });

    it('keeps symptom-only gastrointestinal cases broad and confirmatory-test driven', () => {
        const request: InferenceRequest = {
            species: 'canine',
            presenting_signs: ['vomiting', 'diarrhea', 'lethargy'],
        };

        const result = runClinicalInferenceEngine(request);

        expect(result.differentials[0]?.probability ?? 0).toBeLessThan(0.70);
        expect(result.differentials.length).toBeGreaterThanOrEqual(3);
        expect(result.differentials.every((entry) => entry.determination_basis === 'symptom_scoring')).toBe(true);
        expect((result.inference_explanation.missing_data_that_would_help ?? []).length).toBeGreaterThan(0);
    });

    it('keeps dirofilariosis first even when tracheal collapse is also visualised', () => {
        const request: InferenceRequest = {
            species: 'canine',
            presenting_signs: ['chronic_cough', 'dyspnea', 'exercise_intolerance'],
            preventive_history: {
                heartworm_prevention: 'none',
                vector_exposure: { mosquito_endemic: true },
            },
            diagnostic_tests: {
                serology: { dirofilaria_immitis_antigen: 'positive' },
                thoracic_radiograph: {
                    pulmonary_artery_enlargement: 'present',
                    cardiomegaly: 'right_sided',
                    tracheal_collapse_seen: 'present',
                },
                echocardiography: { worms_visualised: 'present' },
            },
        };

        const result = runClinicalInferenceEngine(request);
        const trachealCollapse = result.differentials.find((entry) => entry.condition.includes('Tracheal Collapse'));

        expect(result.differentials[0]?.condition).toContain('Dirofilariosis');
        expect(trachealCollapse).toBeDefined();
        expect(trachealCollapse?.relationship_to_primary?.type).toBe('co-morbidity');
    });

    it('uses east africa priors to elevate tick-borne disease before endocrine mimics', () => {
        const request: InferenceRequest = {
            species: 'canine',
            region: 'nairobi_ke',
            presenting_signs: ['lethargy', 'fever'],
            preventive_history: {
                ectoparasite_prevention: 'none',
                vector_exposure: { tick_endemic: true },
            },
            diagnostic_tests: {
                cbc: { thrombocytopenia: 'severe' },
            },
        };

        const result = runClinicalInferenceEngine(request);
        const topThree = result.differentials.slice(0, 3).map((entry) => entry.condition);

        expect(topThree).toContain('Ehrlichiosis');
        expect(topThree).toContain('Anaplasmosis');
        expect(topThree).toContain('Babesiosis');
        expect(topThree).not.toContain('Hypothyroidism');
        expect(topThree).not.toContain('Hypoadrenocorticism');
        expect(result.differentials.slice(0, 3).every((entry) =>
            (entry.recommended_confirmatory_tests ?? []).some((test) => /pcr|serology|cbc|tick/i.test(test))
        )).toBe(true);
    });
});
