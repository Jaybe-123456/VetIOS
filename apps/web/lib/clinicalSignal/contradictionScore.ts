import {
    contradictionRuleRegistry,
    type ContradictionRuleDefinition,
} from '@/lib/clinicalSignal/contradictionRules';
import {
    extractClinicalTermsFromText,
    normalizeClinicalTermArray,
} from '@/lib/clinicalSignal/clinicalVocabulary';
import {
    extractClinicalSignals,
    parseAgeMonths,
    readBooleanField,
    type ClinicalSignals,
} from '@/lib/ai/clinicalSignals';

export interface ContradictionResult {
    contradiction_score: number;
    contradiction_reasons: string[];
    contradiction_details: ContradictionDetail[];
    matched_rule_ids: string[];
    score_band: 'none' | 'low' | 'moderate' | 'high';
    is_plausible: boolean;
    confidence_cap: number;
    abstain: boolean;
}

export interface ContradictionDetail {
    rule_id: string;
    label: string;
    rule_type: string;
    severity: 'mild' | 'moderate' | 'high';
    weight: number;
    explanation: string;
    evidence: string[];
    source: 'rule_registry' | 'metadata_conflict' | 'biologic_plausibility';
}

export interface ContradictionConfig {
    moderate_threshold: number;
    high_threshold: number;
    mild_confidence_cap: number;
    moderate_confidence_cap: number;
    high_confidence_cap: number;
}

const DEFAULT_CONFIG: ContradictionConfig = {
    moderate_threshold: 0.4,
    high_threshold: 0.7,
    mild_confidence_cap: 0.8,
    moderate_confidence_cap: 0.6,
    high_confidence_cap: 0.45,
};

const SPECIES_WEIGHT_RANGES: Record<string, { min: number; max: number }> = {
    cat: { min: 1.5, max: 12 },
    kitten: { min: 0.1, max: 3 },
    dog: { min: 0.5, max: 90 },
    puppy: { min: 0.1, max: 15 },
    rabbit: { min: 0.5, max: 7 },
    hamster: { min: 0.02, max: 0.06 },
    bird: { min: 0.01, max: 5 },
    horse: { min: 200, max: 1000 },
    cow: { min: 200, max: 1200 },
    ferret: { min: 0.5, max: 2.5 },
    guinea_pig: { min: 0.5, max: 1.5 },
};

const BREED_WEIGHT_RANGES: Record<string, { min: number; max: number }> = {
    chihuahua: { min: 1, max: 3.5 },
    'yorkshire terrier': { min: 1.5, max: 3.5 },
    pomeranian: { min: 1.5, max: 3.5 },
    'shih tzu': { min: 4, max: 8 },
    pug: { min: 6, max: 10 },
    beagle: { min: 9, max: 14 },
    'border collie': { min: 14, max: 22 },
    'golden retriever': { min: 25, max: 36 },
    'labrador retriever': { min: 25, max: 36 },
    'german shepherd': { min: 22, max: 40 },
    rottweiler: { min: 36, max: 60 },
    'great dane': { min: 45, max: 90 },
    'domestic shorthair': { min: 3, max: 7 },
    persian: { min: 3, max: 6 },
    'maine coon': { min: 5, max: 11 },
    siamese: { min: 2.5, max: 5 },
    dachshund: { min: 7, max: 15 },
};

const SIGNAL_TO_TERM: Record<string, string> = {
    unproductive_retching: 'retching_unproductive',
    abdominal_distension: 'abdominal_distension',
    collapse: 'collapse',
    cyanosis: 'cyanosis',
    honking_cough: 'honking_cough',
    cough: 'cough',
    myoclonus: 'myoclonus',
    dyspnea: 'dyspnea',
    tachycardia: 'tachycardia',
    pale_mucous_membranes: 'pale_mucous_membranes',
    productive_vomiting: 'vomiting',
    diarrhea: 'diarrhea',
    fever: 'fever',
    lethargy: 'lethargy',
    anorexia: 'anorexia',
    weakness: 'weakness',
    hypersalivation: 'hypersalivation',
    seizures: 'seizures',
    nasal_discharge: 'nasal_discharge',
    ocular_discharge: 'ocular_discharge',
    pneumonia: 'pneumonia',
};

export function detectContradictions(
    input: Record<string, unknown>,
    overrides: Partial<ContradictionConfig> = {},
): ContradictionResult {
    const config: ContradictionConfig = { ...DEFAULT_CONFIG, ...overrides };
    const signals = extractClinicalSignals(input);
    const termSet = buildContradictionTermSet(input, signals);
    const details: ContradictionDetail[] = [];

    details.push(...evaluateRegistryRules(termSet));
    details.push(...evaluateMetadataConflicts(input, signals));
    details.push(...evaluateBiologicPlausibility(signals));

    const unique = dedupeDetails(details);
    const contradictionScore = Number(Math.min(1, unique.reduce((sum, item) => sum + item.weight, 0)).toFixed(3));
    const confidenceCap = resolveConfidenceCap(contradictionScore, config);
    const abstain =
        contradictionScore >= config.high_threshold ||
        (contradictionScore >= config.moderate_threshold && unique.length >= 3);

    return {
        contradiction_score: contradictionScore,
        contradiction_reasons: unique.map((item) => item.explanation),
        contradiction_details: unique,
        matched_rule_ids: unique.map((item) => item.rule_id),
        score_band: contradictionScore >= config.high_threshold
            ? 'high'
            : contradictionScore >= config.moderate_threshold
                ? 'moderate'
                : contradictionScore > 0
                    ? 'low'
                    : 'none',
        is_plausible: unique.length === 0,
        confidence_cap: confidenceCap,
        abstain,
    };
}

function evaluateRegistryRules(termSet: Set<string>): ContradictionDetail[] {
    const rules = contradictionRuleRegistry.rules ?? [];
    const details: ContradictionDetail[] = [];

    for (const rule of rules) {
        if (rule.requires_all && !rule.requires_all.every((term) => termSet.has(term))) {
            continue;
        }
        if (rule.requires_any && !rule.requires_any.some((term) => termSet.has(term))) {
            continue;
        }
        if (rule.conflicts_any && !rule.conflicts_any.some((term) => termSet.has(term))) {
            continue;
        }

        const evidence = [
            ...(rule.requires_all ?? []),
            ...(rule.requires_any?.filter((term) => termSet.has(term)) ?? []),
            ...(rule.conflicts_any?.filter((term) => termSet.has(term)) ?? []),
        ];

        details.push({
            rule_id: rule.id,
            label: rule.label,
            rule_type: rule.rule_type,
            severity: rule.severity,
            weight: rule.weight,
            explanation: rule.explanation_template,
            evidence: dedupeStrings(evidence),
            source: 'rule_registry',
        });
    }

    return details;
}

function evaluateMetadataConflicts(
    input: Record<string, unknown>,
    signals: ClinicalSignals,
): ContradictionDetail[] {
    const details: ContradictionDetail[] = [];

    addMetadataConflict(
        details,
        input,
        signals,
        'abdominal_distension',
        false,
        'metadata_conflict_abdominal_distension',
        'Abdominal distension metadata conflict',
        'metadata_conflict',
        'abdominal distension present in symptom vector but false in metadata',
        0.24,
        'abdominal_distension',
    );

    addMetadataConflict(
        details,
        input,
        signals,
        'productive_vomiting',
        true,
        'metadata_conflict_retching_vomiting',
        'Retching-vomiting metadata conflict',
        'metadata_conflict',
        'metadata indicates productive vomiting while symptom vector supports unproductive retching',
        0.22,
        'unproductive_retching',
    );

    addMetadataConflict(
        details,
        input,
        signals,
        'fever',
        false,
        'metadata_conflict_fever',
        'Fever metadata conflict',
        'metadata_conflict',
        'fever present in the clinical signal but false in metadata',
        0.18,
        'fever',
    );

    return details;
}

function addMetadataConflict(
    details: ContradictionDetail[],
    input: Record<string, unknown>,
    signals: ClinicalSignals,
    field: string,
    expectedStructuredValue: boolean,
    ruleId: string,
    label: string,
    ruleType: string,
    explanation: string,
    weight: number,
    signalKey: keyof ClinicalSignals['evidence'],
): void {
    const metadataValue = readBooleanField(input, field);
    if (metadataValue === expectedStructuredValue && signals.evidence[signalKey].present) {
        details.push({
            rule_id: ruleId,
            label,
            rule_type: ruleType,
            severity: weight >= 0.24 ? 'high' : weight >= 0.18 ? 'moderate' : 'mild',
            weight,
            explanation,
            evidence: [field, SIGNAL_TO_TERM[String(signalKey)] ?? String(signalKey)],
            source: 'metadata_conflict',
        });
    }
}

function evaluateBiologicPlausibility(signals: ClinicalSignals): ContradictionDetail[] {
    const details: ContradictionDetail[] = [];
    const species = signals.species;
    const breed = signals.breed;
    const weight = signals.weight_kg;

    if (weight != null && species != null) {
        const range = SPECIES_WEIGHT_RANGES[species];
        if (range != null) {
            if (weight < range.min * 0.5) {
                details.push({
                    rule_id: 'biologic_weight_low_species',
                    label: 'Species-weight mismatch',
                    rule_type: 'biologic_plausibility',
                    severity: 'moderate',
                    weight: 0.16,
                    explanation: `weight ${weight.toFixed(1)}kg is implausibly below the expected range for ${species}`,
                    evidence: [species, `weight_${weight.toFixed(1)}kg`],
                    source: 'biologic_plausibility',
                });
            }
            if (weight > range.max * 1.5) {
                details.push({
                    rule_id: 'biologic_weight_high_species',
                    label: 'Species-weight mismatch',
                    rule_type: 'biologic_plausibility',
                    severity: 'moderate',
                    weight: 0.2,
                    explanation: `weight ${weight.toFixed(1)}kg is implausibly above the expected range for ${species}`,
                    evidence: [species, `weight_${weight.toFixed(1)}kg`],
                    source: 'biologic_plausibility',
                });
            }
        }
    }

    if (weight != null && breed != null) {
        const range = BREED_WEIGHT_RANGES[breed];
        if (range != null) {
            if (weight < range.min * 0.3) {
                details.push({
                    rule_id: 'biologic_weight_low_breed',
                    label: 'Breed-weight mismatch',
                    rule_type: 'biologic_plausibility',
                    severity: 'moderate',
                    weight: 0.18,
                    explanation: `weight ${weight.toFixed(1)}kg is critically low for ${breed}`,
                    evidence: [breed, `weight_${weight.toFixed(1)}kg`],
                    source: 'biologic_plausibility',
                });
            }
            if (weight > range.max * 2.5) {
                details.push({
                    rule_id: 'biologic_weight_high_breed',
                    label: 'Breed-weight mismatch',
                    rule_type: 'biologic_plausibility',
                    severity: 'moderate',
                    weight: 0.2,
                    explanation: `weight ${weight.toFixed(1)}kg is implausibly high for ${breed}`,
                    evidence: [breed, `weight_${weight.toFixed(1)}kg`],
                    source: 'biologic_plausibility',
                });
            }
        }
    }

    if (signals.age_description != null && weight != null && species != null) {
        const ageMonths = parseAgeMonths(signals.age_description);
        if (ageMonths != null) {
            if (species === 'dog' && ageMonths < 3 && weight > 10) {
                details.push({
                    rule_id: 'biologic_age_weight_dog',
                    label: 'Age-weight mismatch',
                    rule_type: 'biologic_plausibility',
                    severity: 'moderate',
                    weight: 0.18,
                    explanation: `age ${signals.age_description} is inconsistent with weight ${weight.toFixed(1)}kg for a very young dog`,
                    evidence: [signals.age_description, `weight_${weight.toFixed(1)}kg`, species],
                    source: 'biologic_plausibility',
                });
            }
            if (species === 'cat' && ageMonths < 2 && weight > 3) {
                details.push({
                    rule_id: 'biologic_age_weight_cat',
                    label: 'Age-weight mismatch',
                    rule_type: 'biologic_plausibility',
                    severity: 'moderate',
                    weight: 0.18,
                    explanation: `age ${signals.age_description} is inconsistent with weight ${weight.toFixed(1)}kg for a kitten`,
                    evidence: [signals.age_description, `weight_${weight.toFixed(1)}kg`, species],
                    source: 'biologic_plausibility',
                });
            }
        }
    }

    return details;
}

function buildContradictionTermSet(
    input: Record<string, unknown>,
    signals: ClinicalSignals,
): Set<string> {
    const metadata = getMetadata(input);
    const narrative = [
        signals.all_text,
        coerceString(metadata.raw_note),
        coerceString(metadata.history),
        coerceString(metadata.presentation),
        coerceString(metadata.chief_complaint),
        coerceString(input.history),
        coerceString(input.notes),
        coerceString(input.presentation),
        coerceString(input.chief_complaint),
    ]
        .filter((value): value is string => Boolean(value))
        .join(' ');

    const terms = new Set<string>();

    for (const term of normalizeClinicalTermArray(input.symptoms)) {
        terms.add(term);
    }

    for (const term of extractClinicalTermsFromText(narrative)) {
        terms.add(term);
    }

    for (const [signalKey, evidence] of Object.entries(signals.evidence)) {
        if (evidence.present) {
            terms.add(SIGNAL_TO_TERM[signalKey] ?? signalKey);
        }
    }

    const activityStatus = normalizeText(readStringField(input, 'activity_status'));
    if (activityStatus === 'normal') terms.add('normal_activity');

    const appetiteStatus = normalizeText(
        typeof input.appetite_status === 'string'
            ? input.appetite_status
            : typeof metadata.appetite_status === 'string'
                ? metadata.appetite_status as string
                : null,
    );
    if (appetiteStatus === 'normal') terms.add('normal_appetite');

    const urinationStatus = normalizeText(readStringField(input, 'urination_status'));
    if (urinationStatus === 'normal') terms.add('normal_urination');

    const respiratoryEffort = normalizeText(readStringField(input, 'respiratory_effort'));
    if (respiratoryEffort === 'normal') terms.add('normal_respiratory_effort');

    const abdominalPain = readBooleanField(input, 'abdominal_pain');
    const painPresent = readBooleanField(input, 'pain');
    if (abdominalPain === false || painPresent === false) {
        terms.add('pain_behavior_absent');
    }

    if (signals.duration_days != null && signals.duration_days > 14) {
        terms.add('chronic_duration');
    }
    if (signals.has_isolated_environment) {
        terms.add('low_contact_environment');
    }
    if (signals.evidence.fever.negated_terms.length > 0 || readBooleanField(input, 'fever') === false) {
        terms.add('fever_negated');
    }
    if (signals.shock_pattern_strength >= 2.5) {
        terms.add('shock_pattern');
    }
    if (signals.gdv_cluster_count >= 3) {
        terms.add('mechanical_abdominal_emergency_pattern');
    }
    if (
        signals.evidence.dyspnea.present ||
        (signals.evidence.cyanosis.present && (signals.evidence.dyspnea.present || terms.has('respiratory_distress')))
    ) {
        terms.add('respiratory_failure_pattern');
    }
    if (
        signals.evidence.collapse.present ||
        signals.evidence.cyanosis.present ||
        signals.evidence.seizures.present ||
        terms.has('shock_pattern') ||
        terms.has('respiratory_failure_pattern')
    ) {
        terms.add('severe_illness_pattern');
    }
    if (signals.respiratory_infection_pattern_strength >= 2.4) {
        terms.add('infectious_respiratory_pattern');
    }

    return terms;
}

function resolveConfidenceCap(score: number, config: ContradictionConfig): number {
    if (score > config.high_threshold) return config.high_confidence_cap;
    if (score > config.moderate_threshold) return config.moderate_confidence_cap;
    if (score > 0) return config.mild_confidence_cap;
    return 1;
}

function readStringField(input: Record<string, unknown>, field: string): string | null {
    const direct = input[field];
    if (typeof direct === 'string') return direct;
    const metadata = getMetadata(input);
    return typeof metadata[field] === 'string' ? metadata[field] as string : null;
}

function getMetadata(input: Record<string, unknown>): Record<string, unknown> {
    return input.metadata && typeof input.metadata === 'object'
        ? input.metadata as Record<string, unknown>
        : {};
}

function dedupeDetails(items: ContradictionDetail[]): ContradictionDetail[] {
    const seen = new Map<string, ContradictionDetail>();
    for (const item of items) {
        const key = item.rule_id;
        const existing = seen.get(key);
        if (!existing || existing.weight < item.weight) {
            seen.set(key, {
                ...item,
                evidence: dedupeStrings(item.evidence),
            });
        }
    }
    return [...seen.values()];
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function coerceString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeText(value: string | null): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}
