/**
 * VetIOS Causal Clinical Memory — Living Case Memory
 *
 * Every patient remains a persistent live node. Cases never close.
 * Connects to: living_case_nodes, causal_dag_edges, causal_observations
 */

import { getSupabaseServer } from '@/lib/supabaseServer';

export interface LivingNodeUpdate {
  tenantId: string;
  patientId: string;
  species: string;
  breed: string | null;
  activeDiagnoses: string[];
  lastSymptoms: string[];
  lastBiomarkers: Record<string, number | string> | null;
  lastTreatment: string | null;
  lastOutcome: string | null;
}

export interface SimilarPatientMatch {
  patientId: string;
  species: string;
  breed: string | null;
  sharedDiagnoses: string[];
  lastOutcome: string | null;
  lastTreatment: string | null;
  deteriorationRisk: number | null;
  causalDifferentiator: string | null;
}

export interface LivingCaseInsight {
  patientId: string;
  deteriorationRisk: number;
  causalRiskFactors: string[];
  similarPatients: SimilarPatientMatch[];
  narrativeSummary: string;
}

export class LivingCaseMemory {
  private supabase = getSupabaseServer();

  async upsertNode(update: LivingNodeUpdate): Promise<void> {
    const deteriorationRisk = await this.computeDeteriorationRisk(update.species, update.activeDiagnoses);
    const causalRiskFactors = await this.getCausalRiskFactors(update.species, update.activeDiagnoses);

    try {
      await this.supabase.from('living_case_nodes').upsert(
        {
          tenant_id: update.tenantId,
          patient_id: update.patientId,
          species: update.species,
          breed: update.breed,
          active_diagnoses: update.activeDiagnoses,
          last_symptoms: update.lastSymptoms,
          last_biomarkers: update.lastBiomarkers,
          last_treatment: update.lastTreatment,
          last_outcome: update.lastOutcome,
          deterioration_risk: deteriorationRisk,
          causal_risk_factors: causalRiskFactors,
          last_updated_at: new Date().toISOString(),
          first_seen_at: new Date().toISOString(),
          inference_count: 1,
        },
        { onConflict: 'tenant_id,patient_id', ignoreDuplicates: false }
      );
    } catch { /* non-fatal */ }
  }

  async getInsight(
    tenantId: string,
    patientId: string,
    species: string,
    activeDiagnoses: string[]
  ): Promise<LivingCaseInsight> {
    const deteriorationRisk = await this.computeDeteriorationRisk(species, activeDiagnoses);
    const causalRiskFactors = await this.getCausalRiskFactors(species, activeDiagnoses);
    const similarPatients = await this.findSimilarPatients(tenantId, patientId, species, activeDiagnoses);
    const narrativeSummary = this.buildNarrative(activeDiagnoses, similarPatients, deteriorationRisk);

    return { patientId, deteriorationRisk, causalRiskFactors, similarPatients, narrativeSummary };
  }

  private async computeDeteriorationRisk(species: string, diagnoses: string[]): Promise<number> {
    if (diagnoses.length === 0) return 0.1;
    const diagnosisKeys = diagnoses.map(d => `diagnosis:${d}`);
    const { data: edges } = await this.supabase
      .from('causal_dag_edges')
      .select('ate, confidence')
      .in('from_node_key', diagnosisKeys)
      .in('to_node_key', ['outcome:deteriorated', 'outcome:died'])
      .gte('support_count', 3);

    if (!edges || edges.length === 0) return 0.1;
    const weighted = edges.reduce((s: number, e: Record<string, unknown>) =>
      s + Math.abs(Number(e.ate ?? 0)) * Number(e.confidence ?? 0), 0) / edges.length;
    return Math.min(weighted, 1.0);
  }

  private async getCausalRiskFactors(species: string, diagnoses: string[]): Promise<string[]> {
    if (diagnoses.length === 0) return [];
    const { data: edges } = await this.supabase
      .from('causal_dag_edges')
      .select('from_node_key')
      .in('from_node_key', diagnoses.map(d => `diagnosis:${d}`))
      .in('to_node_key', ['outcome:deteriorated', 'outcome:died'])
      .gte('confidence', 0.4)
      .order('confidence', { ascending: false })
      .limit(5);

    return (edges ?? []).map((e: Record<string, unknown>) => String(e.from_node_key).split(':')[1]);
  }

  private async findSimilarPatients(
    tenantId: string, excludePatientId: string, species: string, activeDiagnoses: string[]
  ): Promise<SimilarPatientMatch[]> {
    if (activeDiagnoses.length === 0) return [];
    const { data: nodes } = await this.supabase
      .from('living_case_nodes')
      .select('patient_id, species, breed, active_diagnoses, last_outcome, last_treatment, deterioration_risk, causal_risk_factors')
      .eq('tenant_id', tenantId)
      .eq('species', species)
      .neq('patient_id', excludePatientId)
      .overlaps('active_diagnoses', activeDiagnoses)
      .limit(10);

    return (nodes ?? []).map((n: Record<string, unknown>) => {
      const shared = ((n.active_diagnoses as string[]) ?? []).filter(d => activeDiagnoses.includes(d));
      const risks = (n.causal_risk_factors as string[]) ?? [];
      return {
        patientId: String(n.patient_id),
        species: String(n.species),
        breed: n.breed ? String(n.breed) : null,
        sharedDiagnoses: shared,
        lastOutcome: n.last_outcome ? String(n.last_outcome) : null,
        lastTreatment: n.last_treatment ? String(n.last_treatment) : null,
        deteriorationRisk: n.deterioration_risk ? Number(n.deterioration_risk) : null,
        causalDifferentiator: risks.length > 0 ? `Driven by: ${risks.slice(0, 2).join(', ')}` : null,
      };
    });
  }

  private buildNarrative(diagnoses: string[], similar: SimilarPatientMatch[], risk: number): string {
    if (similar.length === 0) {
      return `No prior similar patients in the network for ${diagnoses.join(', ')}. Deterioration risk: ${(risk * 100).toFixed(0)}%.`;
    }
    const recovered = similar.filter(s => s.lastOutcome === 'recovered' || s.lastOutcome === 'improved').length;
    const deteriorated = similar.filter(s => s.lastOutcome === 'deteriorated' || s.lastOutcome === 'died').length;
    const riskNote = risk > 0.5 ? ' Causal analysis flags elevated deterioration risk.'
      : risk > 0.25 ? ' Moderate deterioration risk in causal pathways.' : '';
    return `${similar.length} similar patients in network: ${recovered} recovered/improved, ${deteriorated} deteriorated.${riskNote}`;
  }
}

let _mem: LivingCaseMemory | null = null;
export function getLivingCaseMemory(): LivingCaseMemory {
  if (!_mem) _mem = new LivingCaseMemory();
  return _mem;
}
