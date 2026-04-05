import type { InferenceRequest } from './types';
import type { ScoreAdjustment } from './haematological-priors';

export function applyImagingPriors(request: InferenceRequest): ScoreAdjustment[] {
    const thoracic = request.diagnostic_tests?.thoracic_radiograph;
    const echo = request.diagnostic_tests?.echocardiography;
    if (!thoracic && !echo) return [];

    const adjustments: ScoreAdjustment[] = [];

    if (thoracic?.pulmonary_artery_enlargement === 'present') {
        adjustments.push(
            {
                condition_id: 'dirofilariosis_canine',
                delta: 0.25,
                finding: 'Pulmonary artery enlargement on thoracic radiograph',
                weight: 'strong',
            },
            {
                condition_id: 'pulmonary_hypertension',
                delta: 0.18,
                finding: 'Pulmonary artery enlargement on thoracic radiograph',
                weight: 'strong',
            },
            {
                condition_id: 'tracheal_collapse',
                delta: -0.45,
                finding: 'Pulmonary vascular enlargement is inconsistent with primary tracheal collapse',
                weight: 'excludes' as never,
                penalty: true,
            },
            {
                condition_id: 'chronic_bronchitis_canine',
                delta: -0.25,
                finding: 'Pulmonary vascular enlargement is insufficiently explained by primary bronchitis',
                weight: 'weakens' as never,
                penalty: true,
            },
        );
    }

    if (thoracic?.cardiomegaly === 'right_sided' || echo?.right_heart_enlargement === 'present') {
        adjustments.push(
            {
                condition_id: 'dirofilariosis_canine',
                delta: 0.18,
                finding: 'Right heart enlargement',
                weight: 'strong',
            },
            {
                condition_id: 'pulmonary_hypertension',
                delta: 0.15,
                finding: 'Right heart enlargement',
                weight: 'supportive',
            },
            {
                condition_id: 'right_sided_chf_secondary',
                delta: 0.1,
                finding: 'Right heart enlargement',
                weight: 'supportive',
            },
            {
                condition_id: 'tracheal_collapse',
                delta: -0.4,
                finding: 'Right heart enlargement weakens tracheal collapse as the primary explanation',
                weight: 'weakens' as never,
                penalty: true,
            },
        );
    }

    if (echo?.worms_visualised === 'present') {
        adjustments.push({
            condition_id: 'dirofilariosis_canine',
            delta: 0.5,
            finding: 'Echocardiographic worm visualisation',
            weight: 'definitive',
        });
    }

    if (thoracic?.tracheal_collapse_seen === 'present') {
        adjustments.push({
            condition_id: 'tracheal_collapse',
            delta: 0.75,
            finding: 'Tracheal collapse visualised on imaging',
            weight: 'definitive',
        });
    }

    if (thoracic?.cardiomegaly === 'left_sided' || echo?.left_heart_enlargement === 'present') {
        adjustments.push(
            {
                condition_id: 'mitral_valve_disease_canine',
                delta: 0.2,
                finding: 'Left heart enlargement',
                weight: 'strong',
            },
            {
                condition_id: 'dilated_cardiomyopathy_canine',
                delta: 0.18,
                finding: 'Left heart enlargement',
                weight: 'supportive',
            },
        );
    }

    if (echo?.reduced_contractility === 'present') {
        adjustments.push({
            condition_id: 'dilated_cardiomyopathy_canine',
            delta: 0.25,
            finding: 'Reduced myocardial contractility on echocardiography',
            weight: 'strong',
        });
    }

    if (thoracic?.pulmonary_pattern === 'alveolar') {
        adjustments.push(
            {
                condition_id: 'pneumonia_bacterial',
                delta: 0.22,
                finding: 'Alveolar pulmonary pattern',
                weight: 'strong',
            },
            {
                condition_id: 'pneumonia_aspiration',
                delta: 0.18,
                finding: 'Alveolar pulmonary pattern',
                weight: 'supportive',
            },
        );
    }

    return adjustments.map((adjustment) => ({
        ...adjustment,
        weight: adjustment.penalty
            ? 'minor'
            : adjustment.weight,
    }));
}
