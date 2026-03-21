export type FeatureTier = 1 | 2 | 3;
export type EvidenceSource = 'symptom_vector' | 'free_text' | 'structured_field';

export type SignalKey =
    | 'unproductive_retching'
    | 'abdominal_distension'
    | 'collapse'
    | 'honking_cough'
    | 'cough'
    | 'myoclonus'
    | 'dyspnea'
    | 'tachycardia'
    | 'pale_mucous_membranes'
    | 'productive_vomiting'
    | 'diarrhea'
    | 'fever'
    | 'lethargy'
    | 'anorexia'
    | 'weakness'
    | 'hypersalivation'
    | 'seizures'
    | 'nasal_discharge'
    | 'ocular_discharge'
    | 'pneumonia';

export interface SignalEvidence {
    present: boolean;
    strength: number;
    matched_terms: string[];
    sources: EvidenceSource[];
    tier: FeatureTier;
}

export interface ClinicalSignals {
    species: string | null;
    breed: string | null;
    weight_kg: number | null;
    age_description: string | null;
    age_months: number | null;
    duration_days: number | null;
    appetite_status: string | null;
    symptoms: string[];
    free_text_fragments: string[];
    all_text: string;
    evidence: Record<SignalKey, SignalEvidence>;
    has_deep_chested_breed_risk: boolean;
    has_small_breed_gdv_mismatch: boolean;
    has_small_breed_tracheal_collapse_risk: boolean;
    has_exposure_risk: boolean;
    has_isolated_environment: boolean;
    gdv_cluster_count: number;
    gdv_pattern_strength: number;
    shock_pattern_strength: number;
    distemper_pattern_strength: number;
    upper_airway_pattern_strength: number;
    respiratory_infection_pattern_strength: number;
}

interface SignalDefinition {
    label: string;
    tier: FeatureTier;
    terms: string[];
    structured_fields?: string[];
}

const SIGNAL_DEFINITIONS: Record<SignalKey, SignalDefinition> = {
    unproductive_retching: {
        label: 'unproductive retching',
        tier: 1,
        terms: ['unproductive retching', 'dry heaving', 'retching', 'trying to vomit', 'nonproductive retching'],
    },
    abdominal_distension: {
        label: 'abdominal distension',
        tier: 1,
        terms: ['abdominal distension', 'distended abdomen', 'bloated', 'bloat', 'swollen abdomen', 'distended belly'],
        structured_fields: ['abdominal_distension'],
    },
    collapse: {
        label: 'collapse',
        tier: 2,
        terms: ['collapse', 'collapsed', 'unresponsive', 'shock', 'moribund'],
    },
    honking_cough: {
        label: 'honking cough',
        tier: 1,
        terms: ['honking cough', 'goose honk cough', 'goose-honk cough', 'hacking cough', 'harsh cough'],
    },
    cough: {
        label: 'cough',
        tier: 2,
        terms: ['cough', 'coughing'],
    },
    myoclonus: {
        label: 'myoclonus',
        tier: 1,
        terms: ['myoclonus', 'muscle twitching', 'rhythmic twitching'],
    },
    dyspnea: {
        label: 'dyspnea',
        tier: 2,
        terms: ['dyspnea', 'difficulty breathing', 'respiratory distress', 'labored breathing', 'shortness of breath'],
    },
    tachycardia: {
        label: 'tachycardia',
        tier: 2,
        terms: ['tachycardia', 'rapid heart rate', 'rapid heart', 'increased heart rate'],
    },
    pale_mucous_membranes: {
        label: 'pale mucous membranes',
        tier: 2,
        terms: ['pale mucous membranes', 'pale gums', 'pale mm', 'pale mucous membrane'],
    },
    productive_vomiting: {
        label: 'productive vomiting',
        tier: 2,
        terms: ['productive vomiting', 'vomiting', 'vomited', 'emesis'],
        structured_fields: ['productive_vomiting'],
    },
    diarrhea: {
        label: 'diarrhea',
        tier: 2,
        terms: ['diarrhea', 'loose stool', 'loose stools', 'soft stool'],
    },
    fever: {
        label: 'fever',
        tier: 2,
        terms: ['fever', 'febrile', 'pyrexia'],
    },
    lethargy: {
        label: 'lethargy',
        tier: 3,
        terms: ['lethargy', 'lethargic', 'listless'],
    },
    anorexia: {
        label: 'anorexia',
        tier: 3,
        terms: ['anorexia', 'inappetence', 'loss of appetite', 'not eating', 'poor appetite'],
    },
    weakness: {
        label: 'weakness',
        tier: 3,
        terms: ['weakness', 'weak', 'unable to stand'],
    },
    hypersalivation: {
        label: 'hypersalivation',
        tier: 2,
        terms: ['hypersalivation', 'drooling', 'salivating', 'excessive salivation'],
    },
    seizures: {
        label: 'seizures',
        tier: 2,
        terms: ['seizures', 'seizure activity', 'convulsions', 'status epilepticus'],
    },
    nasal_discharge: {
        label: 'nasal discharge',
        tier: 2,
        terms: ['nasal discharge', 'runny nose', 'snotty nose'],
    },
    ocular_discharge: {
        label: 'ocular discharge',
        tier: 2,
        terms: ['ocular discharge', 'eye discharge', 'watery eyes', 'conjunctival discharge'],
    },
    pneumonia: {
        label: 'pneumonia',
        tier: 2,
        terms: ['pneumonia', 'pulmonary infiltrates'],
    },
};

const DEEP_CHESTED_GDV_BREEDS = [
    'great dane',
    'weimaraner',
    'saint bernard',
    'gordon setter',
    'irish setter',
    'standard poodle',
    'doberman',
    'german shepherd',
    'old english sheepdog',
    'basset hound',
];

const SMALL_BREED_AIRWAY_BREEDS = [
    'yorkshire terrier',
    'pomeranian',
    'chihuahua',
    'maltese',
    'toy poodle',
    'miniature poodle',
    'shih tzu',
    'pug',
    'dachshund',
];

export const FEATURE_TIER_MULTIPLIER: Record<FeatureTier, number> = {
    1: 1.45,
    2: 1.0,
    3: 0.55,
};

export function extractClinicalSignals(input: Record<string, unknown>): ClinicalSignals {
    const species = normalizeString(
        typeof input.species === 'string'
            ? input.species
            : typeof getMetadata(input).species === 'string'
                ? (getMetadata(input).species as string)
                : null
    );
    const breed = normalizeString(
        typeof input.breed === 'string'
            ? input.breed
            : typeof getMetadata(input).breed === 'string'
                ? (getMetadata(input).breed as string)
                : null
    );
    const weightKg = extractWeightKg(input);
    const ageDescription = extractAgeDescription(input);
    const ageMonths = parseAgeMonths(ageDescription);
    const durationDays = parseDurationDays(input);
    const appetiteStatus = normalizeString(
        typeof input.appetite_status === 'string'
            ? input.appetite_status
            : typeof getMetadata(input).appetite_status === 'string'
                ? (getMetadata(input).appetite_status as string)
                : null
    );

    const symptoms = extractSymptomVector(input);
    const freeTextFragments = extractFreeTextFragments(input);
    const allFragments = [...symptoms, ...freeTextFragments];
    const allText = allFragments.join(' ').toLowerCase();

    const evidence = {} as Record<SignalKey, SignalEvidence>;

    for (const [key, definition] of Object.entries(SIGNAL_DEFINITIONS) as Array<[SignalKey, SignalDefinition]>) {
        const matchedTerms = new Set<string>();
        const sources = new Set<EvidenceSource>();

        for (const symptom of symptoms) {
            const matches = findMatchedTerms(symptom, definition.terms, key);
            if (matches.length > 0) {
                sources.add('symptom_vector');
                for (const match of matches) matchedTerms.add(match);
            }
        }

        for (const fragment of freeTextFragments) {
            const matches = findMatchedTerms(fragment, definition.terms, key);
            if (matches.length > 0) {
                sources.add('free_text');
                for (const match of matches) matchedTerms.add(match);
            }
        }

        for (const field of definition.structured_fields ?? []) {
            if (readBooleanField(input, field) === true) {
                sources.add('structured_field');
                matchedTerms.add(field);
            }
        }

        evidence[key] = {
            present: sources.size > 0,
            strength: sources.has('symptom_vector') || sources.has('free_text') ? 1 : sources.has('structured_field') ? 0.7 : 0,
            matched_terms: [...matchedTerms],
            sources: [...sources],
            tier: definition.tier,
        };
    }

    const gdvClusterCount = countPresent(evidence, [
        'unproductive_retching',
        'abdominal_distension',
        'collapse',
        'dyspnea',
        'pale_mucous_membranes',
        'tachycardia',
    ]);
    const shockPatternStrength = weightedPresence(evidence, ['collapse', 'pale_mucous_membranes', 'tachycardia', 'dyspnea', 'weakness']);
    const hasDeepChestedBreedRisk = breed != null && DEEP_CHESTED_GDV_BREEDS.some((candidate) => breed.includes(candidate));
    const hasSmallBreedGdvMismatch = Boolean(
        gdvClusterCount >= 3 &&
        ((breed != null && !hasDeepChestedBreedRisk) || (weightKg != null && weightKg <= 12))
    );
    const gdvPatternStrength = weightedPresence(evidence, [
        'unproductive_retching',
        'abdominal_distension',
        'collapse',
        'dyspnea',
        'tachycardia',
        'pale_mucous_membranes',
        'hypersalivation',
    ]) + (hasDeepChestedBreedRisk ? 0.18 : 0);
    const distemperPatternStrength = weightedPresence(evidence, [
        'myoclonus',
        'seizures',
        'nasal_discharge',
        'pneumonia',
        'fever',
    ]);
    const upperAirwayPatternStrength = weightedPresence(evidence, [
        'honking_cough',
        'cough',
        'nasal_discharge',
        'ocular_discharge',
        'dyspnea',
    ]);
    const respiratoryInfectionPatternStrength = weightedPresence(evidence, [
        'honking_cough',
        'cough',
        'nasal_discharge',
        'ocular_discharge',
        'fever',
        'lethargy',
    ]);
    const hasSmallBreedTrachealCollapseRisk = Boolean(
        (breed != null && SMALL_BREED_AIRWAY_BREEDS.some((candidate) => breed.includes(candidate)))
        || (weightKg != null && weightKg <= 12)
    );
    const hasExposureRisk = hasExposureHistory(input, allText);
    const hasIsolatedEnvironment = hasIsolationHistory(input, allText);

    evidence.collapse = {
        ...evidence.collapse,
        tier: evidence.collapse.present && (evidence.unproductive_retching.present || evidence.abdominal_distension.present || evidence.myoclonus.present)
            ? 1
            : 2,
    };

    evidence.weakness = {
        ...evidence.weakness,
        tier: evidence.weakness.present && shockPatternStrength >= 2 ? 2 : 3,
    };

    return {
        species,
        breed,
        weight_kg: weightKg,
        age_description: ageDescription,
        age_months: ageMonths,
        duration_days: durationDays,
        appetite_status: appetiteStatus,
        symptoms,
        free_text_fragments: freeTextFragments,
        all_text: allText,
        evidence,
        has_deep_chested_breed_risk: hasDeepChestedBreedRisk,
        has_small_breed_gdv_mismatch: hasSmallBreedGdvMismatch,
        has_small_breed_tracheal_collapse_risk: hasSmallBreedTrachealCollapseRisk,
        has_exposure_risk: hasExposureRisk,
        has_isolated_environment: hasIsolatedEnvironment,
        gdv_cluster_count: gdvClusterCount,
        gdv_pattern_strength: gdvPatternStrength,
        shock_pattern_strength: shockPatternStrength,
        distemper_pattern_strength: distemperPatternStrength,
        upper_airway_pattern_strength: upperAirwayPatternStrength,
        respiratory_infection_pattern_strength: respiratoryInfectionPatternStrength,
    };
}

export function parseAgeMonths(ageDescription: string | null): number | null {
    if (!ageDescription) return null;
    const lower = ageDescription.toLowerCase();
    const weekMatch = lower.match(/(\d+(?:\.\d+)?)\s*week/);
    if (weekMatch) return Number.parseFloat(weekMatch[1]) / 4;
    const monthMatch = lower.match(/(\d+(?:\.\d+)?)\s*month/);
    if (monthMatch) return Number.parseFloat(monthMatch[1]);
    const yearMatch = lower.match(/(\d+(?:\.\d+)?)\s*year/);
    if (yearMatch) return Number.parseFloat(yearMatch[1]) * 12;
    const dayMatch = lower.match(/(\d+(?:\.\d+)?)\s*day/);
    if (dayMatch) return Number.parseFloat(dayMatch[1]) / 30;
    return null;
}

export function parseDurationDays(input: Record<string, unknown>): number | null {
    const direct = readNumberField(input, 'duration_days');
    if (direct != null) return direct;

    const metadata = getMetadata(input);
    const metaDuration = typeof metadata.duration_days === 'number'
        ? metadata.duration_days
        : typeof metadata.duration === 'string'
            ? metadata.duration
            : null;

    if (typeof metaDuration === 'number') return metaDuration;
    if (typeof metaDuration !== 'string') return null;

    const lower = metaDuration.toLowerCase();
    const match = lower.match(/(\d+(?:\.\d+)?)\s*(hour|day|week|month)/);
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    const unit = match[2];
    if (unit.startsWith('hour')) return value / 24;
    if (unit.startsWith('week')) return value * 7;
    if (unit.startsWith('month')) return value * 30;
    return value;
}

export function normalizeString(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

export function readBooleanField(input: Record<string, unknown>, field: string): boolean | null {
    const direct = input[field];
    if (typeof direct === 'boolean') return direct;
    const metadata = getMetadata(input);
    const nested = metadata[field];
    return typeof nested === 'boolean' ? nested : null;
}

export function readNumberField(input: Record<string, unknown>, field: string): number | null {
    const direct = input[field];
    if (typeof direct === 'number') return direct;
    const metadata = getMetadata(input);
    const nested = metadata[field];
    return typeof nested === 'number' ? nested : null;
}

export function getFeatureLabel(signal: SignalKey): string {
    return SIGNAL_DEFINITIONS[signal].label;
}

function extractSymptomVector(input: Record<string, unknown>): string[] {
    const symptoms: string[] = [];

    if (Array.isArray(input.symptoms)) {
        for (const symptom of input.symptoms) {
            if (typeof symptom === 'string' && symptom.trim().length > 0) {
                symptoms.push(symptom.toLowerCase().trim());
            }
        }
    } else if (typeof input.symptoms === 'string') {
        symptoms.push(...splitTextList(input.symptoms));
    }

    return symptoms;
}

function extractFreeTextFragments(input: Record<string, unknown>): string[] {
    const fragments: string[] = [];
    const fields = ['edge_cases', 'contradictions', 'chief_complaint', 'history', 'raw_note', 'notes', 'presentation'];

    for (const field of fields) {
        if (typeof input[field] === 'string' && input[field].trim().length > 0) {
            fragments.push(input[field].toLowerCase().trim());
        }
    }

    const metadata = getMetadata(input);
    for (const field of fields) {
        if (typeof metadata[field] === 'string' && metadata[field].trim().length > 0) {
            fragments.push(metadata[field].toLowerCase().trim());
        }
    }

    return [...new Set(fragments)];
}

function splitTextList(value: string): string[] {
    return value
        .toLowerCase()
        .split(/[,;\n]|(?:\band\b)/)
        .map((fragment) => fragment.trim())
        .filter((fragment) => fragment.length > 0);
}

function getMetadata(input: Record<string, unknown>): Record<string, unknown> {
    return input.metadata && typeof input.metadata === 'object'
        ? (input.metadata as Record<string, unknown>)
        : {};
}

function extractWeightKg(input: Record<string, unknown>): number | null {
    const weightKg = readNumberField(input, 'weight_kg');
    if (weightKg != null) return weightKg;

    const weightLbs = readNumberField(input, 'weight_lbs');
    if (weightLbs != null) return weightLbs * 0.453592;

    return null;
}

function extractAgeDescription(input: Record<string, unknown>): string | null {
    if (typeof input.age === 'string') return input.age;
    if (typeof input.age_description === 'string') return input.age_description;

    const metadata = getMetadata(input);
    if (typeof metadata.age === 'string') return metadata.age;
    if (typeof metadata.age_description === 'string') return metadata.age_description;
    return null;
}

function findMatchedTerms(fragment: string, terms: string[], signal: SignalKey): string[] {
    const normalized = fragment.toLowerCase();
    const matches = terms.filter((term) => normalized.includes(term));

    if (signal === 'productive_vomiting' && normalized.includes('unproductive')) {
        return matches.filter((term) => term === 'productive vomiting');
    }

    return matches;
}

function countPresent(evidence: Record<SignalKey, SignalEvidence>, keys: SignalKey[]): number {
    return keys.filter((key) => evidence[key].present).length;
}

function weightedPresence(evidence: Record<SignalKey, SignalEvidence>, keys: SignalKey[]): number {
    return keys.reduce((total, key) => {
        const signal = evidence[key];
        if (!signal.present) return total;
        return total + (FEATURE_TIER_MULTIPLIER[signal.tier] * signal.strength);
    }, 0);
}

function hasExposureHistory(input: Record<string, unknown>, allText: string): boolean {
    if (readBooleanField(input, 'kennel_exposure') === true) return true;
    if (readBooleanField(input, 'exposure_to_other_dogs') === true) return true;
    if (readBooleanField(input, 'boarding_exposure') === true) return true;
    return textIncludesAny(allText, [
        'boarding',
        'kennel',
        'daycare',
        'dog park',
        'shelter',
        'recent exposure',
        'exposed to other dogs',
        'multiple dogs',
    ]);
}

function hasIsolationHistory(input: Record<string, unknown>, allText: string): boolean {
    if (readBooleanField(input, 'isolated_environment') === true) return true;
    if (readBooleanField(input, 'no_exposure') === true) return true;
    return textIncludesAny(allText, [
        'isolated',
        'indoor only',
        'single dog household',
        'no exposure',
        'no recent exposure',
        'home isolation',
    ]);
}

function textIncludesAny(value: string, terms: string[]) {
    return terms.some((term) => value.includes(term));
}
