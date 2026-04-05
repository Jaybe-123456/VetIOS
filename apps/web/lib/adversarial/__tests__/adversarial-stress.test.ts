import { describe, expect, it } from 'vitest';
import { runAdversarialSweep } from '../adversarial-engine';
import { runClinicalInferenceEngine } from '../../inference/engine';
import { applyGroundTruthConfirmation } from '../../inference/ground-truth-confirmation';
import type { DifferentialEntry, InferenceRequest } from '../../inference/types';

function buildPomeranianHeartwormExposureCase(): InferenceRequest {
    return {
        species: 'canine',
        breed: 'Pomeranian',
        presenting_signs: ['cough', 'exercise_intolerance', 'lethargy', 'dyspnea'],
        preventive_history: {
            heartworm_prevention: 'none',
            vector_exposure: {
                mosquito_endemic: true,
            },
        },
    };
}

function buildGroundTruthSeed(condition: string, conditionId: string, probability: number): DifferentialEntry[] {
    return [
        {
            rank: 1,
            condition,
            condition_id: conditionId,
            probability,
            confidence: 'moderate',
            determination_basis: 'symptom_scoring',
            supporting_evidence: [],
            contradicting_evidence: [],
            clinical_urgency: 'routine',
            recommended_confirmatory_tests: [],
            recommended_next_steps: [],
        },
        {
            rank: 2,
            condition: 'Comparator',
            condition_id: 'mitral_valve_disease_canine',
            probability: 0.12,
            confidence: 'low',
            determination_basis: 'symptom_scoring',
            supporting_evidence: [],
            contradicting_evidence: [],
            clinical_urgency: 'routine',
            recommended_confirmatory_tests: [],
            recommended_next_steps: [],
        },
        {
            rank: 3,
            condition: 'Tracheal Collapse',
            condition_id: 'tracheal_collapse',
            probability: 0.08,
            confidence: 'low',
            determination_basis: 'symptom_scoring',
            supporting_evidence: [],
            contradicting_evidence: [],
            clinical_urgency: 'routine',
            recommended_confirmatory_tests: [],
            recommended_next_steps: [],
        },
    ];
}

describe('adversarial stress suite', () => {
    it('A1 exposure prior dominance', async () => {
        const request = buildPomeranianHeartwormExposureCase();

        const report = await runAdversarialSweep(request, 'dirofilariosis_canine', {
            target_condition: 'dirofilariosis_canine',
            sweep_steps: 5,
        });

        const clean = report.clean_clinical_differential;
        const heartworm = clean.find((entry) => entry.condition_id === 'dirofilariosis_canine');

        expect(clean[0]?.condition_id === 'dirofilariosis_canine' || clean.slice(0, 3).some((entry) => entry.condition_id === 'dirofilariosis_canine')).toBe(true);
        expect(heartworm?.probability ?? 0).toBeGreaterThan(0.25);
        const engineResult = runClinicalInferenceEngine(request);
        expect(engineResult.abstain_recommendation).toBe(false);
        expect(engineResult.competitive_differential).toBe(true);
        expect(engineResult.urgent_confirmatory_testing).toBe(true);
        expect(
            report.evidence_thresholds.findings_to_reach_rank_1.some((entry) =>
                entry.finding === 'dirofilaria_antigen=positive' && entry.is_sufficient_alone,
            ),
        ).toBe(true);
    });

    it('A2 breed prior dominance for tracheal collapse in a Pomeranian', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Pomeranian',
            presenting_signs: ['honking_cough'],
        };

        const result = runClinicalInferenceEngine(request);
        const tracheal = result.differentials.find((entry) => entry.condition_id === 'tracheal_collapse');
        const mvd = result.differentials.find((entry) => entry.condition_id === 'mitral_valve_disease_canine');

        expect((tracheal?.probability ?? 0) > (mvd?.probability ?? 0)).toBe(true);
        expect(tracheal?.rank ?? 99).toBeLessThanOrEqual(2);
    });

    it('A3 breed prior exclusion for tracheal collapse in a Labrador', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Labrador Retriever',
            presenting_signs: ['cough', 'dyspnea'],
        };

        const result = runClinicalInferenceEngine(request);
        const tracheal = result.differentials.find((entry) => entry.condition_id === 'tracheal_collapse');

        expect(tracheal?.probability ?? 0).toBeLessThan(0.05);
        expect(tracheal?.rank ?? 99).toBeGreaterThanOrEqual(6);
    });

    it('A4 ground truth writeback excludes diabetes without evidence', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Mixed Breed',
            presenting_signs: ['weight_loss', 'polyuria', 'polydipsia'],
        };

        const result = applyGroundTruthConfirmation(
            buildGroundTruthSeed('Diabetes Mellitus', 'diabetes_mellitus_canine', 0.22),
            request,
        );
        const diabetes = result.find((entry) => entry.condition_id === 'diabetes_mellitus_canine');

        expect(diabetes?.ground_truth_explanation?.pre_confirmation_probability ?? 0).toBeGreaterThan(0.15);
        expect(diabetes?.ground_truth_explanation?.post_confirmation_probability ?? 1).toBeLessThan(0.08);
        expect(diabetes?.ground_truth_explanation?.pre_confirmation_probability).not.toBe(
            diabetes?.ground_truth_explanation?.post_confirmation_probability,
        );
        expect(diabetes?.ground_truth_explanation?.confirmation_status).toBe('unconfirmed');
        expect(
            (diabetes?.ground_truth_explanation?.missing_criteria ?? []).some((entry) =>
                entry.includes('glucose') || entry.includes('glucosuria'),
            ),
        ).toBe(true);
    });

    it('A5 ground truth writeback penalises hypothyroidism with weight loss', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Mixed Breed',
            presenting_signs: ['weight_loss', 'lethargy'],
        };

        const result = applyGroundTruthConfirmation(
            buildGroundTruthSeed('Hypothyroidism', 'hypothyroidism_canine', 0.18),
            request,
        );
        const hypothyroid = result.find((entry) => entry.condition_id === 'hypothyroidism_canine');

        expect(
            (hypothyroid?.ground_truth_explanation?.post_confirmation_probability ?? 1)
            < (hypothyroid?.ground_truth_explanation?.pre_confirmation_probability ?? 0),
        ).toBe(true);
        expect(
            (hypothyroid?.ground_truth_explanation?.contradicting_findings ?? []).some((entry) =>
                entry.includes('weight_loss'),
            ),
        ).toBe(true);
    });

    it('A6 narrow spread is not an abstain', () => {
        const result = runClinicalInferenceEngine(buildPomeranianHeartwormExposureCase());

        expect(result.abstain_recommendation).toBe(false);
        expect(result.competitive_differential).toBe(true);
        expect(result.urgent_confirmatory_testing).toBe(true);
    });

    it('A7 abstain fires on genuine contradiction', () => {
        const request: InferenceRequest = {
            species: 'canine',
            breed: 'Mixed Breed',
            presenting_signs: ['weight_loss', 'polyuria'],
            diagnostic_tests: {
                biochemistry: { glucose: 'hyperglycemia' },
                urinalysis: { glucose_in_urine: 'present' },
                serology: { t4_total: 'low' },
            },
        };

        const result = runClinicalInferenceEngine(request);

        expect(result.contradiction_analysis?.contradiction_score ?? 0).toBeGreaterThan(0);
        expect(result.abstain_recommendation === true || result.diagnosis.confidence_score < 0.3).toBe(true);
    });

    it('A8 not_done versus negative disambiguation', () => {
        const baseCase: InferenceRequest = {
            species: 'canine',
            breed: 'Pomeranian',
            presenting_signs: ['cough', 'exercise_intolerance', 'dyspnea'],
            preventive_history: {
                heartworm_prevention: 'none',
                vector_exposure: { mosquito_endemic: true },
            },
        };

        const notDone = applyGroundTruthConfirmation(
            buildGroundTruthSeed('Dirofilariosis (Heartworm disease)', 'dirofilariosis_canine', 0.28),
            {
                ...baseCase,
                diagnostic_tests: { serology: { dirofilaria_immitis_antigen: 'not_done' } },
            },
        ).find((entry) => entry.condition_id === 'dirofilariosis_canine');
        const negative = applyGroundTruthConfirmation(
            buildGroundTruthSeed('Dirofilariosis (Heartworm disease)', 'dirofilariosis_canine', 0.28),
            {
                ...baseCase,
                diagnostic_tests: { serology: { dirofilaria_immitis_antigen: 'negative' } },
            },
        ).find((entry) => entry.condition_id === 'dirofilariosis_canine');

        expect(notDone?.ground_truth_explanation?.post_confirmation_probability ?? 0).toBeGreaterThanOrEqual(
            (notDone?.ground_truth_explanation?.pre_confirmation_probability ?? 0) * 0.9,
        );
        expect(notDone?.ground_truth_explanation?.confirmation_status).toBe('unconfirmed');
        expect(negative?.ground_truth_explanation?.post_confirmation_probability ?? 1).toBeLessThanOrEqual(0.04);
        expect(negative?.ground_truth_explanation?.confirmation_status).toBe('excluded');
        expect((notDone?.ground_truth_explanation?.post_confirmation_probability ?? 0)).toBeGreaterThan(
            (negative?.ground_truth_explanation?.post_confirmation_probability ?? 0) * 10,
        );
    });

    it('A9 adversarial engine preserves clean clinical output separately', async () => {
        const report = await runAdversarialSweep(buildPomeranianHeartwormExposureCase(), 'dirofilariosis_canine', {
            target_condition: 'dirofilariosis_canine',
            sweep_steps: 5,
        });

        expect(report.clean_clinical_differential.length).toBeGreaterThan(0);
        expect(report.adversarial_differential_at_max_noise.warning).toBe('NOT_CLINICAL_OUTPUT — adversarial degradation result only');
        expect(report.clean_clinical_differential).not.toEqual(report.adversarial_differential_at_max_noise.differential);
        expect(report.evidence_thresholds.findings_to_reach_rank_1.length).toBeGreaterThan(0);
        expect(report.step_results.length).toBeGreaterThan(0);
    });

    it('A10 pathognomonic confirmation makes the system collapse-resistant', async () => {
        const report = await runAdversarialSweep(
            {
                ...buildPomeranianHeartwormExposureCase(),
                diagnostic_tests: {
                    serology: { dirofilaria_immitis_antigen: 'positive' },
                    echocardiography: { worms_visualised: 'present' },
                },
            },
            'dirofilariosis_canine',
            {
                target_condition: 'dirofilariosis_canine',
                sweep_steps: 5,
            },
        );

        expect(report.clean_clinical_differential[0]?.condition_id).toBe('dirofilariosis_canine');
        expect(report.clean_clinical_differential[0]?.probability ?? 0).toBeGreaterThanOrEqual(0.85);
        expect(report.clean_clinical_differential[0]?.determination_basis).toBe('pathognomonic_test');
        expect(report.global_phi).toBeGreaterThan(0.90);
        expect(report.collapse_risk).toBeLessThan(0.05);
    });

    it('A11 caval syndrome excludes melarsomine until extraction', () => {
        const result = runClinicalInferenceEngine({
            species: 'canine',
            breed: 'Labrador Retriever',
            weight_kg: 31.4,
            presenting_signs: ['cough', 'exercise_intolerance', 'dyspnea', 'collapse'],
            preventive_history: {
                heartworm_prevention: 'none',
                vector_exposure: { mosquito_endemic: true },
            },
            diagnostic_tests: {
                serology: { dirofilaria_immitis_antigen: 'positive' },
                echocardiography: { worms_visualised: 'present' },
            },
            physical_exam: {
                mucous_membrane_color: 'cyanotic',
                capillary_refill_time_s: 4,
            },
        });

        const plan = result.treatment_plans.dirofilariosis_canine;
        const acuteProtocols = plan.treatment_phases
            .find((phase) => phase.phase === 'acute_stabilisation')
            ?.protocols.map((protocol) => protocol.protocol_id) ?? [];

        expect(acuteProtocols).toContain('caval_syndrome_surgical_extraction');
        expect(plan.contraindicated_treatments.some((entry) =>
            entry.reason.includes('Melarsomine contraindicated in caval syndrome - surgical extraction first'),
        )).toBe(true);
        expect(plan.severity_class).toBe('IV');
        expect(result.differentials[0]?.clinical_urgency).toBe('immediate');
    });

    it('A12 small-breed heartworm versus CHF disambiguation stays explicit in the adversarial report', async () => {
        const report = await runAdversarialSweep(buildPomeranianHeartwormExposureCase(), 'dirofilariosis_canine', {
            target_condition: 'dirofilariosis_canine',
            sweep_steps: 5,
        });

        const antigenThreshold = report.evidence_thresholds.findings_to_reach_rank_1.find((entry) => entry.finding === 'dirofilaria_antigen=positive');
        const murmurThreshold = report.evidence_thresholds.findings_to_reach_rank_1.find((entry) => entry.finding === 'heart_murmur=grade_3_or_above');

        expect(report.baseline_target_rank).toBeLessThanOrEqual(3);
        expect(antigenThreshold?.resulting_rank).toBe(1);
        expect(antigenThreshold?.is_sufficient_alone).toBe(true);
        expect(murmurThreshold?.resulting_rank ?? 0).toBeGreaterThanOrEqual(2);
        expect(report.metastable_conditions.some((entry) => entry.condition_id === 'mitral_valve_disease_canine')).toBe(true);
    });
});
