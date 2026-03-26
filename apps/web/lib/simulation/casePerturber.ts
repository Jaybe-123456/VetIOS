import type { PerturbationVector } from '@/lib/simulation/simulationTypes';

const SPECIES_NOISE_SYMPTOMS: Record<string, string[]> = {
    canine: ['mild pruritus', 'intermittent sneezing', 'soft stool after treats', 'occasional paw licking'],
    feline: ['intermittent grooming changes', 'mild hiding behavior', 'soft stool after treats', 'occasional sneezing'],
    equine: ['mild flank sensitivity', 'intermittent tail swishing', 'brief feed hesitation'],
    default: ['intermittent sneezing', 'mild lethargy', 'reduced appetite', 'soft stool'],
};

const RARE_BREEDS: Record<string, string[]> = {
    canine: ['Xoloitzcuintli', 'Thai Ridgeback', 'Lagotto Romagnolo', 'Azawakh'],
    feline: ['Korat', 'Chartreux', 'Turkish Van', 'LaPerm'],
    equine: ['Akhal-Teke', 'Exmoor Pony', 'Mangalarga Marchador'],
    default: ['rare mixed lineage'],
};

const MIXED_PATHOLOGY_NOTES = [
    'Additional subtle neurologic changes were reported after the primary complaint began.',
    'The presentation appears to mix gastrointestinal and respiratory features atypically.',
    'A secondary inflammatory-looking pattern was noted that does not cleanly fit the leading syndrome.',
];

const CONTRADICTION_NOTES = [
    'Earlier intake notes suggest the patient was bright and eating normally despite the current concern.',
    'One portion of the history reports no vomiting, while a later note mentions repeated vomiting overnight.',
    'A prior triage comment described normal breathing even though the present complaint emphasizes respiratory distress.',
];

export function normalizeClinicalBaseCase(baseCase: Record<string, unknown>) {
    const metadata = asRecord(baseCase.metadata);

    const normalized: Record<string, unknown> = {
        ...baseCase,
        species: readString(baseCase.species) ?? null,
        breed: readString(baseCase.breed) ?? null,
        symptoms: normalizeSymptoms(baseCase.symptoms),
        metadata: {
            ...metadata,
            raw_note: readString(metadata.raw_note) ?? null,
            history: readString(metadata.history) ?? null,
            presenting_complaint: readString(metadata.presenting_complaint) ?? null,
        },
    };

    return normalized;
}

export function perturbClinicalCase(
    baseCase: Record<string, unknown>,
    perturbationVector: PerturbationVector,
) {
    const normalized = normalizeClinicalBaseCase(baseCase);
    const metadata = { ...asRecord(normalized.metadata) };
    let symptoms = normalizeSymptoms(normalized.symptoms);
    let species = readString(normalized.species);
    let breed = readString(normalized.breed);

    if (perturbationVector.noise >= 0.15) {
        symptoms = injectNoiseSymptoms(symptoms, species, perturbationVector.noise);
        metadata.raw_note = appendSentence(
            metadata.raw_note,
            perturbationVector.noise >= 0.45
                ? 'The chart also contains minor unrelated complaints from a separate callback.'
                : 'There are a few low-priority notes mixed into the presentation.',
        );
    }

    if (perturbationVector.ambiguity >= 0.18) {
        metadata.raw_note = prependSentence(
            metadata.raw_note,
            perturbationVector.ambiguity >= 0.5
                ? 'Owner is not sure exactly when the main symptoms started and describes the patient as just not acting right.'
                : 'The timeline is somewhat unclear and several details remain uncertain.',
        );
        metadata.presenting_complaint = makeAmbiguous(metadata.presenting_complaint);
        if (perturbationVector.ambiguity >= 0.55 && symptoms.length > 1) {
            symptoms = [symptoms[0], 'not acting right', ...symptoms.slice(1, 2)];
        }
    }

    if (perturbationVector.contradiction >= 0.18) {
        metadata.history = appendSentence(
            metadata.history,
            CONTRADICTION_NOTES[selectIndex(perturbationVector.contradiction, CONTRADICTION_NOTES.length)],
        );
    }

    if (perturbationVector.distribution_shift >= 0.2) {
        const normalizedSpecies = normalizeSpeciesKey(species);
        const rareBreeds = RARE_BREEDS[normalizedSpecies] ?? RARE_BREEDS.default;
        if (perturbationVector.distribution_shift >= 0.45) {
            breed = rareBreeds[selectIndex(perturbationVector.distribution_shift, rareBreeds.length)];
        } else if (!breed) {
            breed = rareBreeds[0];
        }
        metadata.raw_note = appendSentence(
            metadata.raw_note,
            MIXED_PATHOLOGY_NOTES[selectIndex(perturbationVector.distribution_shift, MIXED_PATHOLOGY_NOTES.length)],
        );
        if (perturbationVector.distribution_shift >= 0.55) {
            symptoms = addUniqueSymptoms(symptoms, ['intermittent neurologic changes']);
        }
    }

    if (perturbationVector.missingness >= 0.16) {
        const strength = perturbationVector.missingness;
        if (strength >= 0.25) delete metadata.history;
        if (strength >= 0.38) delete metadata.presenting_complaint;
        if (strength >= 0.52) delete metadata.raw_note;
        if (strength >= 0.28) delete normalized.lab_results;
        if (strength >= 0.42) delete normalized.diagnostic_images;
        if (symptoms.length > 2) {
            const keepCount = strength >= 0.55 ? 1 : 2;
            symptoms = symptoms.slice(0, keepCount);
        }
        if (strength >= 0.65) breed = null;
    }

    return {
        ...normalized,
        species,
        breed,
        symptoms,
        metadata,
    };
}

export function sanitizeSimulationInput(inputSignature: Record<string, unknown>) {
    const sanitized = normalizeClinicalBaseCase(inputSignature);

    if (Array.isArray(sanitized.diagnostic_images)) {
        sanitized.diagnostic_images = sanitized.diagnostic_images.map((img: any) => ({
            file_name: img.file_name,
            mime_type: img.mime_type,
            size_bytes: img.size_bytes,
        }));
    }
    if (Array.isArray(sanitized.lab_results)) {
        sanitized.lab_results = sanitized.lab_results.map((doc: any) => ({
            file_name: doc.file_name,
            mime_type: doc.mime_type,
            size_bytes: doc.size_bytes,
        }));
    }

    return sanitized;
}

function injectNoiseSymptoms(symptoms: string[], species: string | null, strength: number) {
    const normalizedSpecies = normalizeSpeciesKey(species);
    const pool = SPECIES_NOISE_SYMPTOMS[normalizedSpecies] ?? SPECIES_NOISE_SYMPTOMS.default;
    const count = strength >= 0.55 ? 2 : 1;
    const additions = pool.slice(0, count);
    return addUniqueSymptoms(symptoms, additions);
}

function addUniqueSymptoms(symptoms: string[], additions: string[]) {
    const seen = new Set(symptoms.map((symptom) => symptom.toLowerCase()));
    const next = [...symptoms];
    for (const symptom of additions) {
        if (seen.has(symptom.toLowerCase())) continue;
        next.push(symptom);
        seen.add(symptom.toLowerCase());
    }
    return next;
}

function makeAmbiguous(value: unknown) {
    const existing = readString(value);
    if (!existing) return 'Possibly unwell, but details are unclear.';
    if (existing.toLowerCase().includes('maybe') || existing.toLowerCase().includes('unclear')) {
        return existing;
    }
    return `Maybe ${existing.charAt(0).toLowerCase()}${existing.slice(1)}`;
}

function prependSentence(value: unknown, prefix: string) {
    const existing = readString(value);
    return existing ? `${prefix} ${existing}` : prefix;
}

function appendSentence(value: unknown, suffix: string) {
    const existing = readString(value);
    return existing ? `${existing} ${suffix}` : suffix;
}

function normalizeSpeciesKey(value: string | null) {
    const normalized = (value ?? '').trim().toLowerCase();
    if (normalized.includes('cat') || normalized.includes('feline')) return 'feline';
    if (normalized.includes('horse') || normalized.includes('equine')) return 'equine';
    if (normalized.includes('dog') || normalized.includes('canine')) return 'canine';
    return 'default';
}

function normalizeSymptoms(value: unknown) {
    if (!Array.isArray(value)) return [] as string[];
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry): entry is string => entry.length > 0);
}

function selectIndex(value: number, length: number) {
    if (length <= 1) return 0;
    return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
