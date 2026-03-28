import signalWeightRegistry from '@/lib/clinicalSignal/signal_weights.json';
import {
    CLINICAL_CONTEXT_CATEGORIES,
    OBSERVATION_VOCABULARY_CATEGORIES,
    extractClinicalTermsFromText,
    getClinicalTermDisplayLabel,
    getClinicalVocabularyEntry,
    normalizeClinicalTermArray,
} from '@/lib/clinicalSignal/clinicalVocabulary';

export type SignalWeightCategory =
    | 'red_flag'
    | 'primary_signal'
    | 'contextual_signal'
    | 'weak_signal'
    | 'contradiction_modifier';

export interface WeightedSignal {
    canonical_term: string;
    display_label: string;
    category: SignalWeightCategory;
    weight: number;
    sources: string[];
    rationale: string[];
    emergency_override: boolean;
}

export interface SignalWeightProfile {
    profile_version: string;
    normalized_terms: string[];
    weighted_signals: WeightedSignal[];
    emergency_overrides: string[];
    applied_overrides: string[];
    category_totals: Record<SignalWeightCategory, number>;
    confidence_adjustment: {
        contradiction_penalty: number;
        weak_signal_penalty: number;
        emergency_signal_bonus: number;
        suggested_confidence_cap: number;
    };
}

interface WeightRegistry {
    version: string;
    default_category_weights: Record<string, number>;
    baseline_weights: Array<{
        canonical_term: string;
        category: SignalWeightCategory;
        base_weight: number;
        emergency_override?: boolean;
        rationale: string;
    }>;
    combination_overrides: Array<{
        id: string;
        label: string;
        when_all?: string[];
        when_any?: string[];
        apply_to: string[];
        weight_delta: number;
        category_override?: SignalWeightCategory;
        emergency_override?: boolean;
        rationale: string;
    }>;
}

const registry = signalWeightRegistry as WeightRegistry;
const baselineByTerm = new Map(registry.baseline_weights.map((entry) => [entry.canonical_term, entry]));
const observationCategories = [...OBSERVATION_VOCABULARY_CATEGORIES];
const contextCategories = [...CLINICAL_CONTEXT_CATEGORIES, 'behavior_context'];

export function buildSignalWeightProfile(
    input: Record<string, unknown>,
    options: {
        contradiction?: {
            contradiction_score?: number | null;
            contradiction_reasons?: string[] | null;
            confidence_cap?: number | null;
        } | null;
    } = {},
): SignalWeightProfile {
    const metadata = getMetadata(input);
    const narrative = collectNarrativeText(input);
    const antigravitySignal = readRecord(metadata.antigravity_signal);
    const contradictionScore = clamp(
        readNumber(options.contradiction?.contradiction_score)
        ?? readNumber(readRecord(input.contradiction_analysis)?.contradiction_score)
        ?? readNumber(readRecord(metadata.contradiction_analysis)?.contradiction_score)
        ?? 0,
        0,
        1,
    );
    const contradictionReasons = coerceStringArray(options.contradiction?.contradiction_reasons)
        .concat(coerceStringArray(readRecord(input.contradiction_analysis)?.contradiction_reasons))
        .concat(coerceStringArray(readRecord(metadata.antigravity_signal)?.contradiction_flags))
        .filter((reason) => reason.toLowerCase() !== 'none');

    const sourcesByTerm = new Map<string, Set<string>>();
    const terms = new Set<string>();

    const symptomTerms = normalizeClinicalTermArray(input.symptoms, {
        categories: [...observationCategories, ...contextCategories],
    });
    for (const term of symptomTerms) {
        terms.add(term);
        addSource(sourcesByTerm, term, 'symptom_vector');
    }

    const freeTextTerms = extractClinicalTermsFromText(narrative, {
        categories: [...observationCategories, ...contextCategories],
    });
    for (const term of freeTextTerms) {
        terms.add(term);
        addSource(sourcesByTerm, term, 'free_text');
    }

    for (const term of deriveTermsFromAntigravitySignal(antigravitySignal)) {
        terms.add(term);
        addSource(sourcesByTerm, term, 'antigravity_derived');
    }

    const weightedSignals = new Map<string, WeightedSignal>();
    for (const term of terms) {
        const entry = baselineByTerm.get(term);
        const vocabularyEntry = getClinicalVocabularyEntry(term);
        const category = entry?.category ?? inferDefaultCategory(vocabularyEntry?.category);
        const baseWeight = entry?.base_weight ?? inferDefaultWeight(vocabularyEntry?.category);
        const displayLabel = getClinicalTermDisplayLabel(term);
        const rationale = entry?.rationale
            ? [entry.rationale]
            : vocabularyEntry?.notes
                ? [vocabularyEntry.notes]
                : ['Baseline vocabulary-derived signal weight.'];

        weightedSignals.set(term, {
            canonical_term: term,
            display_label: displayLabel,
            category,
            weight: Number(baseWeight.toFixed(3)),
            sources: [...(sourcesByTerm.get(term) ?? new Set<string>())],
            rationale,
            emergency_override: Boolean(entry?.emergency_override),
        });
    }

    const appliedOverrides: string[] = [];
    for (const override of registry.combination_overrides) {
        if (!matchesOverride(terms, override)) continue;

        appliedOverrides.push(override.id);
        for (const term of override.apply_to) {
            const existing = weightedSignals.get(term);
            if (!existing) continue;

            existing.weight = Number(clamp(existing.weight + override.weight_delta, 0, 1).toFixed(3));
            existing.rationale.push(override.rationale);
            if (override.category_override) {
                existing.category = override.category_override;
            }
            if (override.emergency_override) {
                existing.emergency_override = true;
            }
        }
    }

    const weighted = [...weightedSignals.values()]
        .sort((left, right) => right.weight - left.weight)
        .map((entry) => ({
            ...entry,
            rationale: dedupeStrings(entry.rationale),
            sources: dedupeStrings(entry.sources),
        }));
    const emergencyOverrides = weighted
        .filter((entry) => entry.emergency_override || entry.category === 'red_flag')
        .map((entry) => entry.display_label);

    const categoryTotals = initializeCategoryTotals();
    for (const entry of weighted) {
        categoryTotals[entry.category] = Number((categoryTotals[entry.category] + entry.weight).toFixed(3));
    }

    const weakSignalPenalty = weighted.length > 0 && categoryTotals.weak_signal > (categoryTotals.red_flag + categoryTotals.primary_signal)
        ? 0.08
        : 0;
    const emergencySignalBonus = categoryTotals.red_flag >= 1.5 ? 0.12 : categoryTotals.red_flag >= 0.8 ? 0.06 : 0;
    const contradictionPenalty = Number((contradictionScore * 0.28).toFixed(3));
    const capFromContradiction = readNumber(options.contradiction?.confidence_cap) ?? 1;
    const suggestedConfidenceCap = Number(
        clamp(1 - contradictionPenalty - weakSignalPenalty + emergencySignalBonus, 0.25, capFromContradiction).toFixed(3),
    );

    if (contradictionReasons.length > 0) {
        categoryTotals.contradiction_modifier = Number(
            clamp(categoryTotals.contradiction_modifier + Math.min(0.5, contradictionReasons.length * 0.08), 0, 1).toFixed(3),
        );
    }

    return {
        profile_version: registry.version,
        normalized_terms: [...terms].sort(),
        weighted_signals: weighted,
        emergency_overrides: dedupeStrings(emergencyOverrides),
        applied_overrides: appliedOverrides.sort(),
        category_totals: categoryTotals,
        confidence_adjustment: {
            contradiction_penalty: contradictionPenalty,
            weak_signal_penalty: weakSignalPenalty,
            emergency_signal_bonus: emergencySignalBonus,
            suggested_confidence_cap: suggestedConfidenceCap,
        },
    };
}

export function attachSignalWeightProfile(
    input: Record<string, unknown>,
    options: {
        contradiction?: {
            contradiction_score?: number | null;
            contradiction_reasons?: string[] | null;
            confidence_cap?: number | null;
        } | null;
    } = {},
): Record<string, unknown> {
    const metadata = getMetadata(input);
    const profile = buildSignalWeightProfile(input, options);

    return {
        ...input,
        metadata: {
            ...metadata,
            signal_weight_profile: profile,
        },
    };
}

export function profileToFeatureImportance(
    profile: SignalWeightProfile,
    options: {
        includeCategories?: SignalWeightCategory[];
        topN?: number;
    } = {},
): Record<string, number> {
    const include = new Set(options.includeCategories ?? [
        'red_flag',
        'primary_signal',
        'contextual_signal',
        'weak_signal',
    ]);
    const selected = profile.weighted_signals
        .filter((entry) => include.has(entry.category))
        .slice(0, options.topN ?? 8);

    return Object.fromEntries(
        selected.map((entry) => [entry.display_label, Number(entry.weight.toFixed(2))]),
    );
}

function deriveTermsFromAntigravitySignal(signal: Record<string, unknown> | null): string[] {
    if (!signal) return [];

    const terms = new Set<string>();
    const derivedSignals = readRecord(signal.derived_signals);

    for (const entry of coerceStringArray(readRecord(signal.patient_history)?.key_context)) {
        const mapped = mapAntigravityContextToken(entry);
        if (mapped) terms.add(mapped);
    }

    for (const entry of coerceStringArray(derivedSignals?.exposure_risks)) {
        const mapped = mapAntigravityContextToken(entry);
        if (mapped) terms.add(mapped);
    }

    for (const entry of coerceStringArray(derivedSignals?.reproductive_relevance)) {
        const mapped = mapAntigravityContextToken(entry);
        if (mapped) terms.add(mapped);
    }

    for (const entry of coerceStringArray(signal.symptom_vector)) {
        for (const term of normalizeClinicalTermArray(entry, {
            categories: [...observationCategories, ...contextCategories],
        })) {
            terms.add(term);
        }
    }

    return [...terms];
}

function mapAntigravityContextToken(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    const mapping: Record<string, string> = {
        recent_meal: 'recent_meal',
        communal_animal_exposure: 'kennel_exposure',
        environmental_water_exposure: 'stagnant_water_exposure',
        recent_travel: 'recent_travel',
        foreign_material_or_dietary_indiscretion: 'foreign_body_exposure',
        toxin_exposure_possible: 'toxin_exposure_possible',
        intact_female_relevance: 'intact_female',
        pregnancy_relevant: 'pregnant',
        postpartum_relevant: 'postpartum',
    };

    return mapping[normalized] ?? null;
}

function matchesOverride(
    terms: Set<string>,
    override: WeightRegistry['combination_overrides'][number],
): boolean {
    if (override.when_all && !override.when_all.every((term) => terms.has(term))) {
        return false;
    }
    if (override.when_any && !override.when_any.some((term) => terms.has(term))) {
        return false;
    }
    return true;
}

function inferDefaultCategory(vocabularyCategory?: string): SignalWeightCategory {
    if (!vocabularyCategory) return 'weak_signal';
    if (vocabularyCategory === 'behavior_context') return 'contradiction_modifier';
    if (vocabularyCategory === 'history_concept' || vocabularyCategory === 'exposure_risk' || vocabularyCategory === 'reproductive_status') {
        return 'contextual_signal';
    }
    if (vocabularyCategory === 'systemic_symptom' || vocabularyCategory === 'dermatologic_symptom' || vocabularyCategory === 'musculoskeletal_symptom') {
        return 'weak_signal';
    }
    return 'primary_signal';
}

function inferDefaultWeight(vocabularyCategory?: string): number {
    if (!vocabularyCategory) return 0.24;
    return registry.default_category_weights[vocabularyCategory] ?? 0.24;
}

function initializeCategoryTotals(): Record<SignalWeightCategory, number> {
    return {
        red_flag: 0,
        primary_signal: 0,
        contextual_signal: 0,
        weak_signal: 0,
        contradiction_modifier: 0,
    };
}

function collectNarrativeText(input: Record<string, unknown>): string {
    const metadata = getMetadata(input);
    return [
        coerceString(input.history),
        coerceString(input.notes),
        coerceString(input.presentation),
        coerceString(input.chief_complaint),
        coerceString(metadata.raw_note),
        coerceString(metadata.history),
        coerceString(metadata.presentation),
        coerceString(metadata.chief_complaint),
    ]
        .filter((value): value is string => Boolean(value))
        .join(' ');
}

function addSource(map: Map<string, Set<string>>, term: string, source: string) {
    if (!map.has(term)) {
        map.set(term, new Set());
    }
    map.get(term)?.add(source);
}

function getMetadata(input: Record<string, unknown>): Record<string, unknown> {
    return readRecord(input.metadata) ?? {};
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function coerceString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function coerceStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
