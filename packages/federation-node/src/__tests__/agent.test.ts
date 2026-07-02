import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import {
    assessLearningRecordEligibility,
    buildLocalMultiNodeFederatedRoundProof,
    buildMaskedUpdateCommitment,
    buildOutcomeEligibilitySnapshotDraft,
    buildSecureAggregationMaterialization,
    buildTrainedMaskedUpdateCommitment,
    trainLocalFederatedTask,
    toFederatedUpdateSubmissionPayload,
    VetiosFederationNodeAgent,
    VetiosFederationNodeClient,
    type FederationRoundTask,
    type LocalClinicalLearningRecord,
} from '../index.ts';

const records: LocalClinicalLearningRecord[] = Array.from({ length: 20 }, (_, index) => ({
    local_record_id: `case-${index + 1}`,
    species: index % 2 === 0 ? 'Canine' : 'Feline',
    signs: ['fever', 'lethargy'],
    labs: { culture: 'e_coli', ast: 'available' },
    treatment: { antimicrobial: 'amoxicillin-clavulanate' },
    diagnosis: 'urinary tract infection',
    outcome: 'improved',
    outcome_confirmed: true,
    lab_confirmed: true,
    amr_related: true,
    culture_collected: true,
    consent_status: 'granted',
    provenance_status: 'hash_verified',
    source_system: 'clinic-pims',
}));

const localX25519Keys = generateKeyPairSync('x25519');
const peerX25519Keys = generateKeyPairSync('x25519');
const coordinatorX25519Keys = generateKeyPairSync('x25519');
const localSigningKeys = generateKeyPairSync('ed25519');
const localPrivateKeyDer = localX25519Keys.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
const localSigningPrivateKeyDer = localSigningKeys.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
const localSigningPublicKeyDer = localSigningKeys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
const peerPublicKeyDer = peerX25519Keys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
const coordinatorPublicKeyDer = coordinatorX25519Keys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
const peerPublicKeyFingerprint = createHash('sha256').update(peerPublicKeyDer).digest('hex').slice(0, 32);
const localSigningKeyFingerprint = createHash('sha256').update(localSigningPublicKeyDer).digest('hex').slice(0, 32);

const firstEligibility = assessLearningRecordEligibility(records[0]!);
assert.equal(firstEligibility.eligible_for_federation, true);
assert.match(firstEligibility.record_hash, /^[a-f0-9]{64}$/);
assert.equal(firstEligibility.public_summary.species, 'canine');

const snapshot = buildOutcomeEligibilitySnapshotDraft({
    tenantId: 'tenant-a',
    federationKey: 'one_health_amr',
    partnerRef: 'clinic-a',
    records,
});
assert.equal(snapshot.eligibility_status, 'eligible');
assert.equal(snapshot.outcome_confirmed_rows, 20);
assert.equal(snapshot.provenance_verified_rows, 20);
assert.match(snapshot.source_record_digest, /^[a-f0-9]{64}$/);
assert.equal(snapshot.evidence.raw_records_shared, false);

const task: FederationRoundTask = {
    id: 'task-001',
    federation_round_id: 'round-001',
    federation_key: 'one_health_amr',
    round_key: 'one_health_amr:20260621',
    node_ref: 'clinic-a-node',
    partner_ref: 'clinic-a',
    task_type: 'diagnosis_delta',
    plan_hash: 'a'.repeat(64),
    secure_aggregation_config: {
        quantization_scale: 10000,
        mask_range: 1000,
        node_private_key_der_base64: localPrivateKeyDer.toString('base64'),
        coordinator_public_key_der_base64: coordinatorPublicKeyDer.toString('base64'),
        peers: [
            {
                node_ref: 'clinic-b-node',
                public_key_fingerprint: peerPublicKeyFingerprint,
                public_key_der_base64: peerPublicKeyDer.toString('base64'),
                status: 'active',
            },
            { node_ref: 'clinic-c-node', public_key_fingerprint: 'c'.repeat(32), status: 'dropped' },
        ],
    },
};
const commitment = buildMaskedUpdateCommitment({
    task,
    eligibleRecords: records.map((record) => assessLearningRecordEligibility(record)),
    outcomeEligibilitySnapshotId: 'eligibility-001',
    secret: 'local-node-secret',
    requestId: '11111111-1111-4111-8111-111111111111',
});
assert.equal(commitment.contribution_role, 'diagnosis');
assert.match(commitment.payload_commitment_hash, /^[a-f0-9]{64}$/);
assert.match(commitment.mask_commitment_hash, /^[a-f0-9]{64}$/);
assert.equal(commitment.masked_update_summary.raw_delta_included, false);
assert.equal(commitment.evidence.local_training_data_shared, false);

const trained = trainLocalFederatedTask({
    task,
    records,
    tenantId: 'tenant-a',
    federationKey: 'one_health_amr',
    partnerRef: 'clinic-a',
});
assert.equal(trained.dataset.snapshot_draft.eligibility_status, 'eligible');
assert.equal(trained.delta.task_type, 'diagnosis_delta');
assert.equal(trained.delta.contribution_role, 'diagnosis');
assert.equal(trained.delta.eligible_record_count, 20);
assert.match(trained.delta.delta_digest, /^[a-f0-9]{64}$/);
assert.ok(trained.delta.feature_count > 0);
assert.ok(trained.delta.delta_norm > 0);
assert.equal(trained.delta.evidence.raw_records_shared, false);

const secureMaterialization = buildSecureAggregationMaterialization({
    task,
    delta: trained.delta,
    secret: 'local-node-secret',
});
assert.equal(secureMaterialization.schema, 'vetios_secure_aggregation_materialization_v1');
assert.equal(secureMaterialization.masking_protocol, 'x25519_hkdf_pairwise_masked_v1');
assert.equal(secureMaterialization.dimension_count, trained.delta.feature_count);
assert.equal(secureMaterialization.pairwise_mask_commitments.length, 1);
assert.equal(secureMaterialization.pairwise_mask_commitments[0]?.key_agreement_protocol, 'x25519_hkdf_sha256_v1');
assert.equal(secureMaterialization.unmask_share_commitments.length, 1);
assert.equal(secureMaterialization.unmask_share_commitments[0]?.share_encryption_status, 'share_encrypted_for_coordinator');
assert.match(secureMaterialization.unmask_share_commitments[0]?.encrypted_share_envelope_hash ?? '', /^[a-f0-9]{64}$/);
assert.equal(secureMaterialization.encrypted_unmask_share_envelopes.length, 1);
assert.equal(secureMaterialization.encrypted_unmask_share_envelopes[0]?.schema, 'vetios_encrypted_unmask_share_envelope_v1');
assert.equal(secureMaterialization.encrypted_unmask_share_envelopes[0]?.encryption_protocol, 'x25519_aes_256_gcm_v1');
assert.equal(secureMaterialization.encrypted_unmask_share_envelopes[0]?.sender_node_ref, 'clinic-a-node');
assert.equal(secureMaterialization.encrypted_unmask_share_envelopes[0]?.sender_public_key_der_base64, localX25519Keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
assert.equal(secureMaterialization.quantization.mask_range, 1000);
assert.match(secureMaterialization.encrypted_unmask_share_envelopes[0]?.ciphertext_base64 ?? '', /^[A-Za-z0-9+/=]+$/);
assert.equal('mask_seed' in (secureMaterialization.encrypted_unmask_share_envelopes[0] as Record<string, unknown>), false);
assert.deepEqual(secureMaterialization.dropped_peer_refs, ['clinic-c-node']);
assert.match(secureMaterialization.mask_commitment_hash, /^[a-f0-9]{64}$/);
assert.ok(Object.keys(secureMaterialization.masked_integer_vector).length > 0);
assert.equal(secureMaterialization.evidence.raw_delta_shared, false);

const trainedCommitment = buildTrainedMaskedUpdateCommitment({
    task,
    dataset: trained.dataset,
    delta: trained.delta,
    outcomeEligibilitySnapshotId: 'eligibility-001',
    secret: 'local-node-secret',
    signingKey: {
        privateKeyDerBase64: localSigningPrivateKeyDer.toString('base64'),
    },
    requestId: '22222222-2222-4222-8222-222222222222',
});
assert.equal(trainedCommitment.contribution_role, 'diagnosis');
assert.equal(trainedCommitment.signature_algorithm, 'ed25519-node-signing-key-v1');
assert.equal(trainedCommitment.signing_key_fingerprint, localSigningKeyFingerprint);
assert.match(trainedCommitment.payload_commitment_hash, /^[a-f0-9]{64}$/);
assert.equal(trainedCommitment.masked_update_summary.raw_delta_included, false);
assert.equal(trainedCommitment.masked_update_summary.raw_records_included, false);
assert.equal(trainedCommitment.masked_update_summary.delta_digest, trained.delta.delta_digest);
assert.equal(trainedCommitment.mask_commitment_hash, trainedCommitment.secure_aggregation_materialization.mask_commitment_hash);
assert.equal(trainedCommitment.secure_aggregation_materialization.masked_vector_digest, secureMaterialization.masked_vector_digest);
assert.deepEqual(
    (trainedCommitment.masked_update_summary.secure_aggregation as Record<string, unknown>).masked_integer_vector,
    secureMaterialization.masked_integer_vector,
);
assert.equal(
    (trainedCommitment.masked_update_summary.secure_aggregation as Record<string, unknown>).encrypted_unmask_share_envelope_count,
    1,
);
assert.equal(trainedCommitment.evidence.model_delta_materialized, true);
assert.equal(trainedCommitment.evidence.secure_aggregation_materialized, true);
assert.equal(trainedCommitment.evidence.raw_model_delta_shared, false);
assert.equal(trainedCommitment.evidence.public_signature_verifiable, true);
const trainedSignatureEvidence = trainedCommitment.evidence.update_signature as Record<string, unknown>;
assert.equal(trainedSignatureEvidence.signing_public_key_der_base64, localSigningPublicKeyDer.toString('base64'));
assert.equal(trainedSignatureEvidence.signing_key_fingerprint, localSigningKeyFingerprint);
assert.equal(
    verify(
        null,
        Buffer.from(trainedCommitment.signed_payload_hash, 'utf8'),
        localSigningKeys.publicKey,
        Buffer.from(String(trainedSignatureEvidence.signature_value_base64), 'base64'),
    ),
    true,
);

const submissionPayload = toFederatedUpdateSubmissionPayload(trainedCommitment);
assert.equal('local_delta' in submissionPayload, false);
assert.equal('secure_aggregation_materialization' in submissionPayload, false);
assert.equal(submissionPayload.masked_update_summary.raw_delta_included, false);
assert.deepEqual(
    (submissionPayload.masked_update_summary.secure_aggregation as Record<string, unknown>).masked_integer_vector,
    secureMaterialization.masked_integer_vector,
);
assert.equal(
    ((submissionPayload.masked_update_summary.secure_aggregation as Record<string, unknown>).encrypted_unmask_share_envelopes as unknown[]).length,
    1,
);
assert.equal(
    'mask_seed' in (((submissionPayload.masked_update_summary.secure_aggregation as Record<string, unknown>).encrypted_unmask_share_envelopes as Record<string, unknown>[])[0] ?? {}),
    false,
);

const agent = new VetiosFederationNodeAgent({
    client: {
        pullTask: async () => ({}),
        submitUpdate: async () => ({ accepted: true }),
    } as never,
    records,
    secret: 'local-node-secret',
    signingKey: {
        privateKeyDerBase64: localSigningPrivateKeyDer.toString('base64'),
    },
    tenantId: 'tenant-a',
    federationKey: 'one_health_amr',
    partnerRef: 'clinic-a',
    outcomeEligibilitySnapshotId: 'eligibility-001',
});
const agentPrepared = agent.trainTask(task);
assert.equal(agentPrepared.delta.delta_digest, trained.delta.delta_digest);
assert.equal(agentPrepared.commitment.evidence.local_training_data_shared, false);
assert.equal(agentPrepared.commitment.signature_algorithm, 'ed25519-node-signing-key-v1');

const pullRequests: Array<{ url: string; init: RequestInit | undefined }> = [];
const pullClient = new VetiosFederationNodeClient({
    baseUrl: 'https://vetios.example',
    machineToken: 'machine-token',
    federationKey: 'one_health_amr',
    nodeRef: 'clinic-a-node',
    partnerRef: 'clinic-a',
    fetchImpl: async (url, init) => {
        pullRequests.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    },
});
await pullClient.pullTask('round-001', 'task-001');
assert.equal(pullRequests[0]?.url, 'https://vetios.example/api/federation/v1/rounds/round-001/tasks/task-001/pull');
assert.equal(pullRequests[0]?.init?.method, 'POST');
assert.equal(JSON.parse(String(pullRequests[0]?.init?.body)).node_ref, 'clinic-a-node');

const blocked = assessLearningRecordEligibility({
    local_record_id: 'blocked',
    species: 'canine',
    signs: ['vomiting'],
    consent_status: 'denied',
    provenance_status: 'not_verified',
});
assert.equal(blocked.eligible_for_federation, false);
assert.deepEqual(blocked.exclusion_reasons.sort(), [
    'consent_not_granted',
    'outcome_not_confirmed',
    'provenance_not_verified',
    'trust_score_below_threshold',
]);

const proofParticipants = [
    {
        tenantId: 'tenant-a',
        nodeRef: 'clinic-a-node',
        partnerRef: 'clinic-a',
        records: records.map((record) => ({ ...record, local_record_id: `a-${record.local_record_id}` })),
    },
    {
        tenantId: 'tenant-b',
        nodeRef: 'clinic-b-node',
        partnerRef: 'clinic-b',
        records: records.map((record) => ({ ...record, local_record_id: `b-${record.local_record_id}` })),
    },
    {
        tenantId: 'tenant-c',
        nodeRef: 'clinic-c-node',
        partnerRef: 'clinic-c',
        records: records.map((record) => ({ ...record, local_record_id: `c-${record.local_record_id}` })),
    },
];

const multiNodeProof = buildLocalMultiNodeFederatedRoundProof({
    federationKey: 'one_health_amr',
    roundKey: 'one_health_amr:proof:20260629',
    federationRoundId: 'round-proof-001',
    taskType: 'diagnosis_delta',
    minimumParticipants: 3,
    minimumRequiredRows: 1,
    minimumProvenanceRows: 1,
    minimumTrustScoredRows: 1,
    quantizationScale: 10000,
    maskRange: 1000,
    includeAggregateVector: true,
    generatedAt: '2026-06-29T12:00:00.000Z',
    participants: proofParticipants,
});
assert.equal(multiNodeProof.schema, 'vetios_local_multi_node_federated_round_proof_v1');
assert.equal(multiNodeProof.status, 'materialized');
assert.deepEqual(multiNodeProof.blockers, []);
assert.equal(multiNodeProof.participant_count, 3);
assert.equal(multiNodeProof.sanitized_update_submissions.length, 3);
assert.equal(multiNodeProof.participant_audits.length, 3);
assert.equal(multiNodeProof.aggregate_materialization.masking_protocol, 'x25519_hkdf_pairwise_masked_v1');
assert.equal(multiNodeProof.aggregate_materialization.pairwise_mask_cancellation_verified, true);
assert.equal(multiNodeProof.aggregate_materialization.encrypted_unmask_share_envelope_count, 6);
assert.match(multiNodeProof.aggregate_materialization.aggregate_integer_vector_digest ?? '', /^[a-f0-9]{64}$/);
assert.ok(Object.keys(multiNodeProof.aggregate_materialization.aggregate_integer_vector ?? {}).length > 0);
assert.equal(multiNodeProof.coordinator_artifact_bundle.schema, 'vetios_coordinator_aggregate_artifact_input_bundle_v1');
assert.equal(multiNodeProof.coordinator_artifact_bundle.task_type, 'diagnosis');
assert.equal(multiNodeProof.coordinator_artifact_bundle.accepted_updates.length, 3);
assert.equal(multiNodeProof.coordinator_artifact_bundle.accepted_updates[0]?.submission_status, 'accepted');
assert.equal(multiNodeProof.coordinator_artifact_bundle.accepted_updates[0]?.federation_round_id, 'round-proof-001');
assert.equal(multiNodeProof.coordinator_artifact_bundle.coordinator_recovery_packet, null);
assert.equal(multiNodeProof.coordinator_artifact_bundle.coordinator_private_material_included, false);
assert.equal(multiNodeProof.audit_packet.raw_records_shared, false);
assert.equal(multiNodeProof.audit_packet.raw_site_deltas_shared, false);
assert.equal(multiNodeProof.audit_packet.raw_unmask_share_seeds_shared, false);
assert.equal(multiNodeProof.audit_packet.node_private_keys_exported, false);
assert.equal(multiNodeProof.audit_packet.synthetic_rows_admitted, false);
const serializedMultiNodeProof = JSON.stringify(multiNodeProof);
assert.equal(serializedMultiNodeProof.includes('"local_delta":'), false);
assert.equal(serializedMultiNodeProof.includes('"mask_seed":'), false);
assert.equal(serializedMultiNodeProof.includes('"private_key_der_base64":'), false);
assert.equal(serializedMultiNodeProof.includes('a-case-1'), false);

const coordinatorRecoveryProof = buildLocalMultiNodeFederatedRoundProof({
    federationKey: 'one_health_amr',
    roundKey: 'one_health_amr:proof:20260629',
    federationRoundId: 'round-proof-001',
    taskType: 'diagnosis_delta',
    minimumParticipants: 3,
    minimumRequiredRows: 1,
    minimumProvenanceRows: 1,
    minimumTrustScoredRows: 1,
    generatedAt: '2026-06-29T12:00:00.000Z',
    includeCoordinatorRecoveryKey: true,
    participants: proofParticipants,
});
assert.equal(coordinatorRecoveryProof.coordinator_artifact_bundle.coordinator_private_material_included, true);
assert.equal(coordinatorRecoveryProof.coordinator_artifact_bundle.coordinator_recovery_packet?.local_proof_only, true);
assert.equal(coordinatorRecoveryProof.coordinator_artifact_bundle.coordinator_recovery_packet?.do_not_persist_private_material, true);
assert.equal(coordinatorRecoveryProof.coordinator_artifact_bundle.coordinator_recovery_packet?.raw_node_private_keys_exported, false);
assert.match(coordinatorRecoveryProof.coordinator_artifact_bundle.coordinator_recovery_packet?.private_key_der_base64 ?? '', /^[A-Za-z0-9+/=]+$/);

const blockedMultiNodeProof = buildLocalMultiNodeFederatedRoundProof({
    federationKey: 'one_health_amr',
    minimumParticipants: 3,
    minimumRequiredRows: 1,
    participants: [
        {
            tenantId: 'tenant-a',
            nodeRef: 'clinic-a-node',
            records: records.slice(0, 2),
        },
        {
            tenantId: 'tenant-b',
            nodeRef: 'clinic-b-node',
            records: records.slice(0, 2),
        },
    ],
});
assert.equal(blockedMultiNodeProof.status, 'blocked');
assert.ok(blockedMultiNodeProof.blockers.includes('participant_count_below_secure_aggregation_minimum'));
assert.deepEqual(blockedMultiNodeProof.next_actions, ['enroll_additional_attested_partner_nodes']);
