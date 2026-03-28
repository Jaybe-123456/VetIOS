import vocabularyRegistry from '@/lib/clinicalSignal/clinical_vocabulary.json';

export interface ClinicalVocabularyEntry {
    canonical_term: string;
    aliases: string[];
    category: string;
    severity_compatibility?: string[];
    species_relevance?: string[];
    notes?: string;
}

export interface ClinicalVocabularyRegistry {
    version: string;
    terms: ClinicalVocabularyEntry[];
}

export interface NormalizeClinicalTermOptions {
    categories?: string[];
}

type AliasEntry = {
    alias: string;
    canonical_term: string;
    category: string;
    regex: RegExp;
};

const registry = vocabularyRegistry as ClinicalVocabularyRegistry;
const entryByCanonical = new Map<string, ClinicalVocabularyEntry>(
    registry.terms.map((entry) => [entry.canonical_term, entry]),
);
const aliasLookup = buildAliasLookup();
const aliasEntries = buildAliasEntries();

export const OBSERVATION_VOCABULARY_CATEGORIES = new Set([
    'systemic_symptom',
    'gastrointestinal_symptom',
    'respiratory_symptom',
    'respiratory_finding',
    'urinary_symptom',
    'neurologic_symptom',
    'ophthalmic_symptom',
    'exam_finding',
    'behavior_context',
    'musculoskeletal_symptom',
    'dermatologic_symptom',
]);

export const CLINICAL_CONTEXT_CATEGORIES = new Set([
    'history_concept',
    'exposure_risk',
    'reproductive_status',
]);

const DISPLAY_LABEL_OVERRIDES: Record<string, string> = {
    retching_unproductive: 'non-productive retching',
    normal_activity: 'normal activity',
    normal_appetite: 'normal appetite',
    normal_urination: 'normal urination',
    normal_respiratory_effort: 'normal respiratory effort',
    pain_behavior_absent: 'no pain behavior',
    recent_meal: 'recent meal',
    kennel_exposure: 'kennel exposure',
    shelter_exposure: 'shelter exposure',
    multi_animal_exposure: 'multi-animal exposure',
    stagnant_water_exposure: 'stagnant water exposure',
    recent_travel: 'recent travel',
    toxin_exposure_possible: 'possible toxin exposure',
    pot_bellied_appearance: 'pot-bellied appearance',
    marked_alp_elevation: 'marked ALP elevation',
    supportive_acth_stimulation_test: 'supportive ACTH stimulation test',
    significant_hyperglycemia: 'significant hyperglycemia',
    mild_hyperglycemia: 'mild hyperglycemia',
    glucosuria_absent: 'glucosuria absent',
    diabetic_metabolic_profile: 'diabetic metabolic profile',
    gradual_onset: 'gradual onset',
    acute_onset: 'acute onset',
    chronic_duration: 'chronic duration',
    progressive_worsening: 'progressive worsening',
    intermittent_course: 'intermittent course',
};

export function getClinicalVocabularyRegistry(): ClinicalVocabularyRegistry {
    return registry;
}

export function getClinicalVocabularyTerms(): ClinicalVocabularyEntry[] {
    return registry.terms;
}

export function getClinicalVocabularyEntry(term: string): ClinicalVocabularyEntry | null {
    return entryByCanonical.get(term) ?? null;
}

export function getClinicalVocabularyStats() {
    return {
        version: registry.version,
        total_terms: registry.terms.length,
        categories: [...new Set(registry.terms.map((entry) => entry.category))].sort(),
    };
}

export function getClinicalTermDisplayLabel(term: string): string {
    return DISPLAY_LABEL_OVERRIDES[term] ?? term.replace(/_/g, ' ');
}

export function normalizeClinicalTerm(
    value: unknown,
    options: NormalizeClinicalTermOptions = {},
): string | null {
    if (typeof value !== 'string') return null;

    const normalized = normalizePhrase(value);
    if (!normalized) return null;

    const direct = aliasLookup.get(normalized);
    if (direct && matchesCategoryFilter(direct.category, options.categories)) {
        return direct.canonical_term;
    }

    const heuristic = inferHeuristicTerms(normalized)
        .find((match) => matchesCategoryFilter(getClinicalVocabularyEntry(match)?.category ?? '', options.categories));
    return heuristic ?? null;
}

export function normalizeClinicalTermArray(
    value: unknown,
    options: NormalizeClinicalTermOptions = {},
): string[] {
    const output = new Set<string>();
    const fragments = coerceTextFragments(value);

    for (const fragment of fragments) {
        const direct = normalizeClinicalTerm(fragment, options);
        if (direct) {
            output.add(direct);
            continue;
        }

        for (const term of extractClinicalTermsFromText(fragment, options)) {
            output.add(term);
        }
    }

    return [...output];
}

export function extractClinicalTermsFromText(
    value: unknown,
    options: NormalizeClinicalTermOptions = {},
): string[] {
    if (typeof value !== 'string') return [];

    const normalized = normalizePhrase(value);
    if (!normalized) return [];

    const found = new Set<string>();

    for (const entry of aliasEntries) {
        if (!matchesCategoryFilter(entry.category, options.categories)) continue;
        if (entry.regex.test(normalized)) {
            found.add(entry.canonical_term);
        }
    }

    for (const inferred of inferHeuristicTerms(normalized)) {
        const category = getClinicalVocabularyEntry(inferred)?.category ?? '';
        if (matchesCategoryFilter(category, options.categories)) {
            found.add(inferred);
        }
    }

    return [...found];
}

function buildAliasLookup(): Map<string, { canonical_term: string; category: string }> {
    const lookup = new Map<string, { canonical_term: string; category: string }>();

    for (const entry of registry.terms) {
        lookup.set(normalizePhrase(entry.canonical_term), {
            canonical_term: entry.canonical_term,
            category: entry.category,
        });

        for (const alias of entry.aliases) {
            lookup.set(normalizePhrase(alias), {
                canonical_term: entry.canonical_term,
                category: entry.category,
            });
        }
    }

    return lookup;
}

function buildAliasEntries(): AliasEntry[] {
    const entries: AliasEntry[] = [];

    for (const entry of registry.terms) {
        const phrases = [entry.canonical_term, ...entry.aliases];
        for (const phrase of phrases) {
            const normalized = normalizePhrase(phrase);
            if (!normalized) continue;

            entries.push({
                alias: normalized,
                canonical_term: entry.canonical_term,
                category: entry.category,
                regex: buildBoundaryRegex(normalized),
            });
        }
    }

    return entries.sort((left, right) => right.alias.length - left.alias.length);
}

function buildBoundaryRegex(value: string): RegExp {
    const escaped = escapeRegExp(value).replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
}

function inferHeuristicTerms(value: string): string[] {
    const heuristics: Array<[string, RegExp]> = [
        ['lethargy', /\b(?:very|really|super|extremely)?\s*tired\b|\bnot acting like (?:himself|herself)\b|\blow energy\b/i],
        ['anorexia', /\bnot eating\b|\bwon'?t eat\b|\bhasn'?t eaten\b|\brefusing food\b/i],
        ['retching_unproductive', /\b(?:trying|tried)\s+to\s+vomit\b.*\b(?:nothing|no vomit|nothing came out|but nothing came out)\b|\bdry heaving\b/i],
        ['abdominal_distension', /\bstomach looks big\b|\bbelly looks big\b|\bswollen belly\b|\bbloated\b/i],
        ['ocular_discharge', /\bwatery eyes\b|\beyes watery\b/i],
        ['polydipsia', /\bdrinking a lot\b|\bdrinking more water\b|\bvery thirsty\b/i],
        ['polyuria', /\burinating a lot\b|\bpeeing more\b|\bincreased urination\b/i],
        ['polyphagia', /\balways hungry\b|\beating a lot\b|\bincreased appetite\b/i],
        ['panting', /\bpanting\b|\bpants a lot\b|\bexcessive panting\b/i],
        ['alopecia', /\bhair thinning\b|\bthinning hair\b|\bhair loss\b|\balopecia\b/i],
        ['pot_bellied_appearance', /\bpot[- ]bellied\b|\bpot belly\b|\bpendulous abdomen\b/i],
        ['marked_alp_elevation', /\b(?:alp|alkaline phosphatase)\b.*\b(?:marked(?:ly)? elevated|[4-9]x normal|[3-9]x uln)\b/i],
        ['hypercholesterolemia', /\bhypercholesterolemia\b|\bhigh cholesterol\b/i],
        ['supportive_acth_stimulation_test', /\bacth(?: stimulation| stim)?\b.*\b(?:supportive|positive|consistent with hyperadrenocorticism)\b/i],
        ['dilute_urine', /\bdilute urine\b|\blow urine specific gravity\b|\busg low\b/i],
        ['significant_hyperglycemia', /\b(?:persistent|significant|marked)\s+hyperglycemia\b|\bglucose markedly elevated\b/i],
        ['mild_hyperglycemia', /\bmild hyperglycemia\b|\bmildly elevated glucose\b|\bborderline hyperglycemia\b/i],
        ['glucosuria', /\bglucosuria\b|\bglucose in urine\b|\burine glucose positive\b/i],
        ['glucosuria_absent', /\bno glucosuria\b|\bwithout glucosuria\b|\burine glucose negative\b/i],
        ['ketonuria', /\bketonuria\b|\bketones in urine\b|\burine ketones?\b/i],
        ['diabetic_metabolic_profile', /\bdiabetic metabolic profile\b|\bmetabolic profile consistent with diabetes\b/i],
        ['normal_activity', /\bacting normal\b|\bactivity normal\b|\bplaying normally\b/i],
        ['normal_appetite', /\beating normally\b|\bappetite normal\b/i],
        ['pain_behavior_absent', /\bno pain\b|\bnot painful\b|\bdoesn'?t seem painful\b|\bcomfortable abdomen\b/i],
        ['normal_urination', /\bpeeing normally\b|\burinating normally\b|\bnormal urination\b/i],
        ['normal_respiratory_effort', /\bbreathing normally\b|\bnormal breathing effort\b|\brespiratory effort normal\b/i],
        ['urinary_obstruction_pattern', /\bcan'?t pee\b|\bcannot pee\b|\bunable to urinate\b|\bstraining to pee\b.*\b(?:no urine|only drops|just dribbles)\b|\bonly dribbles urine\b/i],
        ['acute_onset', /\bstarted suddenly\b|\bcame on suddenly\b|\babrupt onset\b/i],
        ['gradual_onset', /\bgradual onset\b|\bcame on gradually\b|\bslowly progressive\b|\bgradually progressive\b/i],
        ['chronic_duration', /\bfor months\b|\blong[- ]standing\b|\bchronic\b/i],
        ['progressive_worsening', /\bgetting worse\b|\bworsening\b|\bprogressively worse\b/i],
        ['intermittent_course', /\bcomes and goes\b|\boff and on\b|\bintermittent\b|\bwaxing and waning\b/i],
        ['recent_meal', /\bafter eating\b|\bafter a meal\b|\bafter feeding\b|\bpost[- ]prandial\b/i],
        ['kennel_exposure', /\bboarding\b|\bdaycare\b|\bdog park\b|\bkennel\b/i],
        ['shelter_exposure', /\bshelter\b|\brecent rescue\b/i],
        ['multi_animal_exposure', /\bmultiple dogs\b|\bmultiple cats\b|\bmulti[- ]animal household\b/i],
        ['stagnant_water_exposure', /\bstanding water\b|\bpond water\b|\blake water\b|\bdirty water\b/i],
        ['recent_travel', /\brecent travel\b|\brecent trip\b|\bout of state\b/i],
        ['intact_female', /\bintact female\b|\bunspayed female\b/i],
        ['intact_male', /\bintact male\b|\bunneutered male\b/i],
        ['pregnant', /\bpregnan(?:t|cy)\b/i],
        ['postpartum', /\bpost[- ]partum\b|\brecently whelped\b|\brecently queened\b/i],
        ['recent_estrus', /\bin heat recently\b|\brecent estrus\b|\brecent heat cycle\b/i],
    ];

    return heuristics
        .filter(([, pattern]) => pattern.test(value))
        .map(([term]) => term);
}

function coerceTextFragments(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.split(/[,;\n]|(?:\band\b)/i).map((entry) => entry.trim()).filter(Boolean);
    }
    return [];
}

function normalizePhrase(value: string): string {
    return value
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/[^a-z0-9\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchesCategoryFilter(category: string, categories?: string[]): boolean {
    if (!categories || categories.length === 0) return true;
    return categories.includes(category);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
