import type { InferenceRequest } from './types';
import type { ScoreAdjustment } from './haematological-priors';

export interface SyndromeScore {
    condition: string;
    prior_boost: number;
    prior_penalty?: number;
    incompatible_conditions?: string[];
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
            { condition: 'Dirofilariosis', prior_boost: 0.35 },
            { condition: 'Pulmonary Hypertension', prior_boost: 0.20 },
            { condition: 'Tracheal Collapse', prior_boost: 0, prior_penalty: 0.40, incompatible_conditions: ['Tracheal Collapse'] },
            { condition: 'Primary Bronchitis', prior_boost: 0, prior_penalty: 0.30, incompatible_conditions: ['Primary Bronchitis'] },
        ],
    },
    {
        name: 'Worm visualisation (echocardiographic pasta sign)',
        trigger: (request) => request.diagnostic_tests?.echocardiography?.worms_visualised === 'present',
        evidence: ['Echocardiographic worm visualisation'],
        scores: [
            { condition: 'Dirofilariosis', prior_boost: 0.45 },
            { condition: 'Pulmonary Hypertension', prior_boost: 0.10 },
        ],
    },
    {
        name: 'Bilateral renal disease pattern',
        trigger: (request) =>
            request.diagnostic_tests?.urinalysis?.proteinuria === 'present'
            && request.diagnostic_tests?.biochemistry?.albumin === 'hypoalbuminemia'
            && request.diagnostic_tests?.biochemistry?.globulins === 'hyperglobulinemia',
        evidence: ['Proteinuria with hypoalbuminemia and hyperglobulinemia'],
        scores: [
            { condition: 'Leishmaniosis', prior_boost: 0.30 },
            { condition: 'Immune-mediated glomerulonephritis', prior_boost: 0.15 },
        ],
    },
    {
        name: 'Alveolar-bronchial pattern with lymphadenopathy',
        trigger: (request) =>
            request.diagnostic_tests?.thoracic_radiograph?.pulmonary_pattern === 'alveolar'
            && request.physical_exam?.lymph_nodes === 'generalised_lymphadenopathy',
        evidence: [
            'Alveolar pulmonary pattern on thoracic radiograph',
            'Generalised lymphadenopathy on physical examination',
        ],
        scores: [
            { condition: 'Pneumonia (bacterial)', prior_boost: 0.25 },
            { condition: 'Fungal pneumonia', prior_boost: 0.15 },
            { condition: 'Neoplasia', prior_boost: 0.12 },
        ],
    },
    {
        name: 'Right-sided cardiac complication pattern',
        trigger: (request) =>
            request.diagnostic_tests?.echocardiography?.right_heart_enlargement === 'present'
            && request.diagnostic_tests?.echocardiography?.pulmonary_hypertension === 'present',
        evidence: [
            'Right heart enlargement on echocardiography',
            'Pulmonary hypertension on echocardiography',
        ],
        scores: [
            { condition: 'Pulmonary Hypertension', prior_boost: 0.22 },
            { condition: 'Congestive Heart Failure', prior_boost: 0.16 },
            { condition: 'Dirofilariosis', prior_boost: 0.12 },
            { condition: 'Left-sided degenerative valve disease', prior_boost: 0, prior_penalty: 0.30, incompatible_conditions: ['Left-sided degenerative valve disease'] },
        ],
    },
];

export function applySyndromeRecogniser(request: InferenceRequest): ScoreAdjustment[] {
    const adjustments: ScoreAdjustment[] = [];

    for (const rule of SYNDROME_RULES) {
        if (!rule.trigger(request)) continue;

        for (const score of rule.scores) {
            if (score.prior_boost > 0) {
                adjustments.push({
                    condition: score.condition,
                    delta: score.prior_boost,
                    finding: rule.evidence.join('; '),
                    weight: score.prior_boost >= 0.3 ? 'strong' : 'supportive',
                });
            }
            if ((score.prior_penalty ?? 0) > 0) {
                adjustments.push({
                    condition: score.condition,
                    delta: -(score.prior_penalty ?? 0),
                    finding: `${rule.name} is inconsistent with ${score.condition} as the primary diagnosis`,
                    weight: 'minor',
                    penalty: true,
                });
            }
        }
    }

    return adjustments;
}
