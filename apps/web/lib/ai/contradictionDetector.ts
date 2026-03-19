/**
 * Contradiction Detector
 *
 * Analyzes clinical input for biologically impossible or logically
 * inconsistent data. Returns a contradiction score (0-1) and a list
 * of specific contradictions found.
 *
 * This is a safety-critical module: high contradiction scores should
 * trigger confidence penalties and uncertainty escalation.
 */

export interface ContradictionResult {
    /** 0 = no contradictions, 1 = maximally contradictory */
    contradiction_score: number;
    /** List of detected contradictions */
    contradiction_reasons: string[];
    /** Whether the input is biologically plausible */
    is_plausible: boolean;
    /** Recommended confidence cap (1.0 = no cap) */
    confidence_cap: number;
    /** Whether the model MUST abstain due to severe contradictions */
    abstain: boolean;
}

// ── Species weight ranges (kg) ──────────────────────────────────────────────

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

// ── Breed weight ranges (kg) ────────────────────────────────────────────────

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
};

// ── Contradictory symptom pairs ─────────────────────────────────────────────

const CONTRADICTORY_SYMPTOMS: [string, string][] = [
    ['fever', 'hypothermia'],
    ['hyperactive', 'lethargic'],
    ['polydipsia', 'dehydration'],
    ['anorexia', 'polyphagia'],
    ['bradycardia', 'tachycardia'],
    ['hypertension', 'hypotension'],
    ['polyuria', 'anuria'],
    ['diarrhea', 'constipation'],
    ['weight gain', 'weight loss'],
    ['hyperglycemia', 'hypoglycemia'],
];

// ── Age constraints ─────────────────────────────────────────────────────────

function parseAgeMonths(ageStr: string): number | null {
    const lower = ageStr.toLowerCase();
    const weekMatch = lower.match(/(\d+)\s*week/);
    if (weekMatch) return parseInt(weekMatch[1]) / 4;
    const monthMatch = lower.match(/(\d+)\s*month/);
    if (monthMatch) return parseInt(monthMatch[1]);
    const yearMatch = lower.match(/(\d+)\s*year/);
    if (yearMatch) return parseInt(yearMatch[1]) * 12;
    const dayMatch = lower.match(/(\d+)\s*day/);
    if (dayMatch) return parseInt(dayMatch[1]) / 30;
    return null;
}

// ── Main Detector ───────────────────────────────────────────────────────────

export function detectContradictions(input: Record<string, unknown>): ContradictionResult {
    const contradictions: string[] = [];

    const species = normalizeStr(input.species);
    const breed = normalizeStr(input.breed);
    const weight = typeof input.weight_kg === 'number' ? input.weight_kg
        : typeof input.weight === 'number' ? input.weight : null;
    const symptoms = extractSymptoms(input);
    const age = typeof input.age === 'string' ? input.age
        : typeof input.age_description === 'string' ? input.age_description : null;

    // 1. Weight vs species check
    if (weight != null && species) {
        const range = SPECIES_WEIGHT_RANGES[species];
        if (range) {
            if (weight < range.min * 0.5) {
                contradictions.push(`Weight ${weight}kg is dangerously below minimum for ${species} (expected ${range.min}-${range.max}kg)`);
            }
            if (weight > range.max * 1.5) {
                contradictions.push(`Weight ${weight}kg is impossibly above maximum for ${species} (expected ${range.min}-${range.max}kg)`);
            }
        }
    }

    // 2. Weight vs breed check
    if (weight != null && breed) {
        const range = BREED_WEIGHT_RANGES[breed];
        if (range) {
            if (weight > range.max * 3) {
                contradictions.push(`Weight ${weight}kg is biologically impossible for ${breed} (expected ${range.min}-${range.max}kg)`);
            }
            if (weight < range.min * 0.3) {
                contradictions.push(`Weight ${weight}kg is critically low for ${breed} (expected ${range.min}-${range.max}kg)`);
            }
        }
    }

    // 3. Age vs weight consistency
    if (age && weight != null && species) {
        const ageMonths = parseAgeMonths(age);
        if (ageMonths != null) {
            // Very young animal with adult weight
            if (ageMonths < 3 && species === 'dog' && weight > 20) {
                contradictions.push(`Age ${age} with weight ${weight}kg is biologically inconsistent — puppies under 3 months rarely exceed 10kg`);
            }
            if (ageMonths < 2 && species === 'cat' && weight > 3) {
                contradictions.push(`Age ${age} with weight ${weight}kg is biologically inconsistent for a kitten`);
            }
        }
    }

    // 4. Contradictory symptoms
    for (const [a, b] of CONTRADICTORY_SYMPTOMS) {
        const hasA = symptoms.some(s => s.includes(a));
        const hasB = symptoms.some(s => s.includes(b));
        if (hasA && hasB) {
            contradictions.push(`Contradictory symptoms: "${a}" and "${b}" cannot coexist`);
        }
    }

    // 5. Species contradiction (e.g. "chihuahua" breed but "cat" species)
    if (species && breed) {
        const catBreeds = ['persian', 'siamese', 'maine coon', 'domestic shorthair', 'ragdoll', 'bengal'];
        const dogBreeds = Object.keys(BREED_WEIGHT_RANGES).filter(b => !catBreeds.includes(b));
        if (species === 'cat' && dogBreeds.includes(breed)) {
            contradictions.push(`Breed "${breed}" is a dog breed but species is listed as cat`);
        }
        if (species === 'dog' && catBreeds.includes(breed)) {
            contradictions.push(`Breed "${breed}" is a cat breed but species is listed as dog`);
        }
    }

    // Compute score
    const score = Math.min(1, contradictions.length * 0.25);
    const isPlausible = contradictions.length === 0;

    // Confidence cap: severe contradictions → hard cap
    let confidenceCap = 1.0;
    if (contradictions.length >= 3) confidenceCap = 0.40;
    else if (contradictions.length >= 2) confidenceCap = 0.50;
    else if (contradictions.length >= 1) confidenceCap = 0.60;
    
    // Hard abstention rule
    const abstain = score >= 0.75 || contradictions.length >= 3;

    return {
        contradiction_score: score,
        contradiction_reasons: contradictions,
        is_plausible: isPlausible,
        confidence_cap: confidenceCap,
        abstain,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStr(val: unknown): string | null {
    if (typeof val !== 'string') return null;
    return val.toLowerCase().trim() || null;
}

function extractSymptoms(input: Record<string, unknown>): string[] {
    const syms: string[] = [];
    if (Array.isArray(input.symptoms)) {
        for (const s of input.symptoms) {
            if (typeof s === 'string') syms.push(s.toLowerCase());
        }
    }
    if (typeof input.edge_cases === 'string') {
        syms.push(input.edge_cases.toLowerCase());
    }
    if (typeof input.contradictions === 'string') {
        syms.push(input.contradictions.toLowerCase());
    }
    if (typeof input.chief_complaint === 'string') {
        syms.push(input.chief_complaint.toLowerCase());
    }
    return syms;
}
