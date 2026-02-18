/**
 * @vetios/ai-core — Feedback Loop Engine
 *
 * Closes the Decision → Outcome → Learning cycle.
 * Every AI decision is scored against its real-world outcome,
 * producing intelligence metrics that feed model improvement.
 *
 * Cross-tenant intelligence is opt-in only — only derived signals
 * (scores, rates, correlations) are aggregated, never raw data.
 *
 * This is the engine behind Thiel's "last mover advantage":
 * once the intelligence layer is entrenched, replacement is
 * nearly impossible.
 */

import type { TypedSupabaseClient } from '@vetios/db';
import type {
    IntelligenceMetric,
    IntelligenceMetricType,
    AIDecisionLog,
    Override,
    Outcome,
    Json,
} from '@vetios/db';
import { createLogger } from '@vetios/logger';

const logger = createLogger({ module: 'ai-core.feedback-loop' });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecisionScoreResult {
    /** The scored decision */
    decision_id: string;
    /** Overall quality score (0–1) */
    quality_score: number;
    /** Was the decision overridden? */
    was_overridden: boolean;
    /** Override action (if overridden) */
    override_action: string | null;
    /** Number of linked outcomes */
    outcome_count: number;
    /** Positive outcome ratio */
    positive_outcome_ratio: number;
    /** Generated feedback signal for model tuning */
    feedback_signal: Json;
}

export interface NetworkIntelligence {
    /** Total opt-in tenants contributing */
    contributing_tenant_count: number;
    /** Average prediction accuracy across the network */
    network_prediction_accuracy: number;
    /** Average override rate across the network */
    network_override_rate: number;
    /** Average decision quality across the network */
    network_decision_quality: number;
    /** Model version performance ranking */
    model_rankings: Array<{
        model_version: string;
        avg_score: number;
        sample_size: number;
    }>;
}

// ─── Decision Scoring ────────────────────────────────────────────────────────

/**
 * Scores an AI decision by correlating it with its real-world outcomes
 * and any human overrides.
 *
 * This closes the learning loop:
 *   AI Decision → Human Override (optional) → Clinical Outcome → Score
 *
 * The score is stored as an intelligence metric for future model improvement.
 */
export async function scoreDecision(
    client: TypedSupabaseClient,
    decisionId: string,
    tenantId: string,
    intelligenceSharingOptedIn: boolean = false,
): Promise<DecisionScoreResult> {
    // Fetch the decision
    const { data: decision, error: decisionError } = await client
        .from('ai_decision_logs')
        .select()
        .eq('id', decisionId)
        .single();

    if (decisionError || !decision) {
        throw new Error(`Decision not found: ${decisionId}`);
    }

    const decisionRow = decision as AIDecisionLog;

    // Fetch overrides for this decision
    const { data: overrides } = await client
        .from('overrides')
        .select()
        .eq('decision_id', decisionId);

    const overrideList = (overrides ?? []) as Override[];
    const wasOverridden = overrideList.length > 0;
    const overrideAction = wasOverridden ? overrideList[0]!.action : null;

    // Fetch outcomes linked to this decision
    const { data: outcomes } = await client
        .from('outcomes')
        .select()
        .eq('decision_id', decisionId);

    const outcomeList = (outcomes ?? []) as Outcome[];
    const outcomeCount = outcomeList.length;

    // Compute quality score
    let qualityScore = 0.5; // Base score

    // Override signals
    if (!wasOverridden) {
        qualityScore += 0.2; // Accepted as-is = good signal
    } else if (overrideAction === 'modified') {
        qualityScore += 0.05; // Partially useful
    } else if (overrideAction === 'rejected') {
        qualityScore -= 0.3; // Rejected = negative signal
    }

    // Outcome signals
    const positiveOutcomes = outcomeList.filter((o) => {
        const result = o.result as Record<string, unknown>;
        return result?.status === 'improved' || result?.status === 'resolved';
    });
    const positiveRatio = outcomeCount > 0 ? positiveOutcomes.length / outcomeCount : 0.5;
    qualityScore += (positiveRatio - 0.5) * 0.4;

    // Clamp to [0, 1]
    qualityScore = Math.max(0, Math.min(1, qualityScore));

    // Build feedback signal for model tuning
    const feedbackSignal: Record<string, unknown> = {
        decision_id: decisionId,
        model_version: decisionRow.model_version,
        quality_score: qualityScore,
        was_overridden: wasOverridden,
        override_action: overrideAction,
        positive_outcome_ratio: positiveRatio,
        outcome_count: outcomeCount,
        latency_ms: decisionRow.latency_ms,
        // Derived learning signal — NOT raw data
        learning_direction: qualityScore > 0.7 ? 'reinforce' : qualityScore < 0.3 ? 'correct' : 'neutral',
    };

    // Persist as intelligence metric
    await emitFeedbackSignal(client, {
        tenant_id: tenantId,
        metric_type: 'decision_quality',
        decision_id: decisionId,
        encounter_id: decisionRow.encounter_id,
        score: qualityScore,
        feedback_signal: feedbackSignal as Json,
        intelligence_sharing_opted_in: intelligenceSharingOptedIn,
        model_version: decisionRow.model_version,
    });

    logger.info('Decision scored', {
        decision_id: decisionId,
        quality_score: qualityScore,
        was_overridden: wasOverridden,
        outcome_count: outcomeCount,
        positive_ratio: positiveRatio,
    });

    return {
        decision_id: decisionId,
        quality_score: qualityScore,
        was_overridden: wasOverridden,
        override_action: overrideAction,
        outcome_count: outcomeCount,
        positive_outcome_ratio: positiveRatio,
        feedback_signal: feedbackSignal as Json,
    };
}

// ─── Intelligence Metrics ────────────────────────────────────────────────────

interface EmitFeedbackInput {
    tenant_id: string;
    metric_type: IntelligenceMetricType;
    decision_id?: string;
    encounter_id?: string;
    score: number;
    feedback_signal: Json;
    intelligence_sharing_opted_in: boolean;
    model_version?: string;
    window_start?: string;
    window_end?: string;
}

/**
 * Emits a feedback signal — writes an intelligence metric to the database.
 * These metrics feed future model improvements and network intelligence.
 */
export async function emitFeedbackSignal(
    client: TypedSupabaseClient,
    input: EmitFeedbackInput,
): Promise<IntelligenceMetric> {
    const { data, error } = await client
        .from('intelligence_metrics')
        .insert({
            tenant_id: input.tenant_id,
            metric_type: input.metric_type,
            decision_id: input.decision_id ?? null,
            encounter_id: input.encounter_id ?? null,
            score: input.score,
            feedback_signal: input.feedback_signal,
            intelligence_sharing_opted_in: input.intelligence_sharing_opted_in,
            model_version: input.model_version ?? null,
            window_start: input.window_start ?? null,
            window_end: input.window_end ?? null,
        })
        .select()
        .single();

    if (error || !data) {
        logger.error('Failed to emit feedback signal', { error, input });
        throw new Error(`Failed to emit feedback signal: ${error?.message ?? 'Unknown error'}`);
    }

    return data as IntelligenceMetric;
}

// ─── Network Intelligence ────────────────────────────────────────────────────

/**
 * Aggregates cross-tenant intelligence from opt-in tenants.
 *
 * CRITICAL: Only derived signals are aggregated — NEVER raw clinical data.
 * This computes network-level statistics from the intelligence_metrics table
 * where intelligence_sharing_opted_in = true.
 *
 * This is the network effect engine: more clinics → better aggregate intelligence
 * → better predictions for everyone → more clinics join.
 */
export async function computeNetworkIntelligence(
    client: TypedSupabaseClient,
): Promise<NetworkIntelligence> {
    // Fetch opt-in metrics only
    const { data: metrics, error } = await client
        .from('intelligence_metrics')
        .select('tenant_id, metric_type, score, model_version')
        .eq('intelligence_sharing_opted_in', true)
        .order('created_at', { ascending: false })
        .limit(5000);

    if (error) {
        throw new Error(`Failed to compute network intelligence: ${error.message}`);
    }

    const allMetrics = (metrics ?? []) as Array<{
        tenant_id: string;
        metric_type: IntelligenceMetricType;
        score: number;
        model_version: string | null;
    }>;

    // Unique contributing tenants
    const tenants = new Set(allMetrics.map((m) => m.tenant_id));

    // Average scores by metric type
    const byType = new Map<IntelligenceMetricType, number[]>();
    for (const m of allMetrics) {
        const existing = byType.get(m.metric_type) ?? [];
        existing.push(m.score);
        byType.set(m.metric_type, existing);
    }

    const avgOf = (arr: number[]): number =>
        arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    // Model rankings
    const modelScores = new Map<string, number[]>();
    for (const m of allMetrics) {
        if (m.model_version && m.metric_type === 'decision_quality') {
            const existing = modelScores.get(m.model_version) ?? [];
            existing.push(m.score);
            modelScores.set(m.model_version, existing);
        }
    }

    const modelRankings = Array.from(modelScores.entries())
        .map(([version, scores]) => ({
            model_version: version,
            avg_score: avgOf(scores),
            sample_size: scores.length,
        }))
        .sort((a, b) => b.avg_score - a.avg_score);

    const result: NetworkIntelligence = {
        contributing_tenant_count: tenants.size,
        network_prediction_accuracy: avgOf(byType.get('prediction_accuracy') ?? []),
        network_override_rate: avgOf(byType.get('override_rate') ?? []),
        network_decision_quality: avgOf(byType.get('decision_quality') ?? []),
        model_rankings: modelRankings,
    };

    logger.info('Network intelligence computed', {
        contributing_tenants: result.contributing_tenant_count,
        prediction_accuracy: result.network_prediction_accuracy,
        override_rate: result.network_override_rate,
        decision_quality: result.network_decision_quality,
        models_ranked: modelRankings.length,
    });

    return result;
}
