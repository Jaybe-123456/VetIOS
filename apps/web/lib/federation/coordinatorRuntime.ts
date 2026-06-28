import { createHash, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS,
    FEDERATED_UPDATE_SUBMISSIONS,
    FEDERATION_MEMBERSHIPS,
    FEDERATION_ROUND_NODE_TASKS,
    FEDERATION_ROUNDS,
} from '@/lib/db/schemaContracts';
import type {
    FederatedUpdateRole,
    FederatedUpdateSubmissionRow,
    FederationMembershipRow,
    FederationRoundNodeTaskRow,
    FederationRoundRow,
} from '@/lib/federation/nodeRuntime';
import {
    contributionRoleForTaskType,
} from '@/lib/federation/nodeRuntime';
import type { FederationRoundNodeTaskStatus, FederationRoundNodeTaskType } from '@/lib/federation/nodeProtocol';

export const COORDINATOR_TASK_TYPES = [
    'diagnosis_delta',
    'severity_delta',
    'support_summary',
    'secure_aggregation_key',
    'unmask_share',
] as const;

export const COORDINATOR_UPDATE_REVIEW_STATUSES = ['accepted', 'rejected', 'quarantined'] as const;

export type CoordinatorTaskType = typeof COORDINATOR_TASK_TYPES[number];
export type CoordinatorUpdateReviewStatus = typeof COORDINATOR_UPDATE_REVIEW_STATUSES[number];

export interface CoordinatorOutcomeEligibilitySnapshot {
    id: string;
    tenant_id: string;
    federation_key: string;
    eligibility_status: string;
    outcome_confirmed_rows: number;
    provenance_verified_rows: number;
    trust_scored_rows: number;
    average_trust_score: number;
    source_record_digest: string | null;
    observed_at: string | null;
}

export interface CoordinatorTaskPlanParticipant {
    membership: FederationMembershipRow;
    node_ref: string;
    partner_ref: string;
    eligibility_snapshot: CoordinatorOutcomeEligibilitySnapshot | null;
}

export interface CoordinatorSecureAggregationPeerConfig {
    node_ref: string;
    partner_ref: string;
    tenant_id: string;
    public_key_fingerprint: string | null;
    public_key_der_base64: string | null;
    public_key_pem: string | null;
    status: 'active' | 'unknown';
}

export interface CoordinatorTaskPlan {
    round: FederationRoundRow;
    eligible_participants: CoordinatorTaskPlanParticipant[];
    skipped_participants: Array<{
        tenant_id: string;
        reason: string;
    }>;
    task_types: CoordinatorTaskType[];
}

export interface CoordinatorIssueTasksResult {
    plan: CoordinatorTaskPlan;
    issued_tasks: FederationRoundNodeTaskRow[];
    existing_tasks: FederationRoundNodeTaskRow[];
}

export interface CoordinatorReviewUpdateResult {
    reviewed_submission: FederatedUpdateSubmissionRow;
    review_submission: FederatedUpdateSubmissionRow;
    task: FederationRoundNodeTaskRow | null;
}

export interface CoordinatorFinalizeRoundResult {
    round: FederationRoundRow;
    accepted_submissions: FederatedUpdateSubmissionRow[];
    missing_task_count: number;
    secure_aggregation_status: 'secure_aggregation_ready' | 'secure_aggregation_incomplete';
    secure_aggregate_materialization: CoordinatorSecureAggregateMaterialization;
    blockers: string[];
}

export interface CoordinatorSecureAggregateMaterialization {
    schema: 'vetios_coordinator_secure_aggregate_materialization_v1';
    status: 'materialized' | 'blocked';
    federation_round_id: string;
    federation_key: string;
    round_key: string;
    masking_protocol: string;
    accepted_update_count: number;
    materialized_update_count: number;
    unmask_share_submission_count: number;
    dimension_count: number;
    dimension_order_digest: string | null;
    aggregate_masked_integer_vector: Record<string, number>;
    aggregate_masked_vector_digest: string | null;
    payload_commitment_hashes: string[];
    mask_commitment_hashes: string[];
    masked_vector_digests: string[];
    pairwise_mask_commitment_count: number;
    unmask_share_commitment_count: number;
    encrypted_unmask_share_envelope_count: number;
    encrypted_unmask_share_envelope_hashes: string[];
    dropout_recovery_evidence_status: 'encrypted_unmask_envelopes_available' | 'commitment_only' | 'missing';
    coordinator_visibility: 'secure_aggregate_only_no_site_delta';
    raw_clinical_rows_shared: false;
    raw_site_delta_artifacts_stored: false;
    blockers: string[];
    warnings: string[];
    next_actions: string[];
}

export class FederationCoordinatorRuntimeError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'FederationCoordinatorRuntimeError';
    }
}

export function resolveCoordinatorNodeRef(membership: Pick<FederationMembershipRow, 'tenant_id' | 'metadata'>): string {
    const metadata = membership.metadata;
    return normalizeNodeRef(metadata.node_ref)
        ?? normalizeNodeRef(asRecord(metadata.federation_node).node_ref)
        ?? normalizeNodeRef(asRecord(metadata.live_node).node_ref)
        ?? normalizeNodeRef(membership.tenant_id)
        ?? `tenant_${stableHash(membership.tenant_id).slice(0, 12)}`;
}

export function buildCoordinatorTaskPlanHash(input: {
    federationRoundId: string;
    tenantId: string;
    nodeRef: string;
    taskType: CoordinatorTaskType;
    outcomeEligibilitySnapshotId: string;
    datasetPolicy: Record<string, unknown>;
    secureAggregationConfig: Record<string, unknown>;
    taskPayload: Record<string, unknown>;
}): string {
    return stableHash({
        federation_round_id: input.federationRoundId,
        tenant_id: input.tenantId,
        node_ref: input.nodeRef,
        task_type: input.taskType,
        outcome_eligibility_snapshot_id: input.outcomeEligibilitySnapshotId,
        dataset_policy: input.datasetPolicy,
        secure_aggregation_config: input.secureAggregationConfig,
        task_payload: input.taskPayload,
    });
}

export function buildCoordinatorSecureAggregationConfig(input: {
    round: FederationRoundRow;
    participant: CoordinatorTaskPlanParticipant;
    participants: CoordinatorTaskPlanParticipant[];
    baseConfig?: Record<string, unknown> | null;
}): Record<string, unknown> {
    const baseConfig = asRecord(input.baseConfig);
    const coordinatorPublicKeyDerBase64 = readText(
        baseConfig.coordinator_public_key_der_base64
        ?? baseConfig.coordinatorPublicKeyDerBase64
        ?? asRecord(baseConfig.coordinator).public_key_der_base64
        ?? asRecord(baseConfig.coordinator).publicKeyDerBase64,
    );
    const coordinatorPublicKeyPem = readText(
        baseConfig.coordinator_public_key_pem
        ?? baseConfig.coordinatorPublicKeyPem
        ?? asRecord(baseConfig.coordinator).public_key_pem
        ?? asRecord(baseConfig.coordinator).publicKeyPem,
    );
    const generatedPeers = input.participants
        .filter((participant) => participant.node_ref !== input.participant.node_ref)
        .map((participant) => buildCoordinatorPeerConfig(participant));
    const configuredPeers = Array.isArray(baseConfig.peers)
        ? baseConfig.peers.map((peer) => normalizeConfiguredPeer(peer)).filter((peer): peer is CoordinatorSecureAggregationPeerConfig => peer != null)
        : [];
    const peers = mergePeerConfigs(generatedPeers, configuredPeers);
    const activePeersWithPublicKeys = peers.filter((peer) => peer.public_key_der_base64 || peer.public_key_pem).length;
    const x25519Ready = peers.length > 0
        && activePeersWithPublicKeys === peers.length
        && Boolean(coordinatorPublicKeyDerBase64 || coordinatorPublicKeyPem);

    return {
        ...baseConfig,
        masking_protocol: x25519Ready ? 'x25519_hkdf_pairwise_masked_v1' : 'pairwise_masked_commitment_v1',
        coordinator_public_key_der_base64: coordinatorPublicKeyDerBase64 ?? null,
        coordinator_public_key_pem: coordinatorPublicKeyPem ?? null,
        peers,
        peer_count: peers.length,
        peer_public_key_count: activePeersWithPublicKeys,
        x25519_pairwise_ready: x25519Ready,
        generated_by: 'vetios_coordinator_runtime_v1',
        federation_round_id: input.round.id,
        participant_node_ref: input.participant.node_ref,
    };
}

export function buildCoordinatorTaskPlan(input: {
    round: FederationRoundRow;
    memberships: FederationMembershipRow[];
    outcomeEligibilitySnapshots: CoordinatorOutcomeEligibilitySnapshot[];
    taskTypes: CoordinatorTaskType[];
}): CoordinatorTaskPlan {
    const latestEligibilityByTenant = new Map<string, CoordinatorOutcomeEligibilitySnapshot>();
    for (const snapshot of input.outcomeEligibilitySnapshots) {
        const current = latestEligibilityByTenant.get(snapshot.tenant_id);
        if (!current || compareIso(snapshot.observed_at, current.observed_at) > 0) {
            latestEligibilityByTenant.set(snapshot.tenant_id, snapshot);
        }
    }

    const eligibleParticipants: CoordinatorTaskPlanParticipant[] = [];
    const skippedParticipants: CoordinatorTaskPlan['skipped_participants'] = [];
    for (const membership of input.memberships) {
        const eligibility = latestEligibilityByTenant.get(membership.tenant_id) ?? null;
        if (!eligibility) {
            skippedParticipants.push({ tenant_id: membership.tenant_id, reason: 'missing_outcome_eligibility_snapshot' });
            continue;
        }
        if (eligibility.eligibility_status !== 'eligible') {
            skippedParticipants.push({ tenant_id: membership.tenant_id, reason: `outcome_eligibility_${eligibility.eligibility_status}` });
            continue;
        }

        eligibleParticipants.push({
            membership,
            node_ref: resolveCoordinatorNodeRef(membership),
            partner_ref: resolveCoordinatorPartnerRef(membership),
            eligibility_snapshot: eligibility,
        });
    }

    return {
        round: input.round,
        eligible_participants: eligibleParticipants,
        skipped_participants: skippedParticipants,
        task_types: input.taskTypes,
    };
}

export function buildCoordinatorSecureAggregateMaterialization(input: {
    round: FederationRoundRow;
    acceptedSubmissions: FederatedUpdateSubmissionRow[];
    tasks?: FederationRoundNodeTaskRow[];
    inheritedBlockers?: string[];
}): CoordinatorSecureAggregateMaterialization {
    const blockers = [...(input.inheritedBlockers ?? [])];
    const warnings: string[] = [];
    const updateSubmissions = input.acceptedSubmissions.filter((submission) =>
        submission.contribution_role !== 'unmask_share',
    );
    const unmaskShareSubmissionCount = input.acceptedSubmissions.length - updateSubmissions.length;
    const aggregateVector: Record<string, number> = {};
    const payloadCommitmentHashes: string[] = [];
    const maskCommitmentHashes: string[] = [];
    const maskedVectorDigests: string[] = [];
    const encryptedEnvelopeHashes: string[] = [];
    const maskingProtocols: string[] = [];
    let dimensionOrderDigest: string | null = null;
    let materializedUpdateCount = 0;
    let pairwiseMaskCommitmentCount = 0;
    let unmaskShareCommitmentCount = 0;
    let encryptedEnvelopeCount = 0;

    if (updateSubmissions.length === 0) {
        blockers.push('accepted_masked_update_vectors_missing');
    }

    for (const submission of updateSubmissions) {
        const maskedSummary = asRecord(submission.masked_update_summary);
        const secureAggregation = asRecord(maskedSummary.secure_aggregation);
        const vector = readMaskedIntegerVector(secureAggregation.masked_integer_vector);
        const vectorDimensions = Object.keys(vector).sort();
        const submissionDimensionDigest = readText(secureAggregation.dimension_order_digest);
        const maskedVectorDigest = readText(secureAggregation.masked_vector_digest);
        const maskingProtocol = submission.masking_protocol
            ?? readText(secureAggregation.masking_protocol)
            ?? 'unknown';

        maskingProtocols.push(maskingProtocol);
        payloadCommitmentHashes.push(submission.payload_commitment_hash);
        if (submission.mask_commitment_hash) {
            maskCommitmentHashes.push(submission.mask_commitment_hash);
        }
        if (maskedVectorDigest) {
            maskedVectorDigests.push(maskedVectorDigest);
        }

        pairwiseMaskCommitmentCount += Math.max(0, Math.round(readNumber(secureAggregation.pairwise_mask_count) ?? 0));
        unmaskShareCommitmentCount += Math.max(0, Math.round(readNumber(secureAggregation.unmask_share_count) ?? 0));
        encryptedEnvelopeCount += Math.max(0, Math.round(readNumber(secureAggregation.encrypted_unmask_share_envelope_count) ?? 0));
        encryptedEnvelopeHashes.push(...readEncryptedUnmaskEnvelopeHashes(secureAggregation));

        if (vectorDimensions.length === 0) {
            blockers.push(`masked_integer_vector_missing:${submission.id}`);
            continue;
        }
        if (!submissionDimensionDigest) {
            blockers.push(`dimension_order_digest_missing:${submission.id}`);
        } else if (!dimensionOrderDigest) {
            dimensionOrderDigest = submissionDimensionDigest;
        } else if (submissionDimensionDigest !== dimensionOrderDigest) {
            blockers.push(`dimension_order_digest_mismatch:${submission.id}`);
        }

        for (const dimension of vectorDimensions) {
            aggregateVector[dimension] = (aggregateVector[dimension] ?? 0) + vector[dimension]!;
        }
        materializedUpdateCount += 1;
    }

    if (maskCommitmentHashes.length < updateSubmissions.length) {
        blockers.push('mask_commitments_missing_for_some_accepted_updates');
    }
    if (maskedVectorDigests.length < updateSubmissions.length) {
        blockers.push('masked_vector_digests_missing_for_some_accepted_updates');
    }
    if (pairwiseMaskCommitmentCount === 0 && updateSubmissions.length > 1) {
        blockers.push('pairwise_mask_commitments_missing');
    }
    if (encryptedEnvelopeCount === 0 && updateSubmissions.length > 1) {
        warnings.push('encrypted_unmask_share_envelopes_missing_or_commitment_only');
    }

    const aggregateDimensions = Object.keys(aggregateVector).sort();
    const aggregateMaskedIntegerVector = Object.fromEntries(
        aggregateDimensions.map((dimension) => [dimension, aggregateVector[dimension] ?? 0]),
    ) as Record<string, number>;
    const aggregateMaskedVectorDigest = materializedUpdateCount > 0
        ? stableHash({
            dimension_order_digest: dimensionOrderDigest,
            aggregate_masked_integer_vector: aggregateMaskedIntegerVector,
            accepted_payload_commitment_hashes: payloadCommitmentHashes.sort(),
            accepted_mask_commitment_hashes: maskCommitmentHashes.sort(),
        })
        : null;
    const uniqueBlockers = unique(blockers);
    const uniqueWarnings = unique(warnings);
    const status = uniqueBlockers.length === 0 ? 'materialized' : 'blocked';
    const protocol = chooseAggregateMaskingProtocol(maskingProtocols);
    const dropoutRecoveryEvidenceStatus = encryptedEnvelopeCount > 0
        ? 'encrypted_unmask_envelopes_available'
        : unmaskShareCommitmentCount > 0
        ? 'commitment_only'
        : 'missing';

    return {
        schema: 'vetios_coordinator_secure_aggregate_materialization_v1',
        status,
        federation_round_id: input.round.id,
        federation_key: input.round.federation_key,
        round_key: input.round.round_key,
        masking_protocol: protocol,
        accepted_update_count: input.acceptedSubmissions.length,
        materialized_update_count: materializedUpdateCount,
        unmask_share_submission_count: unmaskShareSubmissionCount,
        dimension_count: aggregateDimensions.length,
        dimension_order_digest: dimensionOrderDigest,
        aggregate_masked_integer_vector: aggregateMaskedIntegerVector,
        aggregate_masked_vector_digest: aggregateMaskedVectorDigest,
        payload_commitment_hashes: unique(payloadCommitmentHashes.filter((hash) => hash.length > 0)),
        mask_commitment_hashes: unique(maskCommitmentHashes),
        masked_vector_digests: unique(maskedVectorDigests),
        pairwise_mask_commitment_count: pairwiseMaskCommitmentCount,
        unmask_share_commitment_count: unmaskShareCommitmentCount,
        encrypted_unmask_share_envelope_count: encryptedEnvelopeCount,
        encrypted_unmask_share_envelope_hashes: unique(encryptedEnvelopeHashes),
        dropout_recovery_evidence_status: dropoutRecoveryEvidenceStatus,
        coordinator_visibility: 'secure_aggregate_only_no_site_delta',
        raw_clinical_rows_shared: false,
        raw_site_delta_artifacts_stored: false,
        blockers: uniqueBlockers,
        warnings: uniqueWarnings,
        next_actions: buildSecureAggregateNextActions(status, dropoutRecoveryEvidenceStatus),
    };
}

export async function issueFederationRoundNodeTasks(
    client: SupabaseClient,
    input: {
        federationRoundId: string;
        actorTenantId: string | null;
        actor: string | null;
        taskTypes?: CoordinatorTaskType[];
        datasetPolicy?: Record<string, unknown>;
        secureAggregationConfig?: Record<string, unknown>;
        taskPayload?: Record<string, unknown>;
        dueAt?: string | null;
    },
): Promise<CoordinatorIssueTasksResult> {
    const round = await loadFederationRoundById(client, input.federationRoundId);
    assertCoordinatorAccess(round, input.actorTenantId);
    const [memberships, eligibilitySnapshots] = await Promise.all([
        listActiveMembershipsByFederation(client, round.federation_key),
        listLatestOutcomeEligibilitySnapshots(client, round.federation_key),
    ]);
    const taskTypes = normalizeTaskTypes(input.taskTypes);
    const plan = buildCoordinatorTaskPlan({
        round,
        memberships,
        outcomeEligibilitySnapshots: eligibilitySnapshots,
        taskTypes,
    });

    if (plan.eligible_participants.length === 0) {
        throw new FederationCoordinatorRuntimeError(409, 'No outcome-eligible federation participants are available for live node task issuance.');
    }

    const issuedTasks: FederationRoundNodeTaskRow[] = [];
    const existingTasks: FederationRoundNodeTaskRow[] = [];
    for (const participant of plan.eligible_participants) {
        for (const taskType of taskTypes) {
            const record = buildTaskRecord({
                round,
                participant,
                participants: plan.eligible_participants,
                taskType,
                datasetPolicy: input.datasetPolicy ?? {},
                secureAggregationConfig: input.secureAggregationConfig ?? {},
                taskPayload: input.taskPayload ?? {},
                dueAt: input.dueAt ?? null,
                actor: input.actor,
            });
            const task = await insertOrLoadTask(client, record);
            if (task.created_at === record.created_at) {
                issuedTasks.push(task);
            } else {
                existingTasks.push(task);
            }
        }
    }

    return {
        plan,
        issued_tasks: issuedTasks,
        existing_tasks: existingTasks,
    };
}

export async function reviewFederatedUpdateSubmission(
    client: SupabaseClient,
    input: {
        federationRoundId: string;
        submissionId: string;
        actorTenantId: string | null;
        actor: string | null;
        reviewStatus: CoordinatorUpdateReviewStatus;
        reviewReason?: string | null;
        evidence?: Record<string, unknown>;
    },
): Promise<CoordinatorReviewUpdateResult> {
    const round = await loadFederationRoundById(client, input.federationRoundId);
    assertCoordinatorAccess(round, input.actorTenantId);
    const submission = await loadUpdateSubmissionById(client, input.submissionId);
    if (submission.federation_round_id !== round.id) {
        throw new FederationCoordinatorRuntimeError(409, 'Federated update submission does not belong to the requested round.');
    }
    if (submission.submission_status !== 'submitted') {
        throw new FederationCoordinatorRuntimeError(409, 'Only submitted masked updates can be reviewed.');
    }

    const reviewSubmission = await appendUpdateReviewRecord(client, {
        round,
        submission,
        reviewStatus: input.reviewStatus,
        reviewReason: input.reviewReason ?? null,
        actor: input.actor,
        evidence: input.evidence ?? {},
    });
    const task = submission.round_node_task_id
        ? await markTaskStatus(client, submission.round_node_task_id, taskStatusForReview(input.reviewStatus))
        : null;

    return {
        reviewed_submission: submission,
        review_submission: reviewSubmission,
        task,
    };
}

export async function finalizeFederationRoundSecureAggregation(
    client: SupabaseClient,
    input: {
        federationRoundId: string;
        actorTenantId: string | null;
        actor: string | null;
        minimumAcceptedUpdates?: number | null;
        markCompleted?: boolean;
        evidence?: Record<string, unknown>;
    },
): Promise<CoordinatorFinalizeRoundResult> {
    const round = await loadFederationRoundById(client, input.federationRoundId);
    assertCoordinatorAccess(round, input.actorTenantId);
    const [tasks, submissions] = await Promise.all([
        listRoundNodeTasks(client, round.id),
        listRoundUpdateSubmissions(client, round.id),
    ]);
    const accepted = submissions.filter((submission) => submission.submission_status === 'accepted');
    const required = input.minimumAcceptedUpdates ?? tasks.filter((task) => task.task_type !== 'unmask_share').length;
    const missingTaskCount = Math.max(0, required - accepted.length);
    const preflightBlockers: string[] = [];
    if (accepted.length < required) {
        preflightBlockers.push('accepted_update_submissions_below_required_count');
    }
    const secureAggregateMaterialization = buildCoordinatorSecureAggregateMaterialization({
        round,
        acceptedSubmissions: accepted,
        tasks,
        inheritedBlockers: preflightBlockers,
    });
    const blockers = unique([...preflightBlockers, ...secureAggregateMaterialization.blockers]);
    const secureAggregationStatus = blockers.length === 0 ? 'secure_aggregation_ready' : 'secure_aggregation_incomplete';
    const updatedRound = await updateRoundSecureAggregationManifest(client, round, {
        secureAggregationStatus,
        accepted,
        tasks,
        blockers,
        secureAggregateMaterialization,
        actor: input.actor,
        markCompleted: input.markCompleted === true && blockers.length === 0,
        evidence: input.evidence ?? {},
    });

    return {
        round: updatedRound,
        accepted_submissions: accepted,
        missing_task_count: missingTaskCount,
        secure_aggregation_status: secureAggregationStatus,
        secure_aggregate_materialization: secureAggregateMaterialization,
        blockers,
    };
}

function buildTaskRecord(input: {
    round: FederationRoundRow;
    participant: CoordinatorTaskPlanParticipant;
    participants: CoordinatorTaskPlanParticipant[];
    taskType: CoordinatorTaskType;
    datasetPolicy: Record<string, unknown>;
    secureAggregationConfig: Record<string, unknown>;
    taskPayload: Record<string, unknown>;
    dueAt: string | null;
    actor: string | null;
}): Omit<FederationRoundNodeTaskRow, 'id'> & { membership_id: string | null; created_at: string } {
    const createdAt = new Date().toISOString();
    const eligibility = input.participant.eligibility_snapshot;
    if (!eligibility) {
        throw new FederationCoordinatorRuntimeError(409, 'Cannot issue a federation node task without an eligible outcome snapshot.');
    }
    const secureAggregationConfig = buildCoordinatorSecureAggregationConfig({
        round: input.round,
        participant: input.participant,
        participants: input.participants,
        baseConfig: input.secureAggregationConfig,
    });

    const planHash = buildCoordinatorTaskPlanHash({
        federationRoundId: input.round.id,
        tenantId: input.participant.membership.tenant_id,
        nodeRef: input.participant.node_ref,
        taskType: input.taskType,
        outcomeEligibilitySnapshotId: eligibility.id,
        datasetPolicy: input.datasetPolicy,
        secureAggregationConfig,
        taskPayload: input.taskPayload,
    });

    return {
        tenant_id: input.participant.membership.tenant_id,
        federation_round_id: input.round.id,
        federation_key: input.round.federation_key,
        round_key: input.round.round_key,
        node_ref: input.participant.node_ref,
        partner_ref: input.participant.partner_ref,
        membership_id: input.participant.membership.id,
        outcome_eligibility_snapshot_id: eligibility.id,
        task_type: input.taskType,
        task_status: 'issued',
        plan_hash: planHash,
        model_artifact_ref: null,
        dataset_policy: input.datasetPolicy,
        secure_aggregation_config: secureAggregationConfig,
        task_payload: input.taskPayload,
        due_at: input.dueAt,
        evidence: {
            issued_by: input.actor,
            issued_at: createdAt,
            outcome_eligibility_snapshot_id: eligibility.id,
            outcome_confirmed_rows: eligibility.outcome_confirmed_rows,
            provenance_verified_rows: eligibility.provenance_verified_rows,
            trust_scored_rows: eligibility.trust_scored_rows,
            average_trust_score: eligibility.average_trust_score,
            secure_aggregation_peer_count: secureAggregationConfig.peer_count,
            secure_aggregation_peer_public_key_count: secureAggregationConfig.peer_public_key_count,
            x25519_pairwise_ready: secureAggregationConfig.x25519_pairwise_ready,
        },
        created_at: createdAt,
    };
}

async function insertOrLoadTask(
    client: SupabaseClient,
    record: Omit<FederationRoundNodeTaskRow, 'id'> & { membership_id: string | null; created_at: string },
): Promise<FederationRoundNodeTaskRow> {
    const C = FEDERATION_ROUND_NODE_TASKS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUND_NODE_TASKS.TABLE)
        .insert({
            [C.tenant_id]: record.tenant_id,
            [C.federation_round_id]: record.federation_round_id,
            [C.federation_key]: record.federation_key,
            [C.round_key]: record.round_key,
            [C.node_ref]: record.node_ref,
            [C.partner_ref]: record.partner_ref,
            [C.membership_id]: record.membership_id,
            [C.outcome_eligibility_snapshot_id]: record.outcome_eligibility_snapshot_id,
            [C.task_type]: record.task_type,
            [C.task_status]: record.task_status,
            [C.plan_hash]: record.plan_hash,
            [C.model_artifact_ref]: record.model_artifact_ref,
            [C.dataset_policy]: record.dataset_policy,
            [C.secure_aggregation_config]: record.secure_aggregation_config,
            [C.task_payload]: record.task_payload,
            [C.due_at]: record.due_at,
            [C.evidence]: record.evidence,
            [C.created_at]: record.created_at,
        })
        .select('*')
        .single();

    if (!error && data) {
        return mapTask(asRecord(data));
    }

    if (error?.code !== '23505') {
        throw new FederationCoordinatorRuntimeError(503, `Failed to issue federation node task: ${error?.message ?? 'unknown error'}`);
    }

    const existing = await loadTaskByUniqueKey(client, record.federation_round_id, record.node_ref, record.task_type);
    if (!existing) {
        throw new FederationCoordinatorRuntimeError(503, 'Federation node task already exists but could not be loaded.');
    }
    return existing;
}

async function appendUpdateReviewRecord(
    client: SupabaseClient,
    input: {
        round: FederationRoundRow;
        submission: FederatedUpdateSubmissionRow;
        reviewStatus: CoordinatorUpdateReviewStatus;
        reviewReason: string | null;
        actor: string | null;
        evidence: Record<string, unknown>;
    },
): Promise<FederatedUpdateSubmissionRow> {
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .insert({
            [C.tenant_id]: input.submission.tenant_id,
            [C.request_id]: randomUUID(),
            [C.federation_round_id]: input.round.id,
            [C.round_node_task_id]: input.submission.round_node_task_id,
            [C.outcome_eligibility_snapshot_id]: input.submission.outcome_eligibility_snapshot_id,
            [C.federation_key]: input.round.federation_key,
            [C.round_key]: input.round.round_key,
            [C.node_ref]: input.submission.node_ref,
            [C.partner_ref]: input.submission.partner_ref,
            [C.participant_ref]: input.submission.participant_ref,
            [C.contribution_role]: input.submission.contribution_role,
            [C.submission_status]: input.reviewStatus,
            [C.masking_protocol]: input.submission.masking_protocol ?? 'pairwise_masked_commitment_v1',
            [C.payload_commitment_hash]: input.submission.payload_commitment_hash,
            [C.mask_commitment_hash]: input.submission.mask_commitment_hash,
            [C.signed_payload_hash]: input.submission.signed_payload_hash,
            [C.signature_algorithm]: input.submission.signature_algorithm,
            [C.signature_hash]: input.submission.signature_hash,
            [C.signing_key_fingerprint]: input.submission.signing_key_fingerprint,
            [C.masked_update_summary]: input.submission.masked_update_summary,
            [C.public_summary]: input.submission.public_summary,
            [C.evidence]: {
                ...input.submission.evidence,
                ...input.evidence,
                review_event_kind: 'coordinator_update_review',
                reviewed_submission_id: input.submission.id,
                review_status: input.reviewStatus,
                review_reason: input.reviewReason,
                reviewed_by: input.actor,
                reviewed_at: new Date().toISOString(),
            },
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to append federated update review record: ${error?.message ?? 'unknown error'}`);
    }

    return mapUpdateSubmission(asRecord(data));
}

async function updateRoundSecureAggregationManifest(
    client: SupabaseClient,
    round: FederationRoundRow,
    input: {
        secureAggregationStatus: 'secure_aggregation_ready' | 'secure_aggregation_incomplete';
        accepted: FederatedUpdateSubmissionRow[];
        tasks: FederationRoundNodeTaskRow[];
        blockers: string[];
        secureAggregateMaterialization: CoordinatorSecureAggregateMaterialization;
        actor: string | null;
        markCompleted: boolean;
        evidence: Record<string, unknown>;
    },
): Promise<FederationRoundRow> {
    const C = FEDERATION_ROUNDS.COLUMNS;
    const aggregatePayload = {
        ...round.aggregate_payload,
        secure_aggregation: {
            ...asRecord(round.aggregate_payload.secure_aggregation),
            mode: 'secure_aggregation_v1',
            status: input.secureAggregationStatus,
            masking_protocol: input.secureAggregateMaterialization.masking_protocol,
            accepted_update_submissions: input.accepted.length,
            issued_task_count: input.tasks.length,
            accepted_submission_ids: input.accepted.map((submission) => submission.id),
            accepted_node_refs: unique(input.accepted.map((submission) => submission.node_ref)),
            accepted_contribution_roles: unique(input.accepted.map((submission) => submission.contribution_role)),
            materialization_status: input.secureAggregateMaterialization.status,
            materialized_update_count: input.secureAggregateMaterialization.materialized_update_count,
            dimension_count: input.secureAggregateMaterialization.dimension_count,
            dimension_order_digest: input.secureAggregateMaterialization.dimension_order_digest,
            aggregate_masked_vector_digest: input.secureAggregateMaterialization.aggregate_masked_vector_digest,
            encrypted_unmask_share_envelope_count: input.secureAggregateMaterialization.encrypted_unmask_share_envelope_count,
            dropout_recovery_evidence_status: input.secureAggregateMaterialization.dropout_recovery_evidence_status,
            raw_clinical_rows_shared: false,
            raw_site_delta_artifacts_stored: false,
            coordinator_visibility: input.secureAggregateMaterialization.coordinator_visibility,
            coordinator_secure_aggregate_materialization: input.secureAggregateMaterialization,
            blockers: input.blockers,
            finalized_by: input.actor,
            finalized_at: new Date().toISOString(),
            evidence: input.evidence,
        },
    };
    const patch: Record<string, unknown> = {
        [C.aggregate_payload]: aggregatePayload,
    };
    if (input.markCompleted) {
        patch[C.status] = 'completed';
        patch[C.completed_at] = new Date().toISOString();
    }

    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .update(patch)
        .eq(C.id, round.id)
        .select('*')
        .single();

    if (error || !data) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to finalize federation round secure aggregation: ${error?.message ?? 'unknown error'}`);
    }

    return mapRound(asRecord(data));
}

async function loadFederationRoundById(client: SupabaseClient, id: string): Promise<FederationRoundRow> {
    const C = FEDERATION_ROUNDS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .select('*')
        .eq(C.id, id)
        .maybeSingle();

    if (error) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to load federation round: ${error.message}`);
    }
    if (!data) {
        throw new FederationCoordinatorRuntimeError(404, 'Federation round not found.');
    }
    return mapRound(asRecord(data));
}

async function listActiveMembershipsByFederation(client: SupabaseClient, federationKey: string): Promise<FederationMembershipRow[]> {
    const C = FEDERATION_MEMBERSHIPS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_MEMBERSHIPS.TABLE)
        .select('*')
        .eq(C.federation_key, federationKey)
        .eq(C.status, 'active');

    if (error) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to load federation memberships: ${error.message}`);
    }
    return (data ?? []).map((row) => mapMembership(asRecord(row)));
}

async function listLatestOutcomeEligibilitySnapshots(client: SupabaseClient, federationKey: string): Promise<CoordinatorOutcomeEligibilitySnapshot[]> {
    const C = FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.TABLE)
        .select('*')
        .eq(C.federation_key, federationKey)
        .order(C.observed_at, { ascending: false })
        .limit(500);

    if (error) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to load outcome eligibility snapshots: ${error.message}`);
    }
    return (data ?? []).map((row) => mapEligibility(asRecord(row)));
}

async function loadTaskByUniqueKey(
    client: SupabaseClient,
    roundId: string,
    nodeRef: string,
    taskType: string,
): Promise<FederationRoundNodeTaskRow | null> {
    const C = FEDERATION_ROUND_NODE_TASKS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUND_NODE_TASKS.TABLE)
        .select('*')
        .eq(C.federation_round_id, roundId)
        .eq(C.node_ref, nodeRef)
        .eq(C.task_type, taskType)
        .maybeSingle();

    if (error) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to load existing federation node task: ${error.message}`);
    }
    return data ? mapTask(asRecord(data)) : null;
}

async function loadUpdateSubmissionById(client: SupabaseClient, id: string): Promise<FederatedUpdateSubmissionRow> {
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .select('*')
        .eq(C.id, id)
        .maybeSingle();

    if (error) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to load federated update submission: ${error.message}`);
    }
    if (!data) {
        throw new FederationCoordinatorRuntimeError(404, 'Federated update submission not found.');
    }
    return mapUpdateSubmission(asRecord(data));
}

async function listRoundUpdateSubmissions(client: SupabaseClient, roundId: string): Promise<FederatedUpdateSubmissionRow[]> {
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .select('*')
        .eq(C.federation_round_id, roundId);

    if (error) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to list federated update submissions: ${error.message}`);
    }
    return (data ?? []).map((row) => mapUpdateSubmission(asRecord(row)));
}

async function listRoundNodeTasks(client: SupabaseClient, roundId: string): Promise<FederationRoundNodeTaskRow[]> {
    const C = FEDERATION_ROUND_NODE_TASKS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUND_NODE_TASKS.TABLE)
        .select('*')
        .eq(C.federation_round_id, roundId);

    if (error) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to list federation node tasks: ${error.message}`);
    }
    return (data ?? []).map((row) => mapTask(asRecord(row)));
}

async function markTaskStatus(
    client: SupabaseClient,
    taskId: string,
    status: FederationRoundNodeTaskStatus,
): Promise<FederationRoundNodeTaskRow> {
    const C = FEDERATION_ROUND_NODE_TASKS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUND_NODE_TASKS.TABLE)
        .update({ [C.task_status]: status })
        .eq(C.id, taskId)
        .select('*')
        .single();

    if (error || !data) {
        throw new FederationCoordinatorRuntimeError(503, `Failed to update federation node task status: ${error?.message ?? 'unknown error'}`);
    }
    return mapTask(asRecord(data));
}

function assertCoordinatorAccess(round: FederationRoundRow, actorTenantId: string | null): void {
    if (actorTenantId && actorTenantId !== round.coordinator_tenant_id) {
        throw new FederationCoordinatorRuntimeError(403, 'Only the federation coordinator can perform this action.');
    }
}

function taskStatusForReview(status: CoordinatorUpdateReviewStatus): FederationRoundNodeTaskStatus {
    if (status === 'accepted') return 'accepted';
    return 'rejected';
}

function normalizeTaskTypes(value: CoordinatorTaskType[] | null | undefined): CoordinatorTaskType[] {
    const requested = Array.isArray(value) && value.length > 0 ? value : ['diagnosis_delta', 'severity_delta', 'support_summary'];
    return unique(requested.filter((taskType): taskType is CoordinatorTaskType =>
        COORDINATOR_TASK_TYPES.includes(taskType as CoordinatorTaskType),
    ));
}

function resolveCoordinatorPartnerRef(membership: Pick<FederationMembershipRow, 'tenant_id' | 'metadata'>): string {
    const metadata = membership.metadata;
    return normalizePartnerRef(metadata.partner_ref)
        ?? normalizePartnerRef(asRecord(metadata.federation_node).partner_ref)
        ?? normalizePartnerRef(asRecord(metadata.live_node).partner_ref)
        ?? `tenant:${membership.tenant_id}`;
}

function buildCoordinatorPeerConfig(participant: CoordinatorTaskPlanParticipant): CoordinatorSecureAggregationPeerConfig {
    const keyMaterial = readParticipantNodeKeyMaterial(participant.membership.metadata);
    return {
        node_ref: participant.node_ref,
        partner_ref: participant.partner_ref,
        tenant_id: participant.membership.tenant_id,
        public_key_fingerprint: keyMaterial.public_key_fingerprint,
        public_key_der_base64: keyMaterial.public_key_der_base64,
        public_key_pem: keyMaterial.public_key_pem,
        status: keyMaterial.public_key_der_base64 || keyMaterial.public_key_pem ? 'active' : 'unknown',
    };
}

function normalizeConfiguredPeer(value: unknown): CoordinatorSecureAggregationPeerConfig | null {
    const peer = asRecord(value);
    const nodeRef = normalizeNodeRef(peer.node_ref ?? peer.nodeRef);
    if (!nodeRef) return null;
    const partnerRef = normalizePartnerRef(peer.partner_ref ?? peer.partnerRef) ?? `node:${nodeRef}`;
    const publicKeyDerBase64 = readText(peer.public_key_der_base64 ?? peer.publicKeyDerBase64);
    const publicKeyPem = readText(peer.public_key_pem ?? peer.publicKeyPem);
    return {
        node_ref: nodeRef,
        partner_ref: partnerRef,
        tenant_id: readText(peer.tenant_id ?? peer.tenantId) ?? '',
        public_key_fingerprint: readText(peer.public_key_fingerprint ?? peer.publicKeyFingerprint),
        public_key_der_base64: publicKeyDerBase64,
        public_key_pem: publicKeyPem,
        status: peer.status === 'unknown' ? 'unknown' : 'active',
    };
}

function mergePeerConfigs(
    generatedPeers: CoordinatorSecureAggregationPeerConfig[],
    configuredPeers: CoordinatorSecureAggregationPeerConfig[],
): CoordinatorSecureAggregationPeerConfig[] {
    const byNodeRef = new Map<string, CoordinatorSecureAggregationPeerConfig>();
    for (const peer of generatedPeers) {
        byNodeRef.set(peer.node_ref, peer);
    }
    for (const peer of configuredPeers) {
        const current = byNodeRef.get(peer.node_ref);
        byNodeRef.set(peer.node_ref, {
            node_ref: peer.node_ref,
            partner_ref: peer.partner_ref || current?.partner_ref || `node:${peer.node_ref}`,
            tenant_id: peer.tenant_id || current?.tenant_id || '',
            public_key_fingerprint: peer.public_key_fingerprint ?? current?.public_key_fingerprint ?? null,
            public_key_der_base64: peer.public_key_der_base64 ?? current?.public_key_der_base64 ?? null,
            public_key_pem: peer.public_key_pem ?? current?.public_key_pem ?? null,
            status: peer.status === 'active' || current?.status === 'active' ? 'active' : 'unknown',
        });
    }
    return Array.from(byNodeRef.values()).sort((left, right) => left.node_ref.localeCompare(right.node_ref));
}

function readParticipantNodeKeyMaterial(metadata: Record<string, unknown>): {
    public_key_fingerprint: string | null;
    public_key_der_base64: string | null;
    public_key_pem: string | null;
} {
    const liveNode = asRecord(metadata.live_node);
    const federationNode = asRecord(metadata.federation_node);
    const secureAggregation = asRecord(metadata.secure_aggregation);
    const liveNodeSecureAggregation = asRecord(liveNode.secure_aggregation);
    const federationNodeSecureAggregation = asRecord(federationNode.secure_aggregation);
    const sources = [
        metadata,
        liveNode,
        federationNode,
        secureAggregation,
        liveNodeSecureAggregation,
        federationNodeSecureAggregation,
    ];
    const publicKeyDerBase64 = readFirstTextFromSources(sources, [
        'node_public_key_der_base64',
        'public_key_der_base64',
        'publicKeyDerBase64',
    ]);
    const publicKeyPem = readFirstTextFromSources(sources, [
        'node_public_key_pem',
        'public_key_pem',
        'publicKeyPem',
    ]);
    const publicKeyFingerprint = readFirstTextFromSources(sources, [
        'node_public_key_fingerprint',
        'public_key_fingerprint',
        'publicKeyFingerprint',
    ]);

    return {
        public_key_fingerprint: publicKeyFingerprint,
        public_key_der_base64: publicKeyDerBase64,
        public_key_pem: publicKeyPem,
    };
}

function readFirstTextFromSources(sources: Array<Record<string, unknown>>, keys: string[]): string | null {
    for (const source of sources) {
        for (const key of keys) {
            const value = readText(source[key]);
            if (value) return value;
        }
    }
    return null;
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

function mapEligibility(row: Record<string, unknown>): CoordinatorOutcomeEligibilitySnapshot {
    return {
        id: String(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        federation_key: readText(row.federation_key) ?? '',
        eligibility_status: readText(row.eligibility_status) ?? 'insufficient_evidence',
        outcome_confirmed_rows: readNumber(row.outcome_confirmed_rows) ?? 0,
        provenance_verified_rows: readNumber(row.provenance_verified_rows) ?? 0,
        trust_scored_rows: readNumber(row.trust_scored_rows) ?? 0,
        average_trust_score: readNumber(row.average_trust_score) ?? 0,
        source_record_digest: readText(row.source_record_digest),
        observed_at: readText(row.observed_at),
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
        masking_protocol: readText(row.masking_protocol),
        payload_commitment_hash: readText(row.payload_commitment_hash) ?? '',
        mask_commitment_hash: readText(row.mask_commitment_hash),
        signed_payload_hash: readText(row.signed_payload_hash),
        signature_algorithm: readText(row.signature_algorithm),
        signature_hash: readText(row.signature_hash),
        signing_key_fingerprint: readText(row.signing_key_fingerprint),
        masked_update_summary: asRecord(row.masked_update_summary),
        public_summary: asRecord(row.public_summary),
        evidence: asRecord(row.evidence),
        observed_at: readText(row.observed_at),
        created_at: readText(row.created_at),
    };
}

function normalizeTaskType(value: unknown): FederationRoundNodeTaskType {
    if (COORDINATOR_TASK_TYPES.includes(value as CoordinatorTaskType)) {
        return value as FederationRoundNodeTaskType;
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

function normalizeUpdateRole(value: unknown): FederatedUpdateRole {
    if (value === 'diagnosis' || value === 'severity' || value === 'support' || value === 'unmask_share') {
        return value;
    }
    return contributionRoleForTaskType(null);
}

function readMaskedIntegerVector(value: unknown): Record<string, number> {
    const record = asRecord(value);
    const vector: Record<string, number> = {};
    for (const [dimension, raw] of Object.entries(record)) {
        const numeric = readNumber(raw);
        if (numeric == null || !Number.isSafeInteger(numeric)) {
            continue;
        }
        vector[dimension] = numeric;
    }
    return vector;
}

function readEncryptedUnmaskEnvelopeHashes(secureAggregation: Record<string, unknown>): string[] {
    const directHashes = readStringArray(secureAggregation.encrypted_unmask_share_envelope_hashes);
    const envelopeHashes = Array.isArray(secureAggregation.encrypted_unmask_share_envelopes)
        ? secureAggregation.encrypted_unmask_share_envelopes
            .map((envelope) => readText(asRecord(envelope).envelope_hash))
            .filter((hash): hash is string => Boolean(hash))
        : [];
    return [...directHashes, ...envelopeHashes];
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map((item) => readText(item)).filter((item): item is string => Boolean(item))
        : [];
}

function chooseAggregateMaskingProtocol(protocols: string[]): string {
    const normalized = unique(protocols.filter((protocol): protocol is string => Boolean(protocol)));
    if (normalized.length === 0) {
        return 'unknown';
    }
    if (normalized.length === 1) {
        return normalized[0]!;
    }
    if (normalized.every((protocol) => protocol === 'x25519_hkdf_pairwise_masked_v1')) {
        return 'x25519_hkdf_pairwise_masked_v1';
    }
    return 'mixed_secure_aggregation_protocols';
}

function buildSecureAggregateNextActions(
    status: CoordinatorSecureAggregateMaterialization['status'],
    dropoutRecoveryEvidenceStatus: CoordinatorSecureAggregateMaterialization['dropout_recovery_evidence_status'],
): string[] {
    if (status === 'blocked') {
        return [
            'review_missing_or_inconsistent_masked_update_vectors',
            'require_nodes_to_resubmit_x25519_masked_update_summaries',
            'do_not_promote_candidate_from_this_round',
        ];
    }
    if (dropoutRecoveryEvidenceStatus !== 'encrypted_unmask_envelopes_available') {
        return [
            'collect_encrypted_unmask_share_envelopes_before_dropout_recovery',
            'keep_round_in_secure_aggregate_materialized_state',
        ];
    }
    return [
        'run_threshold_dropout_recovery_if_needed',
        'handoff_masked_aggregate_to_federated_evaluation_gate',
    ];
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

function compareIso(left: string | null, right: string | null): number {
    const leftMs = left ? Date.parse(left) : 0;
    const rightMs = right ? Date.parse(right) : 0;
    return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
}

function stableHash(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        return `{${Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function unique<T extends string>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
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
