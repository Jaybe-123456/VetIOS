import { getSupabaseServer } from '@/lib/supabaseServer';
import {
  isAdverseOutcome,
  isFavorableOutcome,
  makeCausalNodeKey,
  scoreOutcome,
} from '@/lib/causal/causalEngine';

export interface LivingNodeUpdate {
  tenantId: string;
  patientId: string;
  inferenceEventId?: string | null;
  species: string;
  breed?: string | null;
  activeDiagnoses: string[];
  lastSymptoms?: string[];
  lastBiomarkers?: Record<string, number | string | null> | null;
  lastTreatment?: string | null;
  lastOutcome?: string | null;
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

interface LivingCaseRow {
  id?: string;
  patient_id: string;
  species: string;
  breed: string | null;
  active_diagnoses: string[] | null;
  last_outcome: string | null;
  last_treatment: string | null;
  deterioration_risk: number | null;
  causal_risk_factors: unknown;
  inference_count?: number | null;
  first_seen_at?: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export class LivingCaseMemory {
  private supabase = getSupabaseServer();

  async upsertNode(update: LivingNodeUpdate): Promise<void> {
    const normalized = normalizeUpdate(update);
    const deteriorationRisk = await this.computeDeteriorationRisk({
      species: normalized.species,
      diagnoses: normalized.activeDiagnoses,
      treatment: normalized.lastTreatment,
    });
    const causalRiskFactors = await this.getCausalRiskFactors({
      species: normalized.species,
      diagnoses: normalized.activeDiagnoses,
      treatment: normalized.lastTreatment,
    });
    const similarPatients = await this.findSimilarPatients({
      tenantId: normalized.tenantId,
      excludePatientId: normalized.patientId,
      species: normalized.species,
      activeDiagnoses: normalized.activeDiagnoses,
      limit: 5,
    });

    const { data: existing } = await this.supabase
      .from('living_case_nodes')
      .select('id, inference_count, first_seen_at')
      .eq('tenant_id', normalized.tenantId)
      .eq('patient_id', normalized.patientId)
      .maybeSingle();

    const payload = {
      tenant_id: normalized.tenantId,
      patient_id: normalized.patientId,
      latest_inference_event_id: asUuidOrNull(normalized.inferenceEventId),
      species: normalized.species,
      breed: normalized.breed,
      active_diagnoses: normalized.activeDiagnoses,
      last_symptoms: normalized.lastSymptoms,
      last_biomarkers: normalized.lastBiomarkers,
      last_treatment: normalized.lastTreatment,
      last_outcome: normalized.lastOutcome,
      deterioration_risk: deteriorationRisk,
      causal_risk_factors: causalRiskFactors,
      similar_patient_ids: similarPatients.map((patient) => patient.patientId),
      last_updated_at: new Date().toISOString(),
    };

    if (existing) {
      const current = existing as { inference_count?: number | null };
      const { error } = await this.supabase
        .from('living_case_nodes')
        .update({
          ...payload,
          inference_count: (current.inference_count ?? 0) + 1,
        })
        .eq('tenant_id', normalized.tenantId)
        .eq('patient_id', normalized.patientId);
      if (error) throw new Error(`Living case update failed: ${error.message}`);
      return;
    }

    const { error } = await this.supabase.from('living_case_nodes').insert({
      ...payload,
      first_seen_at: new Date().toISOString(),
      inference_count: 1,
      created_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Living case insert failed: ${error.message}`);
  }

  async getInsight(input: {
    tenantId: string;
    patientId: string;
    species: string;
    activeDiagnoses: string[];
    treatment?: string | null;
  }): Promise<LivingCaseInsight> {
    const species = normalizeText(input.species, 'unknown_species');
    const activeDiagnoses = normalizeStringArray(input.activeDiagnoses);
    const deteriorationRisk = await this.computeDeteriorationRisk({
      species,
      diagnoses: activeDiagnoses,
      treatment: input.treatment ?? null,
    });
    const causalRiskFactors = await this.getCausalRiskFactors({
      species,
      diagnoses: activeDiagnoses,
      treatment: input.treatment ?? null,
    });
    const similarPatients = await this.findSimilarPatients({
      tenantId: input.tenantId,
      excludePatientId: input.patientId,
      species,
      activeDiagnoses,
      limit: 5,
    });

    return {
      patientId: input.patientId,
      deteriorationRisk,
      causalRiskFactors: causalRiskFactors.map((factor) => factor.factor),
      similarPatients,
      narrativeSummary: buildNarrative(activeDiagnoses, similarPatients, deteriorationRisk),
    };
  }

  private async computeDeteriorationRisk(input: {
    species: string;
    diagnoses: string[];
    treatment?: string | null;
  }): Promise<number> {
    const treatmentRisk = input.treatment
      ? await this.computeTreatmentRisk(input.species, input.treatment)
      : null;
    const empiricalRisk = await this.computeEmpiricalDiagnosisRisk(input.species, input.diagnoses);

    if (treatmentRisk == null) return empiricalRisk;
    return clamp(treatmentRisk * 0.65 + empiricalRisk * 0.35, 0, 1);
  }

  private async computeTreatmentRisk(species: string, treatment: string): Promise<number | null> {
    const { data } = await this.supabase
      .from('causal_dag_edges')
      .select('to_node_key, ate, confidence, support_count, species_scope')
      .eq('from_node_key', makeCausalNodeKey('treatment', treatment))
      .like('to_node_key', 'outcome:%')
      .gte('support_count', 3)
      .limit(20);

    const edges = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((edge) => isSpeciesRelevant(edge.species_scope, species));
    if (edges.length === 0) return null;

    let risk = 0.1;
    let weight = 0;
    for (const edge of edges) {
      const outcome = labelFromNodeKey(String(edge.to_node_key ?? ''));
      const ate = readNumber(edge.ate) ?? 0;
      const confidence = readNumber(edge.confidence) ?? 0;
      const contribution = isAdverseOutcome(outcome)
        ? Math.max(ate, 0)
        : isFavorableOutcome(outcome)
          ? Math.max(-ate, 0)
          : 0;
      risk += contribution * confidence;
      weight += confidence;
    }

    return clamp(weight > 0 ? risk / Math.max(weight, 1) : risk, 0, 1);
  }

  private async computeEmpiricalDiagnosisRisk(species: string, diagnoses: string[]): Promise<number> {
    if (diagnoses.length === 0) return 0.1;
    const { data } = await this.supabase
      .from('causal_observations')
      .select('outcome_status')
      .eq('species', species)
      .in('confirmed_diagnosis', diagnoses)
      .order('created_at', { ascending: false })
      .limit(200);

    const rows = (data ?? []) as Array<{ outcome_status?: string }>;
    if (rows.length === 0) return 0.1;
    const adverse = rows.filter((row) => scoreOutcome(row.outcome_status) < 0).length;
    return clamp(adverse / rows.length, 0, 1);
  }

  private async getCausalRiskFactors(input: {
    species: string;
    diagnoses: string[];
    treatment?: string | null;
  }): Promise<Array<{ factor: string; effect: number; confidence: number }>> {
    const factors: Array<{ factor: string; effect: number; confidence: number }> = [];
    if (input.treatment) {
      const { data } = await this.supabase
        .from('causal_dag_edges')
        .select('from_node_key, to_node_key, ate, confidence, species_scope')
        .eq('from_node_key', makeCausalNodeKey('treatment', input.treatment))
        .like('to_node_key', 'outcome:%')
        .order('confidence', { ascending: false })
        .limit(10);

      for (const edge of (data ?? []) as Array<Record<string, unknown>>) {
        if (!isSpeciesRelevant(edge.species_scope, input.species)) continue;
        const outcome = labelFromNodeKey(String(edge.to_node_key ?? ''));
        const ate = readNumber(edge.ate) ?? 0;
        if ((isAdverseOutcome(outcome) && ate > 0) || (isFavorableOutcome(outcome) && ate < 0)) {
          factors.push({
            factor: labelFromNodeKey(String(edge.from_node_key ?? '')),
            effect: ate,
            confidence: readNumber(edge.confidence) ?? 0,
          });
        }
      }
    }

    for (const diagnosis of input.diagnoses) {
      factors.push({
        factor: diagnosis,
        effect: await this.computeEmpiricalDiagnosisRisk(input.species, [diagnosis]),
        confidence: 0.35,
      });
    }

    return factors
      .sort((left, right) => Math.abs(right.effect) * right.confidence - Math.abs(left.effect) * left.confidence)
      .slice(0, 5);
  }

  private async findSimilarPatients(input: {
    tenantId: string;
    excludePatientId: string;
    species: string;
    activeDiagnoses: string[];
    limit: number;
  }): Promise<SimilarPatientMatch[]> {
    if (input.activeDiagnoses.length === 0) return [];
    const { data } = await this.supabase
      .from('living_case_nodes')
      .select('patient_id, species, breed, active_diagnoses, last_outcome, last_treatment, deterioration_risk, causal_risk_factors')
      .eq('tenant_id', input.tenantId)
      .eq('species', input.species)
      .neq('patient_id', input.excludePatientId)
      .overlaps('active_diagnoses', input.activeDiagnoses)
      .order('last_updated_at', { ascending: false })
      .limit(input.limit);

    return ((data ?? []) as LivingCaseRow[]).map((row) => {
      const activeDiagnoses = Array.isArray(row.active_diagnoses) ? row.active_diagnoses : [];
      const sharedDiagnoses = activeDiagnoses.filter((diagnosis) => input.activeDiagnoses.includes(diagnosis));
      const riskFactors = normalizeRiskFactors(row.causal_risk_factors);
      return {
        patientId: row.patient_id,
        species: row.species,
        breed: row.breed,
        sharedDiagnoses,
        lastOutcome: row.last_outcome,
        lastTreatment: row.last_treatment,
        deteriorationRisk: readNumber(row.deterioration_risk),
        causalDifferentiator: riskFactors.length > 0
          ? `Driven by: ${riskFactors.slice(0, 2).join(', ')}`
          : null,
      };
    });
  }
}

function normalizeUpdate(update: LivingNodeUpdate): Required<Omit<LivingNodeUpdate, 'ageYears'>> {
  return {
    tenantId: update.tenantId,
    patientId: update.patientId,
    inferenceEventId: update.inferenceEventId ?? null,
    species: normalizeText(update.species, 'unknown_species'),
    breed: update.breed ? normalizeText(update.breed, '') : null,
    activeDiagnoses: normalizeStringArray(update.activeDiagnoses),
    lastSymptoms: normalizeStringArray(update.lastSymptoms ?? []),
    lastBiomarkers: update.lastBiomarkers ?? null,
    lastTreatment: update.lastTreatment ? normalizeText(update.lastTreatment, '') : null,
    lastOutcome: update.lastOutcome ? normalizeText(update.lastOutcome, '') : null,
  };
}

function buildNarrative(
  diagnoses: string[],
  similarPatients: SimilarPatientMatch[],
  deteriorationRisk: number,
): string {
  const diagnosisLabel = diagnoses.length > 0 ? diagnoses.join(', ') : 'this presentation';
  if (similarPatients.length === 0) {
    return `No prior live patient nodes match ${diagnosisLabel}. Estimated deterioration risk is ${Math.round(deteriorationRisk * 100)}%.`;
  }

  const improved = similarPatients.filter((patient) =>
    patient.lastOutcome === 'resolved' || patient.lastOutcome === 'recovered' || patient.lastOutcome === 'improved'
  ).length;
  const worsened = similarPatients.filter((patient) =>
    patient.lastOutcome === 'deteriorated' || patient.lastOutcome === 'deceased' || patient.lastOutcome === 'died'
  ).length;
  const treatmentCounts = new Map<string, number>();
  for (const patient of similarPatients) {
    if (!patient.lastTreatment) continue;
    treatmentCounts.set(patient.lastTreatment, (treatmentCounts.get(patient.lastTreatment) ?? 0) + 1);
  }
  const topTreatment = Array.from(treatmentCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
  const treatmentSentence = topTreatment ? ` Most common prior treatment: ${topTreatment}.` : '';
  return `${similarPatients.length} similar live patient node(s) match ${diagnosisLabel}: ${improved} improved/resolved, ${worsened} deteriorated/deceased.${treatmentSentence} Estimated deterioration risk is ${Math.round(deteriorationRisk * 100)}%.`;
}

function normalizeRiskFactors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        return typeof record.factor === 'string' ? record.factor : null;
      }
      return null;
    })
    .filter((entry): entry is string => entry != null);
}

function isSpeciesRelevant(value: unknown, species: string): boolean {
  return !Array.isArray(value) || value.map(String).includes(species);
}

function labelFromNodeKey(nodeKey: string): string {
  const separator = nodeKey.indexOf(':');
  return separator === -1 ? nodeKey : nodeKey.slice(separator + 1).replace(/_/g, ' ');
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)));
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

let memory: LivingCaseMemory | null = null;

export function getLivingCaseMemory(): LivingCaseMemory {
  if (!memory) memory = new LivingCaseMemory();
  return memory;
}
