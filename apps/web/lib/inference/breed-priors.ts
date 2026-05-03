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
    { breeds: ['cocker_spaniel', 'english_cocker_spaniel', 'american_cocker_spaniel'],
        condition_id: 'imha_canine', multiplier: 3.8, evidence_level: 'strong' },
    { breeds: ['old_english_sheepdog', 'english_springer_spaniel', 'irish_setter'],
        condition_id: 'imha_canine', multiplier: 2.5, evidence_level: 'moderate' },
    { breeds: ['miniature_poodle', 'bichon_frise', 'maltese'],
        condition_id: 'imha_canine', multiplier: 2.0, evidence_level: 'moderate' },
    { breeds: ['golden_retriever', 'dobermann', 'irish_setter', 'boxer', 'cocker_spaniel',
        'airedale_terrier', 'miniature_schnauzer', 'great_dane', 'old_english_sheepdog'],
        condition_id: 'hypothyroidism_canine', multiplier: 3.0, evidence_level: 'strong' },
    { breeds: ['standard_poodle', 'portuguese_water_dog', 'bearded_collie',
        'great_pyrenees', 'rottweiler', 'west_highland_white_terrier',
        'wheaten_terrier', 'nova_scotia_duck_tolling_retriever'],
        condition_id: 'addisons_canine', multiplier: 4.5, evidence_level: 'strong' },
    { breeds: ['samoyed', 'australian_terrier', 'miniature_schnauzer', 'spitz',
        'bichon_frise', 'keeshond', 'tibetan_terrier', 'cairn_terrier'],
        condition_id: 'diabetes_mellitus_canine', multiplier: 3.0, evidence_level: 'strong' },
    { breeds: ['yorkshire_terrier', 'maltese', 'miniature_schnauzer', 'pug',
        'shih_tzu', 'bichon_frise', 'havanese'],
        condition_id: 'portosystemic_shunt', multiplier: 6.0, evidence_level: 'strong' },
    { breeds: ['irish_wolfhound', 'golden_retriever', 'labrador_retriever',
        'great_dane', 'old_english_sheepdog'],
        condition_id: 'portosystemic_shunt', multiplier: 3.5, evidence_level: 'moderate' },
    { breeds: ['golden_retriever', 'german_shepherd', 'labrador_retriever',
        'flat_coated_retriever', 'skye_terrier'],
        condition_id: 'haemangiosarcoma', multiplier: 5.0, evidence_level: 'strong' },
    { breeds: ['german_shepherd', 'pembroke_welsh_corgi', 'boxer', 'chesapeake_bay_retriever',
        'rhodesian_ridgeback', 'bernese_mountain_dog'],
        condition_id: 'degenerative_myelopathy', multiplier: 4.0, evidence_level: 'strong' },
    { breeds: ['maine_coon', 'ragdoll', 'british_shorthair', 'sphynx',
        'persian', 'american_shorthair'],
        condition_id: 'hypertrophic_cardiomyopathy_feline', multiplier: 5.0, evidence_level: 'strong' },
    { breeds: ['abyssinian', 'bengal', 'birman', 'himalayan', 'ragdoll',
        'british_shorthair', 'devon_rex'],
        condition_id: 'feline_infectious_peritonitis', multiplier: 2.5, evidence_level: 'moderate' },
    { breeds: ['french_bulldog', 'english_bulldog', 'pug', 'boston_terrier',
        'shih_tzu', 'cavalier_king_charles_spaniel', 'pekinese',
        'boxer', 'shar_pei'],
        condition_id: 'brachycephalic_obstructive_airway_syndrome', multiplier: 8.0, evidence_level: 'strong' },
    { breeds: ['bedlington_terrier', 'west_highland_white_terrier',
        'labrador_retriever', 'dalmatian', 'dobermann', 'skye_terrier'],
        condition_id: 'copper_associated_hepatopathy', multiplier: 5.0, evidence_level: 'strong' },
    { breeds: ['golden_retriever', 'labrador_retriever', 'german_shepherd',
        'weimaraner', 'cavalier_king_charles_spaniel'],
        condition_id: 'masticatory_muscle_myositis', multiplier: 3.0, evidence_level: 'moderate' },
    { breeds: ['labrador_retriever', 'golden_retriever', 'german_shepherd',
        'working_type_breeds'],
        condition_id: 'leptospirosis_canine', multiplier: 1.8, evidence_level: 'anecdotal' },
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

export function applyBreedPriors(
    request: InferenceRequest,
): Array<{ condition_id: string; multiplier: number; evidence_level?: string }> {
    if (!request.breed) return [];
    const normalisedBreed = request.breed.toLowerCase().replace(/[\s-]+/g, '_');
    return BREED_PRIOR_RULES
        .filter((rule) => rule.breeds.some((breed) => normalisedBreed.includes(breed) || breed.includes(normalisedBreed)))
        .map((rule) => ({
            condition_id: rule.condition_id,
            multiplier: rule.multiplier,
            evidence_level: rule.evidence_level,
        }));
}
