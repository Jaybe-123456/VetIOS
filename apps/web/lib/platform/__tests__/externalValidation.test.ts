import { describe, expect, it } from 'vitest';
import {
    aggregateExternalValidationEvents,
    buildExternalValidationAssessment,
} from '@/lib/platform/externalValidation';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('external validation moat', () => {
    it('keeps submitted unsigned evidence as source attested', () => {
        const assessment = buildExternalValidationAssessment({
            validation_target_type: 'moat_completion',
            validation_target_ref: 'Outcome Provenance Layer',
            moat_key: 'outcome_provenance_layer',
            attestor_kind: 'clinic',
            attestor_ref: 'Clinic A',
            validation_scope: 'outcome_provenance',
            attestation_status: 'submitted',
            verification_status: 'unsigned',
            validation_score: 0.9,
        });

        expect(assessment.evidence_grade).toBe('source_attested');
        expect(assessment.defensibility_signal).toBe(false);
        expect(assessment.next_required_action).toBe('accept_or_reject_external_validation');
        expect(assessment.normalized_attestor_ref).toBe('clinic_a');
    });

    it('requires accepted, verified, signed, high-scoring evidence for external verification', () => {
        const assessment = buildExternalValidationAssessment({
            validation_target_type: 'amr_stewardship',
            validation_target_ref: 'amr:site:2026-06-20',
            moat_key: 'amr_stewardship',
            attestor_kind: 'reference_lab',
            attestor_ref: 'Lab Network 7',
            validation_scope: 'amr_signal',
            attestation_status: 'accepted',
            verification_status: 'signature_verified',
            validation_score: 0.92,
            signed_payload_hash: HASH_A,
            signature_hash: HASH_B,
            signing_key_fingerprint: 'lab-key-2026',
        });

        expect(assessment.evidence_grade).toBe('externally_verified');
        expect(assessment.defensibility_signal).toBe(true);
        expect(assessment.next_required_action).toBeNull();
        expect(assessment.signed_payload_hash).toBe(HASH_A);
    });

    it('does not overclaim low-scoring signed evidence', () => {
        const assessment = buildExternalValidationAssessment({
            validation_target_type: 'model_trust',
            validation_target_ref: 'trust:cire:v1',
            moat_key: 'model_trust_layer',
            attestor_kind: 'auditor',
            attestor_ref: 'Audit Partner',
            validation_scope: 'clinical_accuracy',
            attestation_status: 'accepted',
            verification_status: 'reviewer_verified',
            validation_score: 0.6,
            signature_hash: HASH_B,
            signing_key_fingerprint: 'audit-key',
        });

        expect(assessment.evidence_grade).toBe('reviewer_verified');
        expect(assessment.defensibility_signal).toBe(false);
        expect(assessment.next_required_action).toBe('raise_validation_score_or_keep_as_reviewer_verified');
    });

    it('aggregates de-identified external validation proof by moat and scope', () => {
        const aggregate = aggregateExternalValidationEvents([
            {
                moat_key: 'amr_stewardship',
                validation_scope: 'amr_signal',
                attestation_status: 'accepted',
                verification_status: 'signature_verified',
                evidence_grade: 'externally_verified',
                validation_score: 0.9,
                observed_at: '2026-06-20T12:00:00.000Z',
            },
            {
                moat_key: 'amr_stewardship',
                validation_scope: 'amr_signal',
                attestation_status: 'submitted',
                verification_status: 'unsigned',
                evidence_grade: 'source_attested',
                validation_score: 0.7,
                observed_at: '2026-06-19T12:00:00.000Z',
            },
        ]);

        expect(aggregate.total_events).toBe(2);
        expect(aggregate.externally_verified_events).toBe(1);
        expect(aggregate.defensibility_signals).toBe(1);
        expect(aggregate.average_validation_score).toBe(0.8);
        expect(aggregate.by_moat[0]).toEqual({
            moat_key: 'amr_stewardship',
            count: 2,
            externally_verified: 1,
        });
    });
});
