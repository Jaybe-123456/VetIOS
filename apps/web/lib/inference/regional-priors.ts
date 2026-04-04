import type { InferenceRequest } from './types';

export interface RegionalPriorSet {
    region: string;
    species: 'canine' | 'feline' | 'bovine' | 'ovine' | 'caprine' | 'equine';
    disease: string;
    base_prevalence: number;
    seasonality?: {
        peak_months: number[];
        off_peak_multiplier: number;
    };
    source: string;
}

export const REGIONAL_PRIORS: RegionalPriorSet[] = [
    { region: 'nairobi_ke', species: 'canine', disease: 'Ehrlichiosis', base_prevalence: 0.18, source: 'VetIOS regional baseline: East Africa tick-borne canine burden' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Babesiosis', base_prevalence: 0.14, source: 'VetIOS regional baseline: East Africa tick-borne canine burden' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Dirofilariosis', base_prevalence: 0.08, source: 'VetIOS regional baseline: Kenya mosquito-endemic cardiopulmonary parasitology' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Hepatozoonosis', base_prevalence: 0.07, source: 'VetIOS regional baseline: East Africa tick/transmission burden' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Anaplasmosis', base_prevalence: 0.10, source: 'VetIOS regional baseline: East Africa canine vector-borne disease burden' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Leishmaniosis', base_prevalence: 0.04, source: 'VetIOS regional baseline: lower highland Nairobi exposure than coast' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Trypanosomiasis', base_prevalence: 0.03, source: 'VetIOS regional baseline: East Africa protozoal burden' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Parvoviral enteritis', base_prevalence: 0.12, source: 'VetIOS regional baseline: vaccination gap-adjusted small animal prevalence' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Canine Distemper', base_prevalence: 0.08, source: 'VetIOS regional baseline: vaccination gap-adjusted small animal prevalence' },
    { region: 'nairobi_ke', species: 'canine', disease: 'Leptospirosis', base_prevalence: 0.06, source: 'VetIOS regional baseline: wildlife and standing-water exposure' },
    { region: 'east_africa', species: 'canine', disease: 'Ehrlichiosis', base_prevalence: 0.18, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Babesiosis', base_prevalence: 0.14, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Dirofilariosis', base_prevalence: 0.08, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Hepatozoonosis', base_prevalence: 0.07, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Anaplasmosis', base_prevalence: 0.10, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Leishmaniosis', base_prevalence: 0.05, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Trypanosomiasis', base_prevalence: 0.03, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Parvoviral enteritis', base_prevalence: 0.12, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Canine Distemper', base_prevalence: 0.08, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'canine', disease: 'Leptospirosis', base_prevalence: 0.06, source: 'VetIOS East Africa regional prior' },
    { region: 'east_africa', species: 'feline', disease: 'FeLV', base_prevalence: 0.05, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'feline', disease: 'FIV', base_prevalence: 0.08, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'feline', disease: 'Cytauxzoonosis', base_prevalence: 0.03, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'feline', disease: 'Toxoplasmosis', base_prevalence: 0.06, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'feline', disease: 'Haemobartonellosis', base_prevalence: 0.07, source: 'VetIOS East Africa feline baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'East Coast Fever', base_prevalence: 0.25, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Foot and Mouth Disease', base_prevalence: 0.15, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Trypanosomiasis', base_prevalence: 0.20, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Lumpy Skin Disease', base_prevalence: 0.12, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Rift Valley Fever', base_prevalence: 0.08, source: 'VetIOS Kenya livestock baseline' },
    { region: 'east_africa', species: 'bovine', disease: 'Contagious Bovine Pleuropneumonia', base_prevalence: 0.10, source: 'VetIOS Kenya livestock baseline' },
    { region: 'mediterranean', species: 'canine', disease: 'Leishmaniosis', base_prevalence: 0.15, source: 'VetIOS Mediterranean canine vector-borne baseline' },
    { region: 'mediterranean', species: 'canine', disease: 'Ehrlichiosis', base_prevalence: 0.08, source: 'VetIOS Mediterranean canine vector-borne baseline' },
    { region: 'mediterranean', species: 'canine', disease: 'Hepatozoonosis', base_prevalence: 0.06, source: 'VetIOS Mediterranean canine vector-borne baseline' },
];

const REGION_ALIASES: Record<string, string[]> = {
    nairobi_ke: ['nairobi', 'kenya', 'nairobi_kenya', 'kenya_nairobi'],
    east_africa: ['east_africa', 'east africa', 'sub_saharan_africa', 'sub saharan africa', 'kenya', 'uganda', 'tanzania'],
    mediterranean: ['mediterranean', 'southern_europe', 'southern europe', 'spain', 'italy', 'greece'],
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
    const candidates = [
        request.region,
        request.history?.geographic_region,
        ...(request.history?.travel_history ?? []),
    ]
        .map((value) => normalizeRegionKey(value))
        .filter((value): value is string => Boolean(value));

    const deduped = [...new Set(candidates)];
    return deduped.length > 0 ? deduped : request.species.toLowerCase() === 'canine' ? ['east_africa'] : [];
}

export function getRegionalPriorMap(request: InferenceRequest): Map<string, number> {
    const regionKeys = resolveRegionalKeys(request);
    const species = request.species.toLowerCase() as RegionalPriorSet['species'];
    const currentMonth = new Date().getUTCMonth() + 1;
    const priors = new Map<string, number>();

    for (const prior of REGIONAL_PRIORS) {
        if (prior.species !== species || !regionKeys.includes(prior.region)) {
            continue;
        }

        const adjusted = prior.seasonality == null
            ? prior.base_prevalence
            : prior.seasonality.peak_months.includes(currentMonth)
                ? prior.base_prevalence
                : prior.base_prevalence * prior.seasonality.off_peak_multiplier;
        priors.set(prior.disease, Math.max(priors.get(prior.disease) ?? 0, adjusted));
    }

    return priors;
}
