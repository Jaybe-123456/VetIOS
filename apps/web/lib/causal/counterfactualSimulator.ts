import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  makeCausalNodeKey,
  normalizeOutcomeStatus,
  scoreOutcome,
} from '@/lib/causal/causalEngine';

export interface CounterfactualQuery {
  tenantId: string;
  inferenceEventId?: string | null;
  species: string;
  breed?: string | null;
  ageYears?: number | null;
  confirmedDiagnosis: string;
  treatmentActual: string;
  outcomeActual?: string | null;
  treatmentCounterfactual: string;
  symptomVector?: string[];
  biomarkers?: Record<string, number | string | null> | null;
}

export interface CounterfactualResult {
  treatmentActual: string;
  treatmentCounterfactual: string;
  estimatedOutcome: string;
  estimatedRecoveryDays: number | null;
  estimatedOutcomeScore: number | null;
  confidence: number;
  supportingCaseCount: number;
  causalPath: Array<{ node: string; effect: number | null; confidence: number }>;
  clinicalSummary: string;
  isReliable: boolean;
}

interface SimilarCaseRow {
  species: string;
  breed: string | null;
  age_years: number | null;
  symptom_vector: string[] | null;
  biomarker_snapshot: Record<string, unknown> | null;
  outcome_status: string;
  recovery_time_days: number | null;
}

interface WeightedOutcome {
  outcome: string;
  weight: number;
  score: number;
  recoveryDays: number | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export class CounterfactualSimulator {
  private supabase = getSupabaseServer();

  async simulate(query: CounterfactualQuery): Promise<CounterfactualResult> {
    const similarCases = await this.findSimilarCases(query);
    const edges = await this.loadTreatmentOutcomeEdges(query.treatmentCounterfactual);
    const weightedOutcomes = similarCases.map((row) => ({
      outcome: normalizeOutcomeStatus(row.outcome_status),
      weight: similarityWeight(query, row),
      score: scoreOutcome(row.outcome_status),
      recoveryDays: readNumber(row.recovery_time_days),
    }));

    const estimatedOutcome = estimateOutcome(weightedOutcomes, edges);
    const estimatedRecoveryDays = estimateRecoveryDays(weightedOutcomes);
    const estimatedOutcomeScore = estimateOutcomeScore(weightedOutcomes, edges);
    const edgeConfidence = edges.reduce((best, edge) => Math.max(best, readNumber(edge.confidence) ?? 0), 0);
    const confidence = clamp(
      Math.min(similarCases.length / 20, 0.7) + edgeConfidence * 0.3,
      0,
      1,
    );
    const causalPath = edges.slice(0, 4).map((edge) => ({
      node: String(edge.to_node_key ?? ''),
      effect: readNumber(edge.ate),
      confidence: readNumber(edge.confidence) ?? 0,
    }));

    const result: CounterfactualResult = {
      treatmentActual: query.treatmentActual,
      treatmentCounterfactual: query.treatmentCounterfactual,
      estimatedOutcome,
      estimatedRecoveryDays,
      estimatedOutcomeScore,
      confidence,
      supportingCaseCount: similarCases.length,
      causalPath,
      clinicalSummary: buildClinicalSummary({
        query,
        estimatedOutcome,
        estimatedRecoveryDays,
        caseCount: similarCases.length,
        confidence,
      }),
      isReliable: similarCases.length >= 5 && confidence >= 0.35,
    };

    await this.persistResult(query, result);
    return result;
  }

  private async findSimilarCases(query: CounterfactualQuery): Promise<SimilarCaseRow[]> {
    const baseSelect = 'species, breed, age_years, symptom_vector, biomarker_snapshot, outcome_status, recovery_time_days';
    const normalizedDiagnosis = query.confirmedDiagnosis.trim();
    const normalizedSpecies = query.species.trim();
    const normalizedTreatment = query.treatmentCounterfactual.trim();

    if (query.breed) {
      const { data } = await this.supabase
        .from('causal_observations')
        .select(baseSelect)
        .eq('confirmed_diagnosis', normalizedDiagnosis)
        .eq('species', normalizedSpecies)
        .eq('breed', query.breed)
        .eq('treatment_applied', normalizedTreatment)
        .order('created_at', { ascending: false })
        .limit(100);
      if ((data ?? []).length >= 5) return (data ?? []) as SimilarCaseRow[];
    }

    const { data } = await this.supabase
      .from('causal_observations')
      .select(baseSelect)
      .eq('confirmed_diagnosis', normalizedDiagnosis)
      .eq('species', normalizedSpecies)
      .eq('treatment_applied', normalizedTreatment)
      .order('created_at', { ascending: false })
      .limit(100);

    return (data ?? []) as SimilarCaseRow[];
  }

  private async loadTreatmentOutcomeEdges(treatment: string): Promise<Array<Record<string, unknown>>> {
    const { data } = await this.supabase
      .from('causal_dag_edges')
      .select('to_node_key, ate, confidence, support_count')
      .eq('from_node_key', makeCausalNodeKey('treatment', treatment))
      .like('to_node_key', 'outcome:%')
      .order('confidence', { ascending: false })
      .limit(8);

    return (data ?? []) as Array<Record<string, unknown>>;
  }

  private async persistResult(query: CounterfactualQuery, result: CounterfactualResult): Promise<void> {
    const { error } = await this.supabase.from('counterfactual_records').insert({
      tenant_id: query.tenantId,
      inference_event_id: asUuidOrNull(query.inferenceEventId),
      species: query.species,
      breed: query.breed ?? null,
      age_years: readNumber(query.ageYears),
      confirmed_diagnosis: query.confirmedDiagnosis,
      treatment_actual: result.treatmentActual,
      outcome_actual: query.outcomeActual ? normalizeOutcomeStatus(query.outcomeActual) : null,
      treatment_counterfactual: result.treatmentCounterfactual,
      estimated_outcome: result.estimatedOutcome,
      estimated_recovery_days: result.estimatedRecoveryDays,
      estimated_outcome_score: result.estimatedOutcomeScore,
      confidence: result.confidence,
      supporting_case_count: result.supportingCaseCount,
      causal_path: result.causalPath,
      adjustment_set: {
        species: query.species,
        breed: query.breed ?? null,
        age_years: query.ageYears ?? null,
        diagnosis: query.confirmedDiagnosis,
      },
      computed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Counterfactual persistence failed: ${error.message}`);
    }
  }
}

function estimateOutcome(
  outcomes: WeightedOutcome[],
  edges: Array<Record<string, unknown>>,
): string {
  const weights = new Map<string, number>();
  for (const outcome of outcomes) {
    weights.set(outcome.outcome, (weights.get(outcome.outcome) ?? 0) + outcome.weight);
  }

  for (const edge of edges) {
    const node = String(edge.to_node_key ?? '');
    const outcome = node.includes(':') ? node.split(':').slice(1).join(':') : node;
    const effect = Math.max(readNumber(edge.ate) ?? 0, 0);
    const confidence = readNumber(edge.confidence) ?? 0;
    weights.set(outcome, (weights.get(outcome) ?? 0) + effect * confidence * 3);
  }

  const winner = Array.from(weights.entries()).sort((left, right) => right[1] - left[1])[0];
  return winner?.[0] ?? 'unknown';
}

function estimateOutcomeScore(
  outcomes: WeightedOutcome[],
  edges: Array<Record<string, unknown>>,
): number | null {
  const outcomeWeight = outcomes.reduce((sum, row) => sum + row.weight, 0);
  const empirical = outcomeWeight > 0
    ? outcomes.reduce((sum, row) => sum + row.score * row.weight, 0) / outcomeWeight
    : null;

  const edgeEffects = edges
    .map((edge) => readNumber(edge.ate))
    .filter((value): value is number => value != null);
  const edgeMean = edgeEffects.length > 0
    ? edgeEffects.reduce((sum, value) => sum + value, 0) / edgeEffects.length
    : null;

  if (empirical == null) return edgeMean;
  if (edgeMean == null) return empirical;
  return clamp(empirical * 0.75 + edgeMean * 0.25, -1, 1);
}

function estimateRecoveryDays(outcomes: WeightedOutcome[]): number | null {
  const withDays = outcomes.filter((row) => row.recoveryDays != null && row.recoveryDays >= 0);
  const totalWeight = withDays.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return null;
  return Math.round(
    withDays.reduce((sum, row) => sum + (row.recoveryDays ?? 0) * row.weight, 0) / totalWeight,
  );
}

function similarityWeight(query: CounterfactualQuery, row: SimilarCaseRow): number {
  let weight = 1;
  if (query.breed && row.breed && query.breed.toLowerCase() === row.breed.toLowerCase()) weight += 0.4;
  if (query.ageYears != null && row.age_years != null) {
    const ageDelta = Math.abs(query.ageYears - row.age_years);
    weight += Math.max(0, 0.3 - ageDelta * 0.03);
  }

  const querySymptoms = new Set((query.symptomVector ?? []).map((entry) => entry.toLowerCase()));
  const rowSymptoms = new Set((row.symptom_vector ?? []).map((entry) => entry.toLowerCase()));
  if (querySymptoms.size > 0 && rowSymptoms.size > 0) {
    const overlap = Array.from(querySymptoms).filter((entry) => rowSymptoms.has(entry)).length;
    const union = new Set([...Array.from(querySymptoms), ...Array.from(rowSymptoms)]).size;
    weight += union > 0 ? overlap / union : 0;
  }
  return weight;
}

function buildClinicalSummary(input: {
  query: CounterfactualQuery;
  estimatedOutcome: string;
  estimatedRecoveryDays: number | null;
  caseCount: number;
  confidence: number;
}): string {
  const actualScore = input.query.outcomeActual ? scoreOutcome(input.query.outcomeActual) : null;
  const estimatedScore = scoreOutcome(input.estimatedOutcome);
  const comparison = actualScore == null
    ? 'with no recorded actual outcome comparator yet'
    : estimatedScore > actualScore + 0.15
      ? 'as a better outcome than the recorded treatment'
      : estimatedScore < actualScore - 0.15
        ? 'as a worse outcome than the recorded treatment'
        : 'as a similar outcome to the recorded treatment';
  const days = input.estimatedRecoveryDays == null
    ? ''
    : ` Estimated recovery time: ${input.estimatedRecoveryDays} day(s).`;
  return `${input.query.treatmentCounterfactual} is estimated ${comparison}: ${input.estimatedOutcome}.${days} Evidence: ${input.caseCount} similar case(s), ${Math.round(input.confidence * 100)}% confidence.`;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asUuidOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

let simulator: CounterfactualSimulator | null = null;

export function getCounterfactualSimulator(): CounterfactualSimulator {
  if (!simulator) simulator = new CounterfactualSimulator();
  return simulator;
}
