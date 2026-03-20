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

const CANONICAL_SYMPTOM_ALIASES: Record<string, string[]> = {
    anorexia: [
        'anorexia',
        'loss of appetite',
        'reduced appetite',
        'decreased appetite',
        'inappetence',
        'not eating',
        'poor appetite',
    ],
    hemorrhagic_diarrhea: [
        'hemorrhagic diarrhea',
        'bloody diarrhea',
        'blood in stool',
        'hematochezia',
    ],
    retching_unproductive: [
        'unproductive retching',
        'nonproductive retching',
        'non productive retching',
        'dry heaving',
    ],
    ocular_discharge: [
        'ocular discharge',
        'eye discharge',
        'discharge from eyes',
    ],
    nasal_discharge: [
        'nasal discharge',
        'nose discharge',
        'runny nose',
    ],
    abdominal_distension: [
        'abdominal distension',
        'distended abdomen',
        'bloated abdomen',
        'bloat',
    ],
    hypersalivation: [
        'hypersalivation',
        'excess salivation',
        'drooling',
        'ptyalism',
    ],
    pale_mucous_membranes: [
        'pale mucous membranes',
        'pale gums',
        'white gums',
    ],
    respiratory_distress: [
        'respiratory distress',
        'labored breathing',
    ],
    dyspnea: [
        'dyspnea',
        'shortness of breath',
        'difficulty breathing',
    ],
    tachycardia: [
        'tachycardia',
        'rapid heart rate',
        'fast heart rate',
    ],
    collapse: [
        'collapse',
        'collapsed',
    ],
    lethargy: [
        'lethargy',
        'lethargic',
        'low energy',
    ],
    weakness: [
        'weakness',
        'weak',
    ],
    fever: [
        'fever',
        'pyrexia',
    ],
    vomiting: [
        'vomiting',
        'emesis',
        'productive vomiting',
    ],
    diarrhea: [
        'diarrhea',
        'diarrhoea',
    ],
    myoclonus: [
        'myoclonus',
        'muscle twitching',
        'twitching',
    ],
    cough: [
        'cough',
        'coughing',
    ],
    tremors: [
        'tremors',
        'shaking',
        'tremor',
    ],
};

const LOOKUP = buildAliasLookup();

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

    return LOOKUP[normalized] ?? heuristicNormalize(normalized);
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

function buildAliasLookup(): Record<string, string> {
    const lookup: Record<string, string> = {};

    for (const [canonical, aliases] of Object.entries(CANONICAL_SYMPTOM_ALIASES)) {
        lookup[normalizeToken(canonical)] = canonical;
        for (const alias of aliases) {
            lookup[normalizeToken(alias)] = canonical;
        }
    }

    return lookup;
}

function heuristicNormalize(value: string): string | null {
    if (value.includes('bloody') && value.includes('diarr')) return 'hemorrhagic_diarrhea';
    if ((value.includes('retch') || value.includes('dry heav')) && (value.includes('unproductive') || value.includes('non productive') || value.includes('nonproductive') || value.includes('dry'))) {
        return 'retching_unproductive';
    }
    if (value.includes('appetite') && (value.includes('loss') || value.includes('decreased') || value.includes('reduced') || value.includes('poor'))) {
        return 'anorexia';
    }
    if (value.includes('ocular') && value.includes('discharge')) return 'ocular_discharge';
    if (value.includes('nasal') && value.includes('discharge')) return 'nasal_discharge';
    if ((value.includes('abdominal') || value.includes('abdomen')) && (value.includes('distension') || value.includes('distension') || value.includes('distended') || value.includes('bloated') || value.includes('bloat'))) {
        return 'abdominal_distension';
    }
    if ((value.includes('pale') || value.includes('white')) && (value.includes('gums') || value.includes('mucous'))) {
        return 'pale_mucous_membranes';
    }
    if (value.includes('respiratory distress')) return 'respiratory_distress';
    if ((value.includes('difficulty') || value.includes('labored') || value.includes('shortness')) && value.includes('breath')) {
        return 'dyspnea';
    }
    if (value.includes('rapid heart') || value.includes('fast heart')) return 'tachycardia';
    if (value === 'collapsed') return 'collapse';
    if (value === 'lethargic') return 'lethargy';
    if (value === 'weak') return 'weakness';
    if (value === 'coughing') return 'cough';
    if (value === 'shaking') return 'tremors';

    return null;
}
