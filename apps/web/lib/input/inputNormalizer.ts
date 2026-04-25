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
    presenting_signs?: string[];
    history?: Record<string, unknown>;
    preventive_history?: Record<string, unknown>;
    diagnostic_tests?: Record<string, unknown>;
    physical_exam?: Record<string, unknown>;
    region?: string | null;
    age_years?: number;
    weight_kg?: number;
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

    return {
        species,
        breed,
        symptoms,
        presenting_signs: Array.isArray(sig.presenting_signs)
            ? (sig.presenting_signs as unknown[]).filter((entry): entry is string => typeof entry === 'string')
            : symptoms,
        history: sig.history && typeof sig.history === 'object' ? sig.history as Record<string, unknown> : undefined,
        preventive_history: sig.preventive_history && typeof sig.preventive_history === 'object' ? sig.preventive_history as Record<string, unknown> : undefined,
        diagnostic_tests: sig.diagnostic_tests && typeof sig.diagnostic_tests === 'object' ? sig.diagnostic_tests as Record<string, unknown> : undefined,
        physical_exam: sig.physical_exam && typeof sig.physical_exam === 'object' ? sig.physical_exam as Record<string, unknown> : undefined,
        region: typeof sig.region === 'string' ? sig.region : null,
        age_years: typeof sig.age_years === 'number' ? sig.age_years : undefined,
        weight_kg: typeof sig.weight_kg === 'number' ? sig.weight_kg : undefined,
        metadata,
    };
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
    const history: Record<string, unknown> = {};
    const preventive_history: Record<string, unknown> = {};
    const diagnostic_tests: Record<string, unknown> = {};
    const physical_exam: Record<string, unknown> = {};

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
        const value = parseInt(durationMatch[1], 10);
        const unit = durationMatch[2].toLowerCase();
        history.duration_days = unit.startsWith('month') ? value * 30 : unit.startsWith('week') ? value * 7 : value;
    }

    history.progression = /chronic|months?|weeks?/i.test(raw) ? 'chronic' : /acute/i.test(raw) ? 'acute' : 'subacute';
    const region = /nairobi/i.test(raw)
        ? 'nairobi_ke'
        : /east africa|kenya|uganda|tanzania/i.test(raw)
            ? 'east_africa'
            : /mediterranean|southern europe|spain|italy|greece/i.test(raw)
                ? 'mediterranean'
                : null;
    if (region) {
        history.geographic_region = region;
    }

    const vectorExposure: Record<string, boolean> = {};
    if (/mosquito[- ]?endemic|mosquito exposure|standing water/i.test(raw)) {
        vectorExposure.mosquito_endemic = true;
    }
    if (/tick[- ]?endemic|tick exposure|ticks present/i.test(raw)) {
        vectorExposure.tick_endemic = true;
    }
    if (/wildlife contact|rodent exposure/i.test(raw)) {
        vectorExposure.wildlife_contact = true;
    }
    if (/standing water/i.test(raw)) {
        vectorExposure.standing_water_access = true;
    }
    if (Object.keys(vectorExposure).length > 0) {
        preventive_history.vector_exposure = vectorExposure;
    }

    if (/zero heartworm prevention|no heartworm prevention|without heartworm prevention/i.test(raw)) {
        preventive_history.heartworm_prevention = 'none';
    } else if (/consistent heartworm prevention/i.test(raw)) {
        preventive_history.heartworm_prevention = 'consistent';
    }

    if (/no ectoparasite prevention|without tick prevention/i.test(raw)) {
        preventive_history.ectoparasite_prevention = 'none';
    }

    const serology: Record<string, unknown> = {};
    if (/positive dirofilaria immitis antigen|heartworm antigen positive/i.test(raw)) {
        serology.dirofilaria_immitis_antigen = 'positive';
    } else if (/negative dirofilaria immitis antigen|heartworm antigen negative/i.test(raw)) {
        serology.dirofilaria_immitis_antigen = 'negative';
    }
    if (/positive ehrlichia/i.test(raw)) serology.ehrlichia_antibody = 'positive';
    if (/positive anaplasma/i.test(raw)) serology.anaplasma_antibody = 'positive';
    if (/positive leishmania/i.test(raw)) serology.leishmania_antibody = 'positive';
    if (/positive parvovirus antigen|parvo positive/i.test(raw)) serology.parvovirus_antigen = 'positive';
    if (Object.keys(serology).length > 0) diagnostic_tests.serology = serology;

    // ── GI / Large-Bowel Signal Extraction ──────────────────────────────────
    // Serology: Clostridium enterotoxin ELISA
    if (/positive clostridium enterotoxin|clostridium.*elisa.*positive|enterotoxin.*positive|clostridial.*toxin.*positive/i.test(raw)) {
        (diagnostic_tests.serology as Record<string, unknown> ?? (diagnostic_tests.serology = {}));
        (diagnostic_tests.serology as Record<string, unknown>).clostridium_enterotoxin_elisa = 'positive';
    }
    if (/negative parvovirus|parvo.*negative|parvovirus.*negative/i.test(raw)) {
        (diagnostic_tests.serology as Record<string, unknown> ?? (diagnostic_tests.serology = {}));
        (diagnostic_tests.serology as Record<string, unknown>).parvovirus_antigen = 'negative';
    }
    if (/negative giardia|giardia.*negative/i.test(raw)) {
        (diagnostic_tests.serology as Record<string, unknown> ?? (diagnostic_tests.serology = {}));
        (diagnostic_tests.serology as Record<string, unknown>).giardia_antigen = 'negative';
    }

    // Cytology: fecal gram-positive rods
    const cytology: Record<string, unknown> = {};
    if (/gram.positive rods|gram+.*rods|gram positive rods.*fecal|fecal.*gram.positive/i.test(raw)) {
        cytology.fecal_gram_positive_rods = 'present';
    }
    if (Object.keys(cytology).length > 0) diagnostic_tests.cytology = cytology;

    // Presenting signs: large-bowel specific
    const giSignals: string[] = [];
    if (/hematochezia|fresh.*blood.*stool|blood.*stool.*fresh|bright.*red.*blood.*stool/i.test(raw)) giSignals.push('hematochezia');
    if (/tenesmus|straining.*defecate|straining.*stool/i.test(raw)) giSignals.push('tenesmus');
    if (/mucus.*stool|mucus.*feces|stool.*mucus|mucoid.*stool/i.test(raw)) giSignals.push('mucus_in_stool');
    if (/bloody diarrhea|hemorrhagic diarrhea|blood.*diarrhea/i.test(raw)) giSignals.push('bloody_diarrhea');
    if (/hematochezia|fresh blood/i.test(raw) && /mucus/i.test(raw)) giSignals.push('colitis');

    // Dietary history
    if (/spoiled meat|garbage|contaminated food|dietary indiscretion|ate.*spoiled|spoiled.*food/i.test(raw)) {
        (metadata.history as Record<string, unknown>).dietary_history = 'spoiled_meat_ingestion';
        giSignals.push('spoiled_meat_ingestion');
    }

    // CBC: hemoconcentration
    if (/packed cell volume.*[6-9][0-9]|pcv.*[6-9][0-9]|hemoconcentration|hemoconcentrated/i.test(raw)) {
        const cbc2 = (diagnostic_tests.cbc as Record<string, unknown>) ?? {};
        cbc2.packed_cell_volume = 'hemoconcentration';
        diagnostic_tests.cbc = cbc2;
    }
    // ────────────────────────────────────────────────────────────────────────

    const cbc: Record<string, unknown> = {};
    if (/severe thrombocytopenia/i.test(raw)) cbc.thrombocytopenia = 'severe';
    else if (/thrombocytopenia/i.test(raw)) cbc.thrombocytopenia = 'mild';
    if (/regenerative an(a)?emia/i.test(raw)) cbc.anemia_type = 'regenerative';
    if (/non[- ]regenerative an(a)?emia/i.test(raw)) cbc.anemia_type = 'non_regenerative';
    if (/severe eosinophilia/i.test(raw)) cbc.eosinophilia = 'severe';
    else if (/moderate eosinophilia/i.test(raw)) cbc.eosinophilia = 'moderate';
    else if (/mild eosinophilia|eosinophilia/i.test(raw)) cbc.eosinophilia = 'mild';
    if (/basophilia/i.test(raw)) cbc.basophilia = 'present';
    if (/lymphopenia/i.test(raw)) cbc.lymphopenia = 'present';
    if (/microfilaremia/i.test(raw)) cbc.microfilaremia = 'present';
    if (/babesia/i.test(raw)) cbc.hemoparasites_seen = ['Babesia'];
    if (Object.keys(cbc).length > 0) diagnostic_tests.cbc = cbc;

    const thoracic_radiograph: Record<string, unknown> = {};
    if (/enlarged pulmonary arteries|pulmonary artery enlargement/i.test(raw)) {
        thoracic_radiograph.pulmonary_artery_enlargement = 'present';
        thoracic_radiograph.pulmonary_pattern = 'vascular';
    }
    if (/right heart enlargement|right[- ]sided cardiomegaly/i.test(raw)) {
        thoracic_radiograph.cardiomegaly = 'right_sided';
    }
    if (/left heart enlargement|left[- ]sided cardiomegaly/i.test(raw)) {
        thoracic_radiograph.cardiomegaly = 'left_sided';
    }
    if (/tracheal collapse seen|tracheal collapse on radiograph/i.test(raw)) {
        thoracic_radiograph.tracheal_collapse_seen = 'present';
    }
    if (Object.keys(thoracic_radiograph).length > 0) diagnostic_tests.thoracic_radiograph = thoracic_radiograph;

    const echocardiography: Record<string, unknown> = {};
    if (/worm visuali[sz]ation|worms visuali[sz]ed|pasta sign/i.test(raw)) {
        echocardiography.worms_visualised = 'present';
    }
    if (/right heart enlargement/i.test(raw)) {
        echocardiography.right_heart_enlargement = 'present';
    }
    if (/pulmonary hypertension/i.test(raw)) {
        echocardiography.pulmonary_hypertension = 'present';
    }
    if (Object.keys(echocardiography).length > 0) diagnostic_tests.echocardiography = echocardiography;

    const biochemistry: Record<string, unknown> = {};
    if (/mildly elevated alt|mildly elevated ast/i.test(raw)) biochemistry.alt_ast = 'mildly_elevated';
    if (/markedly elevated alt|markedly elevated ast/i.test(raw)) biochemistry.alt_ast = 'markedly_elevated';
    if (/hyperglyc(a)?emia/i.test(raw)) biochemistry.glucose = 'hyperglycemia';
    if (/azotemia/i.test(raw)) biochemistry.bun_creatinine = 'azotemia';
    if (Object.keys(biochemistry).length > 0) diagnostic_tests.biochemistry = biochemistry;

    const urinalysis: Record<string, unknown> = {};
    if (/glucosuria|glucose in urine/i.test(raw)) urinalysis.glucose_in_urine = 'present';
    if (/proteinuria/i.test(raw)) urinalysis.proteinuria = 'present';
    if (Object.keys(urinalysis).length > 0) diagnostic_tests.urinalysis = urinalysis;

    const parasitology: Record<string, unknown> = {};
    if (/knott test positive|positive microfilariae/i.test(raw)) parasitology.knott_test = 'positive_microfilariae';
    if (/buffy coat smear.*babesia|babesia seen on buffy coat smear/i.test(raw)) parasitology.buffy_coat_smear = ['Babesia'];
    if (Object.keys(parasitology).length > 0) diagnostic_tests.parasitology = parasitology;

    if (/pale mucous membranes|pale gums/i.test(raw)) physical_exam.mucous_membrane_color = 'pale';
    if (/cyanosis|cyanotic/i.test(raw)) physical_exam.mucous_membrane_color = 'cyanotic';

    metadata.history = history;
    metadata.preventive_history = preventive_history;
    metadata.diagnostic_tests = diagnostic_tests;
    metadata.physical_exam = physical_exam;

    return {
        species,
        breed,
        symptoms,
        presenting_signs: [
            ...symptoms.map((entry) => entry.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')),
            ...giSignals.filter((s) => !symptoms.map((e) => e.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).includes(s)),
        ],
        history,
        preventive_history,
        diagnostic_tests,
        physical_exam,
        region,
        weight_kg: typeof metadata.weight_kg === 'number' ? metadata.weight_kg as number : undefined,
        age_years: typeof metadata.age_months === 'number' ? Number((Number(metadata.age_months) / 12).toFixed(2)) : undefined,
        metadata,
    };
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
        presenting_signs: [],
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
        presenting_signs: input.presenting_signs,
        history: input.history,
        preventive_history: input.preventive_history,
        diagnostic_tests: input.diagnostic_tests,
        physical_exam: input.physical_exam,
        region: input.region,
        age_years: input.age_years,
        weight_kg: input.weight_kg,
        metadata,
    };
}
