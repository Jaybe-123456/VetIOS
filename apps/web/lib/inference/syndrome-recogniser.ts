import type { InferenceRequest } from './types';
import type { ScoreAdjustment } from './haematological-priors';

export interface SyndromeScore {
    condition_id: string;
    prior_boost?: number;
    prior_penalty?: number;
}

export interface SyndromeRule {
    name: string;
    trigger: (request: InferenceRequest) => boolean;
    evidence: string[];
    scores: SyndromeScore[];
}

export const SYNDROME_RULES: SyndromeRule[] = [
    {
        name: 'Pulmonary vascular syndrome (heartworm pattern)',
        trigger: (request) =>
            request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement === 'present'
            && request.diagnostic_tests?.thoracic_radiograph?.cardiomegaly === 'right_sided',
        evidence: [
            'Pulmonary artery enlargement on thoracic radiograph',
            'Right-sided cardiomegaly on thoracic radiograph',
        ],
        scores: [
            { condition_id: 'dirofilariosis_canine', prior_boost: 0.35 },
            { condition_id: 'pulmonary_hypertension', prior_boost: 0.20 },
            { condition_id: 'tracheal_collapse', prior_penalty: 0.40 },
            { condition_id: 'chronic_bronchitis_canine', prior_penalty: 0.30 },
            { condition_id: 'mitral_valve_disease_canine', prior_penalty: 0.18 },
        ],
    },
    {
        name: 'Worm visualisation (echocardiographic pasta sign)',
        trigger: (request) => request.diagnostic_tests?.echocardiography?.worms_visualised === 'present',
        evidence: ['Echocardiographic worm visualisation'],
        scores: [
            { condition_id: 'dirofilariosis_canine', prior_boost: 0.45 },
            { condition_id: 'pulmonary_hypertension', prior_boost: 0.10 },
        ],
    },
    {
        name: 'Bilateral renal immune-complex pattern',
        trigger: (request) =>
            request.diagnostic_tests?.urinalysis?.proteinuria === 'present'
            && request.diagnostic_tests?.biochemistry?.albumin === 'hypoalbuminemia'
            && request.diagnostic_tests?.biochemistry?.globulins === 'hyperglobulinemia',
        evidence: ['Proteinuria with hypoalbuminaemia and hyperglobulinaemia'],
        scores: [
            { condition_id: 'leishmaniosis_canine', prior_boost: 0.30 },
            { condition_id: 'renal_disease_chronic', prior_boost: 0.12 },
        ],
    },
    {
        name: 'Alveolar pattern with lymphadenopathy',
        trigger: (request) =>
            request.diagnostic_tests?.thoracic_radiograph?.pulmonary_pattern === 'alveolar'
            && request.physical_exam?.lymph_nodes === 'generalised_lymphadenopathy',
        evidence: ['Alveolar pulmonary pattern', 'Generalised lymphadenopathy'],
        scores: [
            { condition_id: 'pneumonia_bacterial', prior_boost: 0.25 },
            { condition_id: 'lymphoma', prior_boost: 0.12 },
        ],
    },
    {
        name: 'Right-sided cardiac complication pattern',
        trigger: (request) =>
            request.diagnostic_tests?.echocardiography?.right_heart_enlargement === 'present'
            && (
                request.diagnostic_tests?.echocardiography?.pulmonary_hypertension === 'present'
                || request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement === 'present'
            ),
        evidence: ['Right heart enlargement', 'Pulmonary vascular disease pattern'],
        scores: [
            { condition_id: 'pulmonary_hypertension', prior_boost: 0.22 },
            { condition_id: 'right_sided_chf_secondary', prior_boost: 0.16 },
            { condition_id: 'dirofilariosis_canine', prior_boost: 0.12 },
            { condition_id: 'tracheal_collapse', prior_penalty: 0.25 },
        ],
    },
];

export function applySyndromePatterns(request: InferenceRequest): ScoreAdjustment[] {
    const adjustments: ScoreAdjustment[] = [];

    for (const rule of SYNDROME_RULES) {
        if (!rule.trigger(request)) continue;

        for (const score of rule.scores) {
            if ((score.prior_boost ?? 0) > 0) {
                adjustments.push({
                    condition_id: score.condition_id,
                    delta: score.prior_boost ?? 0,
                    finding: rule.evidence.join('; '),
                    weight: (score.prior_boost ?? 0) >= 0.3 ? 'strong' : 'supportive',
                    determination_basis: 'syndrome_pattern',
                });
            }

            if ((score.prior_penalty ?? 0) > 0) {
                adjustments.push({
                    condition_id: score.condition_id,
                    delta: -(score.prior_penalty ?? 0),
                    finding: `${rule.name} is inconsistent with this condition as the primary diagnosis`,
                    weight: 'minor',
                    penalty: true,
                });
            }
        }
    }

    return adjustments;
}
