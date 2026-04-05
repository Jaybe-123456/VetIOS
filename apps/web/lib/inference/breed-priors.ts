import type { InferenceRequest, VeterinaryCondition } from './types';

export interface BreedPriorRule {
    breeds: string[];
    condition_id: string;
    multiplier: number;
    evidence_level?: 'strong' | 'moderate' | 'anecdotal';
}

export const BREED_PRIOR_RULES: BreedPriorRule[] = [
    {
        breeds: ['labrador_retriever', 'golden_retriever', 'german_shepherd', 'rottweiler', 'dobermann', 'great_dane', 'husky', 'border_collie', 'belgian_malinois', 'boxer', 'standard_poodle', 'weimaraner', 'vizsla'],
        condition_id: 'tracheal_collapse',
        multiplier: 0.05,
        evidence_level: 'strong',
    },
    {
        breeds: ['pomeranian', 'yorkshire_terrier', 'chihuahua', 'maltese', 'toy_poodle', 'miniature_poodle', 'pug', 'shih_tzu', 'lhasa_apso', 'miniature_schnauzer', 'cavalier_kcs', 'miniature_pinscher', 'papillon'],
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
        breeds: ['pomeranian', 'chihuahua', 'dachshund', 'maltese', 'miniature_poodle', 'toy_poodle', 'miniature_schnauzer', 'boston_terrier', 'miniature_pinscher'],
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

const BREED_CATEGORY_MAP: Record<string, string[]> = {
    small_breed: ['pomeranian', 'chihuahua', 'yorkshire_terrier', 'maltese', 'miniature_poodle', 'shih_tzu'],
    toy_breed: ['pomeranian', 'chihuahua', 'yorkshire_terrier', 'maltese', 'papillon', 'miniature_pinscher'],
    large_breed: ['labrador_retriever', 'golden_retriever', 'german_shepherd', 'rottweiler', 'great_dane'],
    medium_breed: ['beagle', 'cocker_spaniel', 'border_collie', 'bulldog', 'whippet'],
};

const BREED_ALIASES: Record<string, string> = {
    pomeranian_dog: 'pomeranian',
    cavalier_king_charles_spaniel: 'cavalier_king_charles_spaniel',
    cavalier_kcs: 'cavalier_king_charles_spaniel',
    mini_poodle: 'miniature_poodle',
    miniature_poodle_mix: 'miniature_poodle',
    labrador: 'labrador_retriever',
    labrador_retriever_dog: 'labrador_retriever',
    golden: 'golden_retriever',
};

export function normalizeBreedKey(breed: string | null | undefined): string {
    const normalized = String(breed ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return BREED_ALIASES[normalized] ?? normalized;
}

export function normaliseBread(breedInput: string): string[] {
    const normalized = normalizeBreedKey(breedInput);
    return BREED_CATEGORY_MAP[normalized] ?? [normalized];
}

export function normaliseBreed(breedInput: string): string[] {
    return normaliseBread(breedInput);
}

export function getBreedMultiplier(conditionId: string, breed: string | null | undefined): number {
    const breedKey = normalizeBreedKey(breed);
    if (!breedKey) return 1;
    const breedKeys = normaliseBread(breedKey);
    const isCategoryInput = breedKeys.length > 1 || Boolean(BREED_CATEGORY_MAP[breedKey]);

    const matches = BREED_PRIOR_RULES.filter((rule) =>
        rule.condition_id === conditionId
        && (breedKeys.some((key) => rule.breeds.includes(key)) || rule.breeds.includes('all_dogs')),
    );
    if (matches.length === 0) return 1;

    if (isCategoryInput) {
        const total = matches.reduce((sum, rule) => sum + rule.multiplier, 0);
        return total / matches.length;
    }

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
