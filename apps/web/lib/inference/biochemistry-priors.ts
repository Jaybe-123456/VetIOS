import type { InferenceRequest } from './types';
import type { ScoreAdjustment } from './haematological-priors';

export function applyBiochemistryPriors(request: InferenceRequest): ScoreAdjustment[] {
    const biochemistry = request.diagnostic_tests?.biochemistry;
    const urinalysis = request.diagnostic_tests?.urinalysis;
    if (!biochemistry) return [];

    const adjustments: ScoreAdjustment[] = [];

    if (biochemistry.glucose === 'hyperglycemia') {
        adjustments.push({
            condition_id: 'diabetes_mellitus_canine',
            delta: urinalysis?.glucose_in_urine === 'present' ? 0.4 : 0.18,
            finding: urinalysis?.glucose_in_urine === 'present' ? 'Hyperglycaemia with glucosuria' : 'Hyperglycaemia',
            weight: urinalysis?.glucose_in_urine === 'present' ? 'definitive' : 'supportive',
        });
    }

    if (biochemistry.albumin === 'hypoalbuminemia' && biochemistry.globulins === 'hyperglobulinemia') {
        adjustments.push(
            {
                condition_id: 'leishmaniosis_canine',
                delta: 0.2,
                finding: 'Hypoalbuminaemia with hyperglobulinaemia',
                weight: 'strong',
            },
            {
                condition_id: 'protein_losing_enteropathy',
                delta: 0.12,
                finding: 'Hypoproteinaemic pattern',
                weight: 'supportive',
            },
        );
    }

    if (biochemistry.bun_creatinine === 'azotemia') {
        adjustments.push(
            {
                condition_id: 'leptospirosis',
                delta: 0.16,
                finding: 'Azotemia on biochemistry',
                weight: 'strong',
            },
            {
                condition_id: 'renal_disease_chronic',
                delta: 0.16,
                finding: 'Azotemia on biochemistry',
                weight: 'supportive',
            },
        );
    }

    if (biochemistry.bilirubin === 'elevated') {
        adjustments.push(
            {
                condition_id: 'leptospirosis',
                delta: 0.12,
                finding: 'Hyperbilirubinaemia',
                weight: 'supportive',
            },
            {
                condition_id: 'hepatic_disease_chronic',
                delta: 0.12,
                finding: 'Hyperbilirubinaemia',
                weight: 'supportive',
            },
            {
                condition_id: 'immune_mediated_hemolytic_anemia',
                delta: 0.08,
                finding: 'Hyperbilirubinaemia',
                weight: 'minor',
            },
        );
    }

    if (biochemistry.alt_ast === 'markedly_elevated') {
        adjustments.push(
            {
                condition_id: 'leptospirosis',
                delta: 0.12,
                finding: 'Markedly elevated liver enzymes',
                weight: 'supportive',
            },
            {
                condition_id: 'hepatic_disease_chronic',
                delta: 0.16,
                finding: 'Markedly elevated liver enzymes',
                weight: 'strong',
            },
        );
    }

    if (urinalysis?.proteinuria === 'present') {
        adjustments.push(
            {
                condition_id: 'leishmaniosis_canine',
                delta: 0.14,
                finding: 'Proteinuria',
                weight: 'supportive',
            },
            {
                condition_id: 'renal_disease_chronic',
                delta: 0.12,
                finding: 'Proteinuria',
                weight: 'supportive',
            },
        );
    }

    if (urinalysis?.specific_gravity != null && urinalysis.specific_gravity < 1.018 && biochemistry.bun_creatinine === 'azotemia') {
        adjustments.push({
            condition_id: 'renal_disease_chronic',
            delta: 0.22,
            finding: 'Azotemia with inappropriately low urine specific gravity',
            weight: 'strong',
        });
    }

    return adjustments;
}
