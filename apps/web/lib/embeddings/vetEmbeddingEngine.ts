/**
 * VetIOS Veterinary Embedding Engine
 *
 * Generates domain-specialised embeddings for veterinary clinical cases.
 * Uses a two-stage approach:
 *   1. Base embedding via OpenAI text-embedding-3-large
 *   2. Veterinary domain re-weighting with species/breed/age/lab contextual
 *      modifiers to ensure "elevated ALT feline" ≠ "elevated ALT canine"
 *
 * The result is a 1536-dim float vector stored in pgvector for retrieval.
 */

import { getAiProviderApiKey, getAiProviderBaseUrl } from '@/lib/ai/config';

// ─── Types ───────────────────────────────────────────────────

export interface VetClinicalCase {
  species: string;
  breed?: string | null;
  age_years?: number | null;
  weight_kg?: number | null;
  symptoms: string[];
  biomarkers?: Record<string, number | string> | null;
  diagnosis?: string | null;
  region?: string | null;
  urgency?: string | null;
}

export interface EmbeddingResult {
  vector: number[];
  dimension: number;
  input_tokens: number;
  model: string;
  domain_weighted: boolean;
}

// ─── Constants ───────────────────────────────────────────────

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 1536;

// Species-specific clinical weight modifiers.
// These shift the semantic importance of biomarkers by species context,
// simulating what a fine-tuned vet embedding model would learn.
const SPECIES_BIOMARKER_WEIGHTS: Record<string, Record<string, number>> = {
  feline: {
    ALT: 2.1,
    BUN: 2.4,
    creatinine: 2.6,
    phosphorus: 2.2,
    potassium: 1.8,
    T4: 2.8,
    glucose: 1.5,
    PCV: 1.6,
  },
  canine: {
    ALT: 1.8,
    ALP: 2.2,
    bilirubin: 2.0,
    amylase: 1.9,
    lipase: 2.1,
    glucose: 1.7,
    BUN: 1.5,
    creatinine: 1.6,
  },
  equine: {
    GGT: 2.4,
    SDH: 2.1,
    bile_acids: 2.0,
    lactate: 2.5,
    fibrinogen: 1.9,
  },
  bovine: {
    BHB: 2.3,
    NEFA: 2.2,
    AST: 1.9,
    GGT: 1.8,
  },
};

// Age-context tokens appended to embedding text to differentiate
// paediatric, adult, and geriatric presentations semantically.
function resolveAgeContext(species: string, ageYears: number | null | undefined): string {
  if (ageYears === null || ageYears === undefined) return '';
  if (species === 'feline' || species === 'canine') {
    if (ageYears < 1) return 'paediatric neonatal juvenile';
    if (ageYears < 7) return 'adult prime reproductive';
    if (ageYears < 10) return 'mature senior early-geriatric';
    return 'geriatric late-stage senile';
  }
  if (ageYears < 2) return 'juvenile young';
  if (ageYears > 15) return 'geriatric aged';
  return 'adult mature';
}

// ─── Text Serialiser ─────────────────────────────────────────

/**
 * Converts a clinical case to a structured text optimised for embedding.
 * Deliberately includes redundant clinical descriptors so the embedding
 * model captures the full semantic weight of each field.
 */
export function serialiseClinicalCase(c: VetClinicalCase): string {
  const parts: string[] = [];

  // Species + breed block
  parts.push(`Species: ${c.species}`);
  if (c.breed) parts.push(`Breed: ${c.breed}`);

  // Age context
  const ageCtx = resolveAgeContext(c.species, c.age_years);
  if (c.age_years !== null && c.age_years !== undefined) {
    parts.push(`Age: ${c.age_years} years ${ageCtx}`);
  }

  // Weight
  if (c.weight_kg !== null && c.weight_kg !== undefined) {
    const bcs = c.weight_kg < 3 ? 'underweight' : c.weight_kg > 40 ? 'overweight' : 'normal';
    parts.push(`Weight: ${c.weight_kg}kg body_condition:${bcs}`);
  }

  // Region / urgency
  if (c.region) parts.push(`Region: ${c.region}`);
  if (c.urgency) parts.push(`Urgency: ${c.urgency}`);

  // Symptoms — repeated with clinical synonyms for better coverage
  if (c.symptoms.length > 0) {
    parts.push(`Presenting signs: ${c.symptoms.join(', ')}`);
    parts.push(`Clinical presentation: ${c.symptoms.join(' ')}`);
  }

  // Biomarkers with species-weighted labels
  if (c.biomarkers) {
    const weights = SPECIES_BIOMARKER_WEIGHTS[c.species] ?? {};
    const markerParts: string[] = [];
    for (const [key, val] of Object.entries(c.biomarkers)) {
      const w = weights[key] ?? 1.0;
      // Repeat high-weight biomarkers to increase semantic influence
      const repetitions = Math.round(w);
      for (let i = 0; i < repetitions; i++) {
        markerParts.push(`${key}:${val}`);
      }
    }
    parts.push(`Laboratory findings: ${markerParts.join(' ')}`);
  }

  // Diagnosis (when present — for training/retrieval cases)
  if (c.diagnosis) {
    parts.push(`Confirmed diagnosis: ${c.diagnosis}`);
    parts.push(`Diagnosis: ${c.diagnosis}`);
  }

  return parts.join('. ');
}

// ─── Embedding Client ────────────────────────────────────────

async function callEmbeddingApi(text: string): Promise<{ embedding: number[]; tokens: number }> {
  const apiKey = getAiProviderApiKey();
  const baseUrl = getAiProviderBaseUrl();

  const url = `${baseUrl}/embeddings`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding API error ${resp.status}: ${err}`);
  }

  const data = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { total_tokens: number };
  };

  return {
    embedding: data.data[0].embedding,
    tokens: data.usage.total_tokens,
  };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Generate a veterinary-domain-specialised embedding for a clinical case.
 * This is the primary entry point for all vector retrieval operations.
 */
export async function embedClinicalCase(c: VetClinicalCase): Promise<EmbeddingResult> {
  const text = serialiseClinicalCase(c);
  const { embedding, tokens } = await callEmbeddingApi(text);

  return {
    vector: embedding,
    dimension: embedding.length,
    input_tokens: tokens,
    model: EMBEDDING_MODEL,
    domain_weighted: true,
  };
}

/**
 * Generate an embedding for a free-text veterinary query.
 * Used by Ask VetIOS to retrieve similar historical cases.
 */
export async function embedQuery(query: string, contextHints?: Partial<VetClinicalCase>): Promise<EmbeddingResult> {
  let enrichedQuery = query;

  if (contextHints) {
    const parts: string[] = [query];
    if (contextHints.species) parts.push(`species:${contextHints.species}`);
    if (contextHints.breed) parts.push(`breed:${contextHints.breed}`);
    if (contextHints.age_years) {
      parts.push(resolveAgeContext(contextHints.species ?? '', contextHints.age_years));
    }
    enrichedQuery = parts.join(' ');
  }

  const { embedding, tokens } = await callEmbeddingApi(enrichedQuery);

  return {
    vector: embedding,
    dimension: embedding.length,
    input_tokens: tokens,
    model: EMBEDDING_MODEL,
    domain_weighted: !!contextHints,
  };
}

/**
 * Batch embed multiple clinical cases efficiently.
 * Rate-limited to avoid overwhelming the embedding API.
 */
export async function batchEmbedCases(
  cases: VetClinicalCase[],
  onProgress?: (completed: number, total: number) => void
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];
  const BATCH_DELAY_MS = 100;

  for (let i = 0; i < cases.length; i++) {
    results.push(await embedClinicalCase(cases[i]));
    onProgress?.(i + 1, cases.length);
    if (i < cases.length - 1) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return results;
}
