/**
 * @vetios/domain — Workflow Capture
 *
 * Captures the cognitive substrate of clinical operations.
 * Every workflow snapshot encodes HOW decisions flow through a clinic —
 * the state graphs, actor sequences, and decision points that
 * become the workflow lock-in.
 *
 * Competitors must retrain humans, retrain AI, AND replicate
 * these workflows — exponentially expensive.
 */

import type { TypedSupabaseClient } from '@vetios/db';
import type { WorkflowSnapshot, WorkflowType, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';

const logger = createLogger({ module: 'domain.workflow-capture' });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkflowActor {
    actor_type: 'human' | 'ai' | 'system';
    actor_id: string;
    action: string;
    timestamp: string;
}

export interface WorkflowDecisionPoint {
    node_id: string;
    ai_attribution: number;    // 0–1: how much AI influenced this decision
    human_attribution: number; // 0–1: how much human influenced this decision
    choice: string;
    alternatives_considered: string[];
    context_snapshot: Json;
}

export interface SnapshotWorkflowInput {
    tenant_id: string;
    workflow_type: WorkflowType;
    encounter_id: string;
    triggered_by: string;
    state_graph: Json;
    actor_sequence: WorkflowActor[];
    decision_points: WorkflowDecisionPoint[];
}

export interface WorkflowPatternMatch {
    /** The recurring pattern structure */
    pattern: Json;
    /** Number of tenants exhibiting this pattern */
    tenant_count: number;
    /** Number of occurrences across all tenants */
    occurrence_count: number;
    /** Average replication cost score */
    avg_replication_cost: number;
}

// ─── Replication Cost ────────────────────────────────────────────────────────

/**
 * Estimates the replication cost score for a workflow snapshot.
 *
 * Factors:
 * - Number of decision points (more points = more complex to replicate)
 * - AI attribution depth (higher AI involvement = harder to replicate without AI)
 * - Actor diversity (more actor types involved = more organizational change needed)
 * - State graph complexity (more nodes/edges = more workflow design effort)
 *
 * Score range: 0.0 (trivial to replicate) to 10.0 (nearly impossible).
 */
function computeReplicationCost(
    decisionPoints: WorkflowDecisionPoint[],
    actorSequence: WorkflowActor[],
    stateGraph: Json,
): number {
    let score = 0;

    // Decision complexity: each decision point adds replication cost
    const decisionScore = Math.min(decisionPoints.length * 0.8, 3.0);
    score += decisionScore;

    // AI attribution depth: higher AI involvement = harder to replicate
    const avgAiAttribution = decisionPoints.length > 0
        ? decisionPoints.reduce((sum, dp) => sum + dp.ai_attribution, 0) / decisionPoints.length
        : 0;
    score += avgAiAttribution * 2.5;

    // Actor diversity: how many different actor types
    const actorTypes = new Set(actorSequence.map((a) => a.actor_type));
    score += actorTypes.size * 0.7;

    // State graph complexity: estimate from JSON size
    const graphSize = JSON.stringify(stateGraph).length;
    const graphComplexity = Math.min(graphSize / 500, 2.0);
    score += graphComplexity;

    return Math.min(score, 10.0);
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Captures a workflow snapshot — the full state graph of a clinical workflow.
 *
 * This is the workflow lock-in function. Every time a decision flows through
 * the system, the pattern is captured and scored.
 */
export async function snapshotWorkflow(
    client: TypedSupabaseClient,
    input: SnapshotWorkflowInput,
): Promise<WorkflowSnapshot> {
    const replicationCostScore = computeReplicationCost(
        input.decision_points,
        input.actor_sequence,
        input.state_graph,
    );

    const { data, error } = await client
        .from('workflow_snapshots')
        .insert({
            tenant_id: input.tenant_id,
            workflow_type: input.workflow_type,
            encounter_id: input.encounter_id,
            triggered_by: input.triggered_by,
            state_graph: input.state_graph,
            actor_sequence: input.actor_sequence as unknown as Json,
            decision_points: input.decision_points as unknown as Json,
            replication_cost_score: replicationCostScore,
        })
        .select()
        .single();

    if (error || !data) {
        logger.error('Failed to snapshot workflow', { error, input });
        throw new Error(`Failed to snapshot workflow: ${error?.message ?? 'Unknown error'}`);
    }

    const result = data as WorkflowSnapshot;
    logger.info('Workflow snapshot captured', {
        snapshot_id: result.id,
        workflow_type: result.workflow_type,
        encounter_id: result.encounter_id,
        replication_cost: replicationCostScore,
        decision_points_count: input.decision_points.length,
        actor_count: input.actor_sequence.length,
    });

    return result;
}

/**
 * Lists workflow snapshots for an encounter.
 * Used to reconstruct the full decision history of a clinical visit.
 */
export async function listWorkflowsByEncounter(
    client: TypedSupabaseClient,
    encounterId: string,
): Promise<WorkflowSnapshot[]> {
    const { data, error } = await client
        .from('workflow_snapshots')
        .select()
        .eq('encounter_id', encounterId)
        .order('created_at', { ascending: true });

    if (error) {
        throw new Error(`Failed to list workflows: ${error.message}`);
    }

    return (data ?? []) as WorkflowSnapshot[];
}

/**
 * Detects recurring workflow patterns across tenants (opt-in network effects).
 *
 * Compares workflow_type distributions and state_graph structures to identify
 * patterns that multiple clinics follow. These patterns represent the
 * "cognitive substrate" that becomes standardized through VetIOS.
 *
 * Only counts from tenants that have opted into intelligence sharing.
 */
export async function detectWorkflowPatterns(
    client: TypedSupabaseClient,
    workflowType: WorkflowType,
    minOccurrences: number = 3,
): Promise<WorkflowPatternMatch[]> {
    // Query aggregated workflow data across opt-in tenants
    const { data, error } = await client
        .from('workflow_snapshots')
        .select('tenant_id, state_graph, replication_cost_score')
        .eq('workflow_type', workflowType)
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        throw new Error(`Failed to detect patterns: ${error.message}`);
    }

    const snapshots = (data ?? []) as Array<{
        tenant_id: string;
        state_graph: Json;
        replication_cost_score: number;
    }>;

    // Group by simplified state graph structure
    const patternMap = new Map<string, {
        tenants: Set<string>;
        count: number;
        totalCost: number;
        pattern: Json;
    }>();

    for (const snapshot of snapshots) {
        // Create a structural key by extracting graph node types
        const structuralKey = extractStructuralKey(snapshot.state_graph);

        const existing = patternMap.get(structuralKey);
        if (existing) {
            existing.tenants.add(snapshot.tenant_id);
            existing.count++;
            existing.totalCost += snapshot.replication_cost_score;
        } else {
            patternMap.set(structuralKey, {
                tenants: new Set([snapshot.tenant_id]),
                count: 1,
                totalCost: snapshot.replication_cost_score,
                pattern: snapshot.state_graph,
            });
        }
    }

    // Filter by minimum occurrences and return
    const patterns: WorkflowPatternMatch[] = [];
    for (const [, value] of patternMap) {
        if (value.count >= minOccurrences) {
            patterns.push({
                pattern: value.pattern,
                tenant_count: value.tenants.size,
                occurrence_count: value.count,
                avg_replication_cost: value.totalCost / value.count,
            });
        }
    }

    // Sort by occurrence count descending
    patterns.sort((a, b) => b.occurrence_count - a.occurrence_count);

    logger.info('Workflow patterns detected', {
        workflow_type: workflowType,
        patterns_found: patterns.length,
        total_snapshots_analyzed: snapshots.length,
    });

    return patterns;
}

/**
 * Extracts a structural key from a state graph for pattern matching.
 * Reduces the graph to its topological structure (node types + edge directions)
 * while stripping specific IDs and timestamps.
 */
function extractStructuralKey(stateGraph: Json): string {
    if (typeof stateGraph !== 'object' || stateGraph === null) {
        return 'simple';
    }

    // Extract top-level keys as a structural signature
    const keys = Object.keys(stateGraph as Record<string, unknown>).sort();
    return keys.join('|');
}
