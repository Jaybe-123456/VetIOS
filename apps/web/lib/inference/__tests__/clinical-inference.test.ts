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

    it('uses symptom_vector, detects a respiratory dominant cluster, and suppresses GI diagnoses', () => {
        const result = runClinicalInferenceEngine({
            species: 'canine',
            symptom_vector: ['cough', 'runny nose', 'crackles'],
            history: {
                owner_observations: ['No vomiting or diarrhea reported at home.'],
            },
        });

        expect(result.top_diagnosis).toContain('Pneumonia');
        expect(result.condition_class).toBe('Infectious');
        expect(result.severity).toBeTruthy();
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.contradiction_score).toBe(0);
        expect(result.cluster_scores.respiratory).toBeGreaterThan(result.cluster_scores.gi);
        expect(
            result.differentials.find((entry) => entry.condition.includes('Parvoviral Enteritis'))?.probability ?? 0,
        ).toBeLessThan(0.02);
    });

    it('normalizes raw synonyms into canonical clinical signals without duplicating semantics', () => {
        const result = runClinicalInferenceEngine({
            species: 'canine',
            symptom_vector: ['runny nose', 'eye discharge', 'panting'],
            history: {
                owner_observations: ['Weak and not eating today.'],
            },
        });

        const featureKeys = Object.keys(result.feature_importance);

        expect(featureKeys).toContain('nasal discharge serous');
        expect(featureKeys).toContain('ocular discharge');
        expect(featureKeys).toContain('tachypnea');
        expect(featureKeys).toContain('anorexia');
        expect(featureKeys).toContain('lethargy');
        expect(result.cluster_scores.respiratory).toBeGreaterThan(result.cluster_scores.systemic);
    });

    it('zeros negated GI signals and penalises diseases that require vomiting or diarrhea', () => {
        const result = runClinicalInferenceEngine({
            species: 'canine',
            symptom_vector: ['vomiting', 'diarrhea', 'lethargy'],
            history: {
                owner_observations: ['No vomiting. No diarrhea.'],
            },
        });

        expect(
            result.differentials.find((entry) => entry.condition.includes('Parvoviral Enteritis'))?.probability ?? 0,
        ).toBeLessThan(0.05);
        expect(result.differentials[0]?.condition.includes('Parvoviral Enteritis')).toBe(false);
        expect(result.cluster_scores.gi).toBe(0);
    });

    it('prioritises GI diagnoses only when validated GI evidence is strong', () => {
        const result = runClinicalInferenceEngine({
            species: 'canine',
            symptom_vector: ['vomiting', 'diarrhea', 'bloody diarrhea'],
        });

        expect(result.top_diagnosis).toContain('Parvoviral Enteritis');
        expect(result.cluster_scores.gi).toBeGreaterThan(result.cluster_scores.respiratory);
        expect(result.condition_class).toBe('Infectious');
    });

    it('raises contradiction score and lowers reported confidence when absent required features conflict with the top diagnosis', () => {
        const result = runClinicalInferenceEngine({
            species: 'canine',
            symptom_vector: ['lethargy', 'fever'],
            history: {
                owner_observations: ['No vomiting or diarrhea observed.'],
            },
            diagnostic_tests: {
                serology: {
                    parvovirus_antigen: 'positive',
                },
            },
        });

        expect(result.top_diagnosis).toContain('Parvoviral Enteritis');
        expect(result.contradiction_score).toBeGreaterThan(0.7);
        expect(result.confidence).toBeLessThan(result.differentials[0]?.probability ?? 0);
        expect(result.abstain_recommendation).toBe(true);
        expect(result.contradiction_analysis?.contradiction_reasons.join(' ')).toContain('absent');
    });

    it('does not let low-specificity systemic signals drive GI prioritization on their own', () => {
        const result = runClinicalInferenceEngine({
            species: 'canine',
            symptom_vector: ['fever', 'lethargy', 'not eating'],
        });

        expect(result.cluster_scores.systemic).toBeGreaterThan(0);
        expect(result.cluster_scores.gi).toBe(0);
        expect(result.top_diagnosis?.includes('Parvoviral Enteritis')).toBe(false);
        expect(Boolean(result.competitive_differential || result.abstain_recommendation)).toBe(true);
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
