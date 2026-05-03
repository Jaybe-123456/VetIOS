/**
 * VetIOS Causal Clinical Memory — Counterfactual Simulator
 *
 * Answers: "What would have happened with treatment B instead of treatment A?"
 * Connects to: causal_observations, causal_dag_edges, counterfactual_records
 */

import { getSupabaseServer } from '@/lib/supabaseServer';

export interface CounterfactualQuery {
  tenantId: string;
  inferenceEventId: string | null;
  species: string;
  breed: string | null;
  ageYears: number | null;
  confirmedDiagnosis: string;
  treatmentActual: string;
  treatmentCounterfactual: string;
  symptomVector: string[];
  biomarkers: Record<string, number | string> | null;
}

export interface CounterfactualResult {
  treatmentActual: string;
  treatmentCounterfactual: string;
  estimatedOutcome: string;
  estimatedRecoveryDays: number | null;
  confidence: number;
  supportingCaseCount: number;
  causalPath: Array<{ node: string; effect: number }>;
  clinicalSummary: string;
  isReliable: boolean;
}

const OUTCOME_RANK: Record<string, number> = {
  recovered: 4, improved: 3, stable: 2, deteriorated: 1, died: 0,
};

export class CounterfactualSimulator {
  private supabase = getSupabaseServer();

  async simulate(query: CounterfactualQuery): Promise<CounterfactualResult> {
    const { data: similarCases } = await this.supabase
      .from('causal_observations')
      .select('outcome_status, recovery_time_days')
      .eq('confirmed_diagnosis', query.confirmedDiagnosis)
      .eq('species', query.species)
      .eq('treatment_applied', query.treatmentCounterfactual)
      .limit(100);

    const { data: cfEdges } = await this.supabase
      .from('causal_dag_edges')
      .select('to_node_key, ate, confidence')
      .eq('from_node_key', `treatment:${query.treatmentCounterfactual}`)
      .like('to_node_key', 'outcome:%')
      .order('ate', { ascending: false })
      .limit(5);

    const { data: actualEdges } = await this.supabase
      .from('causal_dag_edges')
      .select('to_node_key, ate')
      .eq('from_node_key', `treatment:${query.treatmentActual}`)
      .like('to_node_key', 'outcome:%')
      .order('ate', { ascending: false })
      .limit(1);

    const cases = similarCases ?? [];
    const edges = cfEdges ?? [];

    const votes: Record<string, number> = {};
    for (const c of cases) {
      const s = (c as Record<string, unknown>).outcome_status as string;
      votes[s] = (votes[s] ?? 0) + 1;
    }
    for (const e of edges) {
      const outcome = String((e as Record<string, unknown>).to_node_key).split(':')[1];
      const w = Math.max(Number((e as Record<string, unknown>).ate ?? 0), 0) * 3;
      votes[outcome] = (votes[outcome] ?? 0) + w;
    }
    const estimatedOutcome = Object.keys(votes).length > 0
      ? Object.entries(votes).sort(([, a], [, b]) => b - a)[0][0]
      : 'stable';

    const days = cases
      .map((c: Record<string, unknown>) => c.recovery_time_days)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    const estimatedRecoveryDays = days.length > 0
      ? Math.round(days.reduce((a, b) => a + b, 0) / days.length)
      : null;

    const confidence = Math.min(
      (cases.length / 20) * 0.7 +
      (edges.length > 0 ? Number((edges[0] as Record<string, unknown>).confidence ?? 0) * 0.3 : 0),
      1.0
    );

    const causalPath = edges.slice(0, 3).map((e: Record<string, unknown>) => ({
      node: String(e.to_node_key),
      effect: Number(e.ate ?? 0),
    }));

    const actualOutcome = actualEdges && actualEdges.length > 0
      ? String((actualEdges[0] as Record<string, unknown>).to_node_key).split(':')[1]
      : null;

    const rankCf = OUTCOME_RANK[estimatedOutcome] ?? 2;
    const rankActual = actualOutcome ? (OUTCOME_RANK[actualOutcome] ?? 2) : 2;
    const comparison = rankCf > rankActual + 0.5 ? 'better'
      : rankCf < rankActual - 0.5 ? 'worse' : 'similar';

    const reliabilityNote = cases.length >= 10
      ? `Based on ${cases.length} confirmed cases.`
      : cases.length >= 5
      ? `Based on ${cases.length} cases (moderate confidence).`
      : `Based on ${cases.length} case(s) — limited evidence.`;

    const comparisonNote = comparison === 'better'
      ? `${query.treatmentCounterfactual} is estimated to produce a better outcome (${estimatedOutcome}) than ${query.treatmentActual}${actualOutcome ? ` (${actualOutcome})` : ''}.`
      : comparison === 'worse'
      ? `${query.treatmentCounterfactual} is estimated to produce a worse outcome (${estimatedOutcome}) than ${query.treatmentActual}${actualOutcome ? ` (${actualOutcome})` : ''}.`
      : `${query.treatmentCounterfactual} is estimated to produce a similar outcome (${estimatedOutcome}) to ${query.treatmentActual}.`;

    const result: CounterfactualResult = {
      treatmentActual: query.treatmentActual,
      treatmentCounterfactual: query.treatmentCounterfactual,
      estimatedOutcome,
      estimatedRecoveryDays,
      confidence,
      supportingCaseCount: cases.length,
      causalPath,
      clinicalSummary: `${comparisonNote} ${reliabilityNote} Confidence: ${(confidence * 100).toFixed(0)}%.`,
      isReliable: cases.length >= 5,
    };

    // Persist non-blocking
    void (async () => { try { await this.supabase.from('counterfactual_records').insert({
      tenant_id: query.tenantId,
      inference_event_id: query.inferenceEventId,
      species: query.species,
      breed: query.breed,
      age_years: query.ageYears,
      confirmed_diagnosis: query.confirmedDiagnosis,
      treatment_actual: result.treatmentActual,
      treatment_counterfactual: result.treatmentCounterfactual,
      estimated_outcome: result.estimatedOutcome,
      estimated_recovery_days: result.estimatedRecoveryDays,
      confidence: result.confidence,
      supporting_case_count: result.supportingCaseCount,
      causal_path: result.causalPath,
      computed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }); } catch { /* non-fatal */ } })();

    return result;
  }
}

let _sim: CounterfactualSimulator | null = null;
export function getCounterfactualSimulator(): CounterfactualSimulator {
  if (!_sim) _sim = new CounterfactualSimulator();
  return _sim;
}
