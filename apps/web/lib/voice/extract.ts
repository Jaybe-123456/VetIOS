import type {
    ExtractedClinicalFields,
    VoiceAgeUnit,
    VoiceDurationUnit,
    VoiceSeverity,
    VoiceSex,
    VoiceSpecies,
} from './types';

const NUMBER_WORDS: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
};

const SYMPTOM_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
    { label: 'vomiting', pattern: /\bvomit(?:ing|ed|s)?\b/i },
    { label: 'diarrhea', pattern: /\bdiarrh(?:ea|oea)\b/i },
    { label: 'bloody diarrhea', pattern: /\bbloody\s+(?:diarrh(?:ea|oea)|stool|droppings)\b/i },
    { label: 'bloody droppings', pattern: /\bbloody\s+droppings\b/i },
    { label: 'lethargy', pattern: /\bletharg(?:y|ic)\b|\bvery tired\b|\bweak\b/i },
    { label: 'anorexia', pattern: /\bnot eating\b|\banorex(?:ia|ic)\b|\boff feed\b|\binappet(?:ence|ant)\b/i },
    { label: 'sneezing', pattern: /\bsneez(?:ing|es|ed)\b/i },
    { label: 'ocular discharge', pattern: /\beye discharge\b|\bocular discharge\b|\brunny eyes\b/i },
    { label: 'fever', pattern: /\bfever\b|\btemperature\b|\btemp\b/i },
    { label: 'sudden death', pattern: /\bsudden death\b|\bfound dead\b/i },
    { label: 'reduced milk production', pattern: /\bmilk production (?:down|reduced|decreased)\b|\bdrop in milk\b/i },
    { label: 'mastitis', pattern: /\bmastitis\b/i },
    { label: 'ketosis', pattern: /\bketosis\b/i },
    { label: 'pale gums', pattern: /\bpale gums\b|\bpale mucous membranes\b/i },
    { label: 'dehydration', pattern: /\bdehydrat(?:ed|ion)\b/i },
    { label: 'coughing', pattern: /\bcough(?:ing|s|ed)?\b/i },
    { label: 'respiratory distress', pattern: /\brespiratory distress\b|\bdifficulty breathing\b|\bdyspnea\b/i },
    { label: 'lameness', pattern: /\blame(?:ness)?\b|\blimp(?:ing)?\b/i },
];

const LAB_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
    { key: 'pcv', pattern: /\b(?:pcv|packed cell volume)\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)/i },
    { key: 'wbc', pattern: /\b(?:wbc|white blood cells?)\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)/i },
    { key: 'bun', pattern: /\b(?:bun)\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)/i },
    { key: 'creatinine', pattern: /\b(?:creatinine|creat)\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)/i },
    { key: 'glucose', pattern: /\b(?:glucose|blood sugar)\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)/i },
];

export function fallbackExtractClinicalFields(transcript: string): ExtractedClinicalFields {
    const cleaned = transcript.trim();
    const normalized = normalizeNumberWords(cleaned.toLowerCase());
    const species = detectSpecies(normalized);
    const breed = detectBreed(cleaned, species);
    const age = detectAge(normalized);
    const sex = detectSex(normalized);
    const symptoms = detectSymptoms(cleaned);
    const duration = detectDuration(normalized);
    const labs = detectLabs(cleaned);
    const severity = detectSeverity(normalized, symptoms);
    const presentingComplaint = symptoms.length > 0
        ? symptoms.slice(0, 5).join(', ')
        : cleaned.slice(0, 220);

    return normalizeExtractedClinicalFields({
        raw_transcript: cleaned,
        species,
        breed,
        age_value: age?.value,
        age_unit: age?.unit,
        sex,
        symptoms: symptoms.length > 0 ? symptoms : [cleaned],
        presenting_complaint: presentingComplaint,
        duration_value: duration?.value,
        duration_unit: duration?.unit,
        severity,
        labs,
        query: buildVoiceClinicalSummary({
            raw_transcript: cleaned,
            species,
            breed,
            age_value: age?.value,
            age_unit: age?.unit,
            sex,
            symptoms: symptoms.length > 0 ? symptoms : [cleaned],
            presenting_complaint: presentingComplaint,
            duration_value: duration?.value,
            duration_unit: duration?.unit,
            severity,
            labs,
        }),
        confidence: symptoms.length > 0 ? 0.72 : 0.42,
        fallback_used: true,
        extraction_notes: ['local deterministic extraction'],
    }, cleaned);
}

export function normalizeExtractedClinicalFields(value: unknown, transcript: string): ExtractedClinicalFields {
    const record = asRecord(value);
    const symptoms = readStringArray(record.symptoms);
    const labs = readNumberRecord(record.labs);
    const normalized: ExtractedClinicalFields = {
        raw_transcript: transcript.trim(),
        species: readSpecies(record.species),
        breed: readString(record.breed),
        age_value: readNumber(record.age_value),
        age_unit: readAgeUnit(record.age_unit),
        sex: readSex(record.sex),
        symptoms: symptoms.length > 0 ? symptoms : [transcript.trim()].filter(Boolean),
        presenting_complaint: readString(record.presenting_complaint),
        duration_value: readNumber(record.duration_value),
        duration_unit: readDurationUnit(record.duration_unit),
        severity: readSeverity(record.severity),
        labs,
        query: readString(record.query),
        confidence: clamp(readNumber(record.confidence), 0, 1),
        fallback_used: typeof record.fallback_used === 'boolean' ? record.fallback_used : undefined,
        extraction_notes: readStringArray(record.extraction_notes),
    };

    if (!normalized.presenting_complaint) {
        normalized.presenting_complaint = normalized.symptoms.slice(0, 5).join(', ') || transcript.trim();
    }
    if (!normalized.query) {
        normalized.query = buildVoiceClinicalSummary(normalized);
    }
    return normalized;
}

export function buildVoiceClinicalSummary(fields: ExtractedClinicalFields): string {
    const parts: string[] = [];
    const signalment = [
        fields.age_value && fields.age_unit ? `${fields.age_value} ${fields.age_unit} old` : null,
        fields.sex ? sexToReadable(fields.sex) : null,
        fields.breed ?? null,
        fields.species && fields.species !== 'unknown' ? fields.species : null,
    ].filter(Boolean);

    if (signalment.length > 0) parts.push(`Patient: ${signalment.join(' ')}`);
    if (fields.symptoms.length > 0) parts.push(`Clinical signs: ${fields.symptoms.join(', ')}`);
    if (fields.duration_value && fields.duration_unit) {
        parts.push(`Duration: ${fields.duration_value} ${fields.duration_unit}`);
    }
    if (fields.severity) parts.push(`Severity: ${fields.severity}`);
    const labText = formatLabs(fields.labs);
    if (labText) parts.push(`Labs: ${labText}`);
    if (parts.length === 0 && fields.raw_transcript) parts.push(fields.raw_transcript);
    return parts.join('\n');
}

export function buildVoiceMetadataText(fields: ExtractedClinicalFields): string {
    const lines = [
        fields.age_value && fields.age_unit ? `Age: ${fields.age_value} ${fields.age_unit}` : null,
        fields.sex ? `Sex: ${sexToReadable(fields.sex)}` : null,
        fields.duration_value && fields.duration_unit ? `Duration: ${fields.duration_value} ${fields.duration_unit}` : null,
        fields.severity ? `Severity: ${fields.severity}` : null,
        formatLabs(fields.labs) ? `Labs: ${formatLabs(fields.labs)}` : null,
        fields.raw_transcript ? `Voice note: ${fields.raw_transcript}` : null,
    ].filter(Boolean);
    return lines.join('\n');
}

export function clinicalFieldsToJsonInput(fields: ExtractedClinicalFields): string {
    return JSON.stringify({
        species: fields.species === 'unknown' ? undefined : fields.species,
        breed: fields.breed,
        symptoms: fields.symptoms,
        age_years: toAgeYears(fields.age_value, fields.age_unit),
        diagnostic_tests: { labs: fields.labs ?? {} },
        metadata: {
            sex: fields.sex,
            duration_text: fields.duration_value && fields.duration_unit
                ? `${fields.duration_value} ${fields.duration_unit}`
                : undefined,
            severity: fields.severity,
            presenting_complaint: fields.presenting_complaint,
            raw_voice_transcript: fields.raw_transcript,
        },
    }, null, 2);
}

export function toAgeYears(value: number | undefined, unit: VoiceAgeUnit | undefined): number | undefined {
    if (!value || !unit) return undefined;
    if (unit === 'years') return Number(value.toFixed(2));
    if (unit === 'months') return Number((value / 12).toFixed(2));
    return Number((value / 365).toFixed(2));
}

function normalizeNumberWords(value: string): string {
    let output = value.replace(/twenty[-\s](one|two|three|four|five|six|seven|eight|nine)/g, (_, word: string) => {
        return String(20 + NUMBER_WORDS[word]);
    });
    for (const [word, number] of Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) {
        output = output.replace(new RegExp(`\\b${word}\\b`, 'g'), String(number));
    }
    return output;
}

function detectSpecies(value: string): VoiceSpecies | undefined {
    if (/\b(dog|canine|puppy|labrador|retriever|shepherd|terrier|spaniel|collie|poodle)\b/i.test(value)) return 'canine';
    if (/\b(cat|feline|kitten)\b/i.test(value)) return 'feline';
    if (/\b(cow|cattle|bovine|calf|dairy)\b/i.test(value)) return 'bovine';
    if (/\b(chicken|broiler|hen|avian|bird|poultry)\b/i.test(value)) return 'avian';
    if (/\b(horse|equine|foal|mare|stallion|gelding)\b/i.test(value)) return 'equine';
    return undefined;
}

function detectBreed(transcript: string, species: VoiceSpecies | undefined): string | undefined {
    const knownBreeds = [
        'Golden Retriever',
        'Labrador Retriever',
        'Labrador',
        'German Shepherd',
        'Border Collie',
        'French Bulldog',
        'Persian',
        'Siamese',
        'Holstein',
        'Friesian',
        'Jersey',
        'Broiler',
    ];
    const match = knownBreeds.find((breed) => new RegExp(`\\b${escapeRegex(breed)}\\b`, 'i').test(transcript));
    if (match) return match;
    if (species === 'avian' && /\bbroiler\b/i.test(transcript)) return 'Broiler';
    return undefined;
}

function detectAge(value: string): { value: number; unit: VoiceAgeUnit } | null {
    const match = value.match(/\b(\d+(?:\.\d+)?)\s*(year|years|yr|yrs|month|months|mo|mos|day|days)\s*(?:old)?\b/i);
    if (!match) return null;
    const number = Number(match[1]);
    if (!Number.isFinite(number) || number <= 0) return null;
    const rawUnit = match[2].toLowerCase();
    if (rawUnit.startsWith('year') || rawUnit.startsWith('yr')) return { value: number, unit: 'years' };
    if (rawUnit.startsWith('month') || rawUnit.startsWith('mo')) return { value: number, unit: 'months' };
    return { value: number, unit: 'days' };
}

function detectDuration(value: string): { value: number; unit: VoiceDurationUnit } | null {
    const match = value.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(hour|hours|day|days|week|weeks)\b/i);
    if (!match) return null;
    const number = Number(match[1]);
    if (!Number.isFinite(number) || number <= 0) return null;
    const rawUnit = match[2].toLowerCase();
    if (rawUnit.startsWith('hour')) return { value: number, unit: 'hours' };
    if (rawUnit.startsWith('week')) return { value: number, unit: 'weeks' };
    return { value: number, unit: 'days' };
}

function detectSex(value: string): VoiceSex | undefined {
    if (/\bfemale\b/i.test(value) && /\bspay(?:ed)?\b/i.test(value)) return 'female_spayed';
    if (/\bmale\b/i.test(value) && /\bneuter(?:ed)?\b/i.test(value)) return 'male_neutered';
    if (/\bfemale\b/i.test(value)) return 'female_intact';
    if (/\bmale\b/i.test(value)) return 'male_intact';
    return undefined;
}

function detectSymptoms(transcript: string): string[] {
    const found = SYMPTOM_PATTERNS
        .filter(({ pattern }) => pattern.test(transcript))
        .map(({ label }) => label);
    return [...new Set(found)];
}

function detectLabs(transcript: string): Record<string, number> | undefined {
    const labs: Record<string, number> = {};
    for (const { key, pattern } of LAB_PATTERNS) {
        const match = transcript.match(pattern);
        if (!match) continue;
        const value = Number(match[1]);
        if (Number.isFinite(value)) labs[key] = value;
    }
    return Object.keys(labs).length > 0 ? labs : undefined;
}

function detectSeverity(value: string, symptoms: string[]): VoiceSeverity {
    if (/\bsudden death\b|\bcollapse(?:d)?\b|\bshock\b|\bsevere\b|\bbloody\b/i.test(value)) return 'severe';
    if (symptoms.length >= 2 || /\bnot eating\b|\boff feed\b|\bfever\b|\bvery tired\b/i.test(value)) return 'moderate';
    return 'low';
}

function readSpecies(value: unknown): VoiceSpecies | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.toLowerCase().replace(/\s+/g, '_');
    if (['canine', 'feline', 'equine', 'bovine', 'avian', 'exotic', 'unknown'].includes(normalized)) {
        return normalized as VoiceSpecies;
    }
    return detectSpecies(normalized);
}

function readSex(value: unknown): VoiceSex | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.toLowerCase().replace(/[\s-]+/g, '_');
    if (['male_intact', 'male_neutered', 'female_intact', 'female_spayed', 'unknown'].includes(normalized)) {
        return normalized as VoiceSex;
    }
    return detectSex(value);
}

function readAgeUnit(value: unknown): VoiceAgeUnit | undefined {
    return value === 'years' || value === 'months' || value === 'days' ? value : undefined;
}

function readDurationUnit(value: unknown): VoiceDurationUnit | undefined {
    return value === 'hours' || value === 'days' || value === 'weeks' ? value : undefined;
}

function readSeverity(value: unknown): VoiceSeverity | undefined {
    return value === 'low' || value === 'moderate' || value === 'severe' ? value : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(readString).filter((entry): entry is string => Boolean(entry));
}

function readNumberRecord(value: unknown): Record<string, number> | undefined {
    const record = asRecord(value);
    const output: Record<string, number> = {};
    for (const [key, raw] of Object.entries(record)) {
        const valueNumber = readNumber(raw);
        if (valueNumber != null) output[key.toLowerCase()] = valueNumber;
    }
    return Object.keys(output).length > 0 ? output : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function clamp(value: number | undefined, min: number, max: number): number | undefined {
    return value == null ? undefined : Math.min(max, Math.max(min, value));
}

function formatLabs(labs: Record<string, number> | undefined): string {
    if (!labs) return '';
    return Object.entries(labs)
        .map(([key, value]) => `${key.toUpperCase()} ${value}`)
        .join(', ');
}

function sexToReadable(sex: VoiceSex): string {
    return sex.replace(/_/g, ' ');
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
