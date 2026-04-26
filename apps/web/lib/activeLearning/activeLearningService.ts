/**
 * VetIOS Active Learning Pipeline
 *
 * The system identifies its own uncertainty and actively routes ambiguous cases
 * to vets for labelling — improving fastest on its weakest diagnostic points.
 *
 * Strategy: uncertainty sampling + diversity sampling + rare-disease prioritisation.
 * The system asks for labels on cases where it would learn the most,
 * not just cases that are easiest to label.
 */

import { getSupabaseServer } from '@/lib/supabaseServer';

// ─── Types ───────────────────────────────────────────────────

export type ActiveLearningStrategy =
  | 'uncertainty'          // lowest confidence → highest learning value
  | 'margin'              // smallest margin between top-2 differentials
  | 'entropy'             // highest entropy across differential distribution
  | 'rare_disease'        // underrepresented (species, diagnosis) tuples
  | 'correction_cluster'; // near cases that were previously mis-predicted

export type ReviewPriority = 'critical' | 'high' | 'medium' | 'low';

export interface ActiveLearningCase {
  id: string;
  inferenceEventId: string;
  tenantId: string;
  species: string;
  breed: string | null;
  predictedDiagnosis: string | null;
  predictedConfidence: number;
  differentialEntropy: number;
  uncertaintyScore: number;
  strategy: ActiveLearningStrategy;
  priority: ReviewPriority;
  reason: string;
  status: 'pending_review' | 'reviewed' | 'skipped' | 'auto_resolved';
  assignedTo: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ActiveLearningQueueStats {
  totalPending: number;
  byPriority: Record<ReviewPriority, number>;
  bySpecies: Record<string, number>;
  byStrategy: Record<ActiveLearningStrategy, number>;
  estimatedLearningGain: number;  // 0-1 score of how much labelling these cases would improve the model
  oldestPendingDays: number;
}

export interface CasePrioritisation {
  cases: ActiveLearningCase[];
  stats: ActiveLearningQueueStats;
  topRecommendation: string;
}

// ─── Entropy Calculator ───────────────────────────────────────

function computeDifferentialEntropy(probabilities: number[]): number {
  if (probabilities.length === 0) return 0;
  const sum = probabilities.reduce((s, p) => s + p, 0);
  const normalised = sum > 0 ? probabilities.map((p) => p / sum) : probabilities;
  return -normalised.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);
}

function computeMarginScore(topTwoProbabilities: [number, number]): number {
  return 1 - (topTwoProbabilities[0] - topTwoProbabilities[1]);
}

// ─── Active Learning Service ──────────────────────────────────

export class ActiveLearningService {
  private supabase = getSupabaseServer();

  /**
   * Evaluate a new inference result and decide whether to enqueue
   * it for active learning review.
   *
   * Called after every inference — low overhead path.
   */
  async evaluateForQueue(params: {
    inferenceEventId: string;
    tenantId: string;
    species: string;
    breed?: string | null;
    predictedDiagnosis: string | null;
    confidence: number;
    differentialProbabilities: number[];
  }): Promise<{ enqueued: boolean; reason?: string; priority?: ReviewPriority }> {
    const { inferenceEventId, tenantId, species, breed, predictedDiagnosis, confidence, differentialProbabilities } = params;

    const entropy = computeDifferentialEntropy(differentialProbabilities);
    const uncertaintyScore = 1 - confidence;

    // ── Strategy selection ──
    let strategy: ActiveLearningStrategy | null = null;
    let reason = '';
    let priority: ReviewPriority = 'low';

    // Uncertainty threshold: < 55% confidence → high learning value
    if (confidence < 0.45) {
      strategy = 'uncertainty';
      reason = `Very low confidence (${(confidence * 100).toFixed(0)}%) — model is uncertain`;
      priority = confidence < 0.25 ? 'critical' : 'high';
    } else if (confidence < 0.55) {
      strategy = 'uncertainty';
      reason = `Low confidence (${(confidence * 100).toFixed(0)}%) — review recommended`;
      priority = 'medium';
    }

    // High entropy (many plausible differentials with similar probability)
    if (!strategy && entropy > 2.5) {
      strategy = 'entropy';
      reason = `High differential entropy (H=${entropy.toFixed(2)}) — multiple diagnoses equally plausible`;
      priority = entropy > 3.0 ? 'high' : 'medium';
    }

    // Tight margin between top-2 differentials
    if (!strategy && differentialProbabilities.length >= 2) {
      const margin = computeMarginScore([differentialProbabilities[0], differentialProbabilities[1]]);
      if (margin > 0.8) {
        strategy = 'margin';
        reason = `Tight differential margin (${(margin * 100).toFixed(0)}%) — top two diagnoses nearly indistinguishable`;
        priority = 'medium';
      }
    }

    // Rare disease check: check if (species, diagnosis) is underrepresented
    if (!strategy && predictedDiagnosis) {
      const isRare = await this.isRareDiagnosisTuple(species, predictedDiagnosis);
      if (isRare) {
        strategy = 'rare_disease';
        reason = `Rare or underrepresented diagnosis tuple: ${species} + ${predictedDiagnosis}`;
        priority = 'high';
      }
    }

    if (!strategy) return { enqueued: false };

    // ── Enqueue ──
    const { error } = await this.supabase.from('active_learning_queue').insert({
      inference_event_id: inferenceEventId,
      tenant_id: tenantId,
      species,
      breed: breed ?? null,
      predicted_diagnosis: predictedDiagnosis,
      predicted_confidence: confidence,
      uncertainty_score: uncertaintyScore,
      differential_entropy: entropy,
      strategy,
      priority,
      reason,
      status: 'pending_review',
      assigned_to: null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error('ActiveLearning enqueue failed:', error.message);
      return { enqueued: false };
    }

    return { enqueued: true, reason, priority };
  }

  /**
   * Get the prioritised active learning queue for a tenant.
   * Returns cases sorted by learning value (not just recency).
   */
  async getPrioritisedQueue(
    tenantId: string,
    limit = 20
  ): Promise<CasePrioritisation> {
    const { data, error } = await this.supabase
      .from('active_learning_queue')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_review')
      .order('priority', { ascending: true })     // critical first
      .order('uncertainty_score', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`ActiveLearning getPrioritisedQueue failed: ${error.message}`);

    const cases = this.mapRows(data ?? []);
    const stats = this.computeStats(cases);
    const topRecommendation = this.buildTopRecommendation(cases, stats);

    return { cases, stats, topRecommendation };
  }

  /**
   * Mark a queued case as reviewed with the vet's label.
   * Triggers RLHF via the feedback endpoint.
   */
  async markReviewed(
    caseId: string,
    confirmedDiagnosis: string,
    vetId: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('active_learning_queue')
      .update({
        status: 'reviewed',
        assigned_to: vetId,
        confirmed_diagnosis: confirmedDiagnosis,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', caseId);

    if (error) throw new Error(`ActiveLearning markReviewed failed: ${error.message}`);
  }

  /**
   * Compute queue-wide statistics for the operator dashboard.
   */
  async getQueueStats(tenantId: string): Promise<ActiveLearningQueueStats> {
    const { data } = await this.supabase
      .from('active_learning_queue')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_review');

    return this.computeStats(this.mapRows(data ?? []));
  }

  // ─── Private Helpers ─────────────────────────────────────

  private async isRareDiagnosisTuple(species: string, diagnosis: string): Promise<boolean> {
    const { count } = await this.supabase
      .from('vet_case_vectors')
      .select('*', { count: 'exact', head: true })
      .eq('species', species)
      .ilike('diagnosis', `%${diagnosis}%`);

    return (count ?? 0) < 5; // fewer than 5 examples = rare
  }

  private mapRows(rows: Record<string, unknown>[]): ActiveLearningCase[] {
    return rows.map((r) => ({
      id: String(r.id ?? ''),
      inferenceEventId: String(r.inference_event_id ?? ''),
      tenantId: String(r.tenant_id ?? ''),
      species: String(r.species ?? ''),
      breed: r.breed ? String(r.breed) : null,
      predictedDiagnosis: r.predicted_diagnosis ? String(r.predicted_diagnosis) : null,
      predictedConfidence: Number(r.predicted_confidence ?? 0),
      differentialEntropy: Number(r.differential_entropy ?? 0),
      uncertaintyScore: Number(r.uncertainty_score ?? 0),
      strategy: (r.strategy ?? 'uncertainty') as ActiveLearningStrategy,
      priority: (r.priority ?? 'low') as ReviewPriority,
      reason: String(r.reason ?? ''),
      status: (r.status ?? 'pending_review') as ActiveLearningCase['status'],
      assignedTo: r.assigned_to ? String(r.assigned_to) : null,
      createdAt: String(r.created_at ?? ''),
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    }));
  }

  private computeStats(cases: ActiveLearningCase[]): ActiveLearningQueueStats {
    const byPriority: Record<ReviewPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const bySpecies: Record<string, number> = {};
    const byStrategy: Record<ActiveLearningStrategy, number> = {
      uncertainty: 0, margin: 0, entropy: 0, rare_disease: 0, correction_cluster: 0,
    };

    let oldestTimestamp = Date.now();

    for (const c of cases) {
      byPriority[c.priority]++;
      bySpecies[c.species] = (bySpecies[c.species] ?? 0) + 1;
      byStrategy[c.strategy]++;
      const ts = new Date(c.createdAt).getTime();
      if (ts < oldestTimestamp) oldestTimestamp = ts;
    }

    const estimatedLearningGain = cases.length > 0
      ? Math.min(1, cases.reduce((s, c) => s + c.uncertaintyScore, 0) / cases.length)
      : 0;

    const oldestPendingDays = cases.length > 0
      ? Math.floor((Date.now() - oldestTimestamp) / 86400000)
      : 0;

    return {
      totalPending: cases.length,
      byPriority,
      bySpecies,
      byStrategy,
      estimatedLearningGain,
      oldestPendingDays,
    };
  }

  private buildTopRecommendation(cases: ActiveLearningCase[], stats: ActiveLearningQueueStats): string {
    if (cases.length === 0) return 'Active learning queue is empty. Great work — model uncertainty is low.';

    const critical = stats.byPriority.critical;
    const high = stats.byPriority.high;

    if (critical > 0) {
      return `Review ${critical} CRITICAL case${critical !== 1 ? 's' : ''} immediately — these represent the highest model uncertainty and learning value.`;
    }
    if (high > 0) {
      return `${high} high-priority case${high !== 1 ? 's' : ''} pending review. Labelling these would improve model accuracy on its weakest diagnostic gaps.`;
    }
    return `${cases.length} medium/low priority cases pending. Consider batch review to improve model coverage.`;
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _service: ActiveLearningService | null = null;

export function getActiveLearningService(): ActiveLearningService {
  if (!_service) _service = new ActiveLearningService();
  return _service;
}
