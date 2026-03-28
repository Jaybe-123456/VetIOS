/**
 * VetIOS Input Normalizer
 *
 * Accepts any reasonable user input and converts it into the canonical
 * inference input_signature schema:
 *   { species, breed, symptoms[], metadata }
 *
 * Parsing pipeline (layered, never crashes):
 *   1. Valid JSON → map fields
 *   2. Repaired JSON → map fields
 *   3. Plain text → keyword extraction
 *   4. Fallback → raw_note
 */

import { safeParseJson } from './jsonRepair';
import { attachAntigravitySignal } from '../ai/antigravitySignal';
import { attachSignalWeightProfile } from '@/lib/clinicalSignal/signalWeightEngine';
import {
    OBSERVATION_VOCABULARY_CATEGORIES,
    extractClinicalTermsFromText,
    getClinicalTermDisplayLabel,
} from '@/lib/clinicalSignal/clinicalVocabulary';

// ── Types ────────────────────────────────────────────────────────────────────

export type InputMode = 'structured' | 'freetext' | 'json';

export interface NormalizedInput {
    species: string | null;
    breed: string | null;
    symptoms: string[];
    metadata: Record<string, unknown>;
}

// ── Species / Breed dictionaries ─────────────────────────────────────────────

const SPECIES_MAP: Record<string, string> = {
    dog: 'canine', canine: 'canine', puppy: 'canine',
    cat: 'feline', feline: 'feline', kitten: 'feline',
    horse: 'equine', equine: 'equine', mare: 'equine', stallion: 'equine', foal: 'equine',
    cow: 'bovine', bovine: 'bovine', calf: 'bovine',
    bird: 'avian', avian: 'avian', parrot: 'avian', chicken: 'avian',
    rabbit: 'lagomorph', bunny: 'lagomorph',
    hamster: 'rodent', guinea_pig: 'rodent', rat: 'rodent', mouse: 'rodent',
    snake: 'reptile', lizard: 'reptile', turtle: 'reptile', tortoise: 'reptile',
    fish: 'fish', goldfish: 'fish',
    ferret: 'mustelid',
};

const COMMON_BREEDS = [
    'golden retriever', 'labrador', 'german shepherd', 'bulldog', 'poodle',
    'beagle', 'rottweiler', 'dachshund', 'boxer', 'husky', 'chihuahua',
    'shih tzu', 'doberman', 'great dane', 'border collie', 'australian shepherd',
    'cocker spaniel', 'pomeranian', 'yorkshire terrier', 'french bulldog',
    'persian', 'siamese', 'maine coon', 'bengal', 'ragdoll', 'british shorthair',
    'abyssinian', 'sphynx', 'scottish fold', 'burmese',
    'arabian', 'thoroughbred', 'quarter horse', 'appaloosa',
    'canis lupus familiaris', 'felis catus',
];

// ── Main normalizer ──────────────────────────────────────────────────────────

export function normalizeInferenceInput(raw: string, mode: InputMode): NormalizedInput {
    const trimmed = raw.trim();
    if (!trimmed) return fallback('');

    // JSON mode or auto-detect JSON
    if (mode === 'json' || looksLikeJson(trimmed)) {
        const fromJson = normalizeFromJson(trimmed);
        if (fromJson) return enrichNormalizedInput(fromJson);
        // If JSON mode but parse failed, still try text extraction
    }

    // Free text / structured fallback
    return enrichNormalizedInput(normalizeFromText(trimmed));
}

// ── JSON normalization ───────────────────────────────────────────────────────

function normalizeFromJson(raw: string): NormalizedInput | null {
    const obj = safeParseJson(raw);
    if (!obj) return null;

    // Flatten: user might send { input: { input_signature: { ... } } } or just { species: ... }
    const sig = extractSignature(obj);

    const species = extractString(sig, ['species']) ?? null;
    const breed = extractString(sig, ['breed']) ?? null;
    const symptoms = extractSymptoms(sig);

    // Collect known metadata fields
    const metadata: Record<string, unknown> = {};
    const knownKeys = new Set(['species', 'breed', 'symptoms', 'diagnostic_images', 'lab_results']);
    for (const [k, v] of Object.entries(sig)) {
        if (!knownKeys.has(k)) {
            metadata[k] = v;
        }
    }

    return { species, breed, symptoms, metadata };
}

function extractSignature(obj: Record<string, unknown>): Record<string, unknown> {
    // Try nested paths
    if (obj.input && typeof obj.input === 'object') {
        const inp = obj.input as Record<string, unknown>;
        if (inp.input_signature && typeof inp.input_signature === 'object') {
            return inp.input_signature as Record<string, unknown>;
        }
    }
    if (obj.input_signature && typeof obj.input_signature === 'object') {
        return obj.input_signature as Record<string, unknown>;
    }
    // Assume flat structure
    return obj;
}

function extractString(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
}

function extractSymptoms(obj: Record<string, unknown>): string[] {
    const raw = obj.symptoms;
    if (Array.isArray(raw)) {
        return raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map(s => s.trim());
    }
    if (typeof raw === 'string') {
        return splitSymptoms(raw);
    }
    return [];
}

// ── Text normalization ───────────────────────────────────────────────────────

function normalizeFromText(raw: string): NormalizedInput {
    const lower = raw.toLowerCase();
    const metadata: Record<string, unknown> = { raw_note: raw };

    // Extract species
    let species: string | null = null;
    for (const [keyword, canonical] of Object.entries(SPECIES_MAP)) {
        const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
        if (pattern.test(lower)) {
            species = canonical;
            break;
        }
    }

    // Extract breed
    let breed: string | null = null;
    for (const b of COMMON_BREEDS) {
        if (lower.includes(b.toLowerCase())) {
            // Capitalize properly
            breed = b.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            break;
        }
    }

    // Try to parse "Species: X | Breed: Y | Symptoms: Z" format
    const pipeFields = parsePipeFormat(raw);
    if (pipeFields.species) species = species || pipeFields.species;
    if (pipeFields.breed) breed = breed || pipeFields.breed;

    // Extract symptoms
    let symptoms: string[] = [];
    if (pipeFields.symptoms) {
        symptoms = splitSymptoms(pipeFields.symptoms);
    } else {
        symptoms = extractSymptomsFromText(raw);
    }

    // Extract age
    const ageMatch = raw.match(/(\d+)\s*(years?|months?|weeks?|days?)\s*old/i);
    if (ageMatch) {
        const value = parseInt(ageMatch[1], 10);
        const unit = ageMatch[2].toLowerCase();
        if (unit.startsWith('year')) metadata.age_months = value * 12;
        else if (unit.startsWith('month')) metadata.age_months = value;
        else if (unit.startsWith('week')) metadata.age_weeks = value;
        else if (unit.startsWith('day')) metadata.age_days = value;
    }

    // Extract weight
    const weightMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilograms?)/i);
    if (weightMatch) {
        metadata.weight_kg = parseFloat(weightMatch[1]);
    }
    const weightLbMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/i);
    if (weightLbMatch) {
        metadata.weight_lbs = parseFloat(weightLbMatch[1]);
    }

    // Extract duration
    const durationMatch = raw.match(/(?:for|since|past)\s+(\d+)\s*(days?|weeks?|hours?|months?)/i);
    if (durationMatch) {
        metadata.duration = `${durationMatch[1]} ${durationMatch[2]}`;
    }

    return { species, breed, symptoms, metadata };
}

// ── Pipe-delimited format parser ──────────────────────────────────────────────
// Handles: "Species: dog | Breed: German Shepherd | Symptoms: fever, cough"

function parsePipeFormat(raw: string): { species?: string; breed?: string; symptoms?: string } {
    const result: { species?: string; breed?: string; symptoms?: string } = {};

    // Try pipe-delimited
    const parts = raw.split('|').map(p => p.trim());
    for (const part of parts) {
        const colonIdx = part.indexOf(':');
        if (colonIdx === -1) continue;
        const key = part.slice(0, colonIdx).trim().toLowerCase();
        const val = part.slice(colonIdx + 1).trim();
        if (key === 'species') result.species = val;
        else if (key === 'breed') result.breed = val;
        else if (key === 'symptoms' || key === 'symptom') result.symptoms = val;
    }

    // Also try colon-newline format
    if (!result.species && !result.breed) {
        const lines = raw.split('\n');
        for (const line of lines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim().toLowerCase();
            const val = line.slice(colonIdx + 1).trim();
            if (key === 'species') result.species = val;
            else if (key === 'breed') result.breed = val;
            else if (key === 'symptoms' || key === 'symptom') result.symptoms = val;
        }
    }

    return result;
}

// ── Symptom extraction from free text ─────────────────────────────────────────

const COMMON_SYMPTOMS = [
    'lethargy', 'vomiting', 'diarrhea', 'fever', 'coughing', 'cough',
    'sneezing', 'limping', 'swelling', 'loss of appetite', 'anorexia',
    'weight loss', 'dehydration', 'seizures', 'tremors', 'paralysis',
    'bleeding', 'discharge', 'itching', 'scratching', 'hair loss', 'alopecia',
    'difficulty breathing', 'dyspnea', 'wheezing', 'panting',
    'excessive thirst', 'polydipsia', 'polyuria', 'frequent urination',
    'constipation', 'bloating', 'abdominal pain', 'lameness',
    'eye discharge', 'nasal discharge', 'ear infection',
    'skin rash', 'hives', 'jaundice', 'pale gums',
    'increased heart rate', 'tachycardia', 'bradycardia',
    'hypersalivation', 'drooling', 'inappetence', 'nausea',
    'hypothermia', 'hyperthermia', 'ataxia', 'collapse',
    'toxin exposure', 'poisoning',
];

function extractSymptomsFromText(raw: string): string[] {
    const lower = raw.toLowerCase();
    const found: string[] = [];

    // First try comma/semicolon/and splitting
    const hasSeparators = /[,;]/.test(raw) || /\band\b/i.test(raw);
    if (hasSeparators) {
        const parts = raw.split(/[,;]|\band\b/i).map(p => p.trim()).filter(Boolean);
        // If parts look like symptom fragments (short, no key:value), use them
        const symptomLike = parts.filter(p => p.length < 60 && !p.includes(':'));
        if (symptomLike.length > 0) {
            // Clean each: remove leading species/breed info if mixed
            for (const s of symptomLike) {
                const cleaned = s.replace(/^\d+\s*(years?|months?)\s*old\s*/i, '').trim();
                if (cleaned && cleaned.length > 1) found.push(cleaned);
            }
        }
    }

    const extracted = extractClinicalTermsFromText(raw, {
        categories: [...OBSERVATION_VOCABULARY_CATEGORIES],
    });
    for (const term of extracted) {
        const label = getClinicalTermDisplayLabel(term);
        if (!found.some((entry) => entry.toLowerCase() === label.toLowerCase())) {
            found.push(label);
        }
    }

    // Also match known symptoms from the dictionary
    for (const symptom of COMMON_SYMPTOMS) {
        if (lower.includes(symptom) && !found.some(f => f.toLowerCase() === symptom)) {
            found.push(symptom);
        }
    }

    // Deduplicate
    const unique = [...new Set(found.map(s => s.toLowerCase().trim()))];
    return unique.filter(s => s.length > 0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitSymptoms(raw: string): string[] {
    return raw
        .split(/[,;]|\band\b/i)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

function looksLikeJson(raw: string): boolean {
    return (raw.startsWith('{') && raw.includes(':')) || raw.startsWith('[');
}

function fallback(raw: string): NormalizedInput {
    return enrichNormalizedInput({
        species: null,
        breed: null,
        symptoms: [],
        metadata: raw ? { raw_note: raw } : {},
    });
}

function enrichNormalizedInput(input: NormalizedInput): NormalizedInput {
    const antigravityEnriched = attachAntigravitySignal({
        species: input.species,
        breed: input.breed,
        symptoms: input.symptoms,
        metadata: input.metadata ?? {},
    });
    const enriched = attachSignalWeightProfile(antigravityEnriched);
    const metadata = enriched.metadata && typeof enriched.metadata === 'object'
        ? enriched.metadata as Record<string, unknown>
        : {};

    return {
        species: typeof enriched.species === 'string' ? enriched.species : input.species,
        breed: typeof enriched.breed === 'string' ? enriched.breed : input.breed,
        symptoms: Array.isArray(enriched.symptoms)
            ? enriched.symptoms.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            : input.symptoms,
        metadata,
    };
}
