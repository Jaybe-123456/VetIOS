import {
    OBSERVATION_VOCABULARY_CATEGORIES,
    extractClinicalTermsFromText,
    normalizeClinicalTerm,
} from '@/lib/clinicalSignal/clinicalVocabulary';

const PLACEHOLDER_VALUES = new Set([
    '',
    '-',
    '--',
    'unknown',
    'n/a',
    'na',
    'none',
    'null',
    'nil',
]);

const OBSERVATION_CATEGORIES = [...OBSERVATION_VOCABULARY_CATEGORIES];

export interface SymptomNormalizationResult {
    rawText: string | null;
    normalizedKeys: string[];
    vector: Record<string, boolean>;
    unresolvedTokens: string[];
}

export function normalizeSymptomSet(value: unknown): SymptomNormalizationResult {
    const tokens = coerceSymptomTokens(value);
    const normalized = new Set<string>();
    const unresolved = new Set<string>();

    for (const token of tokens) {
        const canonical = normalizeSingleSymptomToken(token);
        if (canonical) {
            normalized.add(canonical);
            continue;
        }

        const extracted = extractClinicalTermsFromText(token, { categories: OBSERVATION_CATEGORIES });
        if (extracted.length > 0) {
            for (const term of extracted) normalized.add(term);
        } else if (!isPlaceholderValue(token)) {
            unresolved.add(normalizeToken(token));
        }
    }

    const normalizedKeys = Array.from(normalized).sort();
    return {
        rawText: tokens.length > 0 ? tokens.join(', ') : null,
        normalizedKeys,
        vector: Object.fromEntries(normalizedKeys.map((key) => [key, true])),
        unresolvedTokens: Array.from(unresolved).sort(),
    };
}

export function normalizeSingleSymptomToken(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = normalizeToken(value);
    if (!normalized || isPlaceholderValue(normalized)) return null;

    return normalizeClinicalTerm(normalized, { categories: OBSERVATION_CATEGORIES });
}

export function hasMeaningfulSymptomInput(value: unknown): boolean {
    const normalized = normalizeSymptomSet(value);
    return normalized.normalizedKeys.length > 0 || normalized.unresolvedTokens.length > 0;
}

export function isPlaceholderValue(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return PLACEHOLDER_VALUES.has(normalizeToken(value));
}

export function normalizeSymptomText(value: unknown): string | null {
    const normalized = normalizeSymptomSet(value);
    return normalized.rawText;
}

function coerceSymptomTokens(value: unknown): string[] {
    const rawTokens = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/[,;|]/)
            : [];

    const tokens = rawTokens
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    return Array.from(new Set(tokens));
}

function normalizeToken(value: string): string {
    return value
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
