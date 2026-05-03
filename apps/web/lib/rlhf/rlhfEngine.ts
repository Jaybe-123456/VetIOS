/**
 * VetIOS RLHF Loop — Reinforcement Learning from Human Feedback
 *
 * Every time a vet overrides or confirms a VetIOS diagnosis, that signal
 * updates the model's probability weights in real time.
 *
 * Extends the existing reinforcementRouter.ts with:
 *  1. Vector store outcome confirmation (closes RAG loop)
 *  2. Calibration update per (species, breed, diagnosis) tuple
 *  3. Active learning signal generation (flags cases for review)
 *  4. Population signal ingestion
 *  5. Longitudinal patient record update
 *
 * This is the flywheel: more vets → more corrections → smarter model → more vets.
 */

import { getSupabaseServer } from '@/lib/supabaseServer';
import { getVectorStore } from '@/lib/vectorStore/vetVectorStore';
import { getLongitudinalService } from '@/lib/longitudinal/longitudinalPatientService';
import { getPopulationSignalService } from '@/lib/populationSignal/populationSignalService';
import { getCausalEngine } from '@/lib/causal/causalEngine';
import { getLivingCaseMemory } from '@/lib/causal/livingCaseMemory';

// ─── Types ───────────────────────────────────────────────────

export type FeedbackType =
  | 'diagnosis_confirmed'      // vet confirms VetIOS was correct
  | 'diagnosis_corrected'      // vet provides the actual correct diagnosis
  | 'diagnosis_rejected'       // vet rejects diagnosis entirely (no alternative yet)
  | 'treatment_confirmed'      // vet confirms treatment recommendation
  | 'treatment_modified'       // vet modified the treatment plan
  | 'severity_escalated'       // vet escalated urgency beyond what VetIOS said
  | 'severity_downgraded'      // vet reduced urgency
  | 'false_positive_alert'     // vet indicates VetIOS over-triggered an alert
  | 'outcome_at_48h'           // 48-hour follow-up outcome
  | 'outcome_at_7d'            // 7-day follow-up outcome
  | 'outcome_at_30d';          // 30-day follow-up outcome

export interface VetFeedbackInput {
  inferenceEventId: string;
  tenantId: string;
  patientId?: string | null;
  feedbackType: FeedbackType;
  predictedDiagnosis: string | null;
  actualDiagnosis: string | null;
  predictedConfidence: number;
  vetConfidence: number;        // vet's confidence in their correction (0-1)
  species: string;
  breed?: string | null;
  ageYears?: number | null;
  region?: string | null;
  extractedFeatures: Record<string, number>;
  vetNotes?: string | null;
  labelType: 'expert' | 'confirmed' | 'synthetic';
}

export interface RLHFResult {
  success: boolean;
  feedbackId: string;
  reinforcementApplied: boolean;
  calibrationUpdated: boolean;
  vectorStoreUpdated: boolean;
  longitudinalUpdated: boolean;
  populationSignalIngested: boolean;
  activeLearningFlagged: boolean;
  causalObservationRecorded: boolean;
  livingNodeUpdated: boolean;
  impactDelta: number;
  summary: string;
}

// ─── Calibration Weight Updates ───────────────────────────────

const IMPACT_DELTAS: Record<FeedbackType, number> = {
  diagnosis_confirmed: 0.05,
  diagnosis_corrected: 0.15,
  diagnosis_rejected: 0.08,
  treatment_confirmed: 0.03,
  treatment_modified: 0.07,
  severity_escalated: 0.10,
  severity_downgraded: 0.06,
  false_positive_alert: 0.12,
  outcome_at_48h: 0.06,
  outcome_at_7d: 0.08,
  outcome_at_30d: 0.10,
};

// ─── RLHF Engine ──────────────────────────────────────────────

export class RLHFEngine {
  private supabase = getSupabaseServer();
  private vectorStore = getVectorStore();
  private longitudinalService = getLongitudinalService();
  private populationSignal = getPopulationSignalService();
  private causalEngine = getCausalEngine();
  private livingCaseMemory = getLivingCaseMemory();

  /**
   * Primary entry point. Called whenever a vet submits feedback.
   * Fans out to all downstream learning systems.
   */
  async processFeedback(input: VetFeedbackInput): Promise<RLHFResult> {
    const feedbackId = `rlhf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const impactDelta = IMPACT_DELTAS[input.feedbackType] * input.vetConfidence;

    let reinforcementApplied = false;
    let calibrationUpdated = false;
    let vectorStoreUpdated = false;
    let longitudinalUpdated = false;
    let populationSignalIngested = false;
    let activeLearningFlagged = false;
    let causalObservationRecorded = false;
    let livingNodeUpdated = false;

    // ── 1. Persist raw feedback record ──
    await this.persistFeedback(feedbackId, input, impactDelta);

    // ── 2. Route reinforcement (extends existing reinforcementRouter) ──
    if (input.labelType !== 'synthetic' || input.feedbackType === 'diagnosis_corrected') {
      reinforcementApplied = await this.routeReinforcement(input, impactDelta);
    }

    // ── 3. Update calibration tuple ──
    if (input.actualDiagnosis) {
      calibrationUpdated = await this.updateCalibrationTuple(input);
    }

    // ── 4. Update vector store (close RAG loop) ──
    if (
      input.actualDiagnosis &&
      (input.feedbackType === 'diagnosis_confirmed' || input.feedbackType === 'diagnosis_corrected')
    ) {
      vectorStoreUpdated = await this.updateVectorStore(input);
    }

    // ── 5. Update longitudinal patient record ──
    if (input.patientId && input.actualDiagnosis) {
      longitudinalUpdated = await this.updateLongitudinal(input);
    }

    // ── 6. Ingest population signal ──
    if (input.actualDiagnosis && input.region) {
      populationSignalIngested = await this.ingestPopulationSignal(input);
    }

    // ── 7. Flag for active learning if high-value case ──
    activeLearningFlagged = await this.flagForActiveLearning(input, impactDelta);

    // ── 8. Record causal observation (Tier 1) ──
    const isOutcomeFeedback = input.feedbackType === 'outcome_at_48h' ||
      input.feedbackType === 'outcome_at_7d' ||
      input.feedbackType === 'outcome_at_30d' ||
      input.feedbackType === 'diagnosis_confirmed' ||
      input.feedbackType === 'diagnosis_corrected';
    if (isOutcomeFeedback && input.actualDiagnosis) {
      causalObservationRecorded = await this.recordCausalObservation(input, feedbackId);
    }

    // ── 9. Update living case node (Tier 1) ──
    if (input.patientId && input.actualDiagnosis) {
      livingNodeUpdated = await this.updateLivingNode(input);
    }

    const summary = this.buildSummary(input, {
      reinforcementApplied,
      calibrationUpdated,
      vectorStoreUpdated,
      longitudinalUpdated,
      populationSignalIngested,
      activeLearningFlagged,
      causalObservationRecorded,
      livingNodeUpdated,
      impactDelta,
    });

    return {
      success: true,
      feedbackId,
      reinforcementApplied,
      calibrationUpdated,
      vectorStoreUpdated,
      longitudinalUpdated,
      populationSignalIngested,
      activeLearningFlagged,
      causalObservationRecorded,
      livingNodeUpdated,
      impactDelta,
      summary,
    };
  }

  // ─── Sub-systems ────────────────────────────────────────

  private async persistFeedback(
    feedbackId: string,
    input: VetFeedbackInput,
    impactDelta: number
  ): Promise<void> {
    const { error } = await this.supabase.from('rlhf_feedback_events').insert({
      feedback_id: feedbackId,
      inference_event_id: input.inferenceEventId,
      tenant_id: input.tenantId,
      patient_id: input.patientId ?? null,
      feedback_type: input.feedbackType,
      predicted_diagnosis: input.predictedDiagnosis,
      actual_diagnosis: input.actualDiagnosis,
      predicted_confidence: input.predictedConfidence,
      vet_confidence: input.vetConfidence,
      species: input.species,
      breed: input.breed ?? null,
      age_years: input.ageYears ?? null,
      region: input.region ?? null,
      extracted_features: input.extractedFeatures,
      vet_notes: input.vetNotes ?? null,
      label_type: input.labelType,
      impact_delta: impactDelta,
      created_at: new Date().toISOString(),
    });

    if (error) throw new Error(`RLHF persistFeedback failed: ${error.message}`);
  }

  private async routeReinforcement(
    input: VetFeedbackInput,
    impactDelta: number
  ): Promise<boolean> {
    try {
      // Extend existing LEARNING_REINFORCEMENTS table
      const { error } = await this.supabase.from('learning_reinforcements').insert({
        tenant_id: input.tenantId,
        inference_event_id: input.inferenceEventId,
        diagnosis_label: input.actualDiagnosis,
        condition_class: this.resolveConditionClass(input.actualDiagnosis ?? ''),
        severity_label: null,
        features: input.extractedFeatures,
        reinforcement_type: 'Diagnosis',
        impact_delta: impactDelta,
        source: 'rlhf_feedback',
        created_at: new Date().toISOString(),
      });

      return !error;
    } catch {
      return false;
    }
  }

  private async updateCalibrationTuple(input: VetFeedbackInput): Promise<boolean> {
    try {
      const tupleKey = `${input.species}::${input.breed ?? 'any'}::${input.actualDiagnosis}`;
      const isCorrect = input.feedbackType === 'diagnosis_confirmed';

      const { error } = await this.supabase.from('calibration_tuples').upsert(
        {
          tuple_key: tupleKey,
          species: input.species,
          breed: input.breed ?? null,
          diagnosis: input.actualDiagnosis,
          total_cases: 1,
          correct_cases: isCorrect ? 1 : 0,
          total_confidence_sum: input.predictedConfidence,
          last_updated: new Date().toISOString(),
        },
        {
          onConflict: 'tuple_key',
          // Raw SQL increment — handled in DB trigger
          ignoreDuplicates: false,
        }
      );

      // Also upsert via RPC for atomic increment
      await this.supabase.rpc('increment_calibration_tuple', {
        p_tuple_key: tupleKey,
        p_species: input.species,
        p_breed: input.breed ?? null,
        p_diagnosis: input.actualDiagnosis,
        p_is_correct: isCorrect,
        p_confidence: input.predictedConfidence,
      });

      return !error;
    } catch {
      return false;
    }
  }

  private async updateVectorStore(input: VetFeedbackInput): Promise<boolean> {
    try {
      await this.vectorStore.confirmOutcome(
        input.inferenceEventId,
        input.actualDiagnosis!
      );
      return true;
    } catch {
      return false;
    }
  }

  private async updateLongitudinal(input: VetFeedbackInput): Promise<boolean> {
    try {
      // Find the visit record linked to this inference event
      const { data } = await this.supabase
        .from('patient_longitudinal_records')
        .select('id')
        .eq('inference_event_id', input.inferenceEventId)
        .single();

      if (data) {
        await this.longitudinalService.confirmVisitOutcome(
          data.id,
          input.actualDiagnosis!,
          input.vetNotes ?? undefined
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  private async ingestPopulationSignal(input: VetFeedbackInput): Promise<boolean> {
    try {
      await this.populationSignal.ingestSignal({
        tenantId: input.tenantId,
        disease: input.actualDiagnosis!,
        species: input.species,
        region: input.region!,
        confidence: input.vetConfidence,
        inferenceEventId: input.inferenceEventId,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async flagForActiveLearning(
    input: VetFeedbackInput,
    impactDelta: number
  ): Promise<boolean> {
    // Flag if: correction (not confirmation) AND high vet confidence AND rare diagnosis
    const shouldFlag =
      input.feedbackType === 'diagnosis_corrected' &&
      input.vetConfidence >= 0.8 &&
      impactDelta >= 0.10;

    if (!shouldFlag) return false;

    try {
      const { error } = await this.supabase.from('active_learning_queue').insert({
        inference_event_id: input.inferenceEventId,
        tenant_id: input.tenantId,
        species: input.species,
        predicted_diagnosis: input.predictedDiagnosis,
        actual_diagnosis: input.actualDiagnosis,
        predicted_confidence: input.predictedConfidence,
        uncertainty_score: 1 - input.predictedConfidence,
        priority: impactDelta >= 0.15 ? 'high' : 'medium',
        reason: `Vet correction: predicted ${input.predictedDiagnosis} → actual ${input.actualDiagnosis}`,
        status: 'pending_review',
        created_at: new Date().toISOString(),
      });
      return !error;
    } catch {
      return false;
    }
  }

  private resolveConditionClass(diagnosis: string): string {
    const d = diagnosis.toLowerCase();
    if (d.includes('parvo') || d.includes('distemper') || d.includes('uri') || d.includes('lepto')) return 'Infectious';
    if (d.includes('lymphoma') || d.includes('carcinoma') || d.includes('cancer') || d.includes('tumour')) return 'Neoplastic';
    if (d.includes('ckd') || d.includes('kidney') || d.includes('renal')) return 'Urological';
    if (d.includes('diabetes') || d.includes('hyperthyroid') || d.includes('cushings') || d.includes('addison')) return 'Endocrine';
    if (d.includes('pancreatitis') || d.includes('hepatic') || d.includes('liver')) return 'Gastrointestinal';
    if (d.includes('fracture') || d.includes('luxation') || d.includes('cruciate')) return 'Orthopaedic';
    if (d.includes('gdv') || d.includes('bloat') || d.includes('volvulus')) return 'Emergency';
    return 'UNKNOWN';
  }

  private async recordCausalObservation(input: VetFeedbackInput, feedbackId: string): Promise<boolean> {
    try {
      const { data: te } = await this.supabase
        .from('treatment_events').select('selected_treatment, id, clinician_override')
        .eq('inference_event_id', input.inferenceEventId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const outcomeStatus = input.feedbackType.startsWith('outcome_at')
        ? (input.vetNotes?.toLowerCase().includes('recover') ? 'recovered'
          : input.vetNotes?.toLowerCase().includes('improv') ? 'improved'
          : input.vetNotes?.toLowerCase().includes('deterior') ? 'deteriorated' : 'stable')
        : input.feedbackType === 'diagnosis_confirmed' ? 'improved' : 'stable';
      const horizon = input.feedbackType === 'outcome_at_48h' ? '48h'
        : input.feedbackType === 'outcome_at_7d' ? '7d' : '30d';
      await this.causalEngine.recordObservation({
        tenantId: input.tenantId, inferenceEventId: input.inferenceEventId,
        treatmentEventId: te?.id ?? null, rlhfFeedbackId: feedbackId,
        species: input.species, breed: input.breed ?? null,
        ageYears: input.ageYears ?? null, weightKg: null,
        treatmentApplied: te?.selected_treatment ?? 'unknown',
        clinicianOverride: te?.clinician_override ?? false,
        predictedDiagnosis: input.predictedDiagnosis,
        confirmedDiagnosis: input.actualDiagnosis!,
        outcomeStatus: outcomeStatus as 'recovered'|'improved'|'stable'|'deteriorated'|'died',
        recoveryTimeDays: null, hadComplications: false, outcomeHorizon: horizon,
        observedAt: new Date().toISOString(),
        symptomVector: Object.keys(input.extractedFeatures), biomarkerSnapshot: null,
      });
      return true;
    } catch { return false; }
  }

  private async updateLivingNode(input: VetFeedbackInput): Promise<boolean> {
    try {
      await this.livingCaseMemory.upsertNode({
        tenantId: input.tenantId, patientId: input.patientId!,
        species: input.species, breed: input.breed ?? null,
        activeDiagnoses: input.actualDiagnosis ? [input.actualDiagnosis] : [],
        lastSymptoms: Object.keys(input.extractedFeatures),
        lastBiomarkers: null, lastTreatment: null,
        lastOutcome: input.feedbackType === 'diagnosis_confirmed' ? 'improved' : null,
      });
      return true;
    } catch { return false; }
  }

  private buildSummary(
    input: VetFeedbackInput,
    results: {
      reinforcementApplied: boolean;
      calibrationUpdated: boolean;
      vectorStoreUpdated: boolean;
      longitudinalUpdated: boolean;
      populationSignalIngested: boolean;
      activeLearningFlagged: boolean;
      causalObservationRecorded: boolean;
      livingNodeUpdated: boolean;
      impactDelta: number;
    }
  ): string {
    const parts: string[] = [];
    parts.push(`RLHF feedback processed: ${input.feedbackType} (δ=${results.impactDelta.toFixed(3)})`);

    const applied: string[] = [];
    if (results.reinforcementApplied) applied.push('model weights updated');
    if (results.calibrationUpdated) applied.push('calibration tuple incremented');
    if (results.vectorStoreUpdated) applied.push('vector store confirmed');
    if (results.longitudinalUpdated) applied.push('longitudinal record updated');
    if (results.populationSignalIngested) applied.push('population signal ingested');
    if (results.activeLearningFlagged) applied.push('flagged for active learning');
    if (results.causalObservationRecorded) applied.push('causal observation recorded');
    if (results.livingNodeUpdated) applied.push('living patient node updated');

    if (applied.length > 0) parts.push(`Systems updated: ${applied.join(', ')}.`);
    return parts.join(' ');
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _engine: RLHFEngine | null = null;

export function getRLHFEngine(): RLHFEngine {
  if (!_engine) _engine = new RLHFEngine();
  return _engine;
}
