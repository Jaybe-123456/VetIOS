import {
    createHash,
    createHmac,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    randomUUID,
    type KeyObject,
} from 'crypto';

export type FederationNodeTaskType =
    | 'diagnosis_delta'
    | 'severity_delta'
    | 'support_summary'
    | 'secure_aggregation_key'
    | 'unmask_share';

export type FederatedUpdateRole = 'diagnosis' | 'severity' | 'support' | 'unmask_share';

export type OutcomeConfirmationStatus =
    | 'unconfirmed'
    | 'clinician_confirmed'
    | 'expert_reviewed'
    | 'lab_confirmed'
    | 'outcome_linked';

export type ProvenanceStatus =
    | 'not_verified'
    | 'source_attested'
    | 'hash_verified'
    | 'reviewer_verified'
    | 'externally_verified';

export interface LocalClinicalLearningRecord {
    local_record_id: string;
    species?: string | null;
    breed?: string | null;
    age_years?: number | null;
    sex?: string | null;
    signs?: string[] | null;
    duration_days?: number | null;
    labs?: Record<string, unknown> | null;
    imaging?: Record<string, unknown> | null;
    treatment?: Record<string, unknown> | null;
    diagnosis?: string | null;
    outcome?: string | null;
    outcome_confirmed?: boolean | null;
    lab_confirmed?: boolean | null;
    expert_reviewed?: boolean | null;
    clinician_confirmed?: boolean | null;
    amr_related?: boolean | null;
    culture_collected?: boolean | null;
    consent_status?: 'unknown' | 'granted' | 'denied' | 'revoked' | 'not_required' | null;
    provenance_status?: ProvenanceStatus | null;
    source_system?: string | null;
    observed_at?: string | null;
}

export interface EligibilityPolicy {
    minimumTrustScore: number;
    requireConsent: boolean;
    requireOutcomeConfirmation: boolean;
    requireProvenance: boolean;
}

export interface LearningRecordEligibility {
    local_record_id: string;
    record_hash: string;
    consent_status: NonNullable<LocalClinicalLearningRecord['consent_status']>;
    outcome_confirmation_status: OutcomeConfirmationStatus;
    provenance_status: ProvenanceStatus;
    trust_score: number;
    trust_score_components: {
        consent: number;
        outcome: number;
        provenance: number;
        clinical_completeness: number;
        amr_context: number;
    };
    eligible_for_federation: boolean;
    exclusion_reasons: string[];
    public_summary: {
        species: string | null;
        has_labs: boolean;
        has_imaging: boolean;
        has_treatment: boolean;
        amr_related: boolean;
        source_system: string | null;
    };
}

export interface FederatedOutcomeEligibilitySnapshotDraft {
    tenant_id: string;
    federation_key: string;
    partner_ref: string | null;
    outcome_confirmed_rows: number;
    lab_confirmed_rows: number;
    expert_reviewed_rows: number;
    synthetic_rows_excluded: number;
    consented_network_learning_rows: number;
    provenance_verified_rows: number;
    trust_scored_rows: number;
    amr_outcome_linked_rows: number;
    minimum_required_rows: number;
    minimum_provenance_rows: number;
    minimum_trust_scored_rows: number;
    minimum_trust_score: number;
    average_trust_score: number;
    eligibility_status: 'eligible' | 'insufficient_evidence' | 'blocked';
    blockers: string[];
    source_hash_bundle: Record<string, unknown>;
    source_record_digest: string;
    evidence: Record<string, unknown>;
}

export interface FederationRoundTask {
    id: string;
    federation_round_id: string;
    federation_key: string;
    round_key: string;
    node_ref: string;
    partner_ref: string;
    task_type: FederationNodeTaskType;
    plan_hash: string;
    dataset_policy?: Record<string, unknown> | null;
    secure_aggregation_config?: Record<string, unknown> | null;
    task_payload?: Record<string, unknown> | null;
}

export interface MaskedUpdateCommitment {
    request_id: string;
    round_node_task_id: string;
    outcome_eligibility_snapshot_id: string | null;
    node_ref: string;
    partner_ref: string;
    contribution_role: FederatedUpdateRole;
    masking_protocol: 'pairwise_masked_commitment_v1' | 'x25519_hkdf_pairwise_masked_v1';
    payload_commitment_hash: string;
    mask_commitment_hash: string;
    signed_payload_hash: string;
    signature_algorithm: 'sha256-hmac-simulation' | 'hmac-sha256-local-node-key-v1';
    signature_hash: string;
    signing_key_fingerprint: string;
    masked_update_summary: Record<string, unknown>;
    public_summary: Record<string, unknown>;
    evidence: Record<string, unknown>;
}

export interface LocalOutcomeDataset {
    tenant_id: string;
    federation_key: string;
    partner_ref: string | null;
    records: LocalClinicalLearningRecord[];
    eligibilities: LearningRecordEligibility[];
    eligible_records: LearningRecordEligibility[];
    snapshot_draft: FederatedOutcomeEligibilitySnapshotDraft;
    record_digest: string;
    policy_hash: string;
}

export interface LocalFederatedModelDelta {
    schema: 'vetios_local_model_delta_v1';
    task_type: FederationNodeTaskType;
    contribution_role: FederatedUpdateRole;
    eligible_record_count: number;
    training_record_count: number;
    holdout_record_count: number;
    feature_count: number;
    label_count: number;
    record_digest: string;
    delta_digest: string;
    delta_norm: number;
    feature_weights: Record<string, number>;
    label_distribution: Record<string, number>;
    species_distribution: Record<string, number>;
    metric_summary: {
        local_accuracy: number | null;
        majority_label: string | null;
        holdout_coverage: number;
        average_trust_score: number;
        calibration_proxy: number | null;
    };
    evidence: Record<string, unknown>;
}

export interface SecureAggregationPeer {
    node_ref: string;
    public_key_fingerprint?: string | null;
    public_key_pem?: string | null;
    public_key_der_base64?: string | null;
    status?: 'active' | 'dropped' | 'unknown' | null;
}

export interface PairwiseMaskCommitment {
    peer_node_ref: string;
    direction: 'add' | 'subtract';
    peer_public_key_fingerprint: string | null;
    key_agreement_protocol: 'x25519_hkdf_sha256_v1' | 'hmac_shared_secret_legacy_v1';
    mask_seed_commitment_hash: string;
    mask_vector_digest: string;
    active: boolean;
}

export interface UnmaskShareCommitment {
    peer_node_ref: string;
    direction: 'add' | 'subtract';
    key_agreement_protocol: 'x25519_hkdf_sha256_v1' | 'hmac_shared_secret_legacy_v1';
    share_commitment_hash: string;
    encrypted_share_commitment_hash: string;
    share_encryption_status: 'recipient_key_envelope_commitment' | 'legacy_commitment_only';
    reveal_policy: 'dropout_or_threshold_unmask_only';
}

export interface LocalSecureAggregationMaterialization {
    schema: 'vetios_secure_aggregation_materialization_v1';
    masking_protocol: 'pairwise_masked_commitment_v1' | 'x25519_hkdf_pairwise_masked_v1';
    federation_round_id: string;
    round_node_task_id: string;
    node_ref: string;
    contribution_role: FederatedUpdateRole;
    quantization: {
        scale: number;
        integer_precision: 'safe_integer';
    };
    dimension_count: number;
    dimension_order_digest: string;
    unmasked_vector_digest: string;
    masked_vector_digest: string;
    masked_integer_vector: Record<string, number>;
    local_mask_sum_digest: string;
    pairwise_mask_commitments: PairwiseMaskCommitment[];
    unmask_share_commitments: UnmaskShareCommitment[];
    dropped_peer_refs: string[];
    mask_commitment_hash: string;
    evidence: Record<string, unknown>;
}

export interface TrainedMaskedUpdateCommitment extends MaskedUpdateCommitment {
    local_delta: LocalFederatedModelDelta;
    secure_aggregation_materialization: LocalSecureAggregationMaterialization;
}

export interface VetiosFederationNodeClientOptions {
    baseUrl: string;
    machineToken: string;
    federationKey: string;
    nodeRef: string;
    partnerRef?: string | null;
    fetchImpl?: typeof fetch;
}

export interface FederationNodeAgentOptions {
    client: VetiosFederationNodeClient;
    records: LocalClinicalLearningRecord[];
    secret: string;
    tenantId: string;
    federationKey: string;
    partnerRef?: string | null;
    policy?: Partial<EligibilityPolicy>;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
    outcomeEligibilitySnapshotId?: string | null;
}

const DEFAULT_POLICY: EligibilityPolicy = {
    minimumTrustScore: 0.7,
    requireConsent: true,
    requireOutcomeConfirmation: true,
    requireProvenance: true,
};

export function assessLearningRecordEligibility(
    record: LocalClinicalLearningRecord,
    policy: Partial<EligibilityPolicy> = {},
): LearningRecordEligibility {
    const resolvedPolicy = { ...DEFAULT_POLICY, ...policy };
    const canonical = canonicalizeRecord(record);
    const recordHash = stableHash(canonical);
    const consentStatus = record.consent_status ?? 'unknown';
    const outcomeStatus = resolveOutcomeConfirmationStatus(record);
    const provenanceStatus = record.provenance_status ?? 'not_verified';
    const components = {
        consent: consentStatus === 'granted' || consentStatus === 'not_required' ? 1 : 0,
        outcome: outcomeScore(outcomeStatus),
        provenance: provenanceScore(provenanceStatus),
        clinical_completeness: clinicalCompletenessScore(record),
        amr_context: record.amr_related || record.culture_collected ? 1 : 0.5,
    };
    const trustScore = roundScore(
        components.consent * 0.2
        + components.outcome * 0.35
        + components.provenance * 0.25
        + components.clinical_completeness * 0.15
        + components.amr_context * 0.05,
    );
    const exclusionReasons = [
        resolvedPolicy.requireConsent && components.consent === 0 ? 'consent_not_granted' : null,
        resolvedPolicy.requireOutcomeConfirmation && components.outcome < 0.75 ? 'outcome_not_confirmed' : null,
        resolvedPolicy.requireProvenance && components.provenance < 0.75 ? 'provenance_not_verified' : null,
        trustScore < resolvedPolicy.minimumTrustScore ? 'trust_score_below_threshold' : null,
        !canonical.species ? 'species_missing' : null,
        !(canonical.signs as string[]).length ? 'clinical_signs_missing' : null,
    ].filter((reason): reason is string => reason != null);

    return {
        local_record_id: record.local_record_id,
        record_hash: recordHash,
        consent_status: consentStatus,
        outcome_confirmation_status: outcomeStatus,
        provenance_status: provenanceStatus,
        trust_score: trustScore,
        trust_score_components: components,
        eligible_for_federation: exclusionReasons.length === 0,
        exclusion_reasons: exclusionReasons,
        public_summary: {
            species: canonical.species as string | null,
            has_labs: Object.keys(canonical.labs as Record<string, unknown>).length > 0,
            has_imaging: Object.keys(canonical.imaging as Record<string, unknown>).length > 0,
            has_treatment: Object.keys(canonical.treatment as Record<string, unknown>).length > 0,
            amr_related: record.amr_related === true,
            source_system: normalizeText(record.source_system),
        },
    };
}

export function buildOutcomeEligibilitySnapshotDraft(input: {
    tenantId: string;
    federationKey: string;
    partnerRef?: string | null;
    records: LocalClinicalLearningRecord[];
    policy?: Partial<EligibilityPolicy>;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
}): FederatedOutcomeEligibilitySnapshotDraft {
    const policy = { ...DEFAULT_POLICY, ...(input.policy ?? {}) };
    const eligibilities = input.records.map((record) => assessLearningRecordEligibility(record, policy));
    const eligible = eligibilities.filter((row) => row.eligible_for_federation);
    const minimumRequiredRows = input.minimumRequiredRows ?? 20;
    const minimumProvenanceRows = input.minimumProvenanceRows ?? minimumRequiredRows;
    const minimumTrustScoredRows = input.minimumTrustScoredRows ?? minimumRequiredRows;
    const provenanceVerifiedRows = eligibilities.filter((row) => provenanceScore(row.provenance_status) >= 0.75).length;
    const trustScoredRows = eligibilities.filter((row) => row.trust_score >= policy.minimumTrustScore).length;
    const outcomeConfirmedRows = eligibilities.filter((row) => outcomeScore(row.outcome_confirmation_status) >= 0.75).length;
    const blockers = [
        eligible.length < minimumRequiredRows ? 'eligible_rows_below_minimum' : null,
        provenanceVerifiedRows < minimumProvenanceRows ? 'provenance_rows_below_minimum' : null,
        trustScoredRows < minimumTrustScoredRows ? 'trust_scored_rows_below_minimum' : null,
    ].filter((blocker): blocker is string => blocker != null);
    const sourceRecordHashes = eligibilities.map((row) => row.record_hash).sort();

    return {
        tenant_id: input.tenantId,
        federation_key: input.federationKey,
        partner_ref: input.partnerRef ?? null,
        outcome_confirmed_rows: outcomeConfirmedRows,
        lab_confirmed_rows: input.records.filter((record) => record.lab_confirmed === true).length,
        expert_reviewed_rows: input.records.filter((record) => record.expert_reviewed === true).length,
        synthetic_rows_excluded: 0,
        consented_network_learning_rows: eligibilities.filter((row) => row.consent_status === 'granted' || row.consent_status === 'not_required').length,
        provenance_verified_rows: provenanceVerifiedRows,
        trust_scored_rows: trustScoredRows,
        amr_outcome_linked_rows: input.records.filter((record) => record.amr_related === true && record.outcome_confirmed === true).length,
        minimum_required_rows: minimumRequiredRows,
        minimum_provenance_rows: minimumProvenanceRows,
        minimum_trust_scored_rows: minimumTrustScoredRows,
        minimum_trust_score: policy.minimumTrustScore,
        average_trust_score: average(eligibilities.map((row) => row.trust_score)),
        eligibility_status: blockers.length === 0 ? 'eligible' : 'insufficient_evidence',
        blockers,
        source_hash_bundle: {
            record_hashes: sourceRecordHashes,
            eligibility_hash: stableHash(eligibilities),
            policy_hash: stableHash(policy),
        },
        source_record_digest: stableHash(sourceRecordHashes),
        evidence: {
            package: '@vetios/federation-node',
            raw_records_shared: false,
            raw_owner_identifiers_shared: false,
            record_count: input.records.length,
            eligible_record_count: eligible.length,
            exclusion_reasons: aggregateExclusionReasons(eligibilities),
        },
    };
}

export function buildLocalOutcomeDataset(input: {
    tenantId: string;
    federationKey: string;
    partnerRef?: string | null;
    records: LocalClinicalLearningRecord[];
    policy?: Partial<EligibilityPolicy>;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
}): LocalOutcomeDataset {
    const policy = { ...DEFAULT_POLICY, ...(input.policy ?? {}) };
    const eligibilities = input.records.map((record) => assessLearningRecordEligibility(record, policy));
    const eligibleRecords = eligibilities.filter((row) => row.eligible_for_federation);
    const snapshotDraft = buildOutcomeEligibilitySnapshotDraft({
        tenantId: input.tenantId,
        federationKey: input.federationKey,
        partnerRef: input.partnerRef,
        records: input.records,
        policy,
        minimumRequiredRows: input.minimumRequiredRows,
        minimumProvenanceRows: input.minimumProvenanceRows,
        minimumTrustScoredRows: input.minimumTrustScoredRows,
    });

    return {
        tenant_id: input.tenantId,
        federation_key: input.federationKey,
        partner_ref: input.partnerRef ?? null,
        records: input.records,
        eligibilities,
        eligible_records: eligibleRecords,
        snapshot_draft: snapshotDraft,
        record_digest: snapshotDraft.source_record_digest,
        policy_hash: stableHash(policy),
    };
}

export function trainLocalFederatedTask(input: {
    task: FederationRoundTask;
    records: LocalClinicalLearningRecord[];
    tenantId: string;
    federationKey: string;
    partnerRef?: string | null;
    policy?: Partial<EligibilityPolicy>;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
}): {
    dataset: LocalOutcomeDataset;
    delta: LocalFederatedModelDelta;
} {
    const dataset = buildLocalOutcomeDataset({
        tenantId: input.tenantId,
        federationKey: input.federationKey,
        partnerRef: input.partnerRef,
        records: input.records,
        policy: input.policy,
        minimumRequiredRows: input.minimumRequiredRows,
        minimumProvenanceRows: input.minimumProvenanceRows,
        minimumTrustScoredRows: input.minimumTrustScoredRows,
    });
    const delta = buildLocalFederatedModelDelta(input.task, dataset);
    return { dataset, delta };
}

export function buildTrainedMaskedUpdateCommitment(input: {
    task: FederationRoundTask;
    dataset: LocalOutcomeDataset;
    delta: LocalFederatedModelDelta;
    outcomeEligibilitySnapshotId?: string | null;
    secret: string;
    requestId?: string;
}): TrainedMaskedUpdateCommitment {
    const secureAggregationMaterialization = buildSecureAggregationMaterialization({
        task: input.task,
        delta: input.delta,
        secret: input.secret,
    });
    const payloadCommitmentHash = stableHash({
        federation_round_id: input.task.federation_round_id,
        round_node_task_id: input.task.id,
        contribution_role: input.delta.contribution_role,
        record_digest: input.delta.record_digest,
        delta_digest: input.delta.delta_digest,
        masked_vector_digest: secureAggregationMaterialization.masked_vector_digest,
        dimension_order_digest: secureAggregationMaterialization.dimension_order_digest,
        plan_hash: input.task.plan_hash,
        trainer_schema: input.delta.schema,
    });
    const maskCommitmentHash = secureAggregationMaterialization.mask_commitment_hash;
    const signedPayloadHash = stableHash({
        payload_commitment_hash: payloadCommitmentHash,
        mask_commitment_hash: maskCommitmentHash,
        evaluation_digest: stableHash(input.delta.metric_summary),
    });

    return {
        request_id: input.requestId ?? randomUUID(),
        round_node_task_id: input.task.id,
        outcome_eligibility_snapshot_id: input.outcomeEligibilitySnapshotId ?? null,
        node_ref: input.task.node_ref,
        partner_ref: input.task.partner_ref,
        contribution_role: input.delta.contribution_role,
        masking_protocol: secureAggregationMaterialization.masking_protocol,
        payload_commitment_hash: payloadCommitmentHash,
        mask_commitment_hash: maskCommitmentHash,
        signed_payload_hash: signedPayloadHash,
        signature_algorithm: 'hmac-sha256-local-node-key-v1',
        signature_hash: stableHash(`${signedPayloadHash}:${input.secret}`),
        signing_key_fingerprint: stableHash(input.secret).slice(0, 32),
        masked_update_summary: {
            schema: 'vetios_masked_model_delta_commitment_v1',
            local_delta_schema: input.delta.schema,
            contribution_role: input.delta.contribution_role,
            eligible_record_count: input.delta.eligible_record_count,
            feature_count: input.delta.feature_count,
            label_count: input.delta.label_count,
            delta_digest: input.delta.delta_digest,
            delta_norm: input.delta.delta_norm,
            record_digest: input.delta.record_digest,
            metric_summary: input.delta.metric_summary,
            secure_aggregation: {
                schema: secureAggregationMaterialization.schema,
                masking_protocol: secureAggregationMaterialization.masking_protocol,
                dimension_count: secureAggregationMaterialization.dimension_count,
                quantization_scale: secureAggregationMaterialization.quantization.scale,
                dimension_order_digest: secureAggregationMaterialization.dimension_order_digest,
                masked_integer_vector: secureAggregationMaterialization.masked_integer_vector,
                pairwise_mask_count: secureAggregationMaterialization.pairwise_mask_commitments.length,
                unmask_share_count: secureAggregationMaterialization.unmask_share_commitments.length,
                masked_vector_digest: secureAggregationMaterialization.masked_vector_digest,
                mask_commitment_hash: secureAggregationMaterialization.mask_commitment_hash,
                dropped_peer_count: secureAggregationMaterialization.dropped_peer_refs.length,
                x25519_pairwise_peer_count: secureAggregationMaterialization.evidence.x25519_pairwise_peer_count,
            },
            raw_delta_included: false,
            raw_records_included: false,
        },
        public_summary: {
            species_counts: input.delta.species_distribution,
            eligible_record_count: input.delta.eligible_record_count,
            average_trust_score: input.delta.metric_summary.average_trust_score,
            contribution_role: input.delta.contribution_role,
            task_type: input.delta.task_type,
        },
        evidence: {
            generated_by: '@vetios/federation-node',
            local_runner: 'deterministic_outcome_delta_v1',
            task_plan_hash: input.task.plan_hash,
            dataset_policy_hash: input.dataset.policy_hash,
            outcome_eligibility_status: input.dataset.snapshot_draft.eligibility_status,
            secure_aggregation_boundary: 'pairwise_masked_delta_commitments_no_raw_delta',
            secure_aggregation_materialized: true,
            secure_aggregation_schema: secureAggregationMaterialization.schema,
            secure_aggregation_masking_protocol: secureAggregationMaterialization.masking_protocol,
            model_delta_materialized: true,
            local_training_data_shared: false,
            raw_model_delta_shared: false,
        },
        local_delta: input.delta,
        secure_aggregation_materialization: secureAggregationMaterialization,
    };
}

export function buildSecureAggregationMaterialization(input: {
    task: FederationRoundTask;
    delta: LocalFederatedModelDelta;
    secret: string;
}): LocalSecureAggregationMaterialization {
    const config = normalizeRecord(input.task.secure_aggregation_config);
    const scale = Math.max(1, Math.min(1_000_000, Math.round(finiteNumber(config.quantization_scale) ?? 10_000)));
    const maskRange = Math.max(1, Math.min(1_000_000, Math.round(finiteNumber(config.mask_range) ?? 100_000)));
    const peers = readSecureAggregationPeers(config, input.task.node_ref);
    const activePeers = peers.filter((peer) => peer.status !== 'dropped');
    const droppedPeerRefs = peers.filter((peer) => peer.status === 'dropped').map((peer) => peer.node_ref);
    const localPrivateKey = readNodePrivateKey(config);
    const dimensions = Object.keys(input.delta.feature_weights).sort();
    const quantizedVector = Object.fromEntries(dimensions.map((dimension) => [
        dimension,
        Math.round((input.delta.feature_weights[dimension] ?? 0) * scale),
    ]));
    const maskSum = Object.fromEntries(dimensions.map((dimension) => [dimension, 0]));
    const pairwiseMaskCommitments: PairwiseMaskCommitment[] = [];
    const unmaskShareCommitments: UnmaskShareCommitment[] = [];

    for (const peer of activePeers) {
        const direction = input.task.node_ref.localeCompare(peer.node_ref) <= 0 ? 'add' : 'subtract';
        const sign = direction === 'add' ? 1 : -1;
        const seedMaterial = stableStringify({
            protocol: 'pairwise_masked_commitment_v1',
            federation_round_id: input.task.federation_round_id,
            round_node_task_id: input.task.id,
            local_node_ref: input.task.node_ref,
            peer_node_ref: peer.node_ref,
            ordered_pair: [input.task.node_ref, peer.node_ref].sort(),
            peer_public_key_fingerprint: peer.public_key_fingerprint ?? null,
            delta_digest: input.delta.delta_digest,
        });
        const keyAgreement = derivePairwiseMaskSeed({
            localPrivateKey,
            peer,
            task: input.task,
            delta: input.delta,
            fallbackSecret: input.secret,
            seedMaterial,
        });
        const maskSeed = keyAgreement.seed;
        const maskVector = Object.fromEntries(dimensions.map((dimension, index) => {
            const maskValue = pairwiseMaskValue(maskSeed, dimension, index, maskRange);
            maskSum[dimension] = (maskSum[dimension] ?? 0) + sign * maskValue;
            return [dimension, maskValue];
        }));
        const maskVectorDigest = stableHash(maskVector);

        pairwiseMaskCommitments.push({
            peer_node_ref: peer.node_ref,
            direction,
            peer_public_key_fingerprint: peer.public_key_fingerprint ?? null,
            key_agreement_protocol: keyAgreement.protocol,
            mask_seed_commitment_hash: stableHash({
                protocol: keyAgreement.protocol,
                seed_digest: stableHash(maskSeed),
                federation_round_id: input.task.federation_round_id,
                round_node_task_id: input.task.id,
                peer_node_ref: peer.node_ref,
            }),
            mask_vector_digest: maskVectorDigest,
            active: true,
        });
        unmaskShareCommitments.push({
            peer_node_ref: peer.node_ref,
            direction,
            key_agreement_protocol: keyAgreement.protocol,
            share_commitment_hash: stableHash({
                protocol: 'pairwise_unmask_share_commitment_v1',
                seed_digest: stableHash(maskSeed),
                mask_vector_digest: maskVectorDigest,
                federation_round_id: input.task.federation_round_id,
                round_node_task_id: input.task.id,
                peer_node_ref: peer.node_ref,
                reveal_policy: 'dropout_or_threshold_unmask_only',
            }),
            encrypted_share_commitment_hash: stableHash({
                protocol: keyAgreement.protocol === 'x25519_hkdf_sha256_v1'
                    ? 'x25519_unmask_share_envelope_commitment_v1'
                    : 'legacy_unmask_share_commitment_only_v1',
                seed_digest: stableHash(maskSeed),
                peer_node_ref: peer.node_ref,
                peer_public_key_fingerprint: peer.public_key_fingerprint ?? null,
                share_scope: 'dropout_recovery_seed',
            }),
            share_encryption_status: keyAgreement.protocol === 'x25519_hkdf_sha256_v1'
                ? 'recipient_key_envelope_commitment'
                : 'legacy_commitment_only',
            reveal_policy: 'dropout_or_threshold_unmask_only',
        });
    }

    const maskedVector = Object.fromEntries(dimensions.map((dimension) => [
        dimension,
        (quantizedVector[dimension] ?? 0) + (maskSum[dimension] ?? 0),
    ]));
    const dimensionOrderDigest = stableHash(dimensions);
    const unmaskedVectorDigest = stableHash(quantizedVector);
    const maskedVectorDigest = stableHash(maskedVector);
    const localMaskSumDigest = stableHash(maskSum);
    const sortedPairwiseCommitments = pairwiseMaskCommitments
        .sort((left, right) => left.peer_node_ref.localeCompare(right.peer_node_ref));
    const sortedUnmaskShares = unmaskShareCommitments
        .sort((left, right) => left.peer_node_ref.localeCompare(right.peer_node_ref));
    const x25519PeerCount = sortedPairwiseCommitments.filter((commitment) =>
        commitment.key_agreement_protocol === 'x25519_hkdf_sha256_v1',
    ).length;
    const maskingProtocol = activePeers.length > 0 && x25519PeerCount === activePeers.length
        ? 'x25519_hkdf_pairwise_masked_v1'
        : 'pairwise_masked_commitment_v1';
    const limitations = [
        activePeers.length === 0 ? 'pairwise_peers_missing' : null,
        x25519PeerCount < activePeers.length ? 'x25519_key_agreement_not_available_for_all_active_peers' : null,
    ].filter((limitation): limitation is string => limitation != null);
    const maskCommitmentHash = stableHash({
        schema: 'vetios_secure_aggregation_materialization_v1',
        masking_protocol: maskingProtocol,
        federation_round_id: input.task.federation_round_id,
        round_node_task_id: input.task.id,
        node_ref: input.task.node_ref,
        contribution_role: input.delta.contribution_role,
        quantization_scale: scale,
        dimension_order_digest: dimensionOrderDigest,
        unmasked_vector_digest: unmaskedVectorDigest,
        masked_vector_digest: maskedVectorDigest,
        local_mask_sum_digest: localMaskSumDigest,
        pairwise_mask_commitments: sortedPairwiseCommitments,
        dropped_peer_refs: droppedPeerRefs,
    });

    return {
        schema: 'vetios_secure_aggregation_materialization_v1',
        masking_protocol: maskingProtocol,
        federation_round_id: input.task.federation_round_id,
        round_node_task_id: input.task.id,
        node_ref: input.task.node_ref,
        contribution_role: input.delta.contribution_role,
        quantization: {
            scale,
            integer_precision: 'safe_integer',
        },
        dimension_count: dimensions.length,
        dimension_order_digest: dimensionOrderDigest,
        unmasked_vector_digest: unmaskedVectorDigest,
        masked_vector_digest: maskedVectorDigest,
        masked_integer_vector: maskedVector,
        local_mask_sum_digest: localMaskSumDigest,
        pairwise_mask_commitments: sortedPairwiseCommitments,
        unmask_share_commitments: sortedUnmaskShares,
        dropped_peer_refs: droppedPeerRefs,
        mask_commitment_hash: maskCommitmentHash,
        evidence: {
            generated_by: '@vetios/federation-node',
            raw_delta_shared: false,
            raw_records_shared: false,
            masked_vector_shared_by_default: true,
            key_agreement_protocol: x25519PeerCount === activePeers.length && activePeers.length > 0
                ? 'x25519_hkdf_sha256_v1'
                : 'hmac_shared_secret_legacy_v1',
            pairwise_peer_count: peers.length,
            active_pairwise_peer_count: activePeers.length,
            x25519_pairwise_peer_count: x25519PeerCount,
            dropped_peer_count: droppedPeerRefs.length,
            limitations,
        },
    };
}

export function buildMaskedUpdateCommitment(input: {
    task: FederationRoundTask;
    eligibleRecords: LearningRecordEligibility[];
    outcomeEligibilitySnapshotId?: string | null;
    secret: string;
    requestId?: string;
}): MaskedUpdateCommitment {
    const eligibleRecords = input.eligibleRecords.filter((record) => record.eligible_for_federation);
    const contributionRole = contributionRoleForTaskType(input.task.task_type);
    const recordDigest = stableHash(eligibleRecords.map((record) => record.record_hash).sort());
    const payloadCommitmentHash = stableHash({
        federation_round_id: input.task.federation_round_id,
        round_node_task_id: input.task.id,
        contribution_role: contributionRole,
        record_digest: recordDigest,
        plan_hash: input.task.plan_hash,
    });
    const maskCommitmentHash = stableHash({
        payload_commitment_hash: payloadCommitmentHash,
        node_ref: input.task.node_ref,
        secret_commitment: stableHash(input.secret),
    });
    const signedPayloadHash = stableHash({
        payload_commitment_hash: payloadCommitmentHash,
        mask_commitment_hash: maskCommitmentHash,
    });

    return {
        request_id: input.requestId ?? randomUUID(),
        round_node_task_id: input.task.id,
        outcome_eligibility_snapshot_id: input.outcomeEligibilitySnapshotId ?? null,
        node_ref: input.task.node_ref,
        partner_ref: input.task.partner_ref,
        contribution_role: contributionRole,
        masking_protocol: 'pairwise_masked_commitment_v1',
        payload_commitment_hash: payloadCommitmentHash,
        mask_commitment_hash: maskCommitmentHash,
        signed_payload_hash: signedPayloadHash,
        signature_algorithm: 'sha256-hmac-simulation',
        signature_hash: stableHash(`${signedPayloadHash}:${input.secret}`),
        signing_key_fingerprint: stableHash(input.secret).slice(0, 32),
        masked_update_summary: {
            schema: 'vetios_masked_update_summary_v1',
            contribution_role: contributionRole,
            eligible_record_count: eligibleRecords.length,
            record_digest: recordDigest,
            raw_delta_included: false,
            raw_records_included: false,
        },
        public_summary: {
            species_counts: countBy(eligibleRecords.map((record) => record.public_summary.species ?? 'unknown')),
            eligible_record_count: eligibleRecords.length,
            average_trust_score: average(eligibleRecords.map((record) => record.trust_score)),
            contribution_role: contributionRole,
        },
        evidence: {
            generated_by: '@vetios/federation-node',
            task_plan_hash: input.task.plan_hash,
            secure_aggregation_boundary: 'commitments_only_no_raw_delta',
            local_training_data_shared: false,
        },
    };
}

export function toFederatedUpdateSubmissionPayload(commitment: MaskedUpdateCommitment): MaskedUpdateCommitment {
    return {
        request_id: commitment.request_id,
        round_node_task_id: commitment.round_node_task_id,
        outcome_eligibility_snapshot_id: commitment.outcome_eligibility_snapshot_id,
        node_ref: commitment.node_ref,
        partner_ref: commitment.partner_ref,
        contribution_role: commitment.contribution_role,
        masking_protocol: commitment.masking_protocol,
        payload_commitment_hash: commitment.payload_commitment_hash,
        mask_commitment_hash: commitment.mask_commitment_hash,
        signed_payload_hash: commitment.signed_payload_hash,
        signature_algorithm: commitment.signature_algorithm,
        signature_hash: commitment.signature_hash,
        signing_key_fingerprint: commitment.signing_key_fingerprint,
        masked_update_summary: commitment.masked_update_summary,
        public_summary: commitment.public_summary,
        evidence: commitment.evidence,
    };
}

export class VetiosFederationNodeAgent {
    private readonly options: FederationNodeAgentOptions;

    constructor(options: FederationNodeAgentOptions) {
        this.options = options;
    }

    buildDataset(): LocalOutcomeDataset {
        return buildLocalOutcomeDataset({
            tenantId: this.options.tenantId,
            federationKey: this.options.federationKey,
            partnerRef: this.options.partnerRef,
            records: this.options.records,
            policy: this.options.policy,
            minimumRequiredRows: this.options.minimumRequiredRows,
            minimumProvenanceRows: this.options.minimumProvenanceRows,
            minimumTrustScoredRows: this.options.minimumTrustScoredRows,
        });
    }

    trainTask(task: FederationRoundTask): {
        dataset: LocalOutcomeDataset;
        delta: LocalFederatedModelDelta;
        commitment: TrainedMaskedUpdateCommitment;
    } {
        const { dataset, delta } = trainLocalFederatedTask({
            task,
            records: this.options.records,
            tenantId: this.options.tenantId,
            federationKey: this.options.federationKey,
            partnerRef: this.options.partnerRef,
            policy: this.options.policy,
            minimumRequiredRows: this.options.minimumRequiredRows,
            minimumProvenanceRows: this.options.minimumProvenanceRows,
            minimumTrustScoredRows: this.options.minimumTrustScoredRows,
        });
        const commitment = buildTrainedMaskedUpdateCommitment({
            task,
            dataset,
            delta,
            outcomeEligibilitySnapshotId: this.options.outcomeEligibilitySnapshotId,
            secret: this.options.secret,
        });
        return { dataset, delta, commitment };
    }

    async runTask(task: FederationRoundTask): Promise<{
        dataset: LocalOutcomeDataset;
        delta: LocalFederatedModelDelta;
        commitment: TrainedMaskedUpdateCommitment;
        submission: unknown;
    }> {
        await this.options.client.pullTask(task.federation_round_id, task.id);
        const result = this.trainTask(task);
        const submission = await this.options.client.submitUpdate(task.federation_round_id, result.commitment);
        return {
            ...result,
            submission,
        };
    }
}

export class VetiosFederationNodeClient {
    private readonly fetchImpl: typeof fetch;
    private readonly baseUrl: string;
    private readonly options: VetiosFederationNodeClientOptions;

    constructor(options: VetiosFederationNodeClientOptions) {
        this.options = options;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    }

    heartbeat(payload: Record<string, unknown> = {}) {
        return this.post('/api/federation/v1/rounds/current', {
            federation_key: this.options.federationKey,
            node_ref: this.options.nodeRef,
            partner_ref: this.options.partnerRef,
            runtime_event: 'heartbeat',
            node_status: 'online',
            evidence: payload,
        });
    }

    getCurrentRound() {
        const params = new URLSearchParams({
            federation_key: this.options.federationKey,
            node_ref: this.options.nodeRef,
        });
        return this.get(`/api/federation/v1/rounds/current?${params.toString()}`);
    }

    pullTask(roundId: string, taskId: string) {
        const params = new URLSearchParams({
            federation_key: this.options.federationKey,
            node_ref: this.options.nodeRef,
        });
        return this.get(`/api/federation/v1/rounds/${roundId}/tasks/${taskId}/pull?${params.toString()}`);
    }

    submitUpdate(roundId: string, commitment: MaskedUpdateCommitment) {
        return this.post(`/api/federation/v1/rounds/${roundId}/updates`, {
            federation_key: this.options.federationKey,
            ...toFederatedUpdateSubmissionPayload(commitment),
        });
    }

    private async get(path: string): Promise<unknown> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            headers: this.headers(),
        });
        return readJsonResponse(response);
    }

    private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        return readJsonResponse(response);
    }

    private headers(): HeadersInit {
        return {
            Authorization: `Bearer ${this.options.machineToken}`,
            'Content-Type': 'application/json',
        };
    }
}

function buildLocalFederatedModelDelta(
    task: FederationRoundTask,
    dataset: LocalOutcomeDataset,
): LocalFederatedModelDelta {
    const eligibleIds = new Set(dataset.eligible_records.map((row) => row.local_record_id));
    const eligibleSourceRecords = dataset.records.filter((record) => eligibleIds.has(record.local_record_id));
    const eligibleById = new Map(dataset.eligible_records.map((row) => [row.local_record_id, row]));
    const examples = eligibleSourceRecords.map((record) => ({
        record,
        eligibility: eligibleById.get(record.local_record_id),
        features: extractModelFeatures(record),
        label: labelForTask(task.task_type, record),
        hash: stableHash({
            local_record_id: record.local_record_id,
            task_type: task.task_type,
            record_hash: eligibleById.get(record.local_record_id)?.record_hash,
        }),
    })).filter((example) => example.eligibility != null && example.features.length > 0 && example.label != null);

    const trainingExamples = examples.filter((example) => holdoutBucket(example.hash) !== 0);
    const holdoutExamples = examples.filter((example) => holdoutBucket(example.hash) === 0);
    const trainingSet = trainingExamples.length > 0 ? trainingExamples : examples;
    const labelDistribution = countBy(examples.map((example) => example.label ?? 'unknown'));
    const speciesDistribution = countBy(examples.map((example) => normalizeText(example.record.species) ?? 'unknown'));
    const featureWeights = buildFeatureWeights(task.task_type, trainingSet.map((example) => ({
        features: example.features,
        label: example.label ?? 'unknown',
        trustScore: example.eligibility?.trust_score ?? 0,
    })));
    const majorityLabel = majorityValue(trainingSet.map((example) => example.label ?? 'unknown'));
    const localAccuracy = holdoutExamples.length > 0 && majorityLabel
        ? roundScore(holdoutExamples.filter((example) => example.label === majorityLabel).length / holdoutExamples.length)
        : null;
    const deltaDigest = stableHash({
        schema: 'vetios_local_model_delta_v1',
        task_type: task.task_type,
        plan_hash: task.plan_hash,
        record_digest: dataset.record_digest,
        feature_weights: featureWeights,
        label_distribution: labelDistribution,
    });

    return {
        schema: 'vetios_local_model_delta_v1',
        task_type: task.task_type,
        contribution_role: contributionRoleForTaskType(task.task_type),
        eligible_record_count: dataset.eligible_records.length,
        training_record_count: trainingSet.length,
        holdout_record_count: holdoutExamples.length,
        feature_count: Object.keys(featureWeights).length,
        label_count: Object.keys(labelDistribution).length,
        record_digest: dataset.record_digest,
        delta_digest: deltaDigest,
        delta_norm: vectorNorm(Object.values(featureWeights)),
        feature_weights: featureWeights,
        label_distribution: labelDistribution,
        species_distribution: speciesDistribution,
        metric_summary: {
            local_accuracy: localAccuracy,
            majority_label: majorityLabel,
            holdout_coverage: examples.length > 0 ? roundScore(holdoutExamples.length / examples.length) : 0,
            average_trust_score: average(dataset.eligible_records.map((record) => record.trust_score)),
            calibration_proxy: localAccuracy == null ? null : roundScore(Math.abs(localAccuracy - average(dataset.eligible_records.map((record) => record.trust_score)))),
        },
        evidence: {
            generated_by: '@vetios/federation-node',
            local_runner: 'deterministic_outcome_delta_v1',
            task_plan_hash: task.plan_hash,
            raw_records_shared: false,
            raw_delta_shared: false,
            eligible_record_count: dataset.eligible_records.length,
            source_record_digest: dataset.record_digest,
        },
    };
}

function buildFeatureWeights(
    taskType: FederationNodeTaskType,
    examples: Array<{ features: string[]; label: string; trustScore: number }>,
): Record<string, number> {
    const weights: Record<string, number> = {};
    for (const example of examples) {
        const labelPrefix = taskType === 'support_summary' || taskType === 'secure_aggregation_key'
            ? 'support'
            : example.label;
        const contributionWeight = Math.max(0.1, example.trustScore);
        for (const feature of example.features) {
            const key = `${labelPrefix}::${feature}`;
            weights[key] = roundScore((weights[key] ?? 0) + contributionWeight);
        }
    }
    return Object.fromEntries(Object.entries(weights).sort(([left], [right]) => left.localeCompare(right)));
}

function extractModelFeatures(record: LocalClinicalLearningRecord): string[] {
    const features = [
        normalizeText(record.species) ? `species:${normalizeText(record.species)}` : null,
        normalizeText(record.breed) ? `breed:${normalizeText(record.breed)}` : null,
        normalizeText(record.sex) ? `sex:${normalizeText(record.sex)}` : null,
        finiteNumber(record.age_years) != null ? `age_bucket:${bucketNumber(record.age_years, [1, 3, 7, 12])}` : null,
        finiteNumber(record.duration_days) != null ? `duration_bucket:${bucketNumber(record.duration_days, [1, 3, 7, 14, 30])}` : null,
        record.amr_related ? 'amr_related:true' : null,
        record.culture_collected ? 'culture_collected:true' : null,
        ...normalizeList(record.signs).map((sign) => `sign:${sign}`),
        ...Object.keys(normalizeRecord(record.labs)).sort().map((key) => `lab:${normalizeText(key) ?? key}`),
        ...Object.keys(normalizeRecord(record.imaging)).sort().map((key) => `imaging:${normalizeText(key) ?? key}`),
        ...Object.keys(normalizeRecord(record.treatment)).sort().map((key) => `treatment:${normalizeText(key) ?? key}`),
    ];
    return features.filter((feature): feature is string => feature != null);
}

function labelForTask(taskType: FederationNodeTaskType, record: LocalClinicalLearningRecord): string | null {
    if (taskType === 'severity_delta') return inferSeverityLabel(record);
    if (taskType === 'support_summary' || taskType === 'secure_aggregation_key' || taskType === 'unmask_share') {
        return record.amr_related || record.culture_collected ? 'amr_support' : 'clinical_support';
    }
    return normalizeText(record.diagnosis);
}

function inferSeverityLabel(record: LocalClinicalLearningRecord): string {
    const signs = normalizeList(record.signs);
    const outcome = normalizeText(record.outcome);
    if (signs.some((sign) => sign.includes('collapse') || sign.includes('seizure') || sign.includes('dyspnea'))) return 'emergency';
    if (outcome?.includes('death') || outcome?.includes('euthan')) return 'critical';
    if (signs.some((sign) => sign.includes('fever') || sign.includes('lethargy') || sign.includes('anorexia'))) return 'urgent';
    return 'routine';
}

function canonicalizeRecord(record: LocalClinicalLearningRecord): Record<string, unknown> {
    return {
        local_record_id: record.local_record_id,
        species: normalizeText(record.species),
        breed: normalizeText(record.breed),
        age_years: finiteNumber(record.age_years),
        sex: normalizeText(record.sex),
        signs: normalizeList(record.signs),
        duration_days: finiteNumber(record.duration_days),
        labs: normalizeRecord(record.labs),
        imaging: normalizeRecord(record.imaging),
        treatment: normalizeRecord(record.treatment),
        diagnosis: normalizeText(record.diagnosis),
        outcome: normalizeText(record.outcome),
        observed_at: normalizeText(record.observed_at),
    };
}

function resolveOutcomeConfirmationStatus(record: LocalClinicalLearningRecord): OutcomeConfirmationStatus {
    if (record.outcome_confirmed) return 'outcome_linked';
    if (record.lab_confirmed) return 'lab_confirmed';
    if (record.expert_reviewed) return 'expert_reviewed';
    if (record.clinician_confirmed) return 'clinician_confirmed';
    return 'unconfirmed';
}

function outcomeScore(status: OutcomeConfirmationStatus): number {
    if (status === 'outcome_linked') return 1;
    if (status === 'lab_confirmed') return 0.95;
    if (status === 'expert_reviewed') return 0.9;
    if (status === 'clinician_confirmed') return 0.8;
    return 0;
}

function provenanceScore(status: ProvenanceStatus): number {
    if (status === 'externally_verified') return 1;
    if (status === 'reviewer_verified') return 0.9;
    if (status === 'hash_verified') return 0.85;
    if (status === 'source_attested') return 0.75;
    return 0;
}

function clinicalCompletenessScore(record: LocalClinicalLearningRecord): number {
    const checks = [
        normalizeText(record.species) != null,
        normalizeList(record.signs).length > 0,
        Object.keys(normalizeRecord(record.labs)).length > 0,
        Object.keys(normalizeRecord(record.treatment)).length > 0,
        normalizeText(record.diagnosis) != null,
        normalizeText(record.outcome) != null,
    ];
    return checks.filter(Boolean).length / checks.length;
}

function contributionRoleForTaskType(taskType: FederationNodeTaskType): FederatedUpdateRole {
    if (taskType === 'severity_delta') return 'severity';
    if (taskType === 'support_summary' || taskType === 'secure_aggregation_key') return 'support';
    if (taskType === 'unmask_share') return 'unmask_share';
    return 'diagnosis';
}

function readSecureAggregationPeers(config: Record<string, unknown>, nodeRef: string): SecureAggregationPeer[] {
    const rawPeers = Array.isArray(config.peers)
        ? config.peers
        : Array.isArray(config.participants)
            ? config.participants
            : [];
    const peers: SecureAggregationPeer[] = [];
    for (const entry of rawPeers) {
        const record = normalizeRecord(entry as Record<string, unknown>);
        const peerNodeRef = normalizeText(record.node_ref ?? record.nodeRef ?? record.participant_ref ?? record.participantRef);
        if (!peerNodeRef || peerNodeRef === normalizeText(nodeRef)) continue;
        peers.push({
            node_ref: peerNodeRef,
            public_key_fingerprint: normalizeText(record.public_key_fingerprint ?? record.publicKeyFingerprint),
            public_key_pem: readRawText(record.public_key_pem ?? record.publicKeyPem),
            public_key_der_base64: readRawText(record.public_key_der_base64 ?? record.publicKeyDerBase64),
            status: readPeerStatus(record.status),
        });
    }
    return Array.from(new Map(peers.map((peer) => [peer.node_ref, peer])).values())
        .sort((left, right) => left.node_ref.localeCompare(right.node_ref));
}

function readPeerStatus(value: unknown): NonNullable<SecureAggregationPeer['status']> {
    if (value === 'active' || value === 'dropped' || value === 'unknown') return value;
    return 'active';
}

function readNodePrivateKey(config: Record<string, unknown>): KeyObject | null {
    const pem = readRawText(config.node_private_key_pem ?? config.private_key_pem);
    if (pem) {
        try {
            return createPrivateKey(pem);
        } catch {
            return null;
        }
    }
    const derBase64 = readRawText(config.node_private_key_der_base64 ?? config.private_key_der_base64);
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

function readPeerPublicKey(peer: SecureAggregationPeer): KeyObject | null {
    if (peer.public_key_pem) {
        try {
            return createPublicKey(peer.public_key_pem);
        } catch {
            return null;
        }
    }
    if (peer.public_key_der_base64) {
        try {
            return createPublicKey({
                key: Buffer.from(peer.public_key_der_base64, 'base64'),
                format: 'der',
                type: 'spki',
            });
        } catch {
            return null;
        }
    }
    return null;
}

function derivePairwiseMaskSeed(input: {
    localPrivateKey: KeyObject | null;
    peer: SecureAggregationPeer;
    task: FederationRoundTask;
    delta: LocalFederatedModelDelta;
    fallbackSecret: string;
    seedMaterial: string;
}): {
    seed: string;
    protocol: 'x25519_hkdf_sha256_v1' | 'hmac_shared_secret_legacy_v1';
} {
    const peerPublicKey = input.localPrivateKey ? readPeerPublicKey(input.peer) : null;
    if (input.localPrivateKey && peerPublicKey) {
        try {
            const sharedSecret = diffieHellman({
                privateKey: input.localPrivateKey,
                publicKey: peerPublicKey,
            });
            const salt = Buffer.from(stableHash({
                federation_round_id: input.task.federation_round_id,
                round_node_task_id: input.task.id,
                ordered_pair: [input.task.node_ref, input.peer.node_ref].sort(),
                delta_digest: input.delta.delta_digest,
            }), 'hex');
            const info = Buffer.from(`vetios-secagg-mask:${input.task.round_key}:${input.task.id}`, 'utf8');
            return {
                seed: hkdfSha256(sharedSecret, salt, info, 32).toString('hex'),
                protocol: 'x25519_hkdf_sha256_v1',
            };
        } catch {
            // Fall through to the legacy deterministic path and surface the limitation in evidence.
        }
    }
    return {
        seed: hmacHex(input.fallbackSecret, input.seedMaterial),
        protocol: 'hmac_shared_secret_legacy_v1',
    };
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

function pairwiseMaskValue(seed: string, dimension: string, index: number, maskRange: number): number {
    const digest = createHmac('sha256', seed)
        .update(`${index}:${dimension}`)
        .digest('hex');
    const parsed = Number.parseInt(digest.slice(0, 12), 16);
    const bounded = Number.isFinite(parsed) ? parsed % (maskRange * 2 + 1) : 0;
    return bounded - maskRange;
}

async function readJsonResponse(response: Response): Promise<unknown> {
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`VetIOS federation node request failed: ${response.status} ${JSON.stringify(json)}`);
    }
    return json;
}

function aggregateExclusionReasons(rows: LearningRecordEligibility[]): Record<string, number> {
    return rows.flatMap((row) => row.exclusion_reasons).reduce<Record<string, number>>((acc, reason) => {
        acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
    }, {});
}

function countBy(values: string[]): Record<string, number> {
    return values.reduce<Record<string, number>>((acc, value) => {
        acc[value] = (acc[value] ?? 0) + 1;
        return acc;
    }, {});
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return roundScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function majorityValue(values: string[]): string | null {
    const counts = countBy(values);
    const [label] = Object.entries(counts).sort((left, right) => {
        const countDelta = right[1] - left[1];
        return countDelta !== 0 ? countDelta : left[0].localeCompare(right[0]);
    })[0] ?? [];
    return label ?? null;
}

function vectorNorm(values: number[]): number {
    return roundScore(Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)));
}

function roundScore(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

function stableHash(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function hmacHex(secret: string, value: string): string {
    return createHmac('sha256', secret).update(value).digest('hex');
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

function normalizeRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function readRawText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeList(value: string[] | null | undefined): string[] {
    return Array.isArray(value)
        ? Array.from(new Set(value.map((entry) => normalizeText(entry)).filter((entry): entry is string => entry != null))).sort()
        : [];
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bucketNumber(value: unknown, thresholds: number[]): string {
    const numeric = finiteNumber(value);
    if (numeric == null) return 'unknown';
    for (const threshold of thresholds) {
        if (numeric <= threshold) return `lte_${threshold}`;
    }
    return `gt_${thresholds[thresholds.length - 1] ?? 0}`;
}

function holdoutBucket(hash: string): number {
    const prefix = hash.slice(0, 8);
    const parsed = Number.parseInt(prefix, 16);
    return Number.isFinite(parsed) ? parsed % 5 : 0;
}
