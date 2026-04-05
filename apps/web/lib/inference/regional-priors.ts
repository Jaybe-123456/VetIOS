import { getConditionsForSpecies } from './condition-registry';
import type { InferenceRequest, Species, VeterinaryCondition } from './types';

export interface RegionalPriorSet {
    region: string;
    species: Species;
    disease: string;
    base_prevalence: number;
    seasonality?: {
        peak_months: number[];
        off_peak_multiplier: number;
    };
    source: string;
}

export const REGIONAL_PRIORS: RegionalPriorSet[] = [
    { region: 'nairobi_ke', species: 'canine', disease: 'Ehrlichia canis', base_prevalence: 0.18, source: 'VetIOS East Africa canine vector-borne baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Babesia rossi / gibsoni', base_prevalence: 0.14, source: 'VetIOS East Africa canine vector-borne baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Dirofilaria immitis', base_prevalence: 0.08, source: 'VetIOS Kenya mosquito-endemic cardiopulmonary parasitology baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Hepatozoon canis', base_prevalence: 0.07, source: 'VetIOS East Africa canine vector-borne baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Anaplasma platys', base_prevalence: 0.10, source: 'VetIOS East Africa canine vector-borne baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Leishmaniosis', base_prevalence: 0.04, source: 'VetIOS highland Nairobi lower sandfly exposure baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Trypanosoma brucei', base_prevalence: 0.03, source: 'VetIOS East Africa protozoal baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Parvovirus', base_prevalence: 0.12, source: 'VetIOS vaccination-gap adjusted canine infectious baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Distemper', base_prevalence: 0.08, source: 'VetIOS vaccination-gap adjusted canine infectious baseline' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Leptospirosis', base_prevalence: 0.06, source: 'VetIOS East Africa standing-water and wildlife exposure baseline' },
    { region: 'east_africa', species: 'canine', disease: 'Ehrlichia canis', base_prevalence: 0.18, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Babesia rossi / gibsoni', base_prevalence: 0.14, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Dirofilaria immitis', base_prevalence: 0.08, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Hepatozoon canis', base_prevalence: 0.07, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Anaplasma platys', base_prevalence: 0.10, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Leishmaniosis', base_prevalence: 0.04, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Trypanosoma brucei', base_prevalence: 0.03, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Parvovirus', base_prevalence: 0.12, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Distemper', base_prevalence: 0.08, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Leptospirosis', base_prevalence: 0.06, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'feline', disease: 'FeLV', base_prevalence: 0.05, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'feline', disease: 'FIV', base_prevalence: 0.08, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'feline', disease: 'Cytauxzoon felis', base_prevalence: 0.03, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'feline', disease: 'Toxoplasma gondii', base_prevalence: 0.06, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'feline', disease: 'Haemobartonella', base_prevalence: 0.07, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'East Coast Fever (Theileria parva)', base_prevalence: 0.25, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Foot and Mouth Disease', base_prevalence: 0.15, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Trypanosomiasis', base_prevalence: 0.20, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Lumpy Skin Disease', base_prevalence: 0.12, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Rift Valley Fever', base_prevalence: 0.08, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Contagious Bovine Pleuropneumonia', base_prevalence: 0.10, source: 'VetIOS Kenya livestock baseline' },
    { region: 'mediterranean', species: 'canine', disease: 'Leishmaniosis', base_prevalence: 0.15, source: 'VetIOS Mediterranean canine vector-borne baseline' },
    { region: 'mediterranean', species: 'canine', disease: 'Ehrlichia canis', base_prevalence: 0.08, source: 'VetIOS Mediterranean canine vector-borne baseline' },
    { region: 'mediterranean', species: 'canine', disease: 'Hepatozoon canis', base_prevalence: 0.06, source: 'VetIOS Mediterranean canine vector-borne baseline' },
];

const REGION_ALIASES: Record<string, string[]> = {
    nairobi_ke: ['nairobi', 'kenya', 'nairobi_kenya'],
    east_africa: ['east_africa', 'east africa', 'kenya', 'uganda', 'tanzania'],
    sub_saharan_africa: ['sub_saharan_africa', 'sub saharan africa', 'africa'],
    mediterranean: ['mediterranean', 'southern_europe', 'southern europe', 'spain', 'italy', 'greece'],
};

const DISEASE_TO_CONDITION_ID: Record<string, string> = {
    'Ehrlichia canis': 'ehrlichiosis_canine',
    'Babesia rossi / gibsoni': 'babesiosis_canine',
    'Dirofilaria immitis': 'dirofilariosis_canine',
    'Hepatozoon canis': 'hepatozoonosis',
    'Anaplasma platys': 'anaplasmosis_canine',
    Leishmaniosis: 'leishmaniosis_canine',
    'Trypanosoma brucei': 'trypanosomiasis',
    Parvovirus: 'parvoviral_enteritis',
    Distemper: 'canine_distemper',
    Leptospirosis: 'leptospirosis',
};

export function normalizeRegionKey(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!normalized) return null;

    for (const [canonical, aliases] of Object.entries(REGION_ALIASES)) {
        if (canonical === normalized || aliases.includes(normalized)) {
            return canonical;
        }
    }

    return normalized;
}

export function resolveRegionalKeys(request: InferenceRequest): string[] {
    const candidateKeys = [
        request.region,
        request.history?.geographic_region,
        ...(request.history?.travel_history ?? []),
    ]
        .map((value) => normalizeRegionKey(value))
        .filter((value): value is string => Boolean(value));

    const deduped = [...new Set(candidateKeys)];
    return deduped.length > 0 ? deduped : ['east_africa'];
}

export function applyRegionalExposurePriors(
    candidates: VeterinaryCondition[],
    request: InferenceRequest,
): Map<string, number> {
    const scores = new Map<string, number>();
    const regions = resolveRegionalKeys(request);
    const heartwormPrevention = request.preventive_history?.heartworm_prevention ?? 'unknown';
    const ectoparasitePrevention = request.preventive_history?.ectoparasite_prevention ?? 'unknown';
    const vectorExposure = request.preventive_history?.vector_exposure;
    const month = new Date().getUTCMonth() + 1;

    for (const candidate of candidates) {
        const baseline = regions.reduce((best, regionKey) => {
            const registryValue = candidate.regional_prevalence[regionKey] ?? 0;
            const mappedRegional = REGIONAL_PRIORS.find((prior) =>
                prior.region === regionKey
                && prior.species === candidate.species_affected[0]
                && DISEASE_TO_CONDITION_ID[prior.disease] === candidate.id,
            );
            const seasonalValue = mappedRegional == null
                ? 0
                : mappedRegional.seasonality == null
                    ? mappedRegional.base_prevalence
                    : mappedRegional.seasonality.peak_months.includes(month)
                        ? mappedRegional.base_prevalence
                        : mappedRegional.base_prevalence * mappedRegional.seasonality.off_peak_multiplier;
            return Math.max(best, registryValue, seasonalValue);
        }, 0.01);

        scores.set(candidate.id, baseline || 0.01);
    }

    if (vectorExposure?.mosquito_endemic) {
        const heartwormBase = heartwormPrevention === 'none'
            ? 0.15
            : heartwormPrevention === 'consistent'
                ? 0.001
                : 0.08;
        scores.set('dirofilariosis_canine', Math.max(scores.get('dirofilariosis_canine') ?? 0.01, heartwormBase));
        scores.set('leishmaniosis_canine', Math.max(scores.get('leishmaniosis_canine') ?? 0.01, 0.05));
    }

    if (vectorExposure?.wildlife_contact) {
        scores.set('leptospirosis', Math.max(scores.get('leptospirosis') ?? 0.01, 0.08));
        scores.set('rabies', Math.max(scores.get('rabies') ?? 0.01, 0.06));
    }

    if (vectorExposure?.tick_endemic && (ectoparasitePrevention === 'none' || ectoparasitePrevention === 'inconsistent' || ectoparasitePrevention === 'unknown')) {
        scores.set('ehrlichiosis_canine', Math.max(scores.get('ehrlichiosis_canine') ?? 0.01, 0.12));
        scores.set('anaplasmosis_canine', Math.max(scores.get('anaplasmosis_canine') ?? 0.01, 0.10));
        scores.set('babesiosis_canine', Math.max(scores.get('babesiosis_canine') ?? 0.01, 0.09));
        scores.set('hepatozoonosis', Math.max(scores.get('hepatozoonosis') ?? 0.01, 0.05));
    }

    return scores;
}

export function getRegionalPriorMap(request: InferenceRequest): Map<string, number> {
    const candidates = getConditionsForSpecies(request.species);
    const scores = applyRegionalExposurePriors(candidates, request);
    return new Map(
        candidates.map((candidate) => [candidate.canonical_name.replace(/\s+\(.+\)$/, ''), scores.get(candidate.id) ?? 0.01]),
    );
}
