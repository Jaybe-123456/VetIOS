export type FeatureTier = 1 | 2 | 3;
export type EvidenceSource = 'symptom_vector' | 'free_text' | 'structured_field';

export type SignalKey =
    | 'unproductive_retching'
    | 'abdominal_distension'
    | 'collapse'
    | 'cyanosis'
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
    | 'polyuria'
    | 'polydipsia'
    | 'polyphagia'
    | 'panting'
    | 'alopecia'
    | 'weight_loss'
    | 'pot_bellied_appearance'
    | 'marked_alp_elevation'
    | 'hypercholesterolemia'
    | 'supportive_acth_stimulation_test'
    | 'dilute_urine'
    | 'glucosuria'
    | 'glucosuria_absent'
    | 'ketonuria'
    | 'significant_hyperglycemia'
    | 'mild_hyperglycemia'
    | 'diabetic_metabolic_profile'
    | 'hypersalivation'
    | 'seizures'
    | 'nasal_discharge'
    | 'ocular_discharge'
    | 'pneumonia';

export interface SignalEvidence {
    present: boolean;
    strength: number;
    matched_terms: string[];
    negated_terms: string[];
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
    has_chronic_duration: boolean;
    has_gradual_onset: boolean;
    has_explicit_glucosuria_absence: boolean;
    gdv_cluster_count: number;
    gdv_pattern_strength: number;
    shock_pattern_strength: number;
    distemper_pattern_strength: number;
    upper_airway_pattern_strength: number;
    respiratory_infection_pattern_strength: number;
    endocrine_shared_pattern_strength: number;
    endocrine_body_pattern_strength: number;
    hyperadrenocorticism_pattern_strength: number;
    diabetes_mellitus_pattern_strength: number;
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
        terms: ['unproductive retching', 'non-productive retching', 'dry heaving', 'retching', 'trying to vomit', 'tried to vomit', 'nonproductive retching'],
    },
    abdominal_distension: {
        label: 'abdominal distension',
        tier: 1,
        terms: ['abdominal distension', 'distended abdomen', 'bloated', 'bloat', 'swollen abdomen', 'distended belly', 'stomach looks big', 'belly looks big', 'belly swollen'],
        structured_fields: ['abdominal_distension'],
    },
    collapse: {
        label: 'collapse',
        tier: 2,
        terms: ['collapse', 'collapsed', 'unresponsive', 'shock', 'moribund'],
    },
    cyanosis: {
        label: 'cyanosis',
        tier: 1,
        terms: ['cyanosis', 'cyanotic', 'blue gums', 'bluish gums', 'blue tongue', 'cyanotic mucous membranes'],
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
        terms: ['dyspnea', 'difficulty breathing', 'respiratory distress', 'labored breathing', 'shortness of breath', 'breathing hard', 'trouble breathing', 'struggling to breathe'],
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
        terms: ['productive vomiting', 'vomiting', 'vomited', 'emesis', 'throwing up'],
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
        terms: ['anorexia', 'inappetence', 'loss of appetite', 'not eating', 'poor appetite', 'won\'t eat', 'refusing food', 'hasn\'t eaten'],
    },
    weakness: {
        label: 'weakness',
        tier: 3,
        terms: ['weakness', 'weak', 'unable to stand'],
    },
    polyuria: {
        label: 'polyuria',
        tier: 3,
        terms: ['polyuria', 'urinating a lot', 'peeing more', 'increased urination', 'large urine volumes'],
        structured_fields: ['polyuria'],
    },
    polydipsia: {
        label: 'polydipsia',
        tier: 3,
        terms: ['polydipsia', 'drinking a lot', 'drinking more water', 'very thirsty', 'increased thirst', 'excessive thirst'],
        structured_fields: ['polydipsia'],
    },
    polyphagia: {
        label: 'polyphagia',
        tier: 3,
        terms: ['polyphagia', 'always hungry', 'eating a lot', 'increased appetite', 'ravenous'],
        structured_fields: ['polyphagia'],
    },
    panting: {
        label: 'panting',
        tier: 2,
        terms: ['panting', 'excessive panting', 'pants a lot', 'pants excessively'],
        structured_fields: ['panting'],
    },
    alopecia: {
        label: 'alopecia',
        tier: 2,
        terms: ['alopecia', 'hair loss', 'hair thinning', 'thinning hair', 'coat thinning'],
        structured_fields: ['alopecia'],
    },
    weight_loss: {
        label: 'weight loss',
        tier: 2,
        terms: ['weight loss', 'losing weight', 'lost weight', 'getting skinny', 'thin'],
        structured_fields: ['weight_loss'],
    },
    pot_bellied_appearance: {
        label: 'pot-bellied appearance',
        tier: 2,
        terms: ['pot-bellied appearance', 'pot bellied', 'pot-bellied', 'potbelly', 'pendulous abdomen'],
        structured_fields: ['pot_bellied_appearance'],
    },
    marked_alp_elevation: {
        label: 'marked ALP elevation',
        tier: 1,
        terms: ['marked elevated alp', 'markedly elevated alp', 'alp markedly elevated', 'alkaline phosphatase markedly elevated', 'marked alkaline phosphatase elevation'],
        structured_fields: ['marked_alp_elevation'],
    },
    hypercholesterolemia: {
        label: 'hypercholesterolemia',
        tier: 2,
        terms: ['hypercholesterolemia', 'high cholesterol', 'cholesterol elevated'],
        structured_fields: ['hypercholesterolemia'],
    },
    supportive_acth_stimulation_test: {
        label: 'supportive ACTH stimulation test',
        tier: 1,
        terms: ['supportive acth stimulation test', 'acth stimulation supportive', 'positive acth stimulation test', 'acth stimulation consistent with hyperadrenocorticism'],
        structured_fields: ['supportive_acth_stimulation_test'],
    },
    dilute_urine: {
        label: 'dilute urine',
        tier: 2,
        terms: ['dilute urine', 'urine is dilute', 'low urine specific gravity', 'specific gravity low', 'usg low'],
        structured_fields: ['dilute_urine'],
    },
    glucosuria: {
        label: 'glucosuria',
        tier: 1,
        terms: ['glucosuria', 'glucose in urine', 'urine glucose positive', 'glucose positive urine'],
        structured_fields: ['glucosuria'],
    },
    glucosuria_absent: {
        label: 'glucosuria absent',
        tier: 2,
        terms: ['no glucosuria', 'without glucosuria', 'glucosuria absent', 'urine glucose negative', 'glucose negative urine'],
        structured_fields: ['glucosuria_absent', 'glucosuria_negative'],
    },
    ketonuria: {
        label: 'ketonuria',
        tier: 1,
        terms: ['ketonuria', 'ketones in urine', 'urine ketones', 'urine ketone positive'],
        structured_fields: ['ketonuria'],
    },
    significant_hyperglycemia: {
        label: 'significant hyperglycemia',
        tier: 1,
        terms: ['significant hyperglycemia', 'persistent significant hyperglycemia', 'marked hyperglycemia', 'persistent hyperglycemia', 'glucose markedly elevated'],
        structured_fields: ['significant_hyperglycemia'],
    },
    mild_hyperglycemia: {
        label: 'mild hyperglycemia',
        tier: 3,
        terms: ['mild hyperglycemia', 'mildly elevated glucose', 'slight hyperglycemia', 'borderline hyperglycemia'],
        structured_fields: ['mild_hyperglycemia'],
    },
    diabetic_metabolic_profile: {
        label: 'diabetic metabolic profile',
        tier: 1,
        terms: ['compatible diabetic metabolic profile', 'diabetic metabolic profile', 'metabolic profile consistent with diabetes'],
        structured_fields: ['diabetic_metabolic_profile'],
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
        terms: ['ocular discharge', 'eye discharge', 'watery eyes', 'eyes watery', 'conjunctival discharge'],
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
    const species = normalizeSpecies(
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
        const negatedTerms = new Set<string>();

        for (const symptom of symptoms) {
            const matches = findSignalMatches(symptom, definition.terms, key);
            if (matches.positive.length > 0) {
                sources.add('symptom_vector');
                for (const match of matches.positive) matchedTerms.add(match);
            }
            for (const match of matches.negated) negatedTerms.add(match);
        }

        for (const fragment of freeTextFragments) {
            const matches = findSignalMatches(fragment, definition.terms, key);
            if (matches.positive.length > 0) {
                sources.add('free_text');
                for (const match of matches.positive) matchedTerms.add(match);
            }
            for (const match of matches.negated) negatedTerms.add(match);
        }

        for (const field of definition.structured_fields ?? []) {
            if (readBooleanField(input, field) === true) {
                sources.add('structured_field');
                matchedTerms.add(field);
            } else if (readBooleanField(input, field) === false) {
                negatedTerms.add(field);
            }
        }

        evidence[key] = {
            present: sources.size > 0,
            strength: sources.has('symptom_vector') || sources.has('free_text') ? 1 : sources.has('structured_field') ? 0.7 : 0,
            matched_terms: [...matchedTerms],
            negated_terms: [...negatedTerms],
            sources: [...sources],
            tier: definition.tier,
        };
    }

    applyStructuredEndocrineEvidence(input, allText, evidence);

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
    const hasChronicDuration = Boolean(
        (durationDays != null && durationDays >= 21)
        || textIncludesAny(allText, ['chronic', 'long-standing', 'for months', 'ongoing for weeks', 'ongoing for months'])
    );
    const hasGradualOnset = Boolean(
        textIncludesAny(allText, ['gradual onset', 'came on gradually', 'gradually progressive', 'slowly progressive', 'slowly worsening'])
        || (hasChronicDuration && !textIncludesAny(allText, ['started suddenly', 'came on suddenly', 'acute onset', 'abrupt onset']))
    );
    const hasExplicitGlucosuriaAbsence = evidence.glucosuria_absent.present || evidence.glucosuria.negated_terms.length > 0;
    const endocrineSharedPatternStrength = weightedPresence(evidence, [
        'polyuria',
        'polydipsia',
        'polyphagia',
        'lethargy',
    ]);
    const endocrineBodyPatternStrength = weightedPresence(evidence, [
        'pot_bellied_appearance',
        'panting',
        'alopecia',
        'marked_alp_elevation',
        'hypercholesterolemia',
    ]);
    const hyperadrenocorticismPatternStrength = endocrineBodyPatternStrength
        + (evidence.supportive_acth_stimulation_test.present ? 0.38 : 0)
        + (evidence.dilute_urine.present ? 0.16 : 0)
        + (hasExplicitGlucosuriaAbsence ? 0.14 : 0)
        + (hasChronicDuration ? 0.12 : 0)
        + (hasGradualOnset ? 0.08 : 0)
        + (evidence.abdominal_distension.present && hasChronicDuration ? 0.06 : 0)
        + (evidence.polyuria.present ? 0.06 : 0)
        + (evidence.polydipsia.present ? 0.06 : 0)
        + (evidence.polyphagia.present ? 0.04 : 0);
    const diabetesMellitusPatternStrength = weightedPresence(evidence, [
        'significant_hyperglycemia',
        'glucosuria',
        'ketonuria',
        'weight_loss',
        'diabetic_metabolic_profile',
    ])
        + (evidence.polyuria.present ? 0.06 : 0)
        + (evidence.polydipsia.present ? 0.06 : 0)
        + (evidence.polyphagia.present ? 0.05 : 0)
        + (evidence.lethargy.present ? 0.03 : 0);
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
        has_chronic_duration: hasChronicDuration,
        has_gradual_onset: hasGradualOnset,
        has_explicit_glucosuria_absence: hasExplicitGlucosuriaAbsence,
        gdv_cluster_count: gdvClusterCount,
        gdv_pattern_strength: gdvPatternStrength,
        shock_pattern_strength: shockPatternStrength,
        distemper_pattern_strength: distemperPatternStrength,
        upper_airway_pattern_strength: upperAirwayPatternStrength,
        respiratory_infection_pattern_strength: respiratoryInfectionPatternStrength,
        endocrine_shared_pattern_strength: endocrineSharedPatternStrength,
        endocrine_body_pattern_strength: endocrineBodyPatternStrength,
        hyperadrenocorticism_pattern_strength: hyperadrenocorticismPatternStrength,
        diabetes_mellitus_pattern_strength: diabetesMellitusPatternStrength,
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

function normalizeSpecies(value: string | null | undefined): string | null {
    const normalized = normalizeString(value);
    if (!normalized) return null;

    const aliases: Record<string, string> = {
        canine: 'dog',
        puppy: 'dog',
        dog: 'dog',
        'canis lupus familiaris': 'dog',
        feline: 'cat',
        kitten: 'cat',
        cat: 'cat',
        'felis catus': 'cat',
        equine: 'horse',
        horse: 'horse',
        'equus ferus caballus': 'horse',
        bovine: 'cow',
        cow: 'cow',
        'bos taurus': 'cow',
        lagomorph: 'rabbit',
        rabbit: 'rabbit',
        avian: 'bird',
        bird: 'bird',
        reptile: 'reptile',
        snake: 'reptile',
        lizard: 'reptile',
        turtle: 'reptile',
        fish: 'fish',
        rodent: 'rodent',
        hamster: 'rodent',
        ferret: 'ferret',
        'guinea pig': 'guinea_pig',
        'guinea_pig': 'guinea_pig',
    };

    return aliases[normalized] ?? normalized;
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
    const fields = [
        'edge_cases',
        'contradictions',
        'chief_complaint',
        'history',
        'raw_note',
        'notes',
        'presentation',
        'lab_summary',
        'chemistry_summary',
        'bloodwork_summary',
        'urinalysis_summary',
        'endocrine_summary',
        'acth_stimulation_result',
    ];

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

    for (const docText of extractLabResultText(input.lab_results)) {
        fragments.push(docText.toLowerCase().trim());
    }
    for (const docText of extractLabResultText(metadata.lab_results)) {
        fragments.push(docText.toLowerCase().trim());
    }

    return [...new Set(fragments)];
}

function extractLabResultText(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    const fragments: string[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;

        for (const key of ['text', 'content_text', 'summary', 'raw_text']) {
            const direct = typeof record[key] === 'string' ? record[key].trim() : '';
            if (direct) fragments.push(direct);
        }

        const encoded = typeof record.content_base64 === 'string' ? record.content_base64 : null;
        const mimeType = typeof record.mime_type === 'string' ? record.mime_type.toLowerCase() : '';
        if (!encoded || (mimeType && !mimeType.startsWith('text/') && !mimeType.includes('json'))) {
            continue;
        }

        try {
            const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
            if (decoded) fragments.push(decoded);
        } catch {
            // Ignore undecodable lab attachments.
        }
    }

    return fragments;
}

function applyStructuredEndocrineEvidence(
    input: Record<string, unknown>,
    allText: string,
    evidence: Record<SignalKey, SignalEvidence>,
) {
    const structuredBooleanSignals: Array<[SignalKey, string[]]> = [
        ['panting', ['panting']],
        ['alopecia', ['alopecia']],
        ['polyuria', ['polyuria']],
        ['polydipsia', ['polydipsia']],
        ['polyphagia', ['polyphagia']],
        ['weight_loss', ['weight_loss']],
        ['pot_bellied_appearance', ['pot_bellied_appearance']],
        ['hypercholesterolemia', ['hypercholesterolemia']],
        ['supportive_acth_stimulation_test', ['supportive_acth_stimulation_test', 'acth_stimulation_supportive']],
        ['dilute_urine', ['dilute_urine']],
        ['glucosuria', ['glucosuria']],
        ['ketonuria', ['ketonuria']],
        ['diabetic_metabolic_profile', ['diabetic_metabolic_profile']],
    ];

    for (const [signalKey, fields] of structuredBooleanSignals) {
        for (const field of fields) {
            const value = readBooleanField(input, field);
            if (value === true) {
                markSignalPresent(evidence, signalKey, field);
                break;
            }
            if (value === false) {
                markSignalNegated(evidence, signalKey, field);
            }
        }
    }

    const glucosuriaField = readBooleanField(input, 'glucosuria');
    if (glucosuriaField === false) {
        markSignalPresent(evidence, 'glucosuria_absent', 'glucosuria false');
        markSignalNegated(evidence, 'glucosuria', 'glucosuria false');
    }

    for (const field of ['marked_alp_elevation', 'significant_hyperglycemia', 'mild_hyperglycemia']) {
        const direct = readBooleanField(input, field);
        if (direct === true) {
            markSignalPresent(evidence, field as SignalKey, field);
        } else if (direct === false) {
            markSignalNegated(evidence, field as SignalKey, field);
        }
    }

    const alpMultiplier = firstNumber(
        readNumberField(input, 'alp_multiple_upper_limit'),
        readNumberField(input, 'alkaline_phosphatase_multiple_upper_limit'),
    );
    if (alpMultiplier != null && alpMultiplier >= 3) {
        markSignalPresent(evidence, 'marked_alp_elevation', `alp ${alpMultiplier}x upper limit`);
    }

    const alpValue = firstNumber(
        readNumberField(input, 'alp_u_l'),
        readNumberField(input, 'alkaline_phosphatase_u_l'),
        extractLabNumber(allText, /(?:alp|alkaline phosphatase)\s*(?:[:=]|\bis\b)?\s*(\d+(?:\.\d+)?)/i),
    );
    if (alpValue != null && alpValue >= 350) {
        markSignalPresent(evidence, 'marked_alp_elevation', `alp ${alpValue}`);
    }

    const cholesterolValue = firstNumber(
        readNumberField(input, 'cholesterol_mg_dl'),
        readNumberField(input, 'serum_cholesterol_mg_dl'),
        extractLabNumber(allText, /(?:cholesterol|chol)\s*(?:[:=]|\bis\b)?\s*(\d+(?:\.\d+)?)/i),
    );
    if (cholesterolValue != null && cholesterolValue >= 320) {
        markSignalPresent(evidence, 'hypercholesterolemia', `cholesterol ${cholesterolValue}`);
    }

    const glucoseValue = firstNumber(
        readNumberField(input, 'blood_glucose_mg_dl'),
        readNumberField(input, 'serum_glucose_mg_dl'),
        readNumberField(input, 'glucose_mg_dl'),
        extractLabNumber(allText, /(?:blood glucose|serum glucose|glucose)\s*(?:[:=]|\bis\b)?\s*(\d+(?:\.\d+)?)/i),
    );
    if (glucoseValue != null) {
        if (glucoseValue >= 250) {
            markSignalPresent(evidence, 'significant_hyperglycemia', `glucose ${glucoseValue}`);
        } else if (glucoseValue >= 130) {
            markSignalPresent(evidence, 'mild_hyperglycemia', `glucose ${glucoseValue}`);
        }
    }

    const urineSpecificGravity = firstNumber(
        readNumberField(input, 'urine_specific_gravity'),
        readNumberField(input, 'urine_specific_gravity_value'),
        extractLabNumber(allText, /(?:urine specific gravity|specific gravity|usg)\s*(?:[:=]|\bis\b)?\s*(1\.\d{3})/i),
    );
    if (urineSpecificGravity != null && urineSpecificGravity <= 1.015) {
        markSignalPresent(evidence, 'dilute_urine', `usg ${urineSpecificGravity.toFixed(3)}`);
    }
}

function markSignalPresent(
    evidence: Record<SignalKey, SignalEvidence>,
    signalKey: SignalKey,
    matchedTerm: string,
    source: EvidenceSource = 'structured_field',
) {
    const current = evidence[signalKey];
    evidence[signalKey] = {
        ...current,
        present: true,
        strength: Math.max(current.strength, source === 'structured_field' ? 0.7 : 1),
        matched_terms: dedupeStringList([...current.matched_terms, matchedTerm]),
        sources: dedupeSourceList([...current.sources, source]),
    };
}

function markSignalNegated(
    evidence: Record<SignalKey, SignalEvidence>,
    signalKey: SignalKey,
    negatedTerm: string,
) {
    const current = evidence[signalKey];
    evidence[signalKey] = {
        ...current,
        negated_terms: dedupeStringList([...current.negated_terms, negatedTerm]),
    };
}

function extractLabNumber(value: string, pattern: RegExp): number | null {
    const match = value.match(pattern);
    if (!match) return null;
    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values: Array<number | null>): number | null {
    return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? null;
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

function findSignalMatches(fragment: string, terms: string[], signal: SignalKey): {
    positive: string[];
    negated: string[];
} {
    const normalized = fragment.toLowerCase();
    const positive: string[] = [];
    const negated: string[] = [];

    for (const term of terms) {
        if (!normalized.includes(term)) {
            continue;
        }

        if (signal === 'productive_vomiting' && normalized.includes('unproductive') && term !== 'productive vomiting') {
            continue;
        }

        if (isNegatedMention(normalized, term, signal)) {
            negated.push(term);
            continue;
        }

        positive.push(term);
    }

    if (signal === 'fever' && normalized.includes('afebrile')) {
        negated.push('afebrile');
    }

    return {
        positive,
        negated,
    };
}

function isNegatedMention(fragment: string, term: string, signal: SignalKey): boolean {
    const escapedTerm = escapeRegExp(term);
    const patterns = [
        new RegExp(`\\bno\\s+${escapedTerm}\\b`, 'i'),
        new RegExp(`\\bwithout\\s+${escapedTerm}\\b`, 'i'),
        new RegExp(`\\bdenies?\\s+${escapedTerm}\\b`, 'i'),
        new RegExp(`\\bnot\\s+${escapedTerm}\\b`, 'i'),
        new RegExp(`\\bnegative\\s+for\\s+${escapedTerm}\\b`, 'i'),
        new RegExp(`\\bfree\\s+of\\s+${escapedTerm}\\b`, 'i'),
        new RegExp(`\\babsence\\s+of\\s+${escapedTerm}\\b`, 'i'),
    ];

    if (signal === 'fever') {
        patterns.push(/\bafebrile\b/i);
    }

    return patterns.some((pattern) => pattern.test(fragment));
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupeStringList(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function dedupeSourceList(values: EvidenceSource[]): EvidenceSource[] {
    return [...new Set(values)];
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
