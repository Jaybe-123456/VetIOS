import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    FEDERATED_UPDATE_SUBMISSIONS,
    FEDERATION_MEMBERSHIPS,
    FEDERATION_NODE_RUNTIME_EVENTS as FEDERATION_NODE_RUNTIME_EVENT_TABLE,
    FEDERATION_ROUND_NODE_TASKS,
    FEDERATION_ROUNDS,
} from '@/lib/db/schemaContracts';
import {
    buildFederationNodeAttestationAssessment,
    loadLatestFederationNodeAttestation,
    type FederationNodeAttestationAssessment,
    type FederationNodeAttestationRow,
} from '@/lib/federation/nodeAttestation';
import {
    buildFederationNodeProtocolAssessment,
    type FederationNodeRuntimeEvent,
    type FederationNodeStatus,
    type FederationRoundNodeTaskStatus,
    type FederationRoundNodeTaskType,
} from '@/lib/federation/nodeProtocol';

export const FEDERATION_NODE_KINDS = [
    'clinic',
    'reference_lab',
    'university',
    'ngo',
    'government',
    'public_health',
    'research_network',
    'sandbox',
] as const;

export const FEDERATION_NODE_ENVIRONMENTS = ['sandbox', 'staging', 'production'] as const;
export const SECURE_AGGREGATION_STATUSES = ['not_ready', 'keys_registered', 'masking_ready', 'ready'] as const;
export const OUTCOME_ELIGIBILITY_STATUSES = ['eligible', 'insufficient_evidence', 'blocked', 'expired'] as const;
export const FEDERATED_UPDATE_ROLES = ['diagnosis', 'severity', 'support', 'unmask_share'] as const;

export type FederationNodeKind = typeof FEDERATION_NODE_KINDS[number];
export type FederationNodeEnvironment = typeof FEDERATION_NODE_ENVIRONMENTS[number];
export type SecureAggregationStatus = typeof SECURE_AGGREGATION_STATUSES[number];
export type OutcomeEligibilityStatus = typeof OUTCOME_ELIGIBILITY_STATUSES[number];
export type FederatedUpdateRole = typeof FEDERATED_UPDATE_ROLES[number];

export interface FederationNodeIdentity {
    tenantId: string;
    federationKey: string;
    nodeRef: string;
    partnerRef: string;
}

export interface FederationNodeRuntimeInput {
    federationKey: string;
    nodeRef: string;
    partnerRef?: string | null;
    requestId?: string | null;
    federationRoundId?: string | null;
    outcomeEligibilitySnapshotId?: string | null;
    runtimeEvent?: FederationNodeRuntimeEvent;
    nodeStatus?: FederationNodeStatus;
    nodeKind?: FederationNodeKind;
    deploymentEnvironment?: FederationNodeEnvironment;
    softwareVersion?: string | null;
    secureAggregationStatus?: SecureAggregationStatus;
    outcomeEligibilityStatus?: OutcomeEligibilityStatus;
    lastHeartbeatAt?: string | null;
    blockers?: string[] | null;
    evidence?: Record<string, unknown> | null;
    observedAt?: string | null;
}

export interface FederatedUpdateSubmissionInput {
    requestId?: string | null;
    nodeRef: string;
    partnerRef?: string | null;
    roundNodeTaskId?: string | null;
    outcomeEligibilitySnapshotId?: string | null;
    contributionRole?: FederatedUpdateRole | null;
    maskingProtocol?: string | null;
    payloadCommitmentHash: string;
    maskCommitmentHash?: string | null;
    signedPayloadHash?: string | null;
    signatureAlgorithm?: string | null;
    signatureHash?: string | null;
    signingKeyFingerprint?: string | null;
    maskedUpdateSummary?: Record<string, unknown> | null;
    publicSummary?: Record<string, unknown> | null;
    evidence?: Record<string, unknown> | null;
    observedAt?: string | null;
}

export interface FederationMembershipRow {
    id: string;
    federation_key: string;
    tenant_id: string;
    coordinator_tenant_id: string;
    status: string;
    participation_mode: string;
    weight: number;
    metadata: Record<string, unknown>;
}

export interface FederationRoundRow {
    id: string;
    federation_key: string;
    coordinator_tenant_id: string;
    round_key: string;
    status: string;
    aggregation_strategy: string;
    participant_count: number;
    aggregate_payload: Record<string, unknown>;
    candidate_artifact_payload: Record<string, unknown>;
    started_at: string | null;
    completed_at: string | null;
}

export interface FederationRoundNodeTaskRow {
    id: string;
    tenant_id: string;
    federation_round_id: string;
    federation_key: string;
    round_key: string;
    node_ref: string;
    partner_ref: string;
    outcome_eligibility_snapshot_id: string | null;
    task_type: FederationRoundNodeTaskType;
    task_status: FederationRoundNodeTaskStatus;
    plan_hash: string;
    model_artifact_ref: string | null;
    dataset_policy: Record<string, unknown>;
    secure_aggregation_config: Record<string, unknown>;
    task_payload: Record<string, unknown>;
    due_at: string | null;
    evidence: Record<string, unknown>;
    created_at: string | null;
}

export interface FederationNodeRuntimeEventRow {
    id: string;
    tenant_id: string;
    federation_key: string;
    partner_ref: string;
    node_ref: string;
    federation_round_id: string | null;
    runtime_event: FederationNodeRuntimeEvent;
    node_status: FederationNodeStatus;
    secure_aggregation_status: SecureAggregationStatus;
    outcome_eligibility_status: OutcomeEligibilityStatus;
    last_heartbeat_at: string | null;
    blockers: string[];
    evidence: Record<string, unknown>;
    observed_at: string | null;
    created_at: string | null;
}

export interface FederatedUpdateSubmissionRow {
    id: string;
    tenant_id: string;
    request_id: string;
    federation_round_id: string;
    round_node_task_id: string | null;
    outcome_eligibility_snapshot_id: string | null;
    federation_key: string;
    round_key: string;
    node_ref: string;
    partner_ref: string;
    participant_ref: string;
    contribution_role: FederatedUpdateRole;
    submission_status: string;
    payload_commitment_hash: string;
    mask_commitment_hash: string | null;
    signed_payload_hash: string | null;
    signature_hash: string | null;
    observed_at: string | null;
    created_at: string | null;
}

export class FederationNodeRuntimeError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'FederationNodeRuntimeError';
    }
}

export function resolveFederationNodeIdentity(input: {
    actor: ClinicalApiActor;
    federationKey: string;
    nodeRef?: string | null;
    partnerRef?: string | null;
}): FederationNodeIdentity {
    const federationKey = normalizeFederationKey(input.federationKey);
    if (!federationKey) {
        throw new FederationNodeRuntimeError(400, 'federation_key is required and must use letters, numbers, :, _, or -.');
    }

    const nodeRef = normalizeNodeRef(input.nodeRef)
        ?? normalizeNodeRef(readText(input.actor.serviceAccountId))
        ?? normalizeNodeRef(input.actor.credentialId)
        ?? normalizeNodeRef(input.actor.principalLabel);
    if (!nodeRef) {
        throw new FederationNodeRuntimeError(400, 'node_ref is required for federation node protocol requests.');
    }

    return {
        tenantId: input.actor.tenantId,
        federationKey,
        nodeRef,
        partnerRef: normalizePartnerRef(input.partnerRef)
            ?? normalizePartnerRef(input.actor.principalLabel)
            ?? normalizePartnerRef(input.actor.credentialId)
            ?? `tenant:${input.actor.tenantId}`,
    };
}

export function contributionRoleForTaskType(taskType: string | null | undefined): FederatedUpdateRole {
    if (taskType === 'severity_delta') return 'severity';
    if (taskType === 'support_summary' || taskType === 'secure_aggregation_key') return 'support';
    if (taskType === 'unmask_share') return 'unmask_share';
    return 'diagnosis';
}

export async function getCurrentFederationRoundForNode(
    client: SupabaseClient,
    input: {
        actor: ClinicalApiActor;
        federationKey: string;
        nodeRef?: string | null;
        partnerRef?: string | null;
    },
): Promise<{
    identity: FederationNodeIdentity;
    membership: FederationMembershipRow;
    round: FederationRoundRow | null;
    tasks: FederationRoundNodeTaskRow[];
    latest_node_attestation: FederationNodeAttestationRow | null;
    node_attestation_assessment: FederationNodeAttestationAssessment | null;
    latest_runtime_event: FederationNodeRuntimeEventRow | null;
    assessment: ReturnType<typeof buildFederationNodeProtocolAssessment> | null;
}> {
    const identity = resolveFederationNodeIdentity(input);
    const membership = await requireActiveFederationMembership(client, identity);
    const round = await loadLatestNodeVisibleRound(client, identity.federationKey);
    let tasks: FederationRoundNodeTaskRow[] = [];
    let latestRuntime: FederationNodeRuntimeEventRow | null;
    if (round) {
        [tasks, latestRuntime] = await Promise.all([
            listNodeTasksForRound(client, identity, round.id),
            loadLatestRuntimeEvent(client, identity, round.id),
        ]);
    } else {
        latestRuntime = await loadLatestRuntimeEvent(client, identity, null);
    }
    const latestAttestation = await loadLatestFederationNodeAttestation(client, identity);

    return {
        identity,
        membership,
        round,
        tasks,
        latest_node_attestation: latestAttestation,
        node_attestation_assessment: latestAttestation ? buildFederationNodeAttestationAssessment(latestAttestation) : null,
        latest_runtime_event: latestRuntime,
        assessment: latestRuntime ? buildFederationNodeProtocolAssessment({
            ...latestRuntime,
            task_status: tasks[0]?.task_status ?? null,
        }) : null,
    };
}

export async function getFederationRoundNodeStatus(
    client: SupabaseClient,
    input: {
        actor: ClinicalApiActor;
        roundId: string;
        nodeRef?: string | null;
        partnerRef?: string | null;
    },
): Promise<{
    identity: FederationNodeIdentity;
    membership: FederationMembershipRow;
    round: FederationRoundRow;
    tasks: FederationRoundNodeTaskRow[];
    latest_node_attestation: FederationNodeAttestationRow | null;
    node_attestation_assessment: FederationNodeAttestationAssessment | null;
    latest_runtime_event: FederationNodeRuntimeEventRow | null;
    submissions: FederatedUpdateSubmissionRow[];
    assessment: ReturnType<typeof buildFederationNodeProtocolAssessment> | null;
}> {
    const round = await loadFederationRoundById(client, input.roundId);
    const identity = resolveFederationNodeIdentity({
        actor: input.actor,
        federationKey: round.federation_key,
        nodeRef: input.nodeRef,
        partnerRef: input.partnerRef,
    });
    const membership = await requireActiveFederationMembership(client, identity);
    const [tasks, latestRuntime, submissions] = await Promise.all([
        listNodeTasksForRound(client, identity, round.id),
        loadLatestRuntimeEvent(client, identity, round.id),
        listNodeUpdateSubmissionsForRound(client, identity, round.id),
    ]);
    const latestAttestation = await loadLatestFederationNodeAttestation(client, identity);

    return {
        identity,
        membership,
        round,
        tasks,
        latest_node_attestation: latestAttestation,
        node_attestation_assessment: latestAttestation ? buildFederationNodeAttestationAssessment(latestAttestation) : null,
        latest_runtime_event: latestRuntime,
        submissions,
        assessment: latestRuntime ? buildFederationNodeProtocolAssessment({
            ...latestRuntime,
            task_status: tasks[0]?.task_status ?? null,
            submission_status: submissions[0]?.submission_status ?? null,
        }) : null,
    };
}

export async function recordFederationNodeRuntimeEvent(
    client: SupabaseClient,
    actor: ClinicalApiActor,
    input: FederationNodeRuntimeInput,
): Promise<FederationNodeRuntimeEventRow> {
    const identity = resolveFederationNodeIdentity({
        actor,
        federationKey: input.federationKey,
        nodeRef: input.nodeRef,
        partnerRef: input.partnerRef,
    });
    const membership = await requireActiveFederationMembership(client, identity);
    const attestationGate = await requireContributionReadyNodeAttestation(client, identity);
    const C = FEDERATION_NODE_RUNTIME_EVENT_TABLE.COLUMNS;
    const now = new Date().toISOString();
    const runtimeEvent = input.runtimeEvent ?? 'heartbeat';
    const { data, error } = await client
        .from(FEDERATION_NODE_RUNTIME_EVENT_TABLE.TABLE)
        .insert({
            [C.tenant_id]: identity.tenantId,
            [C.request_id]: input.requestId ?? randomUUID(),
            [C.federation_key]: identity.federationKey,
            [C.partner_ref]: identity.partnerRef,
            [C.node_ref]: identity.nodeRef,
            [C.membership_id]: membership.id,
            [C.outcome_eligibility_snapshot_id]: input.outcomeEligibilitySnapshotId ?? null,
            [C.federation_round_id]: input.federationRoundId ?? null,
            [C.node_kind]: normalizeNodeKind(input.nodeKind),
            [C.runtime_event]: runtimeEvent,
            [C.node_status]: input.nodeStatus ?? 'online',
            [C.deployment_environment]: normalizeDeploymentEnvironment(input.deploymentEnvironment),
            [C.software_version]: normalizeOptionalText(input.softwareVersion, 80),
            [C.secure_aggregation_status]: normalizeSecureAggregationStatus(input.secureAggregationStatus),
            [C.outcome_eligibility_status]: normalizeOutcomeEligibilityStatus(input.outcomeEligibilityStatus),
            [C.last_heartbeat_at]: input.lastHeartbeatAt ?? (runtimeEvent === 'heartbeat' ? now : null),
            [C.blockers]: normalizeBlockers(input.blockers),
            [C.evidence]: {
                ...(input.evidence ?? {}),
                node_attestation_id: attestationGate.attestation.id,
                node_attestation_score: attestationGate.assessment.attestation_score,
                node_attestation_verification_status: attestationGate.attestation.verification_status,
            },
            [C.observed_at]: input.observedAt ?? now,
        })
        .select('*')
        .single();

    if (error || !data) {
        if (error?.code === '23505' && input.requestId) {
            const cached = await loadRuntimeEventByRequestId(client, identity.tenantId, input.requestId);
            if (cached) return cached;
        }
        throw new FederationNodeRuntimeError(503, `Failed to record federation node runtime event: ${error?.message ?? 'unknown error'}`);
    }

    return mapRuntimeEvent(asRecord(data));
}

export async function pullFederationRoundNodeTask(
    client: SupabaseClient,
    actor: ClinicalApiActor,
    input: {
        roundId: string;
        taskId: string;
        nodeRef: string;
        partnerRef?: string | null;
        evidence?: Record<string, unknown> | null;
    },
): Promise<{
    identity: FederationNodeIdentity;
    task: FederationRoundNodeTaskRow;
    runtime_event: FederationNodeRuntimeEventRow;
}> {
    const round = await loadFederationRoundById(client, input.roundId);
    const identity = resolveFederationNodeIdentity({
        actor,
        federationKey: round.federation_key,
        nodeRef: input.nodeRef,
        partnerRef: input.partnerRef,
    });
    await requireActiveFederationMembership(client, identity);
    const task = await loadNodeTaskById(client, identity, round.id, input.taskId);
    await requireContributionReadyNodeAttestation(client, identity, task.task_type);
    const pulledTask = await markTaskStatus(client, task, task.task_status === 'submitted' || task.task_status === 'accepted' ? task.task_status : 'pulled');
    const runtimeEvent = await recordFederationNodeRuntimeEvent(client, actor, {
        federationKey: identity.federationKey,
        nodeRef: identity.nodeRef,
        partnerRef: identity.partnerRef,
        federationRoundId: round.id,
        runtimeEvent: 'round_plan_pulled',
        nodeStatus: 'online',
        secureAggregationStatus: 'ready',
        outcomeEligibilitySnapshotId: task.outcome_eligibility_snapshot_id,
        outcomeEligibilityStatus: task.outcome_eligibility_snapshot_id ? 'eligible' : 'insufficient_evidence',
        evidence: {
            task_id: task.id,
            task_type: task.task_type,
            plan_hash: task.plan_hash,
            ...(input.evidence ?? {}),
        },
    });

    return {
        identity,
        task: pulledTask,
        runtime_event: runtimeEvent,
    };
}

export async function submitFederatedUpdate(
    client: SupabaseClient,
    actor: ClinicalApiActor,
    input: {
        roundId: string;
        body: FederatedUpdateSubmissionInput;
    },
): Promise<{
    identity: FederationNodeIdentity;
    submission: FederatedUpdateSubmissionRow;
    task: FederationRoundNodeTaskRow | null;
    runtime_event: FederationNodeRuntimeEventRow;
    cached: boolean;
}> {
    const round = await loadFederationRoundById(client, input.roundId);
    const identity = resolveFederationNodeIdentity({
        actor,
        federationKey: round.federation_key,
        nodeRef: input.body.nodeRef,
        partnerRef: input.body.partnerRef,
    });
    await requireActiveFederationMembership(client, identity);
    const task = input.body.roundNodeTaskId
        ? await loadNodeTaskById(client, identity, round.id, input.body.roundNodeTaskId)
        : null;
    const contributionRole = input.body.contributionRole ?? contributionRoleForTaskType(task?.task_type);
    const maskingProtocol = normalizeOptionalText(
        input.body.maskingProtocol ?? inferMaskingProtocol(input.body.maskedUpdateSummary),
        120,
    ) ?? 'pairwise_masked_commitment_v1';
    const attestationGate = await requireContributionReadyNodeAttestation(
        client,
        identity,
        task?.task_type ?? taskTypeForContributionRole(contributionRole),
    );
    const requestId = input.body.requestId ?? randomUUID();
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .insert({
            [C.tenant_id]: identity.tenantId,
            [C.request_id]: requestId,
            [C.federation_round_id]: round.id,
            [C.round_node_task_id]: task?.id ?? null,
            [C.outcome_eligibility_snapshot_id]: input.body.outcomeEligibilitySnapshotId ?? task?.outcome_eligibility_snapshot_id ?? null,
            [C.federation_key]: identity.federationKey,
            [C.round_key]: round.round_key,
            [C.node_ref]: identity.nodeRef,
            [C.partner_ref]: identity.partnerRef,
            [C.participant_ref]: createParticipantRef(identity.federationKey, round.round_key, identity.tenantId, identity.nodeRef),
            [C.contribution_role]: contributionRole,
            [C.submission_status]: 'submitted',
            [C.masking_protocol]: maskingProtocol,
            [C.payload_commitment_hash]: input.body.payloadCommitmentHash,
            [C.mask_commitment_hash]: input.body.maskCommitmentHash ?? null,
            [C.signed_payload_hash]: input.body.signedPayloadHash ?? null,
            [C.signature_algorithm]: normalizeOptionalText(input.body.signatureAlgorithm, 80),
            [C.signature_hash]: input.body.signatureHash ?? null,
            [C.signing_key_fingerprint]: normalizeOptionalText(input.body.signingKeyFingerprint, 160),
            [C.masked_update_summary]: input.body.maskedUpdateSummary ?? {},
            [C.public_summary]: input.body.publicSummary ?? {},
            [C.evidence]: {
                ...(input.body.evidence ?? {}),
                node_attestation_id: attestationGate.attestation.id,
                node_attestation_score: attestationGate.assessment.attestation_score,
                node_attestation_verification_status: attestationGate.attestation.verification_status,
            },
            [C.observed_at]: input.body.observedAt ?? new Date().toISOString(),
        })
        .select('*')
        .single();

    let submission: FederatedUpdateSubmissionRow;
    let cached = false;
    if (error || !data) {
        if (error?.code === '23505') {
            const existing = await loadUpdateSubmissionByRequestId(client, identity.tenantId, requestId);
            if (!existing) {
                throw new FederationNodeRuntimeError(503, `Failed to load cached federated update submission: ${error.message}`);
            }
            submission = existing;
            cached = true;
        } else {
            throw new FederationNodeRuntimeError(503, `Failed to submit federated update: ${error?.message ?? 'unknown error'}`);
        }
    } else {
        submission = mapUpdateSubmission(asRecord(data));
    }

    const updatedTask = task && !cached
        ? await markTaskStatus(client, task, 'submitted')
        : task;
    const runtimeEvent = await recordFederationNodeRuntimeEvent(client, actor, {
        federationKey: identity.federationKey,
        nodeRef: identity.nodeRef,
        partnerRef: identity.partnerRef,
        federationRoundId: round.id,
        outcomeEligibilitySnapshotId: submission.outcome_eligibility_snapshot_id,
        runtimeEvent: contributionRole === 'unmask_share' ? 'unmask_share_submitted' : 'masked_update_submitted',
        nodeStatus: 'online',
        secureAggregationStatus: 'ready',
        outcomeEligibilityStatus: submission.outcome_eligibility_snapshot_id ? 'eligible' : 'insufficient_evidence',
        evidence: {
            submission_id: submission.id,
            task_id: updatedTask?.id ?? null,
            contribution_role: contributionRole,
            payload_commitment_hash: submission.payload_commitment_hash,
        },
    });

    return {
        identity,
        submission,
        task: updatedTask,
        runtime_event: runtimeEvent,
        cached,
    };
}

async function requireActiveFederationMembership(
    client: SupabaseClient,
    identity: FederationNodeIdentity,
): Promise<FederationMembershipRow> {
    const C = FEDERATION_MEMBERSHIPS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .select('*')
        .eq(C.federation_key, identity.federationKey)
        .eq(C.tenant_id, identity.tenantId)
        .eq(C.status, 'active')
        .maybeSingle();

    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load federation membership: ${error.message}`);
    }
    if (!data) {
        throw new FederationNodeRuntimeError(403, 'Tenant is not an active member of this federation.');
    }

    return mapMembership(asRecord(data));
}

async function requireContributionReadyNodeAttestation(
    client: SupabaseClient,
    identity: FederationNodeIdentity,
    taskType?: FederationRoundNodeTaskType | null,
): Promise<{
    attestation: FederationNodeAttestationRow;
    assessment: FederationNodeAttestationAssessment;
}> {
    let attestation: FederationNodeAttestationRow | null;
    try {
        attestation = await loadLatestFederationNodeAttestation(client, identity);
    } catch (error) {
        throw new FederationNodeRuntimeError(
            503,
            error instanceof Error ? error.message : 'Failed to load federation node attestation.',
        );
    }
    if (!attestation) {
        throw new FederationNodeRuntimeError(403, 'Federation node attestation is required before live node contribution.');
    }

    const assessment = buildFederationNodeAttestationAssessment({
        ...attestation,
        task_type: taskType ?? null,
    });
    if (!assessment.contribution_allowed) {
        throw new FederationNodeRuntimeError(
            403,
            `Federation node attestation does not allow contribution: ${assessment.blockers.join(', ') || 'attestation_score_below_threshold'}.`,
        );
    }

    return { attestation, assessment };
}

async function loadLatestNodeVisibleRound(
    client: SupabaseClient,
    federationKey: string,
): Promise<FederationRoundRow | null> {
    const C = FEDERATION_ROUNDS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .select('*')
        .eq(C.federation_key, federationKey)
        .neq(C.status, 'failed')
        .order(C.started_at, { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load current federation round: ${error.message}`);
    }
    return data ? mapRound(asRecord(data)) : null;
}

async function loadFederationRoundById(
    client: SupabaseClient,
    roundId: string,
): Promise<FederationRoundRow> {
    const C = FEDERATION_ROUNDS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .select('*')
        .eq(C.id, roundId)
        .maybeSingle();

    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load federation round: ${error.message}`);
    }
    if (!data) {
        throw new FederationNodeRuntimeError(404, 'Federation round not found.');
    }
    return mapRound(asRecord(data));
}

async function listNodeTasksForRound(
    client: SupabaseClient,
    identity: FederationNodeIdentity,
    roundId: string,
): Promise<FederationRoundNodeTaskRow[]> {
    const C = FEDERATION_ROUND_NODE_TASKS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUND_NODE_TASKS.TABLE)
        .select('*')
        .eq(C.tenant_id, identity.tenantId)
        .eq(C.federation_round_id, roundId)
        .eq(C.node_ref, identity.nodeRef)
        .order(C.created_at, { ascending: true });

    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load federation node tasks: ${error.message}`);
    }
    return (data ?? []).map((row) => mapTask(asRecord(row)));
}

async function loadNodeTaskById(
    client: SupabaseClient,
    identity: FederationNodeIdentity,
    roundId: string,
    taskId: string,
): Promise<FederationRoundNodeTaskRow> {
    const C = FEDERATION_ROUND_NODE_TASKS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUND_NODE_TASKS.TABLE)
        .select('*')
        .eq(C.id, taskId)
        .eq(C.tenant_id, identity.tenantId)
        .eq(C.federation_round_id, roundId)
        .eq(C.node_ref, identity.nodeRef)
        .maybeSingle();

    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load federation node task: ${error.message}`);
    }
    if (!data) {
        throw new FederationNodeRuntimeError(404, 'Federation node task not found for this node.');
    }
    return mapTask(asRecord(data));
}

async function markTaskStatus(
    client: SupabaseClient,
    task: FederationRoundNodeTaskRow,
    status: FederationRoundNodeTaskStatus,
): Promise<FederationRoundNodeTaskRow> {
    if (task.task_status === status) return task;
    const C = FEDERATION_ROUND_NODE_TASKS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUND_NODE_TASKS.TABLE)
        .update({ [C.task_status]: status })
        .eq(C.id, task.id)
        .select('*')
        .single();

    if (error || !data) {
        throw new FederationNodeRuntimeError(503, `Failed to update federation node task: ${error?.message ?? 'unknown error'}`);
    }
    return mapTask(asRecord(data));
}

async function loadLatestRuntimeEvent(
    client: SupabaseClient,
    identity: FederationNodeIdentity,
    roundId: string | null,
): Promise<FederationNodeRuntimeEventRow | null> {
    const C = FEDERATION_NODE_RUNTIME_EVENT_TABLE.COLUMNS;
    let query = client
        .from(FEDERATION_NODE_RUNTIME_EVENT_TABLE.TABLE)
        .select('*')
        .eq(C.tenant_id, identity.tenantId)
        .eq(C.federation_key, identity.federationKey)
        .eq(C.node_ref, identity.nodeRef)
        .order(C.observed_at, { ascending: false })
        .limit(1);

    if (roundId) query = query.eq(C.federation_round_id, roundId);

    const { data, error } = await query.maybeSingle();
    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load node runtime event: ${error.message}`);
    }
    return data ? mapRuntimeEvent(asRecord(data)) : null;
}

async function loadRuntimeEventByRequestId(
    client: SupabaseClient,
    tenantId: string,
    requestId: string,
): Promise<FederationNodeRuntimeEventRow | null> {
    const C = FEDERATION_NODE_RUNTIME_EVENT_TABLE.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_NODE_RUNTIME_EVENT_TABLE.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.request_id, requestId)
        .maybeSingle();

    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load cached runtime event: ${error.message}`);
    }
    return data ? mapRuntimeEvent(asRecord(data)) : null;
}

async function listNodeUpdateSubmissionsForRound(
    client: SupabaseClient,
    identity: FederationNodeIdentity,
    roundId: string,
): Promise<FederatedUpdateSubmissionRow[]> {
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, identity.tenantId)
        .eq(C.federation_round_id, roundId)
        .eq(C.node_ref, identity.nodeRef)
        .order(C.observed_at, { ascending: false });

    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load federated update submissions: ${error.message}`);
    }
    return (data ?? []).map((row) => mapUpdateSubmission(asRecord(row)));
}

async function loadUpdateSubmissionByRequestId(
    client: SupabaseClient,
    tenantId: string,
    requestId: string,
): Promise<FederatedUpdateSubmissionRow | null> {
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.request_id, requestId)
        .maybeSingle();

    if (error) {
        throw new FederationNodeRuntimeError(503, `Failed to load cached federated update submission: ${error.message}`);
    }
    return data ? mapUpdateSubmission(asRecord(data)) : null;
}

function mapMembership(row: Record<string, unknown>): FederationMembershipRow {
    return {
        id: String(row.id),
        federation_key: readText(row.federation_key) ?? '',
        tenant_id: readText(row.tenant_id) ?? '',
        coordinator_tenant_id: readText(row.coordinator_tenant_id) ?? '',
        status: readText(row.status) ?? 'active',
        participation_mode: readText(row.participation_mode) ?? 'full',
        weight: readNumber(row.weight) ?? 1,
        metadata: asRecord(row.metadata),
    };
}

function mapRound(row: Record<string, unknown>): FederationRoundRow {
    return {
        id: String(row.id),
        federation_key: readText(row.federation_key) ?? '',
        coordinator_tenant_id: readText(row.coordinator_tenant_id) ?? '',
        round_key: readText(row.round_key) ?? '',
        status: readText(row.status) ?? 'collecting',
        aggregation_strategy: readText(row.aggregation_strategy) ?? 'weighted_mean_v1',
        participant_count: readNumber(row.participant_count) ?? 0,
        aggregate_payload: asRecord(row.aggregate_payload),
        candidate_artifact_payload: asRecord(row.candidate_artifact_payload),
        started_at: readText(row.started_at),
        completed_at: readText(row.completed_at),
    };
}

function mapTask(row: Record<string, unknown>): FederationRoundNodeTaskRow {
    return {
        id: String(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        federation_round_id: readText(row.federation_round_id) ?? '',
        federation_key: readText(row.federation_key) ?? '',
        round_key: readText(row.round_key) ?? '',
        node_ref: readText(row.node_ref) ?? '',
        partner_ref: readText(row.partner_ref) ?? '',
        outcome_eligibility_snapshot_id: readText(row.outcome_eligibility_snapshot_id),
        task_type: normalizeTaskType(row.task_type),
        task_status: normalizeTaskStatus(row.task_status),
        plan_hash: readText(row.plan_hash) ?? '',
        model_artifact_ref: readText(row.model_artifact_ref),
        dataset_policy: asRecord(row.dataset_policy),
        secure_aggregation_config: asRecord(row.secure_aggregation_config),
        task_payload: asRecord(row.task_payload),
        due_at: readText(row.due_at),
        evidence: asRecord(row.evidence),
        created_at: readText(row.created_at),
    };
}

function mapRuntimeEvent(row: Record<string, unknown>): FederationNodeRuntimeEventRow {
    return {
        id: String(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        federation_key: readText(row.federation_key) ?? '',
        partner_ref: readText(row.partner_ref) ?? '',
        node_ref: readText(row.node_ref) ?? '',
        federation_round_id: readText(row.federation_round_id),
        runtime_event: normalizeRuntimeEvent(row.runtime_event),
        node_status: normalizeNodeStatus(row.node_status),
        secure_aggregation_status: normalizeSecureAggregationStatus(row.secure_aggregation_status),
        outcome_eligibility_status: normalizeOutcomeEligibilityStatus(row.outcome_eligibility_status),
        last_heartbeat_at: readText(row.last_heartbeat_at),
        blockers: asStringArray(row.blockers),
        evidence: asRecord(row.evidence),
        observed_at: readText(row.observed_at),
        created_at: readText(row.created_at),
    };
}

function mapUpdateSubmission(row: Record<string, unknown>): FederatedUpdateSubmissionRow {
    return {
        id: String(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        request_id: readText(row.request_id) ?? '',
        federation_round_id: readText(row.federation_round_id) ?? '',
        round_node_task_id: readText(row.round_node_task_id),
        outcome_eligibility_snapshot_id: readText(row.outcome_eligibility_snapshot_id),
        federation_key: readText(row.federation_key) ?? '',
        round_key: readText(row.round_key) ?? '',
        node_ref: readText(row.node_ref) ?? '',
        partner_ref: readText(row.partner_ref) ?? '',
        participant_ref: readText(row.participant_ref) ?? '',
        contribution_role: normalizeUpdateRole(row.contribution_role),
        submission_status: readText(row.submission_status) ?? 'submitted',
        payload_commitment_hash: readText(row.payload_commitment_hash) ?? '',
        mask_commitment_hash: readText(row.mask_commitment_hash),
        signed_payload_hash: readText(row.signed_payload_hash),
        signature_hash: readText(row.signature_hash),
        observed_at: readText(row.observed_at),
        created_at: readText(row.created_at),
    };
}

function createParticipantRef(federationKey: string, roundKey: string, tenantId: string, nodeRef: string): string {
    return `${federationKey}:${roundKey}:${tenantId}:${nodeRef}`.toLowerCase().replace(/[^a-z0-9:_-]+/g, '_');
}

function normalizeFederationKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9:_-]{2,63}$/.test(normalized) ? normalized : null;
}

function normalizeNodeRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length >= 3 && normalized.length <= 96 ? normalized : null;
}

function normalizePartnerRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_@.-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length >= 3 && normalized.length <= 160 ? normalized : null;
}

function normalizeNodeKind(value: unknown): FederationNodeKind {
    return FEDERATION_NODE_KINDS.includes(value as FederationNodeKind) ? value as FederationNodeKind : 'clinic';
}

function normalizeDeploymentEnvironment(value: unknown): FederationNodeEnvironment {
    return FEDERATION_NODE_ENVIRONMENTS.includes(value as FederationNodeEnvironment) ? value as FederationNodeEnvironment : 'sandbox';
}

function normalizeSecureAggregationStatus(value: unknown): SecureAggregationStatus {
    return SECURE_AGGREGATION_STATUSES.includes(value as SecureAggregationStatus) ? value as SecureAggregationStatus : 'not_ready';
}

function normalizeOutcomeEligibilityStatus(value: unknown): OutcomeEligibilityStatus {
    return OUTCOME_ELIGIBILITY_STATUSES.includes(value as OutcomeEligibilityStatus) ? value as OutcomeEligibilityStatus : 'insufficient_evidence';
}

function normalizeTaskType(value: unknown): FederationRoundNodeTaskType {
    if (
        value === 'diagnosis_delta'
        || value === 'severity_delta'
        || value === 'support_summary'
        || value === 'secure_aggregation_key'
        || value === 'unmask_share'
    ) {
        return value;
    }
    return 'diagnosis_delta';
}

function normalizeTaskStatus(value: unknown): FederationRoundNodeTaskStatus {
    if (
        value === 'planned'
        || value === 'issued'
        || value === 'pulled'
        || value === 'submitted'
        || value === 'accepted'
        || value === 'rejected'
        || value === 'expired'
    ) {
        return value;
    }
    return 'planned';
}

function normalizeRuntimeEvent(value: unknown): FederationNodeRuntimeEvent {
    if (
        value === 'registered'
        || value === 'heartbeat'
        || value === 'round_plan_pulled'
        || value === 'task_started'
        || value === 'masked_update_submitted'
        || value === 'unmask_share_submitted'
        || value === 'dropout_reported'
        || value === 'round_acknowledged'
        || value === 'revoked'
    ) {
        return value;
    }
    return 'heartbeat';
}

function normalizeNodeStatus(value: unknown): FederationNodeStatus {
    if (value === 'pending' || value === 'online' || value === 'degraded' || value === 'offline' || value === 'revoked') {
        return value;
    }
    return 'pending';
}

function normalizeUpdateRole(value: unknown): FederatedUpdateRole {
    return FEDERATED_UPDATE_ROLES.includes(value as FederatedUpdateRole) ? value as FederatedUpdateRole : 'diagnosis';
}

function taskTypeForContributionRole(role: FederatedUpdateRole): FederationRoundNodeTaskType {
    if (role === 'severity') return 'severity_delta';
    if (role === 'support') return 'support_summary';
    if (role === 'unmask_share') return 'unmask_share';
    return 'diagnosis_delta';
}

function normalizeBlockers(value: unknown): string[] {
    return asStringArray(value)
        .map((entry) => entry.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_'))
        .filter((entry) => entry.length > 0)
        .slice(0, 30);
}

function normalizeOptionalText(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized.slice(0, max) : null;
}

function inferMaskingProtocol(maskedUpdateSummary: Record<string, unknown> | null | undefined): string | null {
    const secureAggregation = asRecord(asRecord(maskedUpdateSummary).secure_aggregation);
    return readText(secureAggregation.masking_protocol);
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
