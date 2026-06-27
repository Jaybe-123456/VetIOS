import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
    assessLearningRecordEligibility,
    buildMaskedUpdateCommitment,
    buildOutcomeEligibilitySnapshotDraft,
    buildSecureAggregationMaterialization,
    buildTrainedMaskedUpdateCommitment,
    trainLocalFederatedTask,
    toFederatedUpdateSubmissionPayload,
    VetiosFederationNodeAgent,
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
const localPrivateKeyDer = localX25519Keys.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
const peerPublicKeyDer = peerX25519Keys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
const coordinatorPublicKeyDer = coordinatorX25519Keys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
const peerPublicKeyFingerprint = createHash('sha256').update(peerPublicKeyDer).digest('hex').slice(0, 32);

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
    requestId: '22222222-2222-4222-8222-222222222222',
});
assert.equal(trainedCommitment.contribution_role, 'diagnosis');
assert.equal(trainedCommitment.signature_algorithm, 'hmac-sha256-local-node-key-v1');
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
    tenantId: 'tenant-a',
    federationKey: 'one_health_amr',
    partnerRef: 'clinic-a',
    outcomeEligibilitySnapshotId: 'eligibility-001',
});
const agentPrepared = agent.trainTask(task);
assert.equal(agentPrepared.delta.delta_digest, trained.delta.delta_digest);
assert.equal(agentPrepared.commitment.evidence.local_training_data_shared, false);

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
