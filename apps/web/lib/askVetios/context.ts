export const VETIOS_SPECIES = ['canine', 'feline', 'equine', 'bovine', 'avian', 'porcine', 'ovine'] as const;

export type VetiosSpecies = typeof VETIOS_SPECIES[number];
export type DetectedVetiosSpecies = VetiosSpecies | 'unknown';

const SPECIES_PATTERNS: Array<{ species: VetiosSpecies; patterns: RegExp[] }> = [
    { species: 'canine', patterns: [/\bcanine\b/i, /\bdogs?\b/i, /\bpupp(?:y|ies)\b/i] },
    { species: 'feline', patterns: [/\bfeline\b/i, /\bcats?\b/i, /\bkittens?\b/i] },
    { species: 'equine', patterns: [/\bequine\b/i, /\bhorses?\b/i, /\bfoals?\b/i, /\bmares?\b/i, /\bstallions?\b/i] },
    { species: 'bovine', patterns: [/\bbovine\b/i, /\bcows?\b/i, /\bcattle\b/i, /\bcalves\b/i, /\bcalf\b/i] },
    { species: 'avian', patterns: [/\bavian\b/i, /\bbirds?\b/i, /\bchickens?\b/i, /\bparrots?\b/i, /\bpsittacine\b/i, /\bturkeys?\b/i] },
    { species: 'porcine', patterns: [/\bporcine\b/i, /\bpigs?\b/i, /\bswine\b/i, /\bpiglets?\b/i] },
    { species: 'ovine', patterns: [/\bovine\b/i, /\bsheep\b/i, /\blambs?\b/i, /\bewes?\b/i] },
];

export function isVetiosSpecies(value: string | null | undefined): value is VetiosSpecies {
    return VETIOS_SPECIES.includes(value as VetiosSpecies);
}

export function detectSpeciesFromTexts(
    texts: Array<string | null | undefined>,
    fallback: DetectedVetiosSpecies = 'unknown',
): DetectedVetiosSpecies {
    for (const text of texts) {
        const trimmed = text?.trim();
        if (!trimmed) continue;

        for (const candidate of SPECIES_PATTERNS) {
            if (candidate.patterns.some((pattern) => pattern.test(trimmed))) {
                return candidate.species;
            }
        }
    }

    return fallback;
}

export function compactSearchTerms(parts: Array<string | null | undefined>) {
    return parts
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}
