import { normalizeSymptomSet } from '@/lib/clinicalCases/symptomOntology';
import {
    OBSERVATION_VOCABULARY_CATEGORIES,
    extractClinicalTermsFromText,
    getClinicalTermDisplayLabel,
} from '@/lib/clinicalSignal/clinicalVocabulary';
import { detectContradictions } from './contradictionEngine';
import { extractClinicalSignals, parseDurationDays, type SignalKey } from './clinicalSignals';

type DurationUnit = 'hours' | 'days' | 'weeks' | 'months' | null;

interface DurationDescriptor {
    value: number | null;
    unit: DurationUnit;
    normalized_days: number | null;
    bucket: string;
}

interface PatientHistoryDescriptor {
    species_label: string;
    age: string;
    sex_reproductive_status: string;
    duration: DurationDescriptor;
    onset: string;
    progression: string;
    environment: string;
    exposures: string[];
    key_context: string[];
}

export interface AntigravityClinicalSignal {
    species_constraint: string;
    breed_string: string;
    symptom_vector: string[];
    patient_history: PatientHistoryDescriptor;
    patient_history_summary: string;
    derived_signals: {
        temporal_pattern: string[];
        exposure_risks: string[];
        breed_risk: string[];
        systemic_involvement: string[];
        urgency_signals: string[];
        reproductive_relevance: string[];
    };
    contradiction_flags: string[];
    missing_fields: string[];
    signal_quality_score: number;
    signal_text: string;
}

const SPECIES_CONSTRAINT_MAP: Record<string, string> = {
    dog: 'Canis lupus familiaris',
    canine: 'Canis lupus familiaris',
    puppy: 'Canis lupus familiaris',
    'canis lupus familiaris': 'Canis lupus familiaris',
    cat: 'Felis catus',
    feline: 'Felis catus',
    kitten: 'Felis catus',
    'felis catus': 'Felis catus',
    horse: 'Equus ferus caballus',
    equine: 'Equus ferus caballus',
    'equus ferus caballus': 'Equus ferus caballus',
    cow: 'Bos taurus',
    bovine: 'Bos taurus',
    'bos taurus': 'Bos taurus',
    rabbit: 'Oryctolagus cuniculus',
    lagomorph: 'Oryctolagus cuniculus',
    ferret: 'Mustela putorius furo',
    avian: 'Aves',
    bird: 'Aves',
    reptile: 'Reptilia',
    snake: 'Reptilia',
    lizard: 'Reptilia',
    turtle: 'Reptilia',
    fish: 'Actinopterygii',
    rodent: 'Rodentia',
    hamster: 'Rodentia',
    'guinea pig': 'Cavia porcellus',
};

const SPECIES_DISPLAY_MAP: Record<string, string> = {
    'Canis lupus familiaris': 'Dog',
    'Felis catus': 'Cat',
    'Equus ferus caballus': 'Horse',
    'Bos taurus': 'Cow',
    'Oryctolagus cuniculus': 'Rabbit',
    'Mustela putorius furo': 'Ferret',
    Aves: 'Bird',
    Reptilia: 'Reptile',
    Actinopterygii: 'Fish',
    Rodentia: 'Rodent',
    'Cavia porcellus': 'Guinea pig',
};

const SIGNAL_TERM_MAP: Record<SignalKey, string> = {
    unproductive_retching: 'non-productive retching',
    abdominal_distension: 'abdominal distension',
    abdominal_pain: 'abdominal pain',
    collapse: 'collapse',
    cyanosis: 'cyanosis',
    honking_cough: 'honking cough',
    cough: 'cough',
    myoclonus: 'myoclonus',
    dyspnea: 'dyspnea',
    tachycardia: 'tachycardia',
    pale_mucous_membranes: 'pale mucous membranes',
    productive_vomiting: 'vomiting',
    diarrhea: 'diarrhea',
    fever: 'fever',
    lethargy: 'lethargy',
    anorexia: 'anorexia',
    weakness: 'weakness',
    polyuria: 'polyuria',
    polydipsia: 'polydipsia',
    polyphagia: 'polyphagia',
    panting: 'panting',
    alopecia: 'alopecia',
    weight_loss: 'weight loss',
    pot_bellied_appearance: 'pot-bellied appearance',
    marked_alp_elevation: 'marked ALP elevation',
    hypercholesterolemia: 'hypercholesterolemia',
    supportive_acth_stimulation_test: 'supportive ACTH stimulation test',
    dilute_urine: 'dilute urine',
    glucosuria: 'glucosuria',
    glucosuria_absent: 'glucosuria absent',
    ketonuria: 'ketonuria',
    significant_hyperglycemia: 'significant hyperglycemia',
    mild_hyperglycemia: 'mild hyperglycemia',
    diabetic_metabolic_profile: 'diabetic metabolic profile',
    hypersalivation: 'hypersalivation',
    seizures: 'seizures',
    nasal_discharge: 'nasal discharge',
    ocular_discharge: 'ocular discharge',
    pneumonia: 'pneumonia',
    recent_meal: 'recent meal',
    acute_onset: 'acute onset',
};

const SYMPTOM_LABEL_MAP: Record<string, string> = {
    anorexia: 'anorexia',
    hemorrhagic_diarrhea: 'hemorrhagic diarrhea',
    retching_unproductive: 'non-productive retching',
    ocular_discharge: 'ocular discharge',
    nasal_discharge: 'nasal discharge',
    abdominal_distension: 'abdominal distension',
    abdominal_pain: 'abdominal pain',
    hypersalivation: 'hypersalivation',
    pale_mucous_membranes: 'pale mucous membranes',
    respiratory_distress: 'respiratory distress',
    dyspnea: 'dyspnea',
    tachycardia: 'tachycardia',
    collapse: 'collapse',
    lethargy: 'lethargy',
    weakness: 'weakness',
    fever: 'fever',
    vomiting: 'vomiting',
    diarrhea: 'diarrhea',
    myoclonus: 'myoclonus',
    cough: 'cough',
    tremors: 'tremors',
    recent_meal: 'recent meal',
    acute_onset: 'acute onset',
};

const SYSTEMIC_SIGNAL_KEYS: Array<{
    label: string;
    keys: SignalKey[];
    required?: number;
}> = [
    {
        label: 'gastrointestinal',
        keys: ['unproductive_retching', 'abdominal_distension', 'abdominal_pain', 'productive_vomiting', 'diarrhea', 'anorexia', 'hypersalivation'],
        required: 1,
    },
    {
        label: 'respiratory',
        keys: ['dyspnea', 'cough', 'honking_cough', 'nasal_discharge', 'ocular_discharge', 'pneumonia'],
        required: 1,
    },
    {
        label: 'cardiovascular_possible',
        keys: ['collapse', 'tachycardia', 'pale_mucous_membranes', 'cyanosis'],
        required: 1,
    },
    {
        label: 'metabolic_endocrine',
        keys: [
            'polyuria',
            'polydipsia',
            'polyphagia',
            'panting',
            'alopecia',
            'weight_loss',
            'marked_alp_elevation',
            'supportive_acth_stimulation_test',
            'glucosuria',
            'ketonuria',
            'significant_hyperglycemia',
        ],
        required: 2,
    },
    {
        label: 'neurologic',
        keys: ['myoclonus', 'seizures'],
        required: 1,
    },
    {
        label: 'systemic_inflammatory',
        keys: ['fever', 'lethargy', 'weakness', 'anorexia'],
        required: 2,
    },
];

const URGENCY_SIGNAL_KEYS: Array<[SignalKey, string]> = [
    ['collapse', 'collapse'],
    ['pale_mucous_membranes', 'pale mucous membranes'],
    ['dyspnea', 'dyspnea'],
    ['abdominal_distension', 'abdominal distension'],
    ['cyanosis', 'cyanosis'],
    ['seizures', 'seizures'],
];

const PLAIN_TEXT_SYMPTOM_RULES: Array<{ label: string; patterns: RegExp[] }> = [
    {
        label: 'lethargy',
        patterns: [
            /\b(?:super|very|really)?\s*tired\b/i,
            /\blow energy\b/i,
            /\bnot acting like (?:himself|herself)\b/i,
            /\bsluggish\b/i,
        ],
    },
    {
        label: 'anorexia',
        patterns: [
            /\bnot eating\b/i,
            /\bwon'?t eat\b/i,
            /\brefusing (?:food|meals?)\b/i,
            /\bhasn'?t eaten\b/i,
        ],
    },
    {
        label: 'non-productive retching',
        patterns: [
            /\b(?:dry heaving|non[- ]?productive retching)\b/i,
            /\b(?:trying|tried)\s+to\s+vomit\b.*\b(?:nothing|no vomit|but nothing came out)\b/i,
            /\bretch(?:ing)?\b.*\b(?:nothing|no vomit|but nothing came out)\b/i,
        ],
    },
    {
        label: 'abdominal distension',
        patterns: [
            /\bstomach looks big\b/i,
            /\bbelly looks big\b/i,
            /\bswollen belly\b/i,
            /\bbloated\b/i,
        ],
    },
    {
        label: 'dyspnea',
        patterns: [
            /\bbreathing hard\b/i,
            /\btrouble breathing\b/i,
            /\bstruggling to breathe\b/i,
            /\bcan't catch (?:his|her|their)\s+breath\b/i,
        ],
    },
    {
        label: 'hypersalivation',
        patterns: [
            /\bdrooling\b/i,
            /\bexcessive salivation\b/i,
            /\bsalivating\b/i,
        ],
    },
    {
        label: 'dehydration',
        patterns: [
            /\bdehydrated\b/i,
            /\bdehydration\b/i,
        ],
    },
    {
        label: 'bradycardia',
        patterns: [
            /\bbradycardia\b/i,
            /\bslow heart rate\b/i,
        ],
    },
];

export function buildAntigravityClinicalSignal(input: Record<string, unknown>): AntigravityClinicalSignal {
    const signals = extractClinicalSignals(input);
    const narrativeText = extractNarrativeText(input, signals.all_text);
    const duration = deriveDurationDescriptor(input, narrativeText);
    const onset = deriveOnset(narrativeText, duration);
    const progression = deriveProgression(narrativeText);
    const environment = deriveEnvironment(input, narrativeText);
    const exposureRisks = deriveExposureRisks(input, narrativeText, signals);
    const breedRisk = deriveBreedRisk(signals);
    const systemicInvolvement = deriveSystemicInvolvement(signals);
    const urgencySignals = deriveUrgencySignals(signals);
    const reproductiveRelevance = deriveReproductiveRelevance(input, narrativeText);
    const contradictionFlags = dedupeStrings([
        ...detectContradictions(input).contradiction_reasons,
        ...deriveAdditionalContradictions(narrativeText, signals),
    ]);
    const symptomVector = deriveSymptomVector(input, signals, narrativeText);
    const speciesConstraint = normalizeSpeciesConstraint(input, signals.species);
    const breedString = normalizeBreedString(input);
    const age = deriveAgeDescription(input, signals);
    const sexReproductiveStatus = deriveSexReproductiveStatus(input, narrativeText);
    const temporalPattern = buildTemporalPattern(onset, progression, duration);
    const patientHistory = {
        species_label: SPECIES_DISPLAY_MAP[speciesConstraint] ?? 'Unknown',
        age,
        sex_reproductive_status: sexReproductiveStatus,
        duration,
        onset,
        progression,
        environment,
        exposures: exposureRisks,
        key_context: deriveKeyContext(exposureRisks, environment, reproductiveRelevance, breedRisk, urgencySignals),
    };
    const patientHistorySummary = buildPatientHistorySummary(patientHistory);
    const missingFields = buildMissingFields({
        speciesConstraint,
        breedString,
        age,
        sexReproductiveStatus,
        duration,
        onset,
        progression,
        environment,
        exposureRisks,
        symptomVector,
    });
    const signalQualityScore = scoreClinicalSignal({
        speciesConstraint,
        breedString,
        age,
        sexReproductiveStatus,
        duration,
        onset,
        progression,
        environment,
        exposureRisks,
        symptomVector,
        contradictionFlags,
    });

    const signal: AntigravityClinicalSignal = {
        species_constraint: speciesConstraint,
        breed_string: breedString,
        symptom_vector: symptomVector,
        patient_history: patientHistory,
        patient_history_summary: patientHistorySummary,
        derived_signals: {
            temporal_pattern: temporalPattern,
            exposure_risks: exposureRisks,
            breed_risk: breedRisk,
            systemic_involvement: systemicInvolvement,
            urgency_signals: urgencySignals,
            reproductive_relevance: reproductiveRelevance,
        },
        contradiction_flags: contradictionFlags.length > 0 ? contradictionFlags : ['none'],
        missing_fields: missingFields,
        signal_quality_score: signalQualityScore,
        signal_text: '',
    };

    signal.signal_text = renderAntigravityClinicalSignal(signal);
    return signal;
}

export function attachAntigravitySignal(input: Record<string, unknown>): Record<string, unknown> {
    const signal = buildAntigravityClinicalSignal(input);
    const metadata = getMetadata(input);
    const symptoms = dedupeStrings([
        ...coerceStringArray(input.symptoms),
        ...signal.symptom_vector,
    ]);

    return {
        ...input,
        symptoms,
        metadata: {
            ...metadata,
            antigravity_signal: signal,
            antigravity_signal_text: signal.signal_text,
            signal_quality_score: signal.signal_quality_score,
        },
    };
}

export function renderAntigravityClinicalSignal(signal: AntigravityClinicalSignal): string {
    return [
        'Species Constraint:',
        signal.species_constraint,
        '',
        'Breed String:',
        signal.breed_string,
        '',
        'Symptom Vector (Comma Separated):',
        signal.symptom_vector.length > 0 ? signal.symptom_vector.join(', ') : 'unknown',
        '',
        'Patient History / Metadata:',
        signal.patient_history_summary,
        '',
        'Derived Signals:',
        `- temporal_pattern: [${signal.derived_signals.temporal_pattern.join(', ')}]`,
        `- exposure_risks: [${signal.derived_signals.exposure_risks.join(', ')}]`,
        `- breed_risk: [${signal.derived_signals.breed_risk.join(', ')}]`,
        `- systemic_involvement: [${signal.derived_signals.systemic_involvement.join(', ')}]`,
        '',
        'Contradiction Flags:',
        signal.contradiction_flags.length > 0
            ? signal.contradiction_flags.map((flag) => `- ${flag}`).join('\n')
            : '- none',
        '',
        'Signal Quality Score:',
        signal.signal_quality_score.toFixed(2),
    ].join('\n');
}

function normalizeSpeciesConstraint(input: Record<string, unknown>, normalizedSpecies: string | null): string {
    const candidates = [
        coerceString(input.species),
        coerceString(getMetadata(input).species),
        normalizedSpecies,
    ];

    for (const candidate of candidates) {
        const key = normalizeText(candidate);
        if (key && SPECIES_CONSTRAINT_MAP[key]) {
            return SPECIES_CONSTRAINT_MAP[key];
        }
    }

    return 'unknown';
}

function normalizeBreedString(input: Record<string, unknown>): string {
    const candidates = [
        coerceString(input.breed),
        coerceString(getMetadata(input).breed),
    ];

    for (const candidate of candidates) {
        const normalized = candidate?.trim();
        if (normalized) return normalized;
    }

    return 'Unknown';
}

function deriveSymptomVector(input: Record<string, unknown>, signals: ReturnType<typeof extractClinicalSignals>, narrativeText: string): string[] {
    const vector = new Set<string>();
    const normalizedSymptoms = normalizeSymptomSet(input.symptoms);

    for (const key of normalizedSymptoms.normalizedKeys) {
        vector.add(SYMPTOM_LABEL_MAP[key] ?? getClinicalTermDisplayLabel(key));
    }

    for (const [key, evidence] of Object.entries(signals.evidence) as Array<[SignalKey, (typeof signals.evidence)[SignalKey]]>) {
        if (evidence.present) {
            vector.add(SIGNAL_TERM_MAP[key]);
        }
    }

    for (const term of extractClinicalTermsFromText(narrativeText, {
        categories: [...OBSERVATION_VOCABULARY_CATEGORIES],
    })) {
        vector.add(getClinicalTermDisplayLabel(term));
    }

    for (const rule of PLAIN_TEXT_SYMPTOM_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(narrativeText))) {
            vector.add(rule.label);
        }
    }

    return dedupeStrings([...vector]);
}

function deriveAgeDescription(input: Record<string, unknown>, signals: ReturnType<typeof extractClinicalSignals>): string {
    const metadata = getMetadata(input);
    const direct = [
        coerceString(input.age_description),
        coerceString(input.age),
        coerceString(metadata.age_description),
        coerceString(metadata.age),
        signals.age_description,
    ].find((value) => Boolean(value?.trim()));

    if (direct) return direct.trim();

    const ageMonths = coerceNumber(input.age_months)
        ?? coerceNumber(metadata.age_months);
    if (ageMonths != null) {
        if (ageMonths >= 12 && Number.isInteger(ageMonths / 12)) {
            return `${ageMonths / 12} years`;
        }
        return `${ageMonths} months`;
    }

    const ageWeeks = coerceNumber(input.age_weeks)
        ?? coerceNumber(metadata.age_weeks);
    if (ageWeeks != null) return `${ageWeeks} weeks`;

    const ageDays = coerceNumber(input.age_days)
        ?? coerceNumber(metadata.age_days);
    if (ageDays != null) return `${ageDays} days`;

    return 'age unknown';
}

function deriveSexReproductiveStatus(input: Record<string, unknown>, narrativeText: string): string {
    const metadata = getMetadata(input);
    const sexRaw = normalizeText(
        coerceString(input.sex)
        ?? coerceString(metadata.sex)
        ?? coerceString(input.gender)
        ?? coerceString(metadata.gender),
    );
    const reproRaw = normalizeText(
        coerceString(input.reproductive_status)
        ?? coerceString(metadata.reproductive_status)
        ?? coerceString(input.spay_neuter_status)
        ?? coerceString(metadata.spay_neuter_status),
    );

    const text = narrativeText.toLowerCase();
    const sex = sexRaw
        ?? (/\bfemale\b|\bbitch\b|\bqueen\b/.test(text) ? 'female' : null)
        ?? (/\bmale\b|\bneutered male\b|\btom\b/.test(text) ? 'male' : null);
    const repro = reproRaw
        ?? (/\bspayed\b/.test(text) ? 'spayed' : null)
        ?? (/\bneutered\b/.test(text) ? 'neutered' : null)
        ?? (/\bintact\b/.test(text) ? 'intact' : null)
        ?? (/\bpregnan(?:t|cy)\b/.test(text) ? 'pregnant' : null);

    if (!sex && !repro) return 'unknown';
    if (sex && repro) return `${sex} ${repro}`;
    return sex ?? repro ?? 'unknown';
}

function deriveDurationDescriptor(input: Record<string, unknown>, narrativeText: string): DurationDescriptor {
    const metadata = getMetadata(input);
    const directDuration = coerceString(metadata.duration) ?? coerceString(input.duration);
    const directDays = parseDurationDays(input);

    const parsed = parseDurationString(directDuration ?? narrativeText);
    if (parsed.value != null && parsed.unit != null) {
        return {
            value: parsed.value,
            unit: parsed.unit,
            normalized_days: parsed.normalized_days,
            bucket: bucketDuration(parsed.normalized_days),
        };
    }

    if (directDays != null) {
        return {
            value: Number(directDays.toFixed(2)),
            unit: 'days',
            normalized_days: directDays,
            bucket: bucketDuration(directDays),
        };
    }

    return {
        value: null,
        unit: null,
        normalized_days: null,
        bucket: 'unknown',
    };
}

function deriveOnset(narrativeText: string, duration: DurationDescriptor): string {
    if (/\b(?:sudden|suddenly|acute onset|started suddenly|abrupt(?:ly)?)\b/i.test(narrativeText)) {
        return 'acute';
    }
    if (/\b(?:gradual|gradually|slowly|progressive onset)\b/i.test(narrativeText)) {
        return 'gradual';
    }
    if (duration.normalized_days != null) {
        if (duration.normalized_days <= 7) return 'acute';
        if (duration.normalized_days >= 30) return 'chronic';
    }
    if (/\bchronic\b|\blong[- ]standing\b|\bfor months\b/i.test(narrativeText)) {
        return 'chronic';
    }
    return 'unknown';
}

function deriveProgression(narrativeText: string): string {
    if (/\b(?:worse|worsening|get(?:ting)? worse|rapidly progressing|progressively)\b/i.test(narrativeText)) {
        return 'worsening';
    }
    if (/\b(?:stable|unchanged|same as before)\b/i.test(narrativeText)) {
        return 'stable';
    }
    if (/\b(?:comes and goes|intermittent|off and on|waxing and waning|fluctuat(?:ing|es))\b/i.test(narrativeText)) {
        return 'fluctuating';
    }
    return 'unknown';
}

function deriveEnvironment(input: Record<string, unknown>, narrativeText: string): string {
    const metadata = getMetadata(input);
    const direct = normalizeText(coerceString(metadata.environment) ?? coerceString(input.environment));
    if (direct) return direct.replace(/\s+/g, '_');
    if (/\bshelter\b|\brescued\b/i.test(narrativeText)) return 'shelter';
    if (/\bfarm\b|\bbarn\b|\bpasture\b/i.test(narrativeText)) return 'farm';
    if (/\bboarding\b|\bkennel\b|\bdaycare\b/i.test(narrativeText)) return 'boarding_or_communal';
    if (/\bindoor only\b|\bapartment\b|\bhousehold\b|\bhome\b/i.test(narrativeText)) return 'household';
    if (/\bmulti[- ]pet\b|\bmultiple dogs\b|\bmultiple cats\b/i.test(narrativeText)) return 'multi_animal_household';
    return 'unknown';
}

function deriveExposureRisks(
    input: Record<string, unknown>,
    narrativeText: string,
    signals: ReturnType<typeof extractClinicalSignals>,
): string[] {
    const risks = new Set<string>();
    const text = narrativeText.toLowerCase();

    if (signals.has_exposure_risk || /\bboarding\b|\bkennel\b|\bdaycare\b|\bdog park\b|\bother dogs\b|\bother cats\b/.test(text)) {
        risks.add('communal_animal_exposure');
    }
    if (/\bafter eating\b|\bafter feeding\b|\bafter a meal\b|\bpost[- ]prandial\b/.test(text)) {
        risks.add('recent_meal');
    }
    if (/\bate\b|\bingested\b|\bchewed\b/.test(text) && /\brock|sock|toy|bone|string|trash|garbage|foreign body\b/.test(text)) {
        risks.add('foreign_material_or_dietary_indiscretion');
    }
    if (/\blily\b|\bxylitol\b|\bchocolate\b|\brat poison\b|\btoxin\b|\bpoison\b|\bmedication\b|\bgrapes?\b|\braisins?\b/.test(text)) {
        risks.add('toxin_exposure_possible');
    }
    if (/\bpond\b|\blake\b|\bstanding water\b|\bdirty water\b/.test(text)) {
        risks.add('environmental_water_exposure');
    }
    if (/\btravel\b|\brecent trip\b|\bout of state\b/.test(text)) {
        risks.add('recent_travel');
    }
    if (signals.has_isolated_environment) {
        risks.add('low_contact_environment');
    }

    return risks.size > 0 ? [...risks] : ['not_reported'];
}

function deriveBreedRisk(signals: ReturnType<typeof extractClinicalSignals>): string[] {
    const risks: string[] = [];

    if (signals.has_deep_chested_breed_risk) {
        risks.push('deep_chested_gastric_dilatation_volvulus_predisposition');
    }
    if (signals.has_small_breed_tracheal_collapse_risk) {
        risks.push('small_breed_upper_airway_collapse_predisposition');
    }
    if (signals.has_small_breed_gdv_mismatch) {
        risks.push('body_size_mismatch_for_classic_gastric_dilatation_volvulus_pattern');
    }

    if (risks.length > 0) return risks;
    return signals.breed ? ['none_identified'] : ['unknown'];
}

function deriveSystemicInvolvement(signals: ReturnType<typeof extractClinicalSignals>): string[] {
    const systems = SYSTEMIC_SIGNAL_KEYS
        .filter((entry) => countPresentSignals(signals, entry.keys) >= (entry.required ?? 1))
        .map((entry) => entry.label);

    return systems.length > 0 ? systems : ['undifferentiated'];
}

function deriveUrgencySignals(signals: ReturnType<typeof extractClinicalSignals>): string[] {
    const urgency = URGENCY_SIGNAL_KEYS
        .filter(([key]) => signals.evidence[key].present)
        .map(([, label]) => label);
    return urgency.length > 0 ? urgency : ['none_reported'];
}

function deriveReproductiveRelevance(input: Record<string, unknown>, narrativeText: string): string[] {
    const metadata = getMetadata(input);
    const text = narrativeText.toLowerCase();
    const pregnancy = /\bpregnan(?:t|cy)\b/.test(text);
    const postpartum = /\bpost[- ]partum\b|\brecently whelped\b|\brecently queened\b/.test(text);
    const intactFemale = /\bintact female\b/.test(text)
        || (normalizeText(coerceString(metadata.reproductive_status) ?? coerceString(input.reproductive_status)) === 'intact'
            && /\bfemale\b/.test(text));

    if (pregnancy) return ['pregnancy_relevant'];
    if (postpartum) return ['postpartum_relevant'];
    if (intactFemale) return ['intact_female_relevance'];
    return ['not_reported'];
}

function deriveAdditionalContradictions(
    narrativeText: string,
    signals: ReturnType<typeof extractClinicalSignals>,
): string[] {
    const flags: string[] = [];
    const text = narrativeText.toLowerCase();

    if ((/\bbradycardia\b|\bslow heart rate\b/.test(text)) && /\bdehydrat(?:ed|ion)\b/.test(text)) {
        flags.push('bradycardia with dehydration is an atypical pairing');
    }
    if (
        signals.evidence.fever.negated_terms.length > 0 &&
        (signals.evidence.collapse.present || signals.evidence.dyspnea.present || signals.evidence.abdominal_distension.present || signals.evidence.cyanosis.present)
    ) {
        flags.push('explicit afebrile history despite high-acuity systemic presentation');
    }

    return flags;
}

function buildTemporalPattern(onset: string, progression: string, duration: DurationDescriptor): string[] {
    const pattern = new Set<string>();

    if (onset !== 'unknown' && progression !== 'unknown') {
        pattern.add(`${onset}_${progression}`);
    }
    if (onset !== 'unknown') pattern.add(onset);
    if (progression !== 'unknown') pattern.add(progression);
    if (duration.bucket !== 'unknown') pattern.add(duration.bucket);

    return pattern.size > 0 ? [...pattern] : ['unknown'];
}

function deriveKeyContext(
    exposureRisks: string[],
    environment: string,
    reproductiveRelevance: string[],
    breedRisk: string[],
    urgencySignals: string[],
): string[] {
    const context = new Set<string>();

    for (const risk of exposureRisks) {
        if (risk !== 'not_reported') context.add(risk);
    }
    if (environment !== 'unknown') context.add(environment);
    for (const signal of urgencySignals) {
        if (signal !== 'none_reported') context.add(`urgency_${signal.replace(/\s+/g, '_')}`);
    }
    for (const item of breedRisk) {
        if (item !== 'unknown' && item !== 'none_identified') context.add(item);
    }
    for (const item of reproductiveRelevance) {
        if (item !== 'not_reported') context.add(item);
    }

    return context.size > 0 ? [...context] : ['none_identified'];
}

function buildPatientHistorySummary(history: PatientHistoryDescriptor): string {
    const durationText = formatDuration(history.duration);
    const exposures = history.exposures.length > 0 ? history.exposures.join(', ') : 'not reported';
    const keyContext = history.key_context.length > 0 ? history.key_context.join(', ') : 'none identified';

    return [
        `${history.species_label}, ${history.age}, sex/reproductive status ${history.sex_reproductive_status}.`,
        `Duration ${durationText}.`,
        `Onset ${history.onset}.`,
        `Progression ${history.progression}.`,
        `Environment ${history.environment}.`,
        `Exposures ${exposures}.`,
        `Key context ${keyContext}.`,
    ].join(' ');
}

function buildMissingFields(input: {
    speciesConstraint: string;
    breedString: string;
    age: string;
    sexReproductiveStatus: string;
    duration: DurationDescriptor;
    onset: string;
    progression: string;
    environment: string;
    exposureRisks: string[];
    symptomVector: string[];
}): string[] {
    const missing: string[] = [];
    if (input.speciesConstraint === 'unknown') missing.push('species');
    if (input.breedString === 'Unknown') missing.push('breed');
    if (input.age === 'age unknown') missing.push('age');
    if (input.sexReproductiveStatus === 'unknown') missing.push('sex_reproductive_status');
    if (input.duration.value == null) missing.push('duration');
    if (input.onset === 'unknown') missing.push('onset');
    if (input.progression === 'unknown') missing.push('progression');
    if (input.environment === 'unknown') missing.push('environment');
    if (input.exposureRisks.length === 1 && input.exposureRisks[0] === 'not_reported') missing.push('exposures');
    if (input.symptomVector.length === 0) missing.push('symptoms');
    return missing;
}

function scoreClinicalSignal(input: {
    speciesConstraint: string;
    breedString: string;
    age: string;
    sexReproductiveStatus: string;
    duration: DurationDescriptor;
    onset: string;
    progression: string;
    environment: string;
    exposureRisks: string[];
    symptomVector: string[];
    contradictionFlags: string[];
}): number {
    let score = 0.12;

    if (input.speciesConstraint !== 'unknown') score += 0.18;
    if (input.breedString !== 'Unknown') score += 0.06;
    if (input.age !== 'age unknown') score += 0.05;
    if (input.sexReproductiveStatus !== 'unknown') score += 0.04;
    if (input.duration.value != null) score += 0.12;
    if (input.onset !== 'unknown') score += 0.08;
    if (input.progression !== 'unknown') score += 0.08;
    if (input.environment !== 'unknown') score += 0.05;
    if (!(input.exposureRisks.length === 1 && input.exposureRisks[0] === 'not_reported')) score += 0.06;
    score += Math.min(0.28, input.symptomVector.length * 0.07);
    if (input.contradictionFlags.length > 0) score += 0.03;

    return Number(Math.min(1, score).toFixed(2));
}

function parseDurationString(value: string): { value: number | null; unit: DurationUnit; normalized_days: number | null } {
    const match = value.match(/(\d+(?:\.\d+)?)\s*(hours?|days?|weeks?|months?)/i);
    if (!match) {
        return { value: null, unit: null, normalized_days: null };
    }

    const numericValue = Number.parseFloat(match[1]);
    const unit = normalizeDurationUnit(match[2]);
    if (unit == null) {
        return { value: null, unit: null, normalized_days: null };
    }

    return {
        value: numericValue,
        unit,
        normalized_days: toDays(numericValue, unit),
    };
}

function normalizeDurationUnit(value: string): DurationUnit {
    const lower = value.toLowerCase();
    if (lower.startsWith('hour')) return 'hours';
    if (lower.startsWith('day')) return 'days';
    if (lower.startsWith('week')) return 'weeks';
    if (lower.startsWith('month')) return 'months';
    return null;
}

function toDays(value: number, unit: Exclude<DurationUnit, null>): number {
    if (unit === 'hours') return value / 24;
    if (unit === 'weeks') return value * 7;
    if (unit === 'months') return value * 30;
    return value;
}

function bucketDuration(value: number | null): string {
    if (value == null) return 'unknown';
    if (value < 0.25) return 'lt_6h';
    if (value < 1) return 'lt_24h';
    if (value <= 7) return '1_7d';
    if (value <= 30) return '1_4w';
    return 'gt_30d';
}

function formatDuration(duration: DurationDescriptor): string {
    if (duration.value == null || duration.unit == null) return 'not reported';
    const rounded = Number.isInteger(duration.value) ? String(duration.value) : duration.value.toFixed(1);
    return `${rounded} ${duration.unit}`;
}

function extractNarrativeText(input: Record<string, unknown>, allText: string): string {
    const metadata = getMetadata(input);
    return [
        allText,
        coerceString(metadata.raw_note),
        coerceString(metadata.history),
        coerceString(metadata.presentation),
        coerceString(metadata.chief_complaint),
        coerceString(input.history),
        coerceString(input.notes),
        coerceString(input.presentation),
        coerceString(input.chief_complaint),
    ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(' ')
        .toLowerCase();
}

function countPresentSignals(
    signals: ReturnType<typeof extractClinicalSignals>,
    keys: SignalKey[],
): number {
    return keys.filter((key) => signals.evidence[key].present).length;
}

function getMetadata(input: Record<string, unknown>): Record<string, unknown> {
    return input.metadata && typeof input.metadata === 'object'
        ? (input.metadata as Record<string, unknown>)
        : {};
}

function coerceString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function coerceNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeText(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

function coerceStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return value
            .split(/[,;\n]|(?:\band\b)/i)
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return [];
}

function dedupeStrings(values: unknown[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];

    for (const value of values) {
        if (typeof value !== 'string') continue;
        const normalized = value.replace(/\s+/g, ' ').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }

    return output;
}
