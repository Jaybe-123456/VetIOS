import type { InferenceRequest } from './types';

export interface ScoredCondition {
    condition_id: string;
    probability: number;
    exposure_prior_applied?: boolean;
    exposure_prior_boost?: number;
}

type VectorExposureRule = {
    with_no_prevention?: number;
    with_inconsistent_prevention?: number;
    with_consistent_prevention?: number;
    with_unknown_prevention?: number;
    base_boost?: number;
};

const DEFAULT_BASELINE = 0.01;

export const VECTOR_EXPOSURE_PRIORS: {
    mosquito_endemic: Record<string, VectorExposureRule>;
    tick_endemic: Record<string, VectorExposureRule>;
    standing_water_access: Record<string, VectorExposureRule>;
    wildlife_contact: Record<string, VectorExposureRule>;
} = {
    mosquito_endemic: {
        dirofilariosis_canine: {
            with_no_prevention: 0.18,
            with_inconsistent_prevention: 0.08,
            with_consistent_prevention: 0.001,
            with_unknown_prevention: 0.10,
        },
        angiostrongylosis_canine: {
            with_no_prevention: 0.04,
            with_unknown_prevention: 0.02,
        },
    },
    tick_endemic: {
        ehrlichiosis_canine: { with_no_prevention: 0.18 },
        anaplasmosis_canine: { with_no_prevention: 0.10 },
        babesiosis_canine: { with_no_prevention: 0.14 },
        hepatozoonosis: { with_no_prevention: 0.07 },
    },
    standing_water_access: {
        leptospirosis: { base_boost: 0.08 },
    },
    wildlife_contact: {
        leptospirosis: { base_boost: 0.06 },
        rabies: { base_boost: 0.06 },
    },
};

function preventionKey(prevention: string | undefined) {
    switch (prevention) {
        case 'none':
            return 'with_no_prevention';
        case 'inconsistent':
            return 'with_inconsistent_prevention';
        case 'consistent':
            return 'with_consistent_prevention';
        default:
            return 'with_unknown_prevention';
    }
}

function boostFromRule(
    rule: VectorExposureRule | undefined,
    preventionField: string | undefined,
): number {
    if (!rule) return 0;
    const keyedValue = rule[preventionKey(preventionField)];
    if (typeof keyedValue === 'number') return keyedValue;
    if (typeof rule.with_unknown_prevention === 'number') return rule.with_unknown_prevention;
    if (typeof rule.base_boost === 'number') return rule.base_boost;
    return 0;
}

export function applyVectorExposurePriors(
    candidates: ScoredCondition[],
    request: InferenceRequest,
): ScoredCondition[] {
    const exposure = request.preventive_history?.vector_exposure;
    if (!exposure) return candidates;

    const heartwormPrevention = request.preventive_history?.heartworm_prevention ?? 'unknown';
    const ectoparasitePrevention = request.preventive_history?.ectoparasite_prevention ?? 'unknown';

    return candidates.map((candidate) => {
        let boost = 0;

        if (exposure.mosquito_endemic) {
            boost += boostFromRule(
                VECTOR_EXPOSURE_PRIORS.mosquito_endemic[candidate.condition_id],
                heartwormPrevention,
            );
        }

        if (
            exposure.tick_endemic
            && ['none', 'inconsistent', 'unknown'].includes(ectoparasitePrevention)
        ) {
            boost += boostFromRule(
                VECTOR_EXPOSURE_PRIORS.tick_endemic[candidate.condition_id],
                'none',
            );
        }

        if (exposure.standing_water_access) {
            boost += VECTOR_EXPOSURE_PRIORS.standing_water_access[candidate.condition_id]?.base_boost ?? 0;
        }

        if (exposure.wildlife_contact) {
            boost += VECTOR_EXPOSURE_PRIORS.wildlife_contact[candidate.condition_id]?.base_boost ?? 0;
        }

        const baseline = Number.isFinite(candidate.probability) ? candidate.probability : DEFAULT_BASELINE;

        return {
            ...candidate,
            probability: Math.min(0.99, baseline + boost),
            exposure_prior_applied: boost > 0,
            exposure_prior_boost: boost,
        };
    });
}

export function computeExposurePriors(request: InferenceRequest): Map<string, number> {
    const candidates = applyVectorExposurePriors(
        Object.keys({
            ...VECTOR_EXPOSURE_PRIORS.mosquito_endemic,
            ...VECTOR_EXPOSURE_PRIORS.tick_endemic,
            ...VECTOR_EXPOSURE_PRIORS.standing_water_access,
            ...VECTOR_EXPOSURE_PRIORS.wildlife_contact,
        }).map((condition_id) => ({
            condition_id,
            probability: DEFAULT_BASELINE,
        })),
        request,
    );

    return new Map(
        candidates
            .filter((candidate) => candidate.exposure_prior_applied)
            .map((candidate) => [candidate.condition_id, candidate.probability]),
    );
}
