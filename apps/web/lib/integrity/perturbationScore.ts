import type { PerturbationScore } from '@/lib/integrity/types';

const COMMON_SPECIES = new Set(['canine', 'dog', 'feline', 'cat']);
const EXOTIC_SPECIES = new Set(['equine', 'horse', 'bovine', 'cow', 'avian', 'bird', 'rabbit', 'ferret', 'reptile', 'goat', 'swine', 'pig']);
const AMBIGUOUS_TERMS = [
    'maybe',
    'not sure',
    'unsure',
    'possibly',
    'possible',
    'perhaps',
    'unclear',
    'unknown',
    'kind of',
    'sort of',
    'seems like',
];

export function computePerturbationScore(
    inputSignature: Record<string, unknown>,
    contradictionAnalysis?: Record<string, unknown> | null,
): PerturbationScore {
    const components = {
        noise: computeNoiseComponent(inputSignature),
        contradiction: computeContradictionComponent(contradictionAnalysis),
        missingness: computeMissingnessComponent(inputSignature),
        ambiguity: computeAmbiguityComponent(inputSignature),
        distribution_shift: computeDistributionShiftComponent(inputSignature),
    };

    const m = clamp01(
        (components.missingness * 0.28)
        + (components.contradiction * 0.26)
        + (components.noise * 0.16)
        + (components.ambiguity * 0.14)
        + (components.distribution_shift * 0.16),
    );

    const reasoning: string[] = [];
    if (components.missingness >= 0.2) reasoning.push('Input is missing core clinical structure or required fields.');
    if (components.contradiction >= 0.2) reasoning.push('Contradictory signals were detected in the case presentation.');
    if (components.noise >= 0.2) reasoning.push('Input contains noisy or weakly structured clinical text.');
    if (components.ambiguity >= 0.2) reasoning.push('Input language is ambiguous or overly tentative.');
    if (components.distribution_shift >= 0.2) reasoning.push('Case characteristics appear outside the common operating distribution.');
    if (reasoning.length === 0) reasoning.push('Clinical input structure is coherent and close to the expected operating regime.');

    return {
        m: roundMetric(m),
        components: {
            noise: roundMetric(components.noise),
            contradiction: roundMetric(components.contradiction),
            missingness: roundMetric(components.missingness),
            ambiguity: roundMetric(components.ambiguity),
            distribution_shift: roundMetric(components.distribution_shift),
        },
        reasoning,
    };
}

function computeMissingnessComponent(inputSignature: Record<string, unknown>) {
    const species = readString(inputSignature.species);
    const breed = readString(inputSignature.breed);
    const symptoms = readStringArray(inputSignature.symptoms);
    const rawNote = readString(asRecord(inputSignature.metadata).raw_note);

    let score = 0;
    if (!species) score += 0.24;
    if (!breed) score += 0.08;
    if (symptoms.length === 0) {
        score += 0.48;
    } else if (symptoms.length === 1) {
        score += 0.22;
    }
    if (!rawNote && symptoms.length < 2) score += 0.12;

    return clamp01(score);
}

function computeContradictionComponent(contradictionAnalysis?: Record<string, unknown> | null) {
    const contradiction = asRecord(contradictionAnalysis);
    const contradictionScore = numberOrNull(contradiction.contradiction_score) ?? 0;
    const contradictionReasons = readStringArray(contradiction.contradiction_reasons);

    return clamp01(Math.max(contradictionScore, contradictionReasons.length * 0.18));
}

function computeNoiseComponent(inputSignature: Record<string, unknown>) {
    const text = collectInputText(inputSignature);
    if (!text) return 0;

    const alphaChars = Array.from(text).filter((char) => /[A-Za-z]/.test(char)).length;
    const uppercaseChars = Array.from(text).filter((char) => /[A-Z]/.test(char)).length;
    const punctuationChars = Array.from(text).filter((char) => /[!?.,;:_\-/#$%]/.test(char)).length;
    const noisyTokens = text
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => /[0-9]/.test(token) || /[^A-Za-z0-9]/.test(token))
        .length;

    let score = 0;
    if (alphaChars > 0 && uppercaseChars / alphaChars > 0.28) score += 0.18;
    if (text.length > 0 && punctuationChars / text.length > 0.09) score += 0.2;
    if (/[!?.,;:_\-/#$%]{3,}/.test(text)) score += 0.2;
    if (noisyTokens >= 4) score += 0.18;
    if (text.length > 1500) score += 0.1;

    return clamp01(score);
}

function computeAmbiguityComponent(inputSignature: Record<string, unknown>) {
    const text = collectInputText(inputSignature).toLowerCase();
    if (!text) return 0;

    let hits = 0;
    for (const term of AMBIGUOUS_TERMS) {
        if (text.includes(term)) hits += 1;
    }

    const symptoms = readStringArray(inputSignature.symptoms);
    const genericSymptoms = symptoms.filter((symptom) => {
        const normalized = symptom.trim().toLowerCase();
        return normalized === 'sick'
            || normalized === 'pain'
            || normalized === 'not acting right'
            || normalized === 'weak';
    }).length;

    return clamp01((hits * 0.16) + (genericSymptoms * 0.08));
}

function computeDistributionShiftComponent(inputSignature: Record<string, unknown>) {
    const species = (readString(inputSignature.species) ?? '').trim().toLowerCase();
    const breed = (readString(inputSignature.breed) ?? '').trim().toLowerCase();

    let score = 0;
    if (species && !COMMON_SPECIES.has(species)) {
        score += EXOTIC_SPECIES.has(species) ? 0.48 : 0.34;
    }
    if (breed && (breed.includes('unknown') || breed.includes('mix') || breed.includes('cross'))) {
        score += 0.08;
    }
    if (breed && (breed.length > 30 || /[0-9/]/.test(breed))) {
        score += 0.12;
    }
    if (!species && breed) {
        score += 0.12;
    }

    return clamp01(score);
}

function collectInputText(inputSignature: Record<string, unknown>) {
    const metadata = asRecord(inputSignature.metadata);
    return [
        readStringArray(inputSignature.symptoms).join(' '),
        readString(metadata.raw_note),
        readString(metadata.history),
        readString(metadata.presenting_complaint),
    ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(' ')
        .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry): entry is string => entry.length > 0);
}

function numberOrNull(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number) {
    return Math.round(clamp01(value) * 1000) / 1000;
}
