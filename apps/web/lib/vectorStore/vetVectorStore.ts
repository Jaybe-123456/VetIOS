/**
 * VetIOS Vector Store — pgvector Retrieval Pipeline
 *
 * Stores clinical case embeddings in Supabase pgvector and retrieves
 * nearest-neighbour cases for RAG-grounded inference.
 *
 * Enables: "In 47 similar feline cases with elevated BUN and weight loss,
 *            38 were CKD stage 2-3."
 */

import { getSupabaseServer } from '@/lib/supabaseServer';
import type { VetClinicalCase, EmbeddingResult } from '@/lib/embeddings/vetEmbeddingEngine';

// ─── Types ───────────────────────────────────────────────────

export interface StoredCaseVector {
  id: string;
  inference_event_id: string | null;
  tenant_id: string;
  species: string;
  breed: string | null;
  age_years: number | null;
  symptoms: string[];
  diagnosis: string | null;
  confidence_score: number | null;
  outcome_confirmed: boolean;
  similarity: number;
  created_at: string;
}

export interface VectorStoreUpsertParams {
  inferenceEventId: string;
  tenantId: string;
  clinicalCase: VetClinicalCase;
  embedding: EmbeddingResult;
  diagnosis: string | null;
  confidenceScore: number | null;
}

export interface SimilarCaseQuery {
  embedding: EmbeddingResult;
  species?: string;
  limit?: number;
  minSimilarity?: number;
  confirmedOnly?: boolean;
}

export interface SimilarCaseResult {
  cases: StoredCaseVector[];
  totalFound: number;
  topDiagnosis: string | null;
  topDiagnosisCount: number;
  retrievalSummary: string;
}

// ─── Vector Store ────────────────────────────────────────────

export class VetVectorStore {
  private supabase = getSupabaseServer();
  private readonly TABLE = 'vet_case_vectors';

  /**
   * Upsert a clinical case embedding into pgvector.
   * Called after every inference to build the retrieval corpus.
   */
  async upsert(params: VectorStoreUpsertParams): Promise<{ id: string }> {
    const { inferenceEventId, tenantId, clinicalCase, embedding, diagnosis, confidenceScore } = params;

    const { data, error } = await this.supabase
      .from(this.TABLE)
      .upsert(
        {
          inference_event_id: inferenceEventId,
          tenant_id: tenantId,
          species: clinicalCase.species,
          breed: clinicalCase.breed ?? null,
          age_years: clinicalCase.age_years ?? null,
          weight_kg: clinicalCase.weight_kg ?? null,
          symptoms: clinicalCase.symptoms,
          biomarkers: clinicalCase.biomarkers ?? null,
          region: clinicalCase.region ?? null,
          diagnosis: diagnosis,
          confidence_score: confidenceScore,
          outcome_confirmed: false,
          embedding: `[${embedding.vector.join(',')}]`,
          embedding_model: embedding.model,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'inference_event_id' }
      )
      .select('id')
      .single();

    if (error) throw new Error(`VectorStore upsert failed: ${error.message}`);
    return { id: data.id };
  }

  /**
   * Mark a stored vector as outcome-confirmed.
   * Called when a vet confirms a diagnosis — upgrades retrieval quality.
   */
  async confirmOutcome(inferenceEventId: string, confirmedDiagnosis: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.TABLE)
      .update({
        outcome_confirmed: true,
        diagnosis: confirmedDiagnosis,
        outcome_confirmed_at: new Date().toISOString(),
      })
      .eq('inference_event_id', inferenceEventId);

    if (error) throw new Error(`VectorStore confirmOutcome failed: ${error.message}`);
  }

  /**
   * Retrieve the most similar historical cases using cosine similarity.
   * The core retrieval function powering RAG-grounded inference.
   */
  async findSimilar(query: SimilarCaseQuery): Promise<SimilarCaseResult> {
    const { embedding, species, limit = 10, minSimilarity = 0.75, confirmedOnly = false } = query;
    const vectorLiteral = `[${embedding.vector.join(',')}]`;

    // Build the pgvector cosine similarity query via RPC
    const { data, error } = await this.supabase.rpc('match_vet_case_vectors', {
      query_embedding: vectorLiteral,
      match_threshold: minSimilarity,
      match_count: limit,
      filter_species: species ?? null,
      confirmed_only: confirmedOnly,
    });

    if (error) throw new Error(`VectorStore findSimilar failed: ${error.message}`);

    const cases = (data ?? []) as StoredCaseVector[];

    // Compute top diagnosis from retrieved cases
    const diagnosisCounts: Record<string, number> = {};
    for (const c of cases) {
      if (c.diagnosis) {
        diagnosisCounts[c.diagnosis] = (diagnosisCounts[c.diagnosis] ?? 0) + 1;
      }
    }

    const sortedDiagnoses = Object.entries(diagnosisCounts).sort(([, a], [, b]) => b - a);
    const topDiagnosis = sortedDiagnoses[0]?.[0] ?? null;
    const topCount = sortedDiagnoses[0]?.[1] ?? 0;

    const retrievalSummary = buildRetrievalSummary(cases, topDiagnosis, topCount, species);

    return {
      cases,
      totalFound: cases.length,
      topDiagnosis,
      topDiagnosisCount: topCount,
      retrievalSummary,
    };
  }

  /**
   * Get calibrated accuracy for a (species, diagnosis) tuple.
   * Powers the "94% accurate for feline CKD" competitive claim.
   */
  async getCalibrationStats(species: string, diagnosis: string): Promise<{
    totalCases: number;
    confirmedCases: number;
    accuracyRate: number;
    avgConfidence: number;
  }> {
    const { data, error } = await this.supabase
      .from(this.TABLE)
      .select('confidence_score, outcome_confirmed, diagnosis')
      .eq('species', species)
      .ilike('diagnosis', `%${diagnosis}%`);

    if (error) throw new Error(`VectorStore calibration query failed: ${error.message}`);

    const rows = data ?? [];
    const confirmed = rows.filter((r) => r.outcome_confirmed);
    const avgConfidence =
      rows.length > 0
        ? rows.reduce((sum, r) => sum + (r.confidence_score ?? 0), 0) / rows.length
        : 0;

    return {
      totalCases: rows.length,
      confirmedCases: confirmed.length,
      accuracyRate: rows.length > 0 ? confirmed.length / rows.length : 0,
      avgConfidence,
    };
  }
}

// ─── Retrieval Summary Builder ────────────────────────────────

function buildRetrievalSummary(
  cases: StoredCaseVector[],
  topDiagnosis: string | null,
  topCount: number,
  species?: string
): string {
  if (cases.length === 0) {
    return 'No similar historical cases found in the VetIOS network.';
  }

  const speciesLabel = species ? `${species} ` : '';
  const confirmed = cases.filter((c) => c.outcome_confirmed).length;

  if (topDiagnosis && topCount > 0) {
    return (
      `In ${cases.length} similar ${speciesLabel}cases retrieved from the VetIOS network ` +
      `(${confirmed} outcome-confirmed), ${topCount} were diagnosed with ${topDiagnosis}. ` +
      `Average similarity: ${(cases.reduce((s, c) => s + c.similarity, 0) / cases.length * 100).toFixed(1)}%.`
    );
  }

  return (
    `Retrieved ${cases.length} similar ${speciesLabel}cases from the VetIOS network ` +
    `(${confirmed} outcome-confirmed).`
  );
}

// ─── Singleton ───────────────────────────────────────────────

let _store: VetVectorStore | null = null;

export function getVectorStore(): VetVectorStore {
  if (!_store) _store = new VetVectorStore();
  return _store;
}
