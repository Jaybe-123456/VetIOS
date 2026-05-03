import { getSupabaseServer } from '@/lib/supabaseServer';

export type CausalNodeType =
  | 'diagnosis'
  | 'treatment'
  | 'outcome'
  | 'species'
  | 'breed'
  | 'biomarker'
  | 'symptom'
  | 'risk_factor';

export type CausalEdgeType = 'causes' | 'prevents' | 'modifies' | 'confounds' | 'mediates';

export interface CausalObservationInput {
  tenantId: string;
  inferenceEventId?: string | null;
  treatmentEventId?: string | null;
  treatmentOutcomeId?: string | null;
  rlhfFeedbackId?: string | null;
  patientId?: string | null;
  species: string;
  breed?: string | null;
  ageYears?: number | null;
  weightKg?: number | null;
  treatmentApplied: string;
  treatmentSnapshot?: Record<string, unknown> | null;
  clinicianOverride?: boolean;
  clinicianValidationStatus?: string | null;
  predictedDiagnosis?: string | null;
  confirmedDiagnosis: string;
  outcomeStatus: string;
  recoveryTimeDays?: number | null;
  hadComplications?: boolean;
  complications?: string[];
  outcomeHorizon: '48h' | '7d' | '30d' | 'final' | 'unknown';
  observedAt?: string | null;
  symptomVector?: string[];
  biomarkerSnapshot?: Record<string, number | string | null> | null;
  featureSnapshot?: Record<string, unknown> | null;
}

export interface CausalEdge {
  fromNodeKey: string;
  toNodeKey: string;
  edgeType: CausalEdgeType;
  ate: number | null;
  ateLower: number | null;
  ateUpper: number | null;
  supportCount: number;
  treatedCount: number;
  controlCount: number;
  confidence: number;
  speciesScope: string[] | null;
}

export interface CausalInsight {
  statement: string;
  fromNodeKey: string;
  toNodeKey: string;
  edgeType: CausalEdgeType;
  ate: number | null;
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

interface ObservationRow {
  id?: string;
  tenant_id?: string;
  species: string;
  breed: string | null;
  age_years: number | null;
  treatment_applied: string;
  confirmed_diagnosis: string;
  outcome_status: string;
  recovery_time_days: number | null;
  had_complications?: boolean;
}

interface CalibrationTupleRow {
  total_cases?: number | string | null;
  accuracy_rate?: number | string | null;
  calibration_error?: number | string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const MIN_EFFECT_SUPPORT = 4;

const OUTCOME_SCORES: Record<string, number> = {
  resolved: 1,
  recovered: 1,
  improved: 0.65,
  stable: 0.2,
  ongoing: 0,
  planned: 0,
  unknown: 0,
  complication: -0.35,
  complicated: -0.35,
  deteriorated: -0.65,
  deceased: -1,
  died: -1,
};

export function normalizeOutcomeStatus(value: string | null | undefined): string {
  const normalized = normalizeKeyPart(value ?? 'unknown');
  if (normalized === 'recovered') return 'resolved';
  if (normalized === 'died') return 'deceased';
  if (normalized === 'complications') return 'complication';
  return normalized || 'unknown';
}

export function scoreOutcome(status: string | null | undefined): number {
  return OUTCOME_SCORES[normalizeOutcomeStatus(status)] ?? 0;
}

export function isFavorableOutcome(status: string | null | undefined): boolean {
  return scoreOutcome(status) >= 0.6;
}

export function isAdverseOutcome(status: string | null | undefined): boolean {
  return scoreOutcome(status) < 0;
}

export function makeCausalNodeKey(type: CausalNodeType, label: string): string {
  return `${type}:${normalizeKeyPart(label) || 'unknown'}`;
}

export class CausalEngine {
  private supabase = getSupabaseServer();

  async recordObservation(input: CausalObservationInput): Promise<void> {
    const species = normalizeLabel(input.species, 'unknown_species');
    const treatmentApplied = normalizeLabel(input.treatmentApplied, 'unknown_treatment');
    const confirmedDiagnosis = normalizeLabel(input.confirmedDiagnosis, 'unknown_diagnosis');
    const outcomeStatus = normalizeOutcomeStatus(input.outcomeStatus);
    const symptoms = normalizeStringArray(input.symptomVector);
    const biomarkerSnapshot = input.biomarkerSnapshot ?? null;
    const featureSnapshot = input.featureSnapshot ?? {};
    const complications = normalizeStringArray(input.complications);

    const nodeInputs: Array<{ key: string; type: CausalNodeType; label: string; metadata?: Record<string, unknown> }> = [
      { key: makeCausalNodeKey('diagnosis', confirmedDiagnosis), type: 'diagnosis', label: confirmedDiagnosis },
      { key: makeCausalNodeKey('treatment', treatmentApplied), type: 'treatment', label: treatmentApplied },
      { key: makeCausalNodeKey('outcome', outcomeStatus), type: 'outcome', label: outcomeStatus },
      { key: makeCausalNodeKey('species', species), type: 'species', label: species },
      ...(
        input.breed
          ? [{ key: makeCausalNodeKey('breed', input.breed), type: 'breed' as const, label: normalizeLabel(input.breed, 'unknown_breed') }]
          : []
      ),
      ...symptoms.slice(0, 20).map((symptom) => ({
        key: makeCausalNodeKey('symptom', symptom),
        type: 'symptom' as const,
        label: symptom,
      })),
      ...Object.keys(biomarkerSnapshot ?? {}).slice(0, 20).map((biomarker) => ({
        key: makeCausalNodeKey('biomarker', biomarker),
        type: 'biomarker' as const,
        label: biomarker,
      })),
    ];

    await Promise.all(nodeInputs.map((node) => this.ensureNode(node.key, node.type, node.label, node.metadata)));

    const { error } = await this.supabase.from('causal_observations').insert({
      tenant_id: input.tenantId,
      inference_event_id: asUuidOrNull(input.inferenceEventId),
      treatment_event_id: asUuidOrNull(input.treatmentEventId),
      treatment_outcome_id: asUuidOrNull(input.treatmentOutcomeId),
      rlhf_feedback_id: input.rlhfFeedbackId ?? null,
      patient_id: input.patientId ?? null,
      species,
      breed: input.breed ? normalizeLabel(input.breed, '') : null,
      age_years: readNumber(input.ageYears),
      weight_kg: readNumber(input.weightKg),
      treatment_applied: treatmentApplied,
      treatment_snapshot: input.treatmentSnapshot ?? {},
      clinician_override: input.clinicianOverride === true,
      clinician_validation_status: input.clinicianValidationStatus ?? null,
      predicted_diagnosis: input.predictedDiagnosis ?? null,
      confirmed_diagnosis: confirmedDiagnosis,
      outcome_status: outcomeStatus,
      recovery_time_days: readNumber(input.recoveryTimeDays),
      had_complications: input.hadComplications === true || complications.length > 0 || outcomeStatus === 'complication',
      complications,
      outcome_horizon: input.outcomeHorizon,
      observed_at: input.observedAt ?? new Date().toISOString(),
      symptom_vector: symptoms,
      biomarker_snapshot: biomarkerSnapshot,
      feature_snapshot: featureSnapshot,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Causal observation insert failed: ${error.message}`);
    }

    if (hasRecordedTreatment(treatmentApplied)) {
      await this.recomputeTreatmentOutcomeEdges({
        species,
        diagnosis: confirmedDiagnosis,
        treatment: treatmentApplied,
        observedOutcome: outcomeStatus,
        breed: input.breed ?? null,
      });
      await this.recomputeDiagnosisTreatmentEdge({
        species,
        diagnosis: confirmedDiagnosis,
        treatment: treatmentApplied,
      });
    }
    await this.recomputeDiagnosisOutcomeEdges({
      species,
      diagnosis: confirmedDiagnosis,
      observedOutcome: outcomeStatus,
    });
  }

  async getCausalContext(
    diagnosis: string,
    species: string,
    treatmentApplied?: string | null,
  ): Promise<CausalContext> {
    const normalizedDiagnosis = normalizeLabel(diagnosis, 'unknown_diagnosis');
    const normalizedSpecies = normalizeLabel(species, 'unknown_species');
    const diagnosisKey = makeCausalNodeKey('diagnosis', normalizedDiagnosis);
    const treatmentKey = treatmentApplied ? makeCausalNodeKey('treatment', treatmentApplied) : null;

    const edgeRows = await this.loadRelevantEdges(diagnosisKey, treatmentKey);
    const insights = edgeRows
      .map((row) => this.mapInsight(row, normalizedSpecies))
      .filter((insight) => insight.speciesRelevant)
      .sort((left, right) => {
        const byConfidence = right.confidence - left.confidence;
        return byConfidence !== 0 ? byConfidence : right.supportCount - left.supportCount;
      })
      .slice(0, 8);

    const { count } = await this.supabase
      .from('causal_observations')
      .select('id', { count: 'exact', head: true })
      .eq('confirmed_diagnosis', normalizedDiagnosis)
      .eq('species', normalizedSpecies);

    const recoveryFactors = insights
      .filter((insight) => this.isRecoveryEdge(insight))
      .map((insight) => labelFromNodeKey(insight.fromNodeKey));

    const deteriorationRiskFactors = insights
      .filter((insight) => this.isRiskEdge(insight))
      .map((insight) => labelFromNodeKey(insight.fromNodeKey));

    const dominantCausalPath = [diagnosisKey];
    const selectedTreatmentKey =
      treatmentKey ??
      insights.find((insight) => insight.fromNodeKey === diagnosisKey && insight.toNodeKey.startsWith('treatment:'))?.toNodeKey ??
      null;
    if (selectedTreatmentKey) dominantCausalPath.push(selectedTreatmentKey);
    const topOutcome = insights.find((insight) =>
      selectedTreatmentKey &&
      insight.fromNodeKey === selectedTreatmentKey &&
      insight.toNodeKey.startsWith('outcome:') &&
      (insight.ate ?? 0) > 0
    );
    if (topOutcome) dominantCausalPath.push(topOutcome.toNodeKey);

    return {
      insights: insights.slice(0, 5),
      dominantCausalPath,
      deteriorationRiskFactors: dedupe(deteriorationRiskFactors),
      recoveryFactors: dedupe(recoveryFactors),
      observationCount: count ?? 0,
      computedAt: new Date().toISOString(),
    };
  }

  async getTreatmentAlternatives(input: {
    diagnosis: string;
    species: string;
    excludeTreatment?: string | null;
    limit?: number;
  }): Promise<string[]> {
    const diagnosis = normalizeLabel(input.diagnosis, 'unknown_diagnosis');
    const species = normalizeLabel(input.species, 'unknown_species');
    const { data } = await this.supabase
      .from('causal_observations')
      .select('treatment_applied')
      .eq('confirmed_diagnosis', diagnosis)
      .eq('species', species)
      .limit(200);

    const exclude = input.excludeTreatment ? normalizeLabel(input.excludeTreatment, '') : null;
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ treatment_applied?: unknown }>) {
      const treatment = normalizeLabel(row.treatment_applied, '');
      if (!treatment || treatment === exclude) continue;
      counts.set(treatment, (counts.get(treatment) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, input.limit ?? 3)
      .map(([treatment]) => treatment);
  }

  private async ensureNode(
    nodeKey: string,
    nodeType: CausalNodeType,
    label: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await this.supabase.from('causal_dag_nodes').upsert(
      {
        node_key: nodeKey,
        node_type: nodeType,
        label,
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'node_key' },
    );

    if (error) {
      throw new Error(`Causal DAG node upsert failed for ${nodeKey}: ${error.message}`);
    }

    try {
      await this.supabase.rpc('increment_causal_node_count', { p_node_key: nodeKey });
    } catch {
      // Non-fatal during staged migrations.
    }
  }

  private async recomputeTreatmentOutcomeEdges(input: {
    species: string;
    diagnosis: string;
    treatment: string;
    observedOutcome: string;
    breed?: string | null;
  }): Promise<void> {
    const { data } = await this.supabase
      .from('causal_observations')
      .select('species, breed, age_years, treatment_applied, confirmed_diagnosis, outcome_status, recovery_time_days, had_complications')
      .eq('species', input.species)
      .eq('confirmed_diagnosis', input.diagnosis)
      .limit(1000);

    const cohort = ((data ?? []) as ObservationRow[])
      .filter((row) => normalizeLabel(row.treatment_applied, '') !== '');
    const outcomes = dedupe([
      input.observedOutcome,
      ...cohort.map((row) => normalizeOutcomeStatus(row.outcome_status)),
    ]);

    const calibration = await this.loadCalibration(input.species, input.breed ?? null, input.diagnosis);
    const adjustmentSet = {
      species: input.species,
      diagnosis: input.diagnosis,
      breed: input.breed ?? null,
      estimator: 'stratified_difference_in_means',
      calibration,
    };

    await Promise.all(outcomes.map(async (outcome) => {
      const treated = cohort.filter((row) => row.treatment_applied === input.treatment);
      const controls = cohort.filter((row) => row.treatment_applied !== input.treatment);
      const supportCount = treated.length + controls.length;
      const estimate = estimateBinaryEffect({
        treated: treated.map((row) => normalizeOutcomeStatus(row.outcome_status) === outcome ? 1 : 0),
        control: controls.map((row) => normalizeOutcomeStatus(row.outcome_status) === outcome ? 1 : 0),
        calibration,
      });

      await this.upsertEdge({
        fromNodeKey: makeCausalNodeKey('treatment', input.treatment),
        toNodeKey: makeCausalNodeKey('outcome', outcome),
        edgeType: 'causes',
        ate: estimate.ate,
        ateLower: estimate.lower,
        ateUpper: estimate.upper,
        supportCount,
        treatedCount: treated.length,
        controlCount: controls.length,
        confidence: estimate.confidence,
        speciesScope: [input.species],
        adjustmentSet,
      });
    }));
  }

  private async recomputeDiagnosisTreatmentEdge(input: {
    species: string;
    diagnosis: string;
    treatment: string;
  }): Promise<void> {
    const { data } = await this.supabase
      .from('causal_observations')
      .select('treatment_applied, confirmed_diagnosis')
      .eq('species', input.species)
      .limit(1000);

    const rows = (data ?? []) as Array<{ treatment_applied?: string; confirmed_diagnosis?: string }>;
    const diagnosed = rows.filter((row) => row.confirmed_diagnosis === input.diagnosis);
    const background = rows.filter((row) => row.confirmed_diagnosis !== input.diagnosis);
    const diagnosedRate = rate(diagnosed.map((row) => row.treatment_applied === input.treatment ? 1 : 0));
    const backgroundRate = rate(background.map((row) => row.treatment_applied === input.treatment ? 1 : 0));
    const lift = diagnosedRate - backgroundRate;
    const supportCount = diagnosed.length + background.length;

    await this.upsertEdge({
      fromNodeKey: makeCausalNodeKey('diagnosis', input.diagnosis),
      toNodeKey: makeCausalNodeKey('treatment', input.treatment),
      edgeType: 'modifies',
      ate: Number.isFinite(lift) ? lift : null,
      ateLower: null,
      ateUpper: null,
      supportCount,
      treatedCount: diagnosed.length,
      controlCount: background.length,
      confidence: Math.min(supportCount / 50, 1),
      speciesScope: [input.species],
      adjustmentSet: {
        species: input.species,
        estimator: 'diagnosis_treatment_selection_lift',
      },
    });
  }

  private async recomputeDiagnosisOutcomeEdges(input: {
    species: string;
    diagnosis: string;
    observedOutcome: string;
  }): Promise<void> {
    const { data } = await this.supabase
      .from('causal_observations')
      .select('confirmed_diagnosis, outcome_status')
      .eq('species', input.species)
      .limit(1000);

    const cohort = (data ?? []) as Array<{ confirmed_diagnosis?: string; outcome_status?: string }>;
    const outcomes = dedupe([
      input.observedOutcome,
      ...cohort.map((row) => normalizeOutcomeStatus(row.outcome_status)),
    ]);
    const calibration = await this.loadCalibration(input.species, null, input.diagnosis);

    await Promise.all(outcomes.map(async (outcome) => {
      const treated = cohort.filter((row) => row.confirmed_diagnosis === input.diagnosis);
      const controls = cohort.filter((row) => row.confirmed_diagnosis !== input.diagnosis);
      const estimate = estimateBinaryEffect({
        treated: treated.map((row) => normalizeOutcomeStatus(row.outcome_status) === outcome ? 1 : 0),
        control: controls.map((row) => normalizeOutcomeStatus(row.outcome_status) === outcome ? 1 : 0),
        calibration,
      });

      await this.upsertEdge({
        fromNodeKey: makeCausalNodeKey('diagnosis', input.diagnosis),
        toNodeKey: makeCausalNodeKey('outcome', outcome),
        edgeType: 'causes',
        ate: estimate.ate,
        ateLower: estimate.lower,
        ateUpper: estimate.upper,
        supportCount: treated.length + controls.length,
        treatedCount: treated.length,
        controlCount: controls.length,
        confidence: estimate.confidence,
        speciesScope: [input.species],
        adjustmentSet: {
          species: input.species,
          estimator: 'diagnosis_outcome_stratified_difference',
          calibration,
        },
      });
    }));
  }

  private async upsertEdge(input: {
    fromNodeKey: string;
    toNodeKey: string;
    edgeType: CausalEdgeType;
    ate: number | null;
    ateLower: number | null;
    ateUpper: number | null;
    supportCount: number;
    treatedCount: number;
    controlCount: number;
    confidence: number;
    speciesScope: string[] | null;
    adjustmentSet: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await this.supabase.from('causal_dag_edges').upsert(
      {
        from_node_key: input.fromNodeKey,
        to_node_key: input.toNodeKey,
        edge_type: input.edgeType,
        ate: input.ate,
        ate_lower: input.ateLower,
        ate_upper: input.ateUpper,
        support_count: input.supportCount,
        treated_count: input.treatedCount,
        control_count: input.controlCount,
        confidence: clamp(input.confidence, 0, 1),
        species_scope: input.speciesScope,
        adjustment_set: input.adjustmentSet,
        last_computed: new Date().toISOString(),
      },
      { onConflict: 'from_node_key,to_node_key,edge_type' },
    );

    if (error) {
      throw new Error(`Causal DAG edge upsert failed: ${error.message}`);
    }
  }

  private async loadRelevantEdges(
    diagnosisKey: string,
    treatmentKey: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    const queries = [
      this.supabase
        .from('causal_dag_edges')
        .select('*')
        .eq('from_node_key', diagnosisKey)
        .order('confidence', { ascending: false })
        .limit(20),
    ];

    if (treatmentKey) {
      queries.push(
        this.supabase
          .from('causal_dag_edges')
          .select('*')
          .eq('from_node_key', treatmentKey)
          .order('confidence', { ascending: false })
          .limit(20),
      );
    }

    const results = await Promise.all(queries);
    const byKey = new Map<string, Record<string, unknown>>();
    for (const result of results) {
      for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
        const key = `${row.from_node_key}:${row.to_node_key}:${row.edge_type}`;
        byKey.set(key, row);
      }
    }
    return Array.from(byKey.values());
  }

  private async loadCalibration(
    species: string,
    breed: string | null,
    diagnosis: string,
  ): Promise<{ totalCases: number; accuracyRate: number | null; calibrationError: number | null }> {
    const tupleKey = `${species}::${breed ?? 'any'}::${diagnosis}`;
    const { data } = await this.supabase
      .from('calibration_tuples')
      .select('total_cases, accuracy_rate, calibration_error')
      .eq('tuple_key', tupleKey)
      .maybeSingle();

    const row = data as CalibrationTupleRow | null;
    return {
      totalCases: readNumber(row?.total_cases) ?? 0,
      accuracyRate: readNumber(row?.accuracy_rate),
      calibrationError: readNumber(row?.calibration_error),
    };
  }

  private mapInsight(edge: Record<string, unknown>, species: string): CausalInsight {
    const speciesScope = Array.isArray(edge.species_scope)
      ? edge.species_scope.map(String)
      : null;
    const ate = readNumber(edge.ate);
    const fromNodeKey = String(edge.from_node_key ?? '');
    const toNodeKey = String(edge.to_node_key ?? '');
    return {
      statement: buildInsightStatement({
        fromNodeKey,
        toNodeKey,
        edgeType: String(edge.edge_type ?? 'causes') as CausalEdgeType,
        ate,
        supportCount: readNumber(edge.support_count) ?? 0,
        confidence: readNumber(edge.confidence) ?? 0,
        species,
      }),
      fromNodeKey,
      toNodeKey,
      edgeType: String(edge.edge_type ?? 'causes') as CausalEdgeType,
      ate,
      supportCount: readNumber(edge.support_count) ?? 0,
      confidence: readNumber(edge.confidence) ?? 0,
      speciesRelevant: !speciesScope || speciesScope.includes(species),
    };
  }

  private isRecoveryEdge(insight: CausalInsight): boolean {
    if (!insight.toNodeKey.startsWith('outcome:') || insight.ate == null) return false;
    const outcome = labelFromNodeKey(insight.toNodeKey);
    return (isFavorableOutcome(outcome) && insight.ate > 0) || (isAdverseOutcome(outcome) && insight.ate < 0);
  }

  private isRiskEdge(insight: CausalInsight): boolean {
    if (!insight.toNodeKey.startsWith('outcome:') || insight.ate == null) return false;
    const outcome = labelFromNodeKey(insight.toNodeKey);
    return (isAdverseOutcome(outcome) && insight.ate > 0) || (isFavorableOutcome(outcome) && insight.ate < 0);
  }
}

function estimateBinaryEffect(input: {
  treated: number[];
  control: number[];
  calibration: { totalCases: number; accuracyRate: number | null; calibrationError: number | null };
}): { ate: number | null; lower: number | null; upper: number | null; confidence: number } {
  if (input.treated.length === 0 || input.control.length === 0) {
    return { ate: null, lower: null, upper: null, confidence: 0 };
  }

  const treatedRate = rate(input.treated);
  const controlRate = rate(input.control);
  const ate = treatedRate - controlRate;
  const treatedSe = binomialSe(treatedRate, input.treated.length);
  const controlSe = binomialSe(controlRate, input.control.length);
  const se = Math.sqrt(treatedSe ** 2 + controlSe ** 2);
  const lower = ate - 1.96 * se;
  const upper = ate + 1.96 * se;
  const support = input.treated.length + input.control.length;
  const supportFactor = support < MIN_EFFECT_SUPPORT ? support / MIN_EFFECT_SUPPORT * 0.25 : Math.min(support / 50, 1);
  const widthPenalty = 1 - Math.min(Math.abs(upper - lower), 2) / 2;
  const calibrationPenalty = input.calibration.calibrationError == null
    ? 0.85
    : clamp(1 - input.calibration.calibrationError, 0.25, 1);
  const calibrationSupport = input.calibration.totalCases > 0 ? Math.min(input.calibration.totalCases / 30, 1) : 0.5;
  const confidence = supportFactor * Math.max(widthPenalty, 0.05) * calibrationPenalty * calibrationSupport;
  return { ate, lower, upper, confidence };
}

function binomialSe(p: number, n: number): number {
  if (n <= 0) return 0;
  return Math.sqrt((p * (1 - p)) / n);
}

function rate(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildInsightStatement(input: {
  fromNodeKey: string;
  toNodeKey: string;
  edgeType: CausalEdgeType;
  ate: number | null;
  supportCount: number;
  confidence: number;
  species: string;
}): string {
  const from = prettifyLabel(labelFromNodeKey(input.fromNodeKey));
  const to = prettifyLabel(labelFromNodeKey(input.toNodeKey));
  if (input.ate == null) {
    return `${from} has early causal evidence toward ${to} in ${input.species} (n=${input.supportCount}).`;
  }

  const magnitude = Math.abs(input.ate) >= 0.3 ? 'strongly'
    : Math.abs(input.ate) >= 0.12 ? 'moderately'
      : 'weakly';
  const direction = input.ate >= 0 ? 'increases' : 'decreases';
  return `${from} ${magnitude} ${direction} likelihood of ${to} in ${input.species} (n=${input.supportCount}, ATE=${input.ate.toFixed(2)}, confidence=${Math.round(input.confidence * 100)}%).`;
}

function normalizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return dedupe(values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean));
}

function normalizeKeyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function labelFromNodeKey(nodeKey: string): string {
  const separator = nodeKey.indexOf(':');
  return separator === -1 ? nodeKey : nodeKey.slice(separator + 1);
}

function prettifyLabel(label: string): string {
  return label.replace(/_/g, ' ');
}

function hasRecordedTreatment(treatment: string): boolean {
  return treatment !== 'no_recorded_treatment' && treatment !== 'unknown_treatment';
}

function asUuidOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

let engine: CausalEngine | null = null;

export function getCausalEngine(): CausalEngine {
  if (!engine) engine = new CausalEngine();
  return engine;
}
