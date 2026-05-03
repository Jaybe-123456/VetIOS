/**
 * VetIOS Causal Clinical Memory — Causal Engine
 *
 * Builds and queries a causal DAG from confirmed clinical outcomes.
 * Connects to: causal_observations, causal_dag_nodes, causal_dag_edges,
 *              treatment_events, treatment_outcomes
 */

import { getSupabaseServer } from '@/lib/supabaseServer';

export type CausalNodeType =
  | 'diagnosis' | 'treatment' | 'outcome'
  | 'species' | 'breed' | 'biomarker' | 'symptom';

export type OutcomeStatus =
  | 'recovered' | 'improved' | 'stable' | 'deteriorated' | 'died';

export interface CausalObservationInput {
  tenantId: string;
  inferenceEventId: string | null;
  treatmentEventId: string | null;
  rlhfFeedbackId: string | null;
  species: string;
  breed: string | null;
  ageYears: number | null;
  weightKg: number | null;
  treatmentApplied: string;
  clinicianOverride: boolean;
  predictedDiagnosis: string | null;
  confirmedDiagnosis: string;
  outcomeStatus: OutcomeStatus;
  recoveryTimeDays: number | null;
  hadComplications: boolean;
  outcomeHorizon: '48h' | '7d' | '30d';
  observedAt: string;
  symptomVector: string[];
  biomarkerSnapshot: Record<string, number | string> | null;
}

export interface CausalInsight {
  statement: string;
  fromNodeKey: string;
  toNodeKey: string;
  ate: number;
  supportCount: number;
  confidence: number;
  speciesRelevant: boolean;
}

export interface CausalContext {
  insights: CausalInsight[];
  dominantCausalPath: string[];
  deteriorationRiskFactors: string[];
  recoveryFactors: string[];
  observationCount: number;
  computedAt: string;
}

const OUTCOME_SCORES: Record<OutcomeStatus, number> = {
  recovered: 1.0, improved: 0.6, stable: 0.2, deteriorated: -0.5, died: -1.0,
};

function scoreOutcome(status: string): number {
  return OUTCOME_SCORES[status as OutcomeStatus] ?? 0.0;
}

export class CausalEngine {
  private supabase = getSupabaseServer();

  async recordObservation(input: CausalObservationInput): Promise<void> {
    await this.ensureNode(`diagnosis:${input.confirmedDiagnosis}`, 'diagnosis', input.confirmedDiagnosis);
    await this.ensureNode(`treatment:${input.treatmentApplied}`, 'treatment', input.treatmentApplied);
    await this.ensureNode(`outcome:${input.outcomeStatus}`, 'outcome', input.outcomeStatus);
    await this.ensureNode(`species:${input.species}`, 'species', input.species);
    if (input.breed) await this.ensureNode(`breed:${input.breed}`, 'breed', input.breed);

    const { error } = await this.supabase.from('causal_observations').insert({
      tenant_id: input.tenantId,
      inference_event_id: input.inferenceEventId,
      treatment_event_id: input.treatmentEventId,
      rlhf_feedback_id: input.rlhfFeedbackId,
      species: input.species,
      breed: input.breed,
      age_years: input.ageYears,
      weight_kg: input.weightKg,
      treatment_applied: input.treatmentApplied,
      clinician_override: input.clinicianOverride,
      predicted_diagnosis: input.predictedDiagnosis,
      confirmed_diagnosis: input.confirmedDiagnosis,
      outcome_status: input.outcomeStatus,
      recovery_time_days: input.recoveryTimeDays,
      had_complications: input.hadComplications,
      outcome_horizon: input.outcomeHorizon,
      observed_at: input.observedAt,
      symptom_vector: input.symptomVector,
      biomarker_snapshot: input.biomarkerSnapshot,
      created_at: new Date().toISOString(),
    });

    if (error) { console.error('[CausalEngine] recordObservation failed:', error.message); return; }

    await this.recomputeEdge(`treatment:${input.treatmentApplied}`, `outcome:${input.outcomeStatus}`, input.species);
    await this.recomputeEdge(`diagnosis:${input.confirmedDiagnosis}`, `treatment:${input.treatmentApplied}`, input.species);
  }

  async getCausalContext(
    diagnosis: string,
    species: string,
    treatmentApplied?: string
  ): Promise<CausalContext> {
    const diagnosisKey = `diagnosis:${diagnosis}`;

    const { data: edges } = await this.supabase
      .from('causal_dag_edges')
      .select('*')
      .or(`from_node_key.eq.${diagnosisKey},to_node_key.eq.${diagnosisKey}`)
      .gte('support_count', 3)
      .order('confidence', { ascending: false })
      .limit(20);

    const { count } = await this.supabase
      .from('causal_observations')
      .select('id', { count: 'exact', head: true })
      .eq('confirmed_diagnosis', diagnosis)
      .eq('species', species);

    const insights: CausalInsight[] = (edges ?? []).map((e: Record<string, unknown>) => ({
      statement: this.buildInsightStatement(e, species),
      fromNodeKey: String(e.from_node_key),
      toNodeKey: String(e.to_node_key),
      ate: Number(e.ate ?? 0),
      supportCount: Number(e.support_count ?? 0),
      confidence: Number(e.confidence ?? 0),
      speciesRelevant: !e.species_scope || (e.species_scope as string[]).includes(species),
    })).filter((i: CausalInsight) => i.speciesRelevant);

    const recoveryFactors = insights
      .filter(i => i.ate > 0.2 && i.toNodeKey.startsWith('outcome:'))
      .map(i => i.fromNodeKey.split(':')[1]);

    const deteriorationRiskFactors = insights
      .filter(i => i.ate < -0.2 && i.toNodeKey.startsWith('outcome:'))
      .map(i => i.fromNodeKey.split(':')[1]);

    const dominantPath = [diagnosisKey];
    if (treatmentApplied) dominantPath.push(`treatment:${treatmentApplied}`);
    const topOutcome = insights.find(i => i.fromNodeKey.startsWith('treatment:') && i.toNodeKey.startsWith('outcome:'));
    if (topOutcome) dominantPath.push(topOutcome.toNodeKey);

    return {
      insights: insights.slice(0, 5),
      dominantCausalPath: dominantPath,
      deteriorationRiskFactors,
      recoveryFactors,
      observationCount: count ?? 0,
      computedAt: new Date().toISOString(),
    };
  }

  private async ensureNode(nodeKey: string, nodeType: CausalNodeType, label: string): Promise<void> {
    try {
      await this.supabase.from('causal_dag_nodes').upsert(
        { node_key: nodeKey, node_type: nodeType, label, observation_count: 1, updated_at: new Date().toISOString() },
        { onConflict: 'node_key', ignoreDuplicates: false }
      );
    } catch { /* non-fatal */ }
  }

  private async recomputeEdge(fromKey: string, toKey: string, species: string): Promise<void> {
    const fromType = fromKey.split(':')[0];
    const fromValue = fromKey.slice(fromType.length + 1);
    const col = fromType === 'treatment' ? 'treatment_applied' : 'confirmed_diagnosis';

    const { data: withFrom } = await this.supabase
      .from('causal_observations').select('outcome_status')
      .eq(col, fromValue).eq('species', species).limit(500);

    const { data: withoutFrom } = await this.supabase
      .from('causal_observations').select('outcome_status')
      .neq(col, fromValue).eq('species', species).limit(500);

    const treated = (withFrom ?? []).map((r: Record<string, unknown>) => scoreOutcome(String(r.outcome_status)));
    const control = (withoutFrom ?? []).map((r: Record<string, unknown>) => scoreOutcome(String(r.outcome_status)));

    if (treated.length < 2 || control.length < 2) return;

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = (arr: number[]) => {
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
    };

    const ate = mean(treated) - mean(control);
    const seDiff = Math.sqrt((std(treated) / Math.sqrt(treated.length)) ** 2 + (std(control) / Math.sqrt(control.length)) ** 2);
    const support = treated.length + control.length;
    const confidence = Math.min((support / 50) * (1 - Math.min(3.92 * seDiff, 2) / 2), 1.0);

    try {
      await this.supabase.from('causal_dag_edges').upsert(
        {
          from_node_key: fromKey, to_node_key: toKey, edge_type: 'causes',
          ate, ate_upper: ate + 1.96 * seDiff, ate_lower: ate - 1.96 * seDiff,
          support_count: support, confidence, species_scope: [species],
          last_computed: new Date().toISOString(), created_at: new Date().toISOString(),
        },
        { onConflict: 'from_node_key,to_node_key,edge_type', ignoreDuplicates: false }
      );
    } catch { /* non-fatal */ }
  }

  private buildInsightStatement(edge: Record<string, unknown>, species: string): string {
    const from = String(edge.from_node_key).split(':')[1];
    const to = String(edge.to_node_key).split(':')[1];
    const ate = Number(edge.ate ?? 0);
    const n = Number(edge.support_count ?? 0);
    const dir = ate > 0 ? 'improves' : 'worsens';
    const mag = Math.abs(ate) > 0.5 ? 'strongly' : Math.abs(ate) > 0.2 ? 'moderately' : 'weakly';
    return `${from} ${mag} ${dir} outcome toward ${to} in ${species} (n=${n}, ATE=${ate.toFixed(2)})`;
  }
}

let _engine: CausalEngine | null = null;
export function getCausalEngine(): CausalEngine {
  if (!_engine) _engine = new CausalEngine();
  return _engine;
}
