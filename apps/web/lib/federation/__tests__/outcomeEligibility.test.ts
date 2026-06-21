import { describe, expect, it } from 'vitest';
import {
    aggregateFederatedOutcomeEligibilitySnapshots,
    buildFederatedOutcomeEligibilityAssessment,
    buildFederatedOutcomeEligibilityDigest,
    evaluateFederatedOutcomeEligibilityForRound,
} from '@/lib/federation/outcomeEligibility';

describe('federated outcome eligibility', () => {
    it('marks a participant eligible only when outcome, consent, provenance, and trust thresholds are met', () => {
        const assessment = buildFederatedOutcomeEligibilityAssessment({
            outcome_confirmed_rows: 28,
            consented_network_learning_rows: 26,
            provenance_verified_rows: 24,
            trust_scored_rows: 23,
            lab_confirmed_rows: 6,
            expert_reviewed_rows: 18,
            average_trust_score: 0.82,
            eligibility_status: 'eligible',
            observed_at: '2026-06-21T10:00:00.000Z',
        });

        expect(assessment.eligibility_status).toBe('eligible');
        expect(assessment.blockers).toEqual([]);
        expect(assessment.eligibility_score).toBe(1);
        expect(assessment.latest_signal_at).toBe('2026-06-21T10:00:00.000Z');
    });

    it('blocks a round when the eligibility snapshot is missing', () => {
        const digest = buildFederatedOutcomeEligibilityDigest(null);
        const reasons = evaluateFederatedOutcomeEligibilityForRound(null);

        expect(digest.present).toBe(false);
        expect(digest.eligibility_status).toBe('insufficient_evidence');
        expect(digest.blockers).toContain('federated_outcome_eligibility_snapshot_missing');
        expect(reasons).toEqual(['federated outcome eligibility snapshot missing']);
    });

    it('keeps a participant out when outcome-confirmed evidence lacks consent or provenance', () => {
        const reasons = evaluateFederatedOutcomeEligibilityForRound({
            outcome_confirmed_rows: 40,
            consented_network_learning_rows: 8,
            provenance_verified_rows: 5,
            trust_scored_rows: 40,
            average_trust_score: 0.9,
        });

        expect(reasons).toContain('federated outcome eligibility: network learning consent rows below minimum');
        expect(reasons).toContain('federated outcome eligibility: provenance verified rows below minimum');
    });

    it('honors explicit blocked and expired statuses even when counts are high', () => {
        const blocked = buildFederatedOutcomeEligibilityAssessment({
            outcome_confirmed_rows: 100,
            consented_network_learning_rows: 100,
            provenance_verified_rows: 100,
            trust_scored_rows: 100,
            average_trust_score: 0.95,
            eligibility_status: 'blocked',
        });
        const expired = buildFederatedOutcomeEligibilityAssessment({
            outcome_confirmed_rows: 100,
            consented_network_learning_rows: 100,
            provenance_verified_rows: 100,
            trust_scored_rows: 100,
            average_trust_score: 0.95,
            eligibility_status: 'expired',
        });

        expect(blocked.eligibility_status).toBe('blocked');
        expect(blocked.blockers).toContain('eligibility_snapshot_blocked');
        expect(expired.eligibility_status).toBe('expired');
        expect(expired.blockers).toContain('eligibility_snapshot_expired');
    });

    it('aggregates latest eligibility evidence for moat reporting', () => {
        const aggregate = aggregateFederatedOutcomeEligibilitySnapshots([
            {
                outcome_confirmed_rows: 30,
                consented_network_learning_rows: 30,
                provenance_verified_rows: 30,
                trust_scored_rows: 30,
                average_trust_score: 0.8,
                eligibility_status: 'eligible',
                observed_at: '2026-06-21T09:00:00.000Z',
            },
            {
                outcome_confirmed_rows: 4,
                consented_network_learning_rows: 2,
                provenance_verified_rows: 1,
                trust_scored_rows: 0,
                average_trust_score: 0,
                observed_at: '2026-06-21T11:00:00.000Z',
            },
        ]);

        expect(aggregate.total_snapshots).toBe(2);
        expect(aggregate.eligible_snapshots).toBe(1);
        expect(aggregate.insufficient_snapshots).toBe(1);
        expect(aggregate.total_outcome_confirmed_rows).toBe(34);
        expect(aggregate.latest_signal_at).toBe('2026-06-21T11:00:00.000Z');
        expect(aggregate.top_blockers[0]?.blocker).toBeTruthy();
    });
});
