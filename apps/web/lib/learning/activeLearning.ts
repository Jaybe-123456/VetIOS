/**
 * Active Learning Pipeline — Phase 5
 *
 * Identifies inference events where the model is most uncertain, then
 * queues them for expert human review. This turns RLHF into a continuous
 * compounding loop rather than a passive one: the system learns fastest
 * from the cases it is most uncertain about.
 *
 * Strategy:
 *   1. Uncertainty sampling — cases where top-1 probability is lowest
 *   2. Disagreement sampling — cases where top-2 and top-3 are close
 *   3. Error cluster priority — cases matching known failure signatures
 *   4. Novel signal detection — cases with unseen feature combinations
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_INFERENCE_EVENTS, OUTCOME_INFERENCES } from '@/lib/db/schemaContracts';

export interface ActiveLearningCandidate {
    inference_event_id: string;
    tenant_id: string;
    uncertainty_score: number;       // 0-1, higher = more uncertain
    disagreement_score: number;      // margin between top-1 and top-2 probability
    matches_error_cluster: boolean;
    selection_reason: 'uncertainty' | 'disagreement' | 'error_cluster' | 'novel_signal';
    species: string | null;
    predicted_diagnosis: string | null;
    top_confidence: number | null;
    created_at: string;
}

export interface ActiveLearningQueueResult {
    candidates_identified: number;
    candidates_queued: number;
    skipped_already_reviewed: number;
    queue_depth: number;
}

export interface ActiveLearningConfig {
    uncertainty_threshold: number;   // Queue if top-1 probability < this (default 0.55)
    disagreement_threshold: number;  // Queue if top-1 minus top-2 < this (default 0.15)
    batch_size: number;              // Max candidates per run (default 50)
    lookback_hours: number;          // How far back to scan (default 24)
    min_confidence_for_skip: number; // Skip if already highly confident (default 0.85)
}

const DEFAULT_CONFIG: ActiveLearningConfig = {
    uncertainty_threshold: 0.55,
    disagreement_threshold: 0.15,
    batch_size: 50,
    lookback_hours: 24,
    min_confidence_for_skip: 0.85,
};

/**
 * Main entry point — scans recent inferences and identifies active learning candidates.
 * Called by the learning scheduler or on-demand via API.
 */
export async function runActiveLearningCycle(
    client: SupabaseClient,
    tenantId: string,
    config: Partial<ActiveLearningConfig> = {}
): Promise<ActiveLearningQueueResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const lookbackFrom = new Date(Date.now() - cfg.lookback_hours * 3600 * 1000).toISOString();

    // 1. Fetch recent inference events without confirmed outcomes
    const { data: inferences, error } = await client
        .from(AI_INFERENCE_EVENTS.TABLE)
        .select(`
            id,
            tenant_id,
            created_at,
            output_payload,
            input_signature
        `)
        .eq(AI_INFERENCE_EVENTS.COLUMNS.tenant_id, tenantId)
        .gte('created_at', lookbackFrom)
        .limit(cfg.batch_size * 3) // Oversample to account for filtering
        .order('created_at', { ascending: false });

    if (error || !inferences) {
        console.error('[ActiveLearning] Failed to fetch inferences:', error);
        return { candidates_identified: 0, candidates_queued: 0, skipped_already_reviewed: 0, queue_depth: 0 };
    }

    // 2. Fetch already-reviewed inference IDs
    const { data: reviewed } = await client
        .from(OUTCOME_INFERENCES.TABLE)
        .select('inference_event_id')
        .eq('tenant_id', tenantId)
        .in('inference_event_id', inferences.map(i => i.id));

    const reviewedIds = new Set((reviewed ?? []).map((r: Record<string, string>) => r.inference_event_id));

    // 3. Fetch known error cluster signatures
    const { data: errorClusters } = await client
        .from('error_clusters')
        .select('cluster_signature, frequency')
        .eq('tenant_id', tenantId)
        .gte('frequency', 3)
        .order('frequency', { ascending: false })
        .limit(20);

    const highFreqClusters = new Set((errorClusters ?? []).map((c: Record<string, string>) => c.cluster_signature));

    // 4. Score and select candidates
    const candidates: ActiveLearningCandidate[] = [];
    let skipped = 0;

    for (const inference of inferences) {
        if (reviewedIds.has(inference.id)) { skipped++; continue; }

        const output = inference.output_payload as Record<string, unknown> ?? {};
        const diagnosis = output['diagnosis'] as Record<string, unknown> ?? {};
        const topDiffs = (diagnosis['top_differentials'] as Array<Record<string, unknown>>) ?? [];

        const top1Prob = (topDiffs[0]?.['probability'] as number) ?? 0;
        const top2Prob = (topDiffs[1]?.['probability'] as number) ?? 0;
        const top1Name = (topDiffs[0]?.['disease'] as string) ?? null;

        // Skip highly confident correct predictions
        if (top1Prob >= cfg.min_confidence_for_skip) continue;

        const uncertaintyScore = 1 - top1Prob;
        const disagreementScore = top1Prob - top2Prob;
        const isUncertain = top1Prob < cfg.uncertainty_threshold;
        const isDisagreement = disagreementScore < cfg.disagreement_threshold && top2Prob > 0;

        // Check error cluster match
        const inputSig = inference.input_signature as Record<string, unknown> ?? {};
        const species = (inputSig['species'] as string) ?? null;
        const clusterSig = `${top1Name ?? 'UNKNOWN'} misclassified`;
        const matchesCluster = [...highFreqClusters].some(sig => sig.includes(top1Name ?? ''));

        if (!isUncertain && !isDisagreement && !matchesCluster) continue;

        const reason: ActiveLearningCandidate['selection_reason'] =
            matchesCluster ? 'error_cluster' :
            isDisagreement ? 'disagreement' : 'uncertainty';

        candidates.push({
            inference_event_id: inference.id,
            tenant_id: tenantId,
            uncertainty_score: uncertaintyScore,
            disagreement_score: disagreementScore,
            matches_error_cluster: matchesCluster,
            selection_reason: reason,
            species,
            predicted_diagnosis: top1Name,
            top_confidence: top1Prob,
            created_at: inference.created_at as string,
        });

        if (candidates.length >= cfg.batch_size) break;
    }

    // 5. Persist to active_learning_queue
    let queued = 0;
    if (candidates.length > 0) {
        const { data: inserted, error: insertError } = await client
            .from('active_learning_queue')
            .upsert(
                candidates.map(c => ({
                    inference_event_id: c.inference_event_id,
                    tenant_id: c.tenant_id,
                    uncertainty_score: c.uncertainty_score,
                    disagreement_score: c.disagreement_score,
                    matches_error_cluster: c.matches_error_cluster,
                    selection_reason: c.selection_reason,
                    species: c.species,
                    predicted_diagnosis: c.predicted_diagnosis,
                    top_confidence: c.top_confidence,
                    status: 'pending',
                    created_at: new Date().toISOString(),
                })),
                { onConflict: 'inference_event_id', ignoreDuplicates: true }
            )
            .select('id');

        if (!insertError && inserted) queued = inserted.length;
    }

    // 6. Get current queue depth
    const { count: queueDepth } = await client
        .from('active_learning_queue')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending');

    return {
        candidates_identified: candidates.length,
        candidates_queued: queued,
        skipped_already_reviewed: skipped,
        queue_depth: queueDepth ?? 0,
    };
}

/**
 * Fetches the top N pending active learning candidates for the review UI.
 */
export async function getActiveLearningQueue(
    client: SupabaseClient,
    tenantId: string,
    limit = 20
): Promise<ActiveLearningCandidate[]> {
    const { data, error } = await client
        .from('active_learning_queue')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('uncertainty_score', { ascending: false })
        .limit(limit);

    if (error || !data) return [];
    return data as ActiveLearningCandidate[];
}

/**
 * Marks a queued case as reviewed after a vet provides the confirmed diagnosis.
 * This triggers the RLHF reinforcement route.
 */
export async function markActiveLearningReviewed(
    client: SupabaseClient,
    inferenceEventId: string,
    tenantId: string,
    reviewedBy: string
): Promise<void> {
    await client
        .from('active_learning_queue')
        .update({
            status: 'reviewed',
            reviewed_by: reviewedBy,
            reviewed_at: new Date().toISOString(),
        })
        .eq('inference_event_id', inferenceEventId)
        .eq('tenant_id', tenantId);
}

/**
 * Returns summary statistics for the active learning pipeline.
 */
export async function getActiveLearningStats(
    client: SupabaseClient,
    tenantId: string
): Promise<{
    pending: number;
    reviewed_today: number;
    reviewed_total: number;
    avg_uncertainty: number;
    top_failure_reason: string | null;
}> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [pending, reviewedToday, reviewedTotal, avgUncertainty] = await Promise.all([
        client.from('active_learning_queue').select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId).eq('status', 'pending'),
        client.from('active_learning_queue').select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId).eq('status', 'reviewed').gte('reviewed_at', today.toISOString()),
        client.from('active_learning_queue').select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId).eq('status', 'reviewed'),
        client.from('active_learning_queue').select('uncertainty_score')
            .eq('tenant_id', tenantId).eq('status', 'pending').limit(100),
    ]);

    const scores = (avgUncertainty.data ?? []).map((r: Record<string, number>) => r.uncertainty_score);
    const avg = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;

    // Most common selection reason
    const { data: reasons } = await client
        .from('active_learning_queue')
        .select('selection_reason')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .limit(200);

    const reasonCounts: Record<string, number> = {};
    for (const r of (reasons ?? [])) {
        const reason = (r as Record<string, string>)['selection_reason'];
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
        pending: pending.count ?? 0,
        reviewed_today: reviewedToday.count ?? 0,
        reviewed_total: reviewedTotal.count ?? 0,
        avg_uncertainty: Math.round(avg * 100) / 100,
        top_failure_reason: topReason,
    };
}
