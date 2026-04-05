import type { InferenceRequest, VeterinaryCondition } from './types';

export interface BreedPriorRule {
    breeds: string[];
    condition_id: string;
    multiplier: number;
    evidence_level?: 'strong' | 'moderate' | 'anecdotal';
}

export const BREED_PRIOR_RULES: BreedPriorRule[] = [
    {
        breeds: ['labrador_retriever', 'german_shepherd', 'golden_retriever', 'rottweiler', 'dobermann', 'great_dane', 'husky', 'border_collie', 'belgian_malinois'],
        condition_id: 'tracheal_collapse',
        multiplier: 0.05,
        evidence_level: 'strong',
    },
    {
        breeds: ['yorkshire_terrier', 'pomeranian', 'chihuahua', 'maltese', 'toy_poodle', 'miniature_poodle', 'pug', 'shih_tzu'],
        condition_id: 'tracheal_collapse',
        multiplier: 8,
        evidence_level: 'strong',
    },
    {
        breeds: ['labrador_retriever', 'golden_retriever', 'great_pyrenees', 'saint_bernard', 'newfoundland', 'irish_setter'],
        condition_id: 'laryngeal_paralysis',
        multiplier: 4,
        evidence_level: 'strong',
    },
    {
        breeds: ['cavalier_king_charles_spaniel'],
        condition_id: 'mitral_valve_disease_canine',
        multiplier: 12,
        evidence_level: 'strong',
    },
    {
        breeds: ['chihuahua', 'dachshund', 'maltese', 'miniature_poodle', 'miniature_schnauzer'],
        condition_id: 'mitral_valve_disease_canine',
        multiplier: 4,
        evidence_level: 'strong',
    },
    {
        breeds: ['dobermann', 'great_dane', 'boxer', 'irish_wolfhound', 'saint_bernard', 'newfoundland'],
        condition_id: 'dilated_cardiomyopathy_canine',
        multiplier: 6,
        evidence_level: 'strong',
    },
    {
        breeds: ['dachshund', 'basset_hound', 'beagle', 'cocker_spaniel', 'shih_tzu', 'lhasa_apso', 'pekingese'],
        condition_id: 'intervertebral_disc_disease',
        multiplier: 8,
        evidence_level: 'strong',
    },
    {
        breeds: ['great_dane', 'irish_setter', 'gordon_setter', 'weimaraner', 'saint_bernard', 'standard_poodle', 'basset_hound', 'german_shepherd', 'dobermann'],
        condition_id: 'gastric_dilatation_volvulus',
        multiplier: 6,
        evidence_level: 'strong',
    },
    {
        breeds: ['german_shepherd', 'golden_retriever', 'labrador_retriever', 'boxer', 'whippet'],
        condition_id: 'hemangiosarcoma',
        multiplier: 4,
        evidence_level: 'moderate',
    },
    {
        breeds: ['standard_poodle', 'bearded_collie', 'portuguese_water_dog', 'nova_scotia_duck_tolling_retriever'],
        condition_id: 'hypoadrenocorticism_canine',
        multiplier: 5,
        evidence_level: 'strong',
    },
    {
        breeds: ['golden_retriever', 'labrador_retriever', 'dobermann', 'boxer', 'cocker_spaniel', 'dachshund'],
        condition_id: 'hypothyroidism_canine',
        multiplier: 2.5,
        evidence_level: 'moderate',
    },
    {
        breeds: ['all_dogs'],
        condition_id: 'spirocercosis',
        multiplier: 1,
        evidence_level: 'moderate',
    },
];

export function normalizeBreedKey(breed: string | null | undefined): string {
    return String(breed ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function getBreedMultiplier(conditionId: string, breed: string | null | undefined): number {
    const breedKey = normalizeBreedKey(breed);
    if (!breedKey) return 1;

    const matches = BREED_PRIOR_RULES.filter((rule) =>
        rule.condition_id === conditionId
        && (rule.breeds.includes(breedKey) || rule.breeds.includes('all_dogs')),
    );
    if (matches.length === 0) return 1;

    return matches.reduce((multiplier, rule) => multiplier * rule.multiplier, 1);
}

export function applyBreedSpecificPriors(
    candidates: VeterinaryCondition[],
    baseScores: Map<string, number>,
    request: InferenceRequest,
): Map<string, number> {
    const nextScores = new Map(baseScores);

    for (const candidate of candidates) {
        const multiplier = getBreedMultiplier(candidate.id, request.breed);
        nextScores.set(candidate.id, (nextScores.get(candidate.id) ?? 0.01) * multiplier);
    }

    return nextScores;
}
