import { describe, expect, it } from 'vitest';
import {
    buildFederatedAggregateArtifactDraft,
    type FederatedAggregateUpdateEvidence,
} from '@/lib/federation/aggregateBuilder';
import type { FederationRoundRow } from '@/lib/federation/nodeRuntime';

describe('federated aggregate artifact builder', () => {
    it('builds a diagnosis aggregate candidate from accepted outcome-linked commitments', () => {
        const draft = buildFederatedAggregateArtifactDraft({
            round: round(),
            taskType: 'diagnosis',
            acceptedUpdates: [
                update({ id: 'accepted-a', node_ref: 'node-a', participant_ref: 'participant-a', outcome_eligibility_snapshot_id: 'elig-a' }),
                update({ id: 'accepted-b', node_ref: 'node-b', participant_ref: 'participant-b', outcome_eligibility_snapshot_id: 'elig-b' }),
            ],
            minimumAcceptedUpdates: 2,
            builtAt: '2026-06-21T15:00:00.000Z',
        });

        expect(draft.blockers).toEqual([]);
        expect(draft.task_type).toBe('diagnosis');
        expect(draft.model_version).toContain('fed-one_health_amr-one_health_amr:20260621-diagnosis');
        expect(draft.dataset_version).toMatch(/^federated:one_health_amr:20260621:[a-f0-9]{64}$/);
        expect(draft.artifact_payload.accepted_update_count).toBe(2);
        expect(draft.artifact_payload.raw_site_delta_artifacts_stored).toBe(false);
        expect(draft.artifact_payload.raw_clinical_rows_shared).toBe(false);
        expect(draft.summary.status).toBe('aggregate_candidate_ready');
    });

    it('blocks candidates that lack secure aggregation mask commitments', () => {
        const draft = buildFederatedAggregateArtifactDraft({
            round: round(),
            taskType: 'severity',
            acceptedUpdates: [
                update({
                    contribution_role: 'severity',
                    mask_commitment_hash: null,
                    outcome_eligibility_snapshot_id: 'elig-a',
                }),
                update({
                    id: 'accepted-b',
                    contribution_role: 'severity',
                    node_ref: 'node-b',
                    participant_ref: 'participant-b',
                    outcome_eligibility_snapshot_id: 'elig-b',
                }),
            ],
            minimumAcceptedUpdates: 2,
        });

        expect(draft.blockers).toContain('accepted_update_missing_mask_commitment');
        expect(draft.summary.status).toBe('aggregate_candidate_blocked');
    });

    it('keeps raw masked update summaries out of the aggregate payload', () => {
        const draft = buildFederatedAggregateArtifactDraft({
            round: round(),
            taskType: 'diagnosis',
            acceptedUpdates: [
                update({ id: 'accepted-a', node_ref: 'node-a', participant_ref: 'participant-a' }),
                update({ id: 'accepted-b', node_ref: 'node-b', participant_ref: 'participant-b' }),
            ],
            minimumAcceptedUpdates: 2,
        });

        const serialized = JSON.stringify(draft.artifact_payload);
        expect(serialized).not.toContain('raw_gradient_vector');
        expect(serialized).not.toContain('unmasked_delta');
        expect(serialized).toContain('public_update_summaries');
    });
});

function round(overrides: Partial<FederationRoundRow> = {}): FederationRoundRow {
    return {
        id: 'round-001',
        federation_key: 'one_health_amr',
        coordinator_tenant_id: 'coordinator-tenant',
        round_key: 'one_health_amr:20260621',
        status: 'aggregating',
        aggregation_strategy: 'secure_aggregation_v1',
        participant_count: 2,
        aggregate_payload: {
            secure_aggregation: {
                status: 'secure_aggregation_ready',
            },
        },
        candidate_artifact_payload: {},
        started_at: '2026-06-21T10:00:00.000Z',
        completed_at: null,
        ...overrides,
    };
}

function update(overrides: Partial<FederatedAggregateUpdateEvidence> = {}): FederatedAggregateUpdateEvidence {
    return {
        id: 'accepted-update',
        tenant_id: 'tenant-a',
        federation_round_id: 'round-001',
        outcome_eligibility_snapshot_id: 'eligibility-a',
        federation_key: 'one_health_amr',
        round_key: 'one_health_amr:20260621',
        node_ref: 'node-a',
        partner_ref: 'partner-a',
        participant_ref: 'participant-a',
        contribution_role: 'diagnosis',
        submission_status: 'accepted',
        masking_protocol: 'pairwise_masked_commitment_v1',
        payload_commitment_hash: 'a'.repeat(64),
        mask_commitment_hash: 'b'.repeat(64),
        signed_payload_hash: 'c'.repeat(64),
        signature_algorithm: 'ed25519',
        signature_hash: 'd'.repeat(64),
        signing_key_fingerprint: 'key-fingerprint-a',
        public_summary: {
            rows: 24,
            label_family: 'outcome_confirmed',
        },
        evidence: {
            raw_gradient_vector: [0.12, -0.01],
            unmasked_delta: 'must-not-propagate',
        },
        observed_at: '2026-06-21T14:00:00.000Z',
        created_at: '2026-06-21T14:00:00.000Z',
        ...overrides,
    };
}
