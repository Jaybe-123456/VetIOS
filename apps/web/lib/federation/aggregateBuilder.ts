import {
    createDecipheriv,
    createHash,
    createHmac,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    type KeyObject,
} from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    FEDERATED_UPDATE_SUBMISSIONS,
    FEDERATION_ROUNDS,
    MODEL_DELTA_ARTIFACTS,
} from '@/lib/db/schemaContracts';
import type { FederatedUpdateRole, FederationRoundRow } from '@/lib/federation/nodeRuntime';

export const FEDERATED_AGGREGATE_TASK_TYPES = ['diagnosis', 'severity'] as const;

export type FederatedAggregateTaskType = typeof FEDERATED_AGGREGATE_TASK_TYPES[number];

export interface FederatedAggregateUpdateEvidence {
    id: string;
    tenant_id: string;
    federation_round_id: string;
    outcome_eligibility_snapshot_id: string | null;
    federation_key: string;
    round_key: string;
    node_ref: string;
    partner_ref: string;
    participant_ref: string;
    contribution_role: FederatedUpdateRole;
    submission_status: string;
    masking_protocol: string | null;
    payload_commitment_hash: string;
    mask_commitment_hash: string | null;
    signed_payload_hash: string | null;
    signature_algorithm: string | null;
    signature_hash: string | null;
    signing_key_fingerprint: string | null;
    masked_update_summary: Record<string, unknown>;
    public_summary: Record<string, unknown>;
    evidence: Record<string, unknown>;
    observed_at: string | null;
    created_at: string | null;
}

export interface FederatedAggregateArtifactRecord {
    id: string;
    federation_round_id: string;
    federation_key: string;
    coordinator_tenant_id: string;
    tenant_id: string | null;
    artifact_role: 'aggregate_candidate';
    task_type: FederatedAggregateTaskType;
    model_version: string;
    dataset_version: string;
    artifact_payload: Record<string, unknown>;
    summary: Record<string, unknown>;
    created_at: string | null;
}

export interface FederatedAggregateArtifactDraft {
    task_type: FederatedAggregateTaskType;
    model_version: string;
    dataset_version: string;
    artifact_payload: Record<string, unknown>;
    summary: Record<string, unknown>;
    blockers: string[];
}

export interface CoordinatorRecoveryKeyMaterial {
    privateKeyPem?: string | null;
    privateKeyDerBase64?: string | null;
}

interface EncryptedUnmaskShareEnvelope {
    schema: 'vetios_encrypted_unmask_share_envelope_v1';
    federation_round_id: string;
    round_node_task_id: string;
    round_key: string;
    sender_node_ref: string;
    sender_public_key_der_base64: string;
    sender_public_key_fingerprint: string;
    peer_node_ref: string;
    direction: 'add' | 'subtract';
    recipient: 'coordinator';
    encryption_protocol: 'x25519_aes_256_gcm_v1';
    key_agreement_protocol: 'x25519_hkdf_sha256_v1';
    aad_hash: string;
    iv_base64: string;
    ciphertext_base64: string;
    auth_tag_base64: string;
    envelope_hash: string;
}

interface ParsedSecureAggregateUpdate {
    update: FederatedAggregateUpdateEvidence;
    protocol: string | null;
    quantizationScale: number | null;
    dimensionOrderDigest: string | null;
    maskedVectorDigest: string | null;
    vector: Record<string, number> | null;
    maskRange: number | null;
    encryptedUnmaskShareEnvelopeHashes: string[];
    encryptedUnmaskShareEnvelopes: EncryptedUnmaskShareEnvelope[];
}

interface DecryptedUnmaskShare {
    sender_node_ref: string;
    peer_node_ref: string;
    direction: 'add' | 'subtract';
    mask_seed: string;
    mask_range: number;
    seed_digest: string;
    mask_vector_digest: string;
}

export interface BuildFederatedAggregateArtifactsResult {
    round: FederationRoundRow;
    accepted_submissions: FederatedAggregateUpdateEvidence[];
    artifacts: FederatedAggregateArtifactRecord[];
    artifact_drafts: FederatedAggregateArtifactDraft[];
    blockers: string[];
    summary: Record<string, unknown>;
}

export class FederatedAggregateBuilderError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'FederatedAggregateBuilderError';
    }
}

export function buildFederatedAggregateArtifactDraft(input: {
    round: FederationRoundRow;
    taskType: FederatedAggregateTaskType;
    acceptedUpdates: FederatedAggregateUpdateEvidence[];
    minimumAcceptedUpdates: number;
    coordinatorRecoveryKeyMaterial?: CoordinatorRecoveryKeyMaterial | null;
    builtAt?: string;
}): FederatedAggregateArtifactDraft {
    const builtAt = input.builtAt ?? new Date().toISOString();
    const secureAggregateMaterialization = buildSecureAggregateMaterialization(
        input.acceptedUpdates,
        input.coordinatorRecoveryKeyMaterial ?? null,
    );
    const blockers = [
        ...validateAcceptedUpdates(input.acceptedUpdates, input.minimumAcceptedUpdates),
        ...secureAggregateMaterialization.blockers,
    ].sort();
    const sourceUpdateDigest = stableHash(input.acceptedUpdates.map((update) => ({
        id: update.id,
        participant_ref: update.participant_ref,
        node_ref: update.node_ref,
        outcome_eligibility_snapshot_id: update.outcome_eligibility_snapshot_id,
        payload_commitment_hash: update.payload_commitment_hash,
        mask_commitment_hash: update.mask_commitment_hash,
        signed_payload_hash: update.signed_payload_hash,
        signature_hash: update.signature_hash,
    })));
    const shortDigest = sourceUpdateDigest.slice(0, 16);
    const modelVersion = `fed-${input.round.federation_key}-${input.round.round_key}-${input.taskType}-${shortDigest}`
        .toLowerCase()
        .replace(/[^a-z0-9:._-]+/g, '-')
        .slice(0, 160);
    const datasetVersion = `federated:${input.round.round_key}:${sourceUpdateDigest}`;
    const acceptedNodeRefs = uniqueNonEmpty(input.acceptedUpdates.map((update) => update.node_ref));
    const acceptedParticipantRefs = uniqueNonEmpty(input.acceptedUpdates.map((update) => update.participant_ref));
    const outcomeEligibilitySnapshotIds = uniqueNonEmpty(input.acceptedUpdates.map((update) => update.outcome_eligibility_snapshot_id));
    const publicSummaries = input.acceptedUpdates.map((update) => ({
        update_submission_id: update.id,
        node_ref: update.node_ref,
        participant_ref: update.participant_ref,
        public_summary: update.public_summary,
        evidence_digest: stableHash(update.evidence),
    }));

    const artifactPayload = {
        artifact_type: secureAggregateMaterialization.status === 'materialized'
            ? 'federated_secure_aggregate_materialization_v1'
            : 'federated_masked_update_manifest_v1',
        aggregation_mode: secureAggregateMaterialization.status === 'materialized'
            ? 'secure_aggregation_masked_vector_sum'
            : 'secure_aggregation_commitment_manifest',
        task_type: input.taskType,
        federation_round_id: input.round.id,
        federation_key: input.round.federation_key,
        round_key: input.round.round_key,
        model_version: modelVersion,
        dataset_version: datasetVersion,
        feature_schema_version: 'federated_feature_schema_v1',
        label_policy_version: 'outcome_confirmed_federated_v1',
        built_at: builtAt,
        accepted_update_count: input.acceptedUpdates.length,
        accepted_node_refs: acceptedNodeRefs,
        accepted_participant_refs: acceptedParticipantRefs,
        outcome_eligibility_snapshot_ids: outcomeEligibilitySnapshotIds,
        payload_commitment_hashes: uniqueNonEmpty(input.acceptedUpdates.map((update) => update.payload_commitment_hash)),
        mask_commitment_hashes: uniqueNonEmpty(input.acceptedUpdates.map((update) => update.mask_commitment_hash)),
        signed_payload_hashes: uniqueNonEmpty(input.acceptedUpdates.map((update) => update.signed_payload_hash)),
        signature_hashes: uniqueNonEmpty(input.acceptedUpdates.map((update) => update.signature_hash)),
        signing_key_fingerprints: uniqueNonEmpty(input.acceptedUpdates.map((update) => update.signing_key_fingerprint)),
        masking_protocols: uniqueNonEmpty(input.acceptedUpdates.map((update) => update.masking_protocol)),
        public_update_summaries: publicSummaries,
        secure_aggregate_materialization: secureAggregateMaterialization,
        source_update_digest: sourceUpdateDigest,
        raw_site_delta_artifacts_stored: false,
        raw_clinical_rows_shared: false,
        coordinator_visibility: 'commitments_public_summaries_and_secure_aggregate_only',
        value_capture_layer: {
            outcome_eligibility_snapshot_count: outcomeEligibilitySnapshotIds.length,
            accepted_update_count: input.acceptedUpdates.length,
            provenance_unit: 'outcome_confirmed_commitment_manifest',
            scarcity_layer: 'confirmed_outcome_linked_provenance_verified_clinical_data',
        },
        blockers,
    };

    return {
        task_type: input.taskType,
        model_version: modelVersion,
        dataset_version: datasetVersion,
        artifact_payload: artifactPayload,
        summary: {
            task_type: input.taskType,
            status: blockers.length === 0 ? 'aggregate_candidate_ready' : 'aggregate_candidate_blocked',
            accepted_update_count: input.acceptedUpdates.length,
            accepted_node_count: acceptedNodeRefs.length,
            outcome_eligibility_snapshot_count: outcomeEligibilitySnapshotIds.length,
            source_update_digest: sourceUpdateDigest,
            built_at: builtAt,
            blockers,
        },
        blockers,
    };
}

export async function buildFederatedAggregateArtifacts(
    client: SupabaseClient,
    input: {
        federationRoundId: string;
        actorTenantId: string | null;
        actor: string | null;
        taskTypes?: FederatedAggregateTaskType[];
        minimumAcceptedUpdates?: number | null;
        markCompleted?: boolean;
        evidence?: Record<string, unknown>;
        coordinatorPrivateKeyPem?: string | null;
        coordinatorPrivateKeyDerBase64?: string | null;
    },
): Promise<BuildFederatedAggregateArtifactsResult> {
    const round = await loadFederationRound(client, input.federationRoundId);
    assertCoordinatorAccess(round, input.actorTenantId);
    const coordinatorRecoveryKeyMaterial = resolveCoordinatorRecoveryKeyMaterial(input);
    const aggregateEvidence = redactCoordinatorRecoveryKeyMaterial(input.evidence ?? {});
    const acceptedSubmissions = (await listAcceptedUpdateSubmissions(client, round.id))
        .filter((submission) => submission.federation_key === round.federation_key);
    const taskTypes = normalizeTaskTypes(input.taskTypes);
    const minimumAcceptedUpdates = Math.max(1, input.minimumAcceptedUpdates ?? Math.min(2, Math.max(1, round.participant_count)));
    const builtAt = new Date().toISOString();
    const drafts = taskTypes.map((taskType) => buildFederatedAggregateArtifactDraft({
        round,
        taskType,
        acceptedUpdates: acceptedSubmissions.filter((submission) => submission.contribution_role === taskType),
        minimumAcceptedUpdates,
        coordinatorRecoveryKeyMaterial,
        builtAt,
    }));
    const readyDrafts = drafts.filter((draft) => draft.blockers.length === 0);
    const blockers = uniqueNonEmpty(drafts.flatMap((draft) =>
        draft.blockers.map((blocker) => `${draft.task_type}:${blocker}`),
    ));

    if (readyDrafts.length === 0) {
        throw new FederatedAggregateBuilderError(409, `No aggregate candidate artifacts are ready: ${blockers.join(', ') || 'no accepted updates'}.`);
    }

    const artifacts: FederatedAggregateArtifactRecord[] = [];
    for (const draft of readyDrafts) {
        artifacts.push(await insertOrLoadAggregateArtifact(client, round, draft));
    }

    const updatedRound = await updateRoundCandidateArtifactPayload(client, round, {
        artifacts,
        drafts,
        actor: input.actor,
        builtAt,
        markCompleted: input.markCompleted === true,
        evidence: aggregateEvidence,
    });

    return {
        round: updatedRound,
        accepted_submissions: acceptedSubmissions,
        artifacts,
        artifact_drafts: drafts,
        blockers,
        summary: {
            status: blockers.length === 0 ? 'aggregate_candidates_ready' : 'aggregate_candidates_partially_ready',
            artifact_count: artifacts.length,
            accepted_update_count: acceptedSubmissions.length,
            accepted_roles: uniqueNonEmpty(acceptedSubmissions.map((submission) => submission.contribution_role)),
            built_at: builtAt,
            blockers,
        },
    };
}

function validateAcceptedUpdates(updates: FederatedAggregateUpdateEvidence[], minimumAcceptedUpdates: number): string[] {
    const blockers = new Set<string>();
    if (updates.length < minimumAcceptedUpdates) {
        blockers.add('accepted_updates_below_minimum');
    }
    if (updates.some((update) => update.submission_status !== 'accepted')) {
        blockers.add('non_accepted_update_present');
    }
    if (updates.some((update) => !isSha256(update.payload_commitment_hash))) {
        blockers.add('accepted_update_missing_payload_commitment');
    }
    if (updates.some((update) => !isSha256(update.mask_commitment_hash))) {
        blockers.add('accepted_update_missing_mask_commitment');
    }
    if (updates.some((update) => !update.outcome_eligibility_snapshot_id)) {
        blockers.add('accepted_update_missing_outcome_eligibility_snapshot');
    }
    if (uniqueNonEmpty(updates.map((update) => update.node_ref)).length < minimumAcceptedUpdates) {
        blockers.add('accepted_node_refs_below_minimum');
    }
    return Array.from(blockers).sort();
}

function buildSecureAggregateMaterialization(
    updates: FederatedAggregateUpdateEvidence[],
    coordinatorRecoveryKeyMaterial: CoordinatorRecoveryKeyMaterial | null,
): {
    status: 'materialized' | 'blocked';
    protocol: string | null;
    quantization_scale: number | null;
    dimension_count: number;
    dimension_order_digest: string | null;
    accepted_update_count: number;
    aggregate_masked_vector_digest: string | null;
    aggregate_integer_vector: Record<string, number> | null;
    aggregate_dequantized_vector_preview: Record<string, number> | null;
    source_masked_vector_digests: string[];
    encrypted_unmask_share_envelope_count: number;
    source_encrypted_unmask_share_envelope_hashes: string[];
    decrypted_unmask_share_count: number;
    applied_dropout_unmask_share_count: number;
    dropout_recovered_peer_refs: string[];
    dropout_recovery_adjustment_digest: string | null;
    dropout_recovery_evidence_status:
        | 'decrypted_and_applied'
        | 'decrypted_no_dropout_correction_needed'
        | 'encrypted_envelopes_available'
        | 'encrypted_envelopes_missing'
        | 'not_required';
    blockers: string[];
} {
    const blockers = new Set<string>();
    const coordinatorPrivateKey = readCoordinatorPrivateKey(coordinatorRecoveryKeyMaterial);
    const parsed = updates.map((update) => {
        const secureAggregation = asRecord(update.masked_update_summary.secure_aggregation);
        return {
            update,
            protocol: readText(secureAggregation.masking_protocol),
            quantizationScale: readNumber(secureAggregation.quantization_scale),
            dimensionOrderDigest: readText(secureAggregation.dimension_order_digest),
            maskedVectorDigest: readText(secureAggregation.masked_vector_digest),
            vector: readNumberRecord(secureAggregation.masked_integer_vector),
            maskRange: readNumber(secureAggregation.mask_range),
            encryptedUnmaskShareEnvelopeHashes: readEnvelopeHashes(secureAggregation.encrypted_unmask_share_envelopes),
            encryptedUnmaskShareEnvelopes: readEncryptedUnmaskShareEnvelopes(secureAggregation.encrypted_unmask_share_envelopes),
        };
    });
    const encryptedEnvelopeHashes = uniqueNonEmpty(parsed.flatMap((entry) => entry.encryptedUnmaskShareEnvelopeHashes));

    if (parsed.length === 0) {
        blockers.add('accepted_updates_missing');
    }
    if (parsed.some((entry) => !entry.vector || Object.keys(entry.vector).length === 0)) {
        blockers.add('accepted_update_missing_masked_integer_vector');
    }
    if (parsed.some((entry) => !entry.dimensionOrderDigest || !isSha256(entry.dimensionOrderDigest))) {
        blockers.add('accepted_update_missing_dimension_order_digest');
    }
    if (parsed.some((entry) => !entry.maskedVectorDigest || !isSha256(entry.maskedVectorDigest))) {
        blockers.add('accepted_update_missing_masked_vector_digest');
    }
    if (parsed.some((entry) => !entry.quantizationScale || entry.quantizationScale <= 0)) {
        blockers.add('accepted_update_missing_quantization_scale');
    }
    if (parsed.some((entry) => !entry.maskRange || entry.maskRange <= 0)) {
        blockers.add('accepted_update_missing_mask_range');
    }
    const protocols = uniqueNonEmpty(parsed.map((entry) => entry.protocol));
    if (protocols.length > 1) {
        blockers.add('mixed_secure_aggregation_protocols');
    }
    const dimensionOrderDigests = uniqueNonEmpty(parsed.map((entry) => entry.dimensionOrderDigest));
    if (dimensionOrderDigests.length > 1) {
        blockers.add('mixed_dimension_orders');
    }
    const quantizationScales = uniqueNonEmpty(parsed.map((entry) =>
        entry.quantizationScale == null ? null : String(entry.quantizationScale),
    ));
    if (quantizationScales.length > 1) {
        blockers.add('mixed_quantization_scales');
    }
    if (protocols[0] === 'pairwise_masked_commitment_v1') {
        blockers.add('legacy_commitment_protocol_not_materializable');
    }
    if (protocols[0] === 'x25519_hkdf_pairwise_masked_v1'
        && parsed.some((entry) => entry.encryptedUnmaskShareEnvelopeHashes.length === 0)) {
        blockers.add('encrypted_unmask_share_envelopes_missing');
    }
    if (protocols[0] === 'x25519_hkdf_pairwise_masked_v1'
        && encryptedEnvelopeHashes.length > 0
        && !coordinatorPrivateKey) {
        blockers.add('coordinator_private_key_missing_for_unmask_share_recovery');
    }

    if (blockers.size > 0) {
        return {
            status: 'blocked',
            protocol: protocols[0] ?? null,
            quantization_scale: parsed[0]?.quantizationScale ?? null,
            dimension_count: 0,
            dimension_order_digest: dimensionOrderDigests[0] ?? null,
            accepted_update_count: updates.length,
            aggregate_masked_vector_digest: null,
            aggregate_integer_vector: null,
            aggregate_dequantized_vector_preview: null,
            source_masked_vector_digests: uniqueNonEmpty(parsed.map((entry) => entry.maskedVectorDigest)),
            encrypted_unmask_share_envelope_count: encryptedEnvelopeHashes.length,
            source_encrypted_unmask_share_envelope_hashes: encryptedEnvelopeHashes,
            decrypted_unmask_share_count: 0,
            applied_dropout_unmask_share_count: 0,
            dropout_recovered_peer_refs: [],
            dropout_recovery_adjustment_digest: null,
            dropout_recovery_evidence_status: encryptedEnvelopeHashes.length > 0
                ? 'encrypted_envelopes_available'
                : 'encrypted_envelopes_missing',
            blockers: Array.from(blockers).sort(),
        };
    }

    const vectors = parsed.map((entry) => entry.vector ?? {});
    const dimensions = Array.from(new Set(vectors.flatMap((vector) => Object.keys(vector)))).sort();
    const aggregateMaskedIntegerVector = Object.fromEntries(dimensions.map((dimension) => [
        dimension,
        vectors.reduce((sum, vector) => sum + (vector[dimension] ?? 0), 0),
    ]));
    const dropoutRecovery = buildDropoutRecoveryMaterialization({
        parsed,
        coordinatorPrivateKey,
        dimensions,
        aggregateIntegerVector: aggregateMaskedIntegerVector,
    });
    for (const blocker of dropoutRecovery.blockers) {
        blockers.add(blocker);
    }

    if (blockers.size > 0) {
        return {
            status: 'blocked',
            protocol: protocols[0] ?? null,
            quantization_scale: parsed[0]?.quantizationScale ?? null,
            dimension_count: dimensions.length,
            dimension_order_digest: dimensionOrderDigests[0] ?? null,
            accepted_update_count: updates.length,
            aggregate_masked_vector_digest: null,
            aggregate_integer_vector: null,
            aggregate_dequantized_vector_preview: null,
            source_masked_vector_digests: uniqueNonEmpty(parsed.map((entry) => entry.maskedVectorDigest)),
            encrypted_unmask_share_envelope_count: encryptedEnvelopeHashes.length,
            source_encrypted_unmask_share_envelope_hashes: encryptedEnvelopeHashes,
            decrypted_unmask_share_count: dropoutRecovery.decryptedShareCount,
            applied_dropout_unmask_share_count: dropoutRecovery.appliedShareCount,
            dropout_recovered_peer_refs: dropoutRecovery.recoveredPeerRefs,
            dropout_recovery_adjustment_digest: dropoutRecovery.adjustmentDigest,
            dropout_recovery_evidence_status: dropoutRecovery.status,
            blockers: Array.from(blockers).sort(),
        };
    }

    const aggregateIntegerVector = dropoutRecovery.recoveredAggregateIntegerVector;
    const scale = parsed[0]?.quantizationScale ?? 1;
    const aggregateDequantizedVectorPreview = Object.fromEntries(dimensions.slice(0, 200).map((dimension) => [
        dimension,
        Math.round(((aggregateIntegerVector[dimension] ?? 0) / scale) * 10_000) / 10_000,
    ]));

    return {
        status: 'materialized',
        protocol: protocols[0] ?? null,
        quantization_scale: scale,
        dimension_count: dimensions.length,
        dimension_order_digest: dimensionOrderDigests[0] ?? null,
        accepted_update_count: updates.length,
        aggregate_masked_vector_digest: stableHash(aggregateIntegerVector),
        aggregate_integer_vector: aggregateIntegerVector,
        aggregate_dequantized_vector_preview: aggregateDequantizedVectorPreview,
        source_masked_vector_digests: uniqueNonEmpty(parsed.map((entry) => entry.maskedVectorDigest)),
        encrypted_unmask_share_envelope_count: encryptedEnvelopeHashes.length,
        source_encrypted_unmask_share_envelope_hashes: encryptedEnvelopeHashes,
        decrypted_unmask_share_count: dropoutRecovery.decryptedShareCount,
        applied_dropout_unmask_share_count: dropoutRecovery.appliedShareCount,
        dropout_recovered_peer_refs: dropoutRecovery.recoveredPeerRefs,
        dropout_recovery_adjustment_digest: dropoutRecovery.adjustmentDigest,
        dropout_recovery_evidence_status: dropoutRecovery.status,
        blockers: [],
    };
}

function buildDropoutRecoveryMaterialization(input: {
    parsed: ParsedSecureAggregateUpdate[];
    coordinatorPrivateKey: KeyObject | null;
    dimensions: string[];
    aggregateIntegerVector: Record<string, number>;
}): {
    recoveredAggregateIntegerVector: Record<string, number>;
    decryptedShareCount: number;
    appliedShareCount: number;
    recoveredPeerRefs: string[];
    adjustmentDigest: string | null;
    status:
        | 'decrypted_and_applied'
        | 'decrypted_no_dropout_correction_needed'
        | 'encrypted_envelopes_available'
        | 'encrypted_envelopes_missing'
        | 'not_required';
    blockers: string[];
} {
    const blockers = new Set<string>();
    const acceptedNodeRefs = new Set(input.parsed.map((entry) => entry.update.node_ref).filter((value) => value.length > 0));
    const adjustmentVector = Object.fromEntries(input.dimensions.map((dimension) => [dimension, 0]));
    const recoveredPeerRefs = new Set<string>();
    let decryptedShareCount = 0;
    let appliedShareCount = 0;

    for (const entry of input.parsed) {
        for (const envelope of entry.encryptedUnmaskShareEnvelopes) {
            if (!isEnvelopeHashValid(envelope)) {
                blockers.add('invalid_encrypted_unmask_share_envelope_hash');
                continue;
            }
            if (!input.coordinatorPrivateKey) {
                blockers.add('coordinator_private_key_missing_for_unmask_share_recovery');
                continue;
            }
            const share = decryptUnmaskShareEnvelope(envelope, input.coordinatorPrivateKey);
            if (!share) {
                blockers.add('encrypted_unmask_share_decryption_failed');
                continue;
            }
            decryptedShareCount += 1;
            if (share.sender_node_ref !== entry.update.node_ref || share.peer_node_ref !== envelope.peer_node_ref) {
                blockers.add('encrypted_unmask_share_sender_or_peer_mismatch');
                continue;
            }
            if (stableHash(share.mask_seed) !== share.seed_digest) {
                blockers.add('encrypted_unmask_share_seed_digest_mismatch');
                continue;
            }
            const maskVector = buildPairwiseMaskVector(share.mask_seed, input.dimensions, share.mask_range);
            if (stableHash(maskVector) !== share.mask_vector_digest) {
                blockers.add('encrypted_unmask_share_mask_vector_digest_mismatch');
                continue;
            }
            if (acceptedNodeRefs.has(share.peer_node_ref)) {
                continue;
            }
            const sign = share.direction === 'add' ? 1 : -1;
            for (const dimension of input.dimensions) {
                adjustmentVector[dimension] = (adjustmentVector[dimension] ?? 0) - sign * (maskVector[dimension] ?? 0);
            }
            recoveredPeerRefs.add(share.peer_node_ref);
            appliedShareCount += 1;
        }
    }

    const recoveredAggregateIntegerVector = Object.fromEntries(input.dimensions.map((dimension) => [
        dimension,
        (input.aggregateIntegerVector[dimension] ?? 0) + (adjustmentVector[dimension] ?? 0),
    ]));
    const envelopeCount = input.parsed.reduce((sum, entry) => sum + entry.encryptedUnmaskShareEnvelopes.length, 0);
    const adjustmentDigest = appliedShareCount > 0 ? stableHash(adjustmentVector) : null;

    return {
        recoveredAggregateIntegerVector,
        decryptedShareCount,
        appliedShareCount,
        recoveredPeerRefs: Array.from(recoveredPeerRefs).sort(),
        adjustmentDigest,
        status: appliedShareCount > 0
            ? 'decrypted_and_applied'
            : decryptedShareCount > 0
                ? 'decrypted_no_dropout_correction_needed'
                : envelopeCount > 0
                    ? 'encrypted_envelopes_available'
                    : 'not_required',
        blockers: Array.from(blockers).sort(),
    };
}

function decryptUnmaskShareEnvelope(
    envelope: EncryptedUnmaskShareEnvelope,
    coordinatorPrivateKey: KeyObject,
): DecryptedUnmaskShare | null {
    try {
        const senderPublicKey = createPublicKey({
            key: Buffer.from(envelope.sender_public_key_der_base64, 'base64'),
            format: 'der',
            type: 'spki',
        });
        const aad = {
            schema: 'vetios_unmask_share_envelope_aad_v1',
            federation_round_id: envelope.federation_round_id,
            round_node_task_id: envelope.round_node_task_id,
            round_key: envelope.round_key,
            node_ref: envelope.sender_node_ref,
            peer_node_ref: envelope.peer_node_ref,
            direction: envelope.direction,
            key_agreement_protocol: 'x25519_hkdf_sha256_v1',
        };
        if (stableHash(aad) !== envelope.aad_hash) return null;
        const sharedSecret = diffieHellman({
            privateKey: coordinatorPrivateKey,
            publicKey: senderPublicKey,
        });
        const salt = Buffer.from(stableHash({
            ...aad,
            envelope_scope: 'coordinator_dropout_recovery_unmask_share',
        }), 'hex');
        const info = Buffer.from(`vetios-secagg-unmask-share:${envelope.round_key}:${envelope.round_node_task_id}:${envelope.peer_node_ref}`, 'utf8');
        const decryptionKey = hkdfSha256(sharedSecret, salt, info, 32);
        const decipher = createDecipheriv('aes-256-gcm', decryptionKey, Buffer.from(envelope.iv_base64, 'base64'));
        decipher.setAAD(Buffer.from(stableStringify(aad), 'utf8'));
        decipher.setAuthTag(Buffer.from(envelope.auth_tag_base64, 'base64'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext_base64, 'base64')),
            decipher.final(),
        ]).toString('utf8');
        const payload = asRecord(JSON.parse(plaintext));
        const direction = payload.direction === 'add' || payload.direction === 'subtract' ? payload.direction : null;
        const maskSeed = readText(payload.mask_seed);
        const seedDigest = readText(payload.seed_digest);
        const maskVectorDigest = readText(payload.mask_vector_digest);
        const maskRange = readNumber(payload.mask_range);
        if (
            payload.schema !== 'vetios_unmask_share_seed_v1'
            || payload.federation_round_id !== envelope.federation_round_id
            || payload.round_node_task_id !== envelope.round_node_task_id
            || payload.node_ref !== envelope.sender_node_ref
            || payload.peer_node_ref !== envelope.peer_node_ref
            || direction !== envelope.direction
            || !maskSeed
            || !isSha256(seedDigest)
            || !isSha256(maskVectorDigest)
            || !maskRange
            || maskRange <= 0
        ) {
            return null;
        }
        return {
            sender_node_ref: envelope.sender_node_ref,
            peer_node_ref: envelope.peer_node_ref,
            direction,
            mask_seed: maskSeed,
            mask_range: maskRange,
            seed_digest: seedDigest,
            mask_vector_digest: maskVectorDigest,
        };
    } catch {
        return null;
    }
}

function buildPairwiseMaskVector(seed: string, dimensions: string[], maskRange: number): Record<string, number> {
    return Object.fromEntries(dimensions.map((dimension, index) => [
        dimension,
        pairwiseMaskValue(seed, dimension, index, maskRange),
    ]));
}

function pairwiseMaskValue(seed: string, dimension: string, index: number, maskRange: number): number {
    const digest = createHmac('sha256', seed)
        .update(`${index}:${dimension}`)
        .digest('hex');
    const parsed = Number.parseInt(digest.slice(0, 12), 16);
    const bounded = Number.isFinite(parsed) ? parsed % (maskRange * 2 + 1) : 0;
    return bounded - maskRange;
}

async function insertOrLoadAggregateArtifact(
    client: SupabaseClient,
    round: FederationRoundRow,
    draft: FederatedAggregateArtifactDraft,
): Promise<FederatedAggregateArtifactRecord> {
    const existing = await loadAggregateArtifact(client, round.id, draft.task_type, draft.model_version);
    if (existing) return existing;

    const C = MODEL_DELTA_ARTIFACTS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_DELTA_ARTIFACTS.TABLE)
        .insert({
            [C.federation_round_id]: round.id,
            [C.federation_key]: round.federation_key,
            [C.coordinator_tenant_id]: round.coordinator_tenant_id,
            [C.tenant_id]: null,
            [C.artifact_role]: 'aggregate_candidate',
            [C.task_type]: draft.task_type,
            [C.model_version]: draft.model_version,
            [C.dataset_version]: draft.dataset_version,
            [C.artifact_payload]: draft.artifact_payload,
            [C.summary]: draft.summary,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new FederatedAggregateBuilderError(503, `Failed to create aggregate candidate artifact: ${error?.message ?? 'unknown error'}`);
    }
    return mapArtifact(asRecord(data));
}

async function updateRoundCandidateArtifactPayload(
    client: SupabaseClient,
    round: FederationRoundRow,
    input: {
        artifacts: FederatedAggregateArtifactRecord[];
        drafts: FederatedAggregateArtifactDraft[];
        actor: string | null;
        builtAt: string;
        markCompleted: boolean;
        evidence: Record<string, unknown>;
    },
): Promise<FederationRoundRow> {
    const C = FEDERATION_ROUNDS.COLUMNS;
    const artifactPayloadByTask = Object.fromEntries(input.artifacts.map((artifact) => [
        artifact.task_type,
        {
            ...artifact.artifact_payload,
            model_delta_artifact_id: artifact.id,
        },
    ]));
    const aggregatePayload = {
        ...round.aggregate_payload,
        accepted_update_aggregation: {
            mode: 'federated_masked_update_manifest_v1',
            status: input.drafts.every((draft) => draft.blockers.length === 0)
                ? 'aggregate_candidates_ready'
                : 'aggregate_candidates_partially_ready',
            built_by: input.actor,
            built_at: input.builtAt,
            artifact_ids: input.artifacts.map((artifact) => artifact.id),
            artifact_tasks: input.artifacts.map((artifact) => artifact.task_type),
            blockers: uniqueNonEmpty(input.drafts.flatMap((draft) =>
                draft.blockers.map((blocker) => `${draft.task_type}:${blocker}`),
            )),
            evidence: input.evidence,
        },
    };
    const patch: Record<string, unknown> = {
        [C.candidate_artifact_payload]: {
            ...round.candidate_artifact_payload,
            ...artifactPayloadByTask,
        },
        [C.aggregate_payload]: aggregatePayload,
    };
    if (input.markCompleted && input.drafts.every((draft) => draft.blockers.length === 0)) {
        patch[C.status] = 'completed';
        patch[C.completed_at] = input.builtAt;
    }

    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .update(patch)
        .eq(C.id, round.id)
        .select('*')
        .single();

    if (error || !data) {
        throw new FederatedAggregateBuilderError(503, `Failed to update aggregate candidate payload: ${error?.message ?? 'unknown error'}`);
    }
    return mapRound(asRecord(data));
}

async function loadFederationRound(client: SupabaseClient, roundId: string): Promise<FederationRoundRow> {
    const C = FEDERATION_ROUNDS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .select('*')
        .eq(C.id, roundId)
        .maybeSingle();

    if (error) {
        throw new FederatedAggregateBuilderError(503, `Failed to load federation round: ${error.message}`);
    }
    if (!data) {
        throw new FederatedAggregateBuilderError(404, 'Federation round not found.');
    }
    return mapRound(asRecord(data));
}

async function listAcceptedUpdateSubmissions(
    client: SupabaseClient,
    roundId: string,
): Promise<FederatedAggregateUpdateEvidence[]> {
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .select('*')
        .eq(C.federation_round_id, roundId)
        .eq(C.submission_status, 'accepted');

    if (error) {
        throw new FederatedAggregateBuilderError(503, `Failed to load accepted federated updates: ${error.message}`);
    }
    return (data ?? []).map((row) => mapUpdateSubmission(asRecord(row)));
}

async function loadAggregateArtifact(
    client: SupabaseClient,
    roundId: string,
    taskType: FederatedAggregateTaskType,
    modelVersion: string,
): Promise<FederatedAggregateArtifactRecord | null> {
    const C = MODEL_DELTA_ARTIFACTS.COLUMNS;
    const { data, error } = await client
        .from(MODEL_DELTA_ARTIFACTS.TABLE)
        .select('*')
        .eq(C.federation_round_id, roundId)
        .eq(C.artifact_role, 'aggregate_candidate')
        .eq(C.task_type, taskType)
        .eq(C.model_version, modelVersion)
        .maybeSingle();

    if (error) {
        throw new FederatedAggregateBuilderError(503, `Failed to load aggregate candidate artifact: ${error.message}`);
    }
    return data ? mapArtifact(asRecord(data)) : null;
}

function assertCoordinatorAccess(round: FederationRoundRow, actorTenantId: string | null): void {
    if (actorTenantId && actorTenantId !== round.coordinator_tenant_id) {
        throw new FederatedAggregateBuilderError(403, 'Only the federation coordinator can build aggregate candidate artifacts.');
    }
}

function normalizeTaskTypes(value: FederatedAggregateTaskType[] | null | undefined): FederatedAggregateTaskType[] {
    const requested = Array.isArray(value) && value.length > 0 ? value : [...FEDERATED_AGGREGATE_TASK_TYPES];
    return Array.from(new Set(requested.filter((taskType): taskType is FederatedAggregateTaskType =>
        FEDERATED_AGGREGATE_TASK_TYPES.includes(taskType as FederatedAggregateTaskType),
    )));
}

function mapRound(row: Record<string, unknown>): FederationRoundRow {
    return {
        id: String(row.id),
        federation_key: readText(row.federation_key) ?? '',
        coordinator_tenant_id: readText(row.coordinator_tenant_id) ?? '',
        round_key: readText(row.round_key) ?? '',
        status: readText(row.status) ?? 'collecting',
        aggregation_strategy: readText(row.aggregation_strategy) ?? 'secure_aggregation_v1',
        participant_count: readNumber(row.participant_count) ?? 0,
        aggregate_payload: asRecord(row.aggregate_payload),
        candidate_artifact_payload: asRecord(row.candidate_artifact_payload),
        started_at: readText(row.started_at),
        completed_at: readText(row.completed_at),
    };
}

function mapUpdateSubmission(row: Record<string, unknown>): FederatedAggregateUpdateEvidence {
    return {
        id: String(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        federation_round_id: readText(row.federation_round_id) ?? '',
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
        public_summary: asRecord(row.public_summary),
        masked_update_summary: asRecord(row.masked_update_summary),
        evidence: asRecord(row.evidence),
        observed_at: readText(row.observed_at),
        created_at: readText(row.created_at),
    };
}

function mapArtifact(row: Record<string, unknown>): FederatedAggregateArtifactRecord {
    return {
        id: String(row.id),
        federation_round_id: readText(row.federation_round_id) ?? '',
        federation_key: readText(row.federation_key) ?? '',
        coordinator_tenant_id: readText(row.coordinator_tenant_id) ?? '',
        tenant_id: readText(row.tenant_id),
        artifact_role: 'aggregate_candidate',
        task_type: normalizeAggregateTaskType(row.task_type),
        model_version: readText(row.model_version) ?? '',
        dataset_version: readText(row.dataset_version) ?? '',
        artifact_payload: asRecord(row.artifact_payload),
        summary: asRecord(row.summary),
        created_at: readText(row.created_at),
    };
}

function normalizeAggregateTaskType(value: unknown): FederatedAggregateTaskType {
    if (value === 'severity') return 'severity';
    return 'diagnosis';
}

function normalizeUpdateRole(value: unknown): FederatedUpdateRole {
    if (value === 'diagnosis' || value === 'severity' || value === 'support' || value === 'unmask_share') {
        return value;
    }
    return 'diagnosis';
}

function isSha256(value: string | null | undefined): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter((value) => value.length > 0)));
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

function readNumberRecord(value: unknown): Record<string, number> | null {
    const record = asRecord(value);
    const entries = Object.entries(record)
        .map(([key, entry]) => [key, readNumber(entry)] as const)
        .filter((entry): entry is readonly [string, number] => entry[1] != null);
    return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function readEnvelopeHashes(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
        const envelope = asRecord(entry);
        return readText(envelope.envelope_hash);
    }).filter(isSha256);
}

function readEncryptedUnmaskShareEnvelopes(value: unknown): EncryptedUnmaskShareEnvelope[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
        const envelope = asRecord(entry);
        const direction = envelope.direction === 'add' || envelope.direction === 'subtract'
            ? envelope.direction
            : null;
        const parsed = {
            schema: envelope.schema,
            federation_round_id: readText(envelope.federation_round_id),
            round_node_task_id: readText(envelope.round_node_task_id),
            round_key: readText(envelope.round_key),
            sender_node_ref: readText(envelope.sender_node_ref),
            sender_public_key_der_base64: readText(envelope.sender_public_key_der_base64),
            sender_public_key_fingerprint: readText(envelope.sender_public_key_fingerprint),
            peer_node_ref: readText(envelope.peer_node_ref),
            direction,
            recipient: envelope.recipient,
            encryption_protocol: envelope.encryption_protocol,
            key_agreement_protocol: envelope.key_agreement_protocol,
            aad_hash: readText(envelope.aad_hash),
            iv_base64: readText(envelope.iv_base64),
            ciphertext_base64: readText(envelope.ciphertext_base64),
            auth_tag_base64: readText(envelope.auth_tag_base64),
            envelope_hash: readText(envelope.envelope_hash),
        };
        if (
            parsed.schema !== 'vetios_encrypted_unmask_share_envelope_v1'
            || !parsed.federation_round_id
            || !parsed.round_node_task_id
            || !parsed.round_key
            || !parsed.sender_node_ref
            || !parsed.sender_public_key_der_base64
            || !parsed.sender_public_key_fingerprint
            || !parsed.peer_node_ref
            || !parsed.direction
            || parsed.recipient !== 'coordinator'
            || parsed.encryption_protocol !== 'x25519_aes_256_gcm_v1'
            || parsed.key_agreement_protocol !== 'x25519_hkdf_sha256_v1'
            || !isSha256(parsed.aad_hash)
            || !parsed.iv_base64
            || !parsed.ciphertext_base64
            || !parsed.auth_tag_base64
            || !isSha256(parsed.envelope_hash)
        ) {
            return null;
        }
        return parsed as EncryptedUnmaskShareEnvelope;
    }).filter((entry): entry is EncryptedUnmaskShareEnvelope => entry != null);
}

function isEnvelopeHashValid(envelope: EncryptedUnmaskShareEnvelope): boolean {
    const { envelope_hash: _envelopeHash, ...withoutHash } = envelope;
    return stableHash(withoutHash) === envelope.envelope_hash;
}

function resolveCoordinatorRecoveryKeyMaterial(input: {
    evidence?: Record<string, unknown>;
    coordinatorPrivateKeyPem?: string | null;
    coordinatorPrivateKeyDerBase64?: string | null;
}): CoordinatorRecoveryKeyMaterial {
    const evidence = asRecord(input.evidence);
    return {
        privateKeyPem: readText(input.coordinatorPrivateKeyPem)
            ?? readText(evidence.coordinator_private_key_pem)
            ?? readText(evidence.coordinatorPrivateKeyPem)
            ?? readText(process.env.VETIOS_FEDERATION_COORDINATOR_PRIVATE_KEY_PEM),
        privateKeyDerBase64: readText(input.coordinatorPrivateKeyDerBase64)
            ?? readText(evidence.coordinator_private_key_der_base64)
            ?? readText(evidence.coordinatorPrivateKeyDerBase64)
            ?? readText(process.env.VETIOS_FEDERATION_COORDINATOR_PRIVATE_KEY_DER_BASE64),
    };
}

function redactCoordinatorRecoveryKeyMaterial(evidence: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...evidence };
    delete redacted.coordinator_private_key_pem;
    delete redacted.coordinatorPrivateKeyPem;
    delete redacted.coordinator_private_key_der_base64;
    delete redacted.coordinatorPrivateKeyDerBase64;
    if (Object.keys(redacted).length !== Object.keys(evidence).length) {
        redacted.coordinator_recovery_key_material_supplied = true;
        redacted.coordinator_recovery_key_material_persisted = false;
    }
    return redacted;
}

function readCoordinatorPrivateKey(material: CoordinatorRecoveryKeyMaterial | null): KeyObject | null {
    const pem = readText(material?.privateKeyPem);
    if (pem) {
        try {
            return createPrivateKey(pem);
        } catch {
            return null;
        }
    }
    const derBase64 = readText(material?.privateKeyDerBase64);
    if (derBase64) {
        try {
            return createPrivateKey({
                key: Buffer.from(derBase64, 'base64'),
                format: 'der',
                type: 'pkcs8',
            });
        } catch {
            return null;
        }
    }
    return null;
}

function hkdfSha256(inputKeyMaterial: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
    const pseudoRandomKey = createHmac('sha256', salt).update(inputKeyMaterial).digest();
    const blocks: Buffer[] = [];
    let previous = Buffer.alloc(0);
    let counter = 1;
    while (Buffer.concat(blocks).length < length) {
        previous = createHmac('sha256', pseudoRandomKey)
            .update(Buffer.concat([previous, info, Buffer.from([counter])]))
            .digest();
        blocks.push(previous);
        counter += 1;
    }
    return Buffer.concat(blocks).subarray(0, length);
}
