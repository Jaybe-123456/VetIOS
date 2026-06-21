import { describe, expect, it } from 'vitest';
import {
    buildFederatedCandidateExternalValidationPacket,
    type FederatedCandidateValidationEvidence,
} from '@/lib/federation/externalValidation';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

describe('federated external validation packets', () => {
    it('builds an externally verified packet only when evidence is accepted, signed, verified, and high scoring', () => {
        const packet = buildFederatedCandidateExternalValidationPacket(strongPromotionEvidence(), {
            attestorKind: 'auditor',
            attestorRef: 'External Audit Partner',
            attestationStatus: 'accepted',
            verificationStatus: 'signature_verified',
            signatureHash: HASH_B,
            signingKeyFingerprint: 'audit-key-2026',
            signatureAlgorithm: 'ed25519',
            requestId: '11111111-1111-4111-8111-111111111111',
        });

        expect(packet.evidence_grade).toBe('externally_verified');
        expect(packet.validation_score).toBeGreaterThanOrEqual(0.8);
        expect(packet.validation_target_type).toBe('federation_activation');
        expect(packet.moat_key).toBe('federation_activation');
        expect(packet.validation_scope).toBe('federation_readiness');
        expect(packet.signed_payload_hash).toBe(HASH_A);
        expect(packet.signature_hash).toBe(HASH_B);
        expect(packet.limitations).toBeNull();
        expect(packet.evidence.raw_clinical_records_included).toBe(false);
        expect(packet.evidence.raw_model_deltas_included).toBe(false);
    });

    it('keeps strong but unsigned internal validation as source-attested rather than externally verified', () => {
        const packet = buildFederatedCandidateExternalValidationPacket(strongPromotionEvidence());

        expect(packet.evidence_grade).toBe('source_attested');
        expect(packet.assessment.defensibility_signal).toBe(false);
        expect(packet.assessment.next_required_action).toBe('accept_or_reject_external_validation');
        expect(packet.limitations).toContain('No verified external signature material');
    });

    it('caps blocked candidate validation below defensible scoring', () => {
        const packet = buildFederatedCandidateExternalValidationPacket({
            ...strongPromotionEvidence(),
            promotion_status: 'blocked',
            blockers: ['outcome_confirmed_rows_below_threshold'],
            outcome_confirmed_rows: 5,
            provenance_verified_rows: 6,
            trust_scored_rows: 6,
        }, {
            attestorKind: 'auditor',
            attestorRef: 'External Audit Partner',
            attestationStatus: 'accepted',
            verificationStatus: 'signature_verified',
            signatureHash: HASH_B,
            signingKeyFingerprint: 'audit-key-2026',
        });

        expect(packet.validation_score).toBeLessThan(0.5);
        expect(packet.evidence_grade).toBe('reviewer_verified');
        expect(packet.assessment.defensibility_signal).toBe(false);
        expect(packet.limitations).toContain('Blocked promotion evidence');
        expect(packet.limitations).toContain('Outcome-confirmed rows below 50');
    });
});

function strongPromotionEvidence(overrides: Partial<FederatedCandidateValidationEvidence> = {}): FederatedCandidateValidationEvidence {
    return {
        id: '22222222-2222-4222-8222-222222222222',
        tenant_id: '11111111-1111-4111-8111-111111111111',
        federation_round_id: '33333333-3333-4333-8333-333333333333',
        model_registry_entry_id: '44444444-4444-4444-8444-444444444444',
        federation_key: 'one_health_amr',
        round_key: 'one_health_amr:20260621',
        task_type: 'diagnosis',
        candidate_model_version: 'fed-diagnosis-20260621',
        candidate_dataset_version: 'federated:one_health_amr:20260621',
        promotion_status: 'candidate_registered',
        participant_count: 4,
        accepted_update_submissions: 4,
        eligible_outcome_snapshots: 4,
        outcome_confirmed_rows: 80,
        provenance_verified_rows: 78,
        trust_scored_rows: 76,
        average_trust_score: 0.87,
        secure_aggregation_status: 'secure_aggregation_ready',
        source_artifact_hash: HASH_C,
        aggregate_payload_hash: HASH_A,
        blockers: [],
        warnings: [],
        evidence: {
            accepted_update_submission_ids: ['u1', 'u2', 'u3', 'u4'],
            outcome_source_digests: ['d1', 'd2'],
        },
        observed_at: '2026-06-21T12:00:00.000Z',
        ...overrides,
    };
}
