import { describe, expect, it } from 'vitest';
import {
    buildFederatedModelPromotionAssessment,
    type FederatedPromotionArtifactEvidence,
    type FederatedPromotionOutcomeEligibilityEvidence,
    type FederatedPromotionRoundEvidence,
    type FederatedPromotionUpdateSubmissionEvidence,
} from '@/lib/federation/modelPromotion';

describe('federated model promotion bridge', () => {
    it('blocks aggregate artifacts that lack accepted live-node and outcome eligibility evidence', () => {
        const assessment = buildFederatedModelPromotionAssessment({
            round: promotionRound(),
            artifact: promotionArtifact(),
            updateSubmissions: [],
            outcomeEligibilitySnapshots: [],
        });

        expect(assessment.allowed).toBe(false);
        expect(assessment.promotion_status).toBe('blocked');
        expect(assessment.blockers).toEqual(expect.arrayContaining([
            'accepted_live_node_updates_below_threshold',
            'eligible_outcome_snapshots_below_threshold',
            'outcome_confirmed_rows_below_threshold',
            'provenance_verified_rows_below_threshold',
            'trust_scored_rows_below_threshold',
        ]));
    });

    it('allows candidate registration when live accepted updates are linked to eligible outcome-confirmed snapshots', () => {
        const assessment = buildFederatedModelPromotionAssessment({
            round: promotionRound({ aggregate_payload: {} }),
            artifact: promotionArtifact(),
            updateSubmissions: [
                updateSubmission({ id: 'update-a', node_ref: 'node-a', outcome_eligibility_snapshot_id: 'elig-a' }),
                updateSubmission({ id: 'update-b', node_ref: 'node-b', outcome_eligibility_snapshot_id: 'elig-b' }),
            ],
            outcomeEligibilitySnapshots: [
                eligibilitySnapshot({ id: 'elig-a', tenant_id: 'tenant-a', outcome_confirmed_rows: 12, provenance_verified_rows: 12, trust_scored_rows: 12, average_trust_score: 0.84 }),
                eligibilitySnapshot({ id: 'elig-b', tenant_id: 'tenant-b', outcome_confirmed_rows: 14, provenance_verified_rows: 14, trust_scored_rows: 14, average_trust_score: 0.76 }),
            ],
        });

        expect(assessment.allowed).toBe(true);
        expect(assessment.promotion_status).toBe('promotion_gate_required');
        expect(assessment.blockers).toEqual([]);
        expect(assessment.metrics.accepted_update_submissions).toBe(2);
        expect(assessment.metrics.eligible_outcome_snapshots).toBe(2);
        expect(assessment.metrics.secure_aggregation_status).toBe('live_node_commitments_ready');
        expect(assessment.metrics.average_trust_score).toBeCloseTo(0.7969, 4);
    });

    it('blocks low-trust outcome snapshots even when updates are accepted', () => {
        const assessment = buildFederatedModelPromotionAssessment({
            round: promotionRound(),
            artifact: promotionArtifact(),
            updateSubmissions: [
                updateSubmission({ id: 'update-a', node_ref: 'node-a', outcome_eligibility_snapshot_id: 'elig-a' }),
                updateSubmission({ id: 'update-b', node_ref: 'node-b', outcome_eligibility_snapshot_id: 'elig-b' }),
            ],
            outcomeEligibilitySnapshots: [
                eligibilitySnapshot({ id: 'elig-a', trust_scored_rows: 11, average_trust_score: 0.61 }),
                eligibilitySnapshot({ id: 'elig-b', trust_scored_rows: 11, average_trust_score: 0.64 }),
            ],
        });

        expect(assessment.allowed).toBe(false);
        expect(assessment.blockers).toContain('average_trust_score_below_threshold');
        expect(assessment.metrics.average_trust_score).toBeLessThan(0.7);
    });
});

function promotionRound(overrides: Partial<FederatedPromotionRoundEvidence> = {}): FederatedPromotionRoundEvidence {
    return {
        id: 'round-001',
        federation_key: 'one_health_amr',
        coordinator_tenant_id: '11111111-1111-4111-8111-111111111111',
        round_key: 'one_health_amr:20260621',
        status: 'completed',
        participant_count: 2,
        aggregate_payload: {
            secure_aggregation: {
                status: 'secure_aggregation_ready',
            },
        },
        candidate_artifact_payload: {},
        completed_at: '2026-06-21T12:00:00.000Z',
        ...overrides,
    };
}

function promotionArtifact(overrides: Partial<FederatedPromotionArtifactEvidence> = {}): FederatedPromotionArtifactEvidence {
    return {
        id: 'artifact-001',
        task_type: 'diagnosis',
        model_version: 'fed-diagnosis-20260621',
        dataset_version: 'fed-dataset-20260621',
        artifact_payload: {
            model_version: 'fed-diagnosis-20260621',
            feature_schema_version: 'federated_feature_schema_v1',
            label_policy_version: 'outcome_confirmed_federated_v1',
        },
        summary: {},
        ...overrides,
    };
}

function updateSubmission(overrides: Partial<FederatedPromotionUpdateSubmissionEvidence> = {}): FederatedPromotionUpdateSubmissionEvidence {
    return {
        id: 'update',
        contribution_role: 'diagnosis',
        submission_status: 'accepted',
        node_ref: 'node',
        participant_ref: 'participant',
        outcome_eligibility_snapshot_id: 'eligibility',
        payload_commitment_hash: 'a'.repeat(64),
        mask_commitment_hash: 'b'.repeat(64),
        signed_payload_hash: 'c'.repeat(64),
        signature_hash: 'd'.repeat(64),
        ...overrides,
    };
}

function eligibilitySnapshot(overrides: Partial<FederatedPromotionOutcomeEligibilityEvidence> = {}): FederatedPromotionOutcomeEligibilityEvidence {
    return {
        id: 'eligibility',
        tenant_id: 'tenant',
        eligibility_status: 'eligible',
        outcome_confirmed_rows: 12,
        provenance_verified_rows: 12,
        trust_scored_rows: 12,
        average_trust_score: 0.82,
        source_record_digest: 'e'.repeat(64),
        ...overrides,
    };
}
