import assert from 'node:assert/strict';
import {
    assessLearningRecordEligibility,
    buildMaskedUpdateCommitment,
    buildOutcomeEligibilitySnapshotDraft,
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
