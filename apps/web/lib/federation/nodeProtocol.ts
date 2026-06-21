export const FEDERATION_NODE_RUNTIME_EVENTS = [
    'registered',
    'heartbeat',
    'round_plan_pulled',
    'task_started',
    'masked_update_submitted',
    'unmask_share_submitted',
    'dropout_reported',
    'round_acknowledged',
    'revoked',
] as const;

export const FEDERATION_NODE_STATUSES = [
    'pending',
    'online',
    'degraded',
    'offline',
    'revoked',
] as const;

export const FEDERATION_ROUND_NODE_TASK_TYPES = [
    'diagnosis_delta',
    'severity_delta',
    'support_summary',
    'secure_aggregation_key',
    'unmask_share',
] as const;

export const FEDERATION_ROUND_NODE_TASK_STATUSES = [
    'planned',
    'issued',
    'pulled',
    'submitted',
    'accepted',
    'rejected',
    'expired',
] as const;

export const FEDERATED_UPDATE_SUBMISSION_STATUSES = [
    'submitted',
    'accepted',
    'rejected',
    'quarantined',
] as const;

export const FEDERATION_NODE_ROUND_READINESS = [
    'ready_for_round',
    'waiting_for_task',
    'update_pending',
    'update_submitted',
    'blocked',
    'offline',
] as const;

export type FederationNodeRuntimeEvent = typeof FEDERATION_NODE_RUNTIME_EVENTS[number];
export type FederationNodeStatus = typeof FEDERATION_NODE_STATUSES[number];
export type FederationRoundNodeTaskType = typeof FEDERATION_ROUND_NODE_TASK_TYPES[number];
export type FederationRoundNodeTaskStatus = typeof FEDERATION_ROUND_NODE_TASK_STATUSES[number];
export type FederatedUpdateSubmissionStatus = typeof FEDERATED_UPDATE_SUBMISSION_STATUSES[number];
export type FederationNodeRoundReadiness = typeof FEDERATION_NODE_ROUND_READINESS[number];

export interface FederationNodeProtocolAssessmentInput {
    node_status?: FederationNodeStatus | string | null;
    runtime_event?: FederationNodeRuntimeEvent | string | null;
    last_heartbeat_at?: string | null;
    secure_aggregation_status?: string | null;
    outcome_eligibility_status?: string | null;
    task_status?: FederationRoundNodeTaskStatus | string | null;
    submission_status?: FederatedUpdateSubmissionStatus | string | null;
    blockers?: string[] | null;
    now?: Date;
}

export interface FederationNodeProtocolAssessment {
    readiness: FederationNodeRoundReadiness;
    readiness_score: number;
    blockers: string[];
    next_required_action: string | null;
    signals: {
        node_online: boolean;
        heartbeat_fresh: boolean;
        secure_aggregation_ready: boolean;
        outcome_eligible: boolean;
        task_available: boolean;
        update_submitted: boolean;
    };
}

export interface FederationNodeRuntimeEventRow {
    federation_key?: string | null;
    node_ref?: string | null;
    runtime_event?: string | null;
    node_status?: string | null;
    secure_aggregation_status?: string | null;
    outcome_eligibility_status?: string | null;
    last_heartbeat_at?: string | null;
    blockers?: string[] | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface FederationNodeProtocolSummary {
    total_nodes: number;
    ready_nodes: number;
    waiting_nodes: number;
    update_pending_nodes: number;
    update_submitted_nodes: number;
    blocked_nodes: number;
    offline_nodes: number;
    latest_signal_at: string | null;
    top_blockers: Array<{ blocker: string; count: number }>;
}

const HEARTBEAT_FRESH_HOURS = 24;

export function buildFederationNodeProtocolAssessment(
    input: FederationNodeProtocolAssessmentInput,
): FederationNodeProtocolAssessment {
    const nodeStatus = normalizeNodeStatus(input.node_status);
    const runtimeEvent = normalizeRuntimeEvent(input.runtime_event);
    const taskStatus = normalizeTaskStatus(input.task_status);
    const submissionStatus = normalizeSubmissionStatus(input.submission_status);
    const secureAggregationReady = input.secure_aggregation_status === 'ready';
    const outcomeEligible = input.outcome_eligibility_status === 'eligible';
    const heartbeatFresh = isFreshHeartbeat(input.last_heartbeat_at, input.now ?? new Date());
    const nodeOnline = nodeStatus === 'online' || nodeStatus === 'degraded';
    const taskAvailable = taskStatus === 'issued' || taskStatus === 'pulled' || taskStatus === 'submitted' || taskStatus === 'accepted';
    const updateSubmitted = runtimeEvent === 'masked_update_submitted'
        || submissionStatus === 'submitted'
        || submissionStatus === 'accepted'
        || taskStatus === 'submitted'
        || taskStatus === 'accepted';

    const blockers = new Set(normalizeBlockers(input.blockers));
    if (nodeStatus === 'revoked') blockers.add('node_revoked');
    if (!nodeOnline) blockers.add(`node_${nodeStatus}`);
    if (!heartbeatFresh) blockers.add('heartbeat_stale_or_missing');
    if (!secureAggregationReady) blockers.add('secure_aggregation_not_ready');
    if (!outcomeEligible) blockers.add('outcome_eligibility_not_ready');
    if (taskStatus === 'rejected') blockers.add('task_rejected');
    if (taskStatus === 'expired') blockers.add('task_expired');
    if (submissionStatus === 'rejected') blockers.add('submission_rejected');
    if (submissionStatus === 'quarantined') blockers.add('submission_quarantined');
    if (runtimeEvent === 'dropout_reported') blockers.add('node_dropout_reported');
    if (runtimeEvent === 'revoked') blockers.add('node_revoked');

    const readiness = resolveReadiness({
        blockers,
        nodeOnline,
        heartbeatFresh,
        secureAggregationReady,
        outcomeEligible,
        taskAvailable,
        updateSubmitted,
        runtimeEvent,
    });

    return {
        readiness,
        readiness_score: scoreReadiness({
            nodeOnline,
            heartbeatFresh,
            secureAggregationReady,
            outcomeEligible,
            taskAvailable,
            updateSubmitted,
            blockerCount: blockers.size,
        }),
        blockers: Array.from(blockers).sort(),
        next_required_action: resolveNextRequiredAction(readiness, {
            nodeOnline,
            heartbeatFresh,
            secureAggregationReady,
            outcomeEligible,
            taskAvailable,
            updateSubmitted,
        }),
        signals: {
            node_online: nodeOnline,
            heartbeat_fresh: heartbeatFresh,
            secure_aggregation_ready: secureAggregationReady,
            outcome_eligible: outcomeEligible,
            task_available: taskAvailable,
            update_submitted: updateSubmitted,
        },
    };
}

export function summarizeFederationNodeProtocolEvents(
    rows: FederationNodeRuntimeEventRow[],
): FederationNodeProtocolSummary {
    const latestRows = latestNodeRows(rows);
    const assessments = latestRows.map((row) => buildFederationNodeProtocolAssessment(row));
    const blockerCounts = new Map<string, number>();

    for (const assessment of assessments) {
        for (const blocker of assessment.blockers) {
            blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
        }
    }

    return {
        total_nodes: latestRows.length,
        ready_nodes: assessments.filter((assessment) => assessment.readiness === 'ready_for_round').length,
        waiting_nodes: assessments.filter((assessment) => assessment.readiness === 'waiting_for_task').length,
        update_pending_nodes: assessments.filter((assessment) => assessment.readiness === 'update_pending').length,
        update_submitted_nodes: assessments.filter((assessment) => assessment.readiness === 'update_submitted').length,
        blocked_nodes: assessments.filter((assessment) => assessment.readiness === 'blocked').length,
        offline_nodes: assessments.filter((assessment) => assessment.readiness === 'offline').length,
        latest_signal_at: latestIso(latestRows.map((row) => row.observed_at ?? row.created_at ?? null)),
        top_blockers: Array.from(blockerCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 10)
            .map(([blocker, count]) => ({ blocker, count })),
    };
}

export function latestNodeRows(rows: FederationNodeRuntimeEventRow[]): FederationNodeRuntimeEventRow[] {
    const latest = new Map<string, FederationNodeRuntimeEventRow>();
    for (const row of rows) {
        const key = `${row.federation_key ?? 'unknown'}:${row.node_ref ?? 'unknown'}`;
        const current = latest.get(key);
        if (!current || compareTimestamp(row, current) > 0) {
            latest.set(key, row);
        }
    }
    return Array.from(latest.values());
}

function resolveReadiness(input: {
    blockers: Set<string>;
    nodeOnline: boolean;
    heartbeatFresh: boolean;
    secureAggregationReady: boolean;
    outcomeEligible: boolean;
    taskAvailable: boolean;
    updateSubmitted: boolean;
    runtimeEvent: FederationNodeRuntimeEvent;
}): FederationNodeRoundReadiness {
    if (!input.nodeOnline || !input.heartbeatFresh) return 'offline';
    if (
        input.blockers.has('node_revoked')
        || input.blockers.has('task_rejected')
        || input.blockers.has('task_expired')
        || input.blockers.has('submission_rejected')
        || input.blockers.has('submission_quarantined')
        || input.blockers.has('node_dropout_reported')
    ) {
        return 'blocked';
    }
    if (!input.secureAggregationReady || !input.outcomeEligible) return 'blocked';
    if (input.updateSubmitted) return 'update_submitted';
    if (input.taskAvailable) return 'update_pending';
    return 'waiting_for_task';
}

function resolveNextRequiredAction(
    readiness: FederationNodeRoundReadiness,
    signals: {
        nodeOnline: boolean;
        heartbeatFresh: boolean;
        secureAggregationReady: boolean;
        outcomeEligible: boolean;
        taskAvailable: boolean;
        updateSubmitted: boolean;
    },
): string | null {
    if (readiness === 'offline') return 'restore_node_heartbeat';
    if (!signals.secureAggregationReady) return 'register_secure_aggregation_keys';
    if (!signals.outcomeEligible) return 'publish_federated_outcome_eligibility_snapshot';
    if (readiness === 'waiting_for_task') return 'issue_round_node_task';
    if (readiness === 'update_pending') return 'submit_masked_update';
    if (readiness === 'update_submitted') return 'await_coordinator_acceptance';
    if (readiness === 'blocked') return 'resolve_node_protocol_blockers';
    return null;
}

function scoreReadiness(input: {
    nodeOnline: boolean;
    heartbeatFresh: boolean;
    secureAggregationReady: boolean;
    outcomeEligible: boolean;
    taskAvailable: boolean;
    updateSubmitted: boolean;
    blockerCount: number;
}): number {
    let score = 0;
    if (input.nodeOnline) score += 0.18;
    if (input.heartbeatFresh) score += 0.18;
    if (input.secureAggregationReady) score += 0.2;
    if (input.outcomeEligible) score += 0.2;
    if (input.taskAvailable) score += 0.12;
    if (input.updateSubmitted) score += 0.12;
    if (input.blockerCount > 0) score = Math.min(score, 0.69);
    return Math.round(Math.max(0, Math.min(1, score)) * 10_000) / 10_000;
}

function isFreshHeartbeat(value: string | null | undefined, now: Date): boolean {
    if (!value) return false;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return false;
    return now.getTime() - parsed.getTime() <= HEARTBEAT_FRESH_HOURS * 60 * 60 * 1000;
}

function normalizeRuntimeEvent(value: unknown): FederationNodeRuntimeEvent {
    return FEDERATION_NODE_RUNTIME_EVENTS.includes(value as FederationNodeRuntimeEvent)
        ? value as FederationNodeRuntimeEvent
        : 'registered';
}

function normalizeNodeStatus(value: unknown): FederationNodeStatus {
    return FEDERATION_NODE_STATUSES.includes(value as FederationNodeStatus)
        ? value as FederationNodeStatus
        : 'pending';
}

function normalizeTaskStatus(value: unknown): FederationRoundNodeTaskStatus {
    return FEDERATION_ROUND_NODE_TASK_STATUSES.includes(value as FederationRoundNodeTaskStatus)
        ? value as FederationRoundNodeTaskStatus
        : 'planned';
}

function normalizeSubmissionStatus(value: unknown): FederatedUpdateSubmissionStatus | null {
    return FEDERATED_UPDATE_SUBMISSION_STATUSES.includes(value as FederatedUpdateSubmissionStatus)
        ? value as FederatedUpdateSubmissionStatus
        : null;
}

function normalizeBlockers(value: string[] | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_') : '')
        .filter(Boolean)));
}

function latestIso(values: Array<string | null | undefined>): string | null {
    return values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function compareTimestamp(left: FederationNodeRuntimeEventRow, right: FederationNodeRuntimeEventRow): number {
    const leftTime = Date.parse(left.observed_at ?? left.created_at ?? '');
    const rightTime = Date.parse(right.observed_at ?? right.created_at ?? '');
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}
