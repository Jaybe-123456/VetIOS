import { describe, expect, it } from 'vitest';
import {
    assessCoordinatorUpdateAcceptanceReadiness,
    buildCoordinatorSecureAggregateMaterialization,
    buildCoordinatorSecureAggregationConfig,
    buildCoordinatorTaskPlan,
    buildCoordinatorTaskPlanHash,
    resolveCoordinatorNodeRef,
    type CoordinatorOutcomeEligibilitySnapshot,
} from '@/lib/federation/coordinatorRuntime';
import type {
    FederatedUpdateSubmissionRow,
    FederationMembershipRow,
    FederationRoundRow,
} from '@/lib/federation/nodeRuntime';

describe('federation coordinator runtime', () => {
    it('issues task plan only for participants with eligible outcome snapshots', () => {
        const plan = buildCoordinatorTaskPlan({
            round: round(),
            memberships: [
                membership({ tenant_id: 'tenant-a', metadata: { live_node: { node_ref: 'Clinic A' } } }),
                membership({ tenant_id: 'tenant-b' }),
                membership({ tenant_id: 'tenant-c' }),
            ],
            outcomeEligibilitySnapshots: [
                eligibility({ tenant_id: 'tenant-a', eligibility_status: 'eligible' }),
                eligibility({ tenant_id: 'tenant-b', eligibility_status: 'blocked' }),
            ],
            taskTypes: ['diagnosis_delta', 'support_summary'],
        });

        expect(plan.eligible_participants).toHaveLength(1);
        expect(plan.eligible_participants[0]?.node_ref).toBe('clinic_a');
        expect(plan.skipped_participants).toEqual([
            { tenant_id: 'tenant-b', reason: 'outcome_eligibility_blocked' },
            { tenant_id: 'tenant-c', reason: 'missing_outcome_eligibility_snapshot' },
        ]);
    });

    it('prefers the latest outcome eligibility snapshot per tenant', () => {
        const plan = buildCoordinatorTaskPlan({
            round: round(),
            memberships: [membership({ tenant_id: 'tenant-a' })],
            outcomeEligibilitySnapshots: [
                eligibility({
                    id: 'old',
                    tenant_id: 'tenant-a',
                    eligibility_status: 'blocked',
                    observed_at: '2026-06-20T12:00:00.000Z',
                }),
                eligibility({
                    id: 'new',
                    tenant_id: 'tenant-a',
                    eligibility_status: 'eligible',
                    observed_at: '2026-06-21T12:00:00.000Z',
                }),
            ],
            taskTypes: ['diagnosis_delta'],
        });

        expect(plan.eligible_participants).toHaveLength(1);
        expect(plan.eligible_participants[0]?.eligibility_snapshot?.id).toBe('new');
    });

    it('builds stable task plan hashes from the governed evidence manifest', () => {
        const first = buildCoordinatorTaskPlanHash({
            federationRoundId: 'round-001',
            tenantId: 'tenant-a',
            nodeRef: 'clinic-a',
            taskType: 'diagnosis_delta',
            outcomeEligibilitySnapshotId: 'elig-001',
            datasetPolicy: { minimum_trust_score: 0.7, label_types: ['lab_confirmed'] },
            secureAggregationConfig: { threshold: 2 },
            taskPayload: { model: 'baseline' },
        });
        const second = buildCoordinatorTaskPlanHash({
            federationRoundId: 'round-001',
            tenantId: 'tenant-a',
            nodeRef: 'clinic-a',
            taskType: 'diagnosis_delta',
            outcomeEligibilitySnapshotId: 'elig-001',
            datasetPolicy: { label_types: ['lab_confirmed'], minimum_trust_score: 0.7 },
            secureAggregationConfig: { threshold: 2 },
            taskPayload: { model: 'baseline' },
        });

        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(second).toBe(first);
    });

    it('allows coordinator acceptance only after Ed25519 update signature verification', () => {
        const readiness = assessCoordinatorUpdateAcceptanceReadiness(submission({
            submission_status: 'submitted',
            signature_algorithm: 'ed25519-node-signing-key-v1',
            signing_key_fingerprint: 'node-signing-key',
            evidence: {
                update_signature_verification_status: 'verified',
                update_signature_verification: {
                    signature_valid: true,
                    raw_private_key_exported: false,
                },
            },
        }));

        expect(readiness.ready).toBe(true);
        expect(readiness.blockers).toEqual([]);
        expect(readiness.signals.secureAggregationMaterialized).toBe(true);
    });

    it('blocks coordinator acceptance for legacy or unverified update signatures', () => {
        const readiness = assessCoordinatorUpdateAcceptanceReadiness(submission({
            submission_status: 'submitted',
            signature_algorithm: 'hmac-sha256-local-node-key-v1',
            evidence: {
                update_signature_verification_status: 'legacy_unverified',
                update_signature_verification: {
                    signature_valid: false,
                    raw_private_key_exported: false,
                },
            },
        }));

        expect(readiness.ready).toBe(false);
        expect(readiness.blockers).toContain('ed25519_update_signature_required');
        expect(readiness.blockers).toContain('update_signature_not_verified');
        expect(readiness.blockers).toContain('update_signature_invalid');
    });

    it('resolves node refs from membership metadata before falling back to tenant id', () => {
        expect(resolveCoordinatorNodeRef(membership({ metadata: { node_ref: 'Clinic / East' } }))).toBe('clinic_east');
        expect(resolveCoordinatorNodeRef(membership({ tenant_id: 'TENANT:WEST' }))).toBe('tenant:west');
    });

    it('hydrates node tasks with peer public keys for X25519 secure aggregation', () => {
        const plan = buildCoordinatorTaskPlan({
            round: round(),
            memberships: [
                membership({
                    tenant_id: 'tenant-a',
                    metadata: {
                        node_ref: 'clinic-a-node',
                        node_public_key_der_base64: 'public-key-a',
                        node_public_key_fingerprint: 'fingerprint-a',
                    },
                }),
                membership({
                    tenant_id: 'tenant-b',
                    metadata: {
                        live_node: {
                            node_ref: 'clinic-b-node',
                            partner_ref: 'clinic-b',
                            secure_aggregation: {
                                public_key_der_base64: 'public-key-b',
                                public_key_fingerprint: 'fingerprint-b',
                            },
                        },
                    },
                }),
            ],
            outcomeEligibilitySnapshots: [
                eligibility({ tenant_id: 'tenant-a' }),
                eligibility({ tenant_id: 'tenant-b' }),
            ],
            taskTypes: ['diagnosis_delta'],
        });

        const config = buildCoordinatorSecureAggregationConfig({
            round: round(),
            participant: plan.eligible_participants[0]!,
            participants: plan.eligible_participants,
            baseConfig: {
                coordinator_public_key_der_base64: 'coordinator-public-key',
                quantization_scale: 10_000,
            },
        });

        expect(config.masking_protocol).toBe('x25519_hkdf_pairwise_masked_v1');
        expect(config.peer_count).toBe(1);
        expect(config.peer_public_key_count).toBe(1);
        expect(config.x25519_pairwise_ready).toBe(true);
        expect(config.peers).toEqual([{
            node_ref: 'clinic-b-node',
            partner_ref: 'clinic-b',
            tenant_id: 'tenant-b',
            public_key_fingerprint: 'fingerprint-b',
            public_key_der_base64: 'public-key-b',
            public_key_pem: null,
            status: 'active',
        }]);
    });

    it('materializes coordinator aggregate evidence from accepted masked vectors', () => {
        const materialization = buildCoordinatorSecureAggregateMaterialization({
            round: round(),
            acceptedSubmissions: [
                submission({
                    id: 'submission-a',
                    node_ref: 'clinic-a-node',
                    payload_commitment_hash: 'a'.repeat(64),
                    mask_commitment_hash: 'b'.repeat(64),
                    masked_update_summary: maskedSummary({
                        symptom_vomiting: 12,
                        species_canine: -3,
                    }),
                }),
                submission({
                    id: 'submission-b',
                    node_ref: 'clinic-b-node',
                    payload_commitment_hash: 'c'.repeat(64),
                    mask_commitment_hash: 'd'.repeat(64),
                    masked_update_summary: maskedSummary({
                        symptom_vomiting: 8,
                        species_canine: 7,
                    }),
                }),
            ],
        });

        expect(materialization.status).toBe('materialized');
        expect(materialization.masking_protocol).toBe('x25519_hkdf_pairwise_masked_v1');
        expect(materialization.materialized_update_count).toBe(2);
        expect(materialization.aggregate_masked_integer_vector).toEqual({
            species_canine: 4,
            symptom_vomiting: 20,
        });
        expect(materialization.aggregate_masked_vector_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(materialization.encrypted_unmask_share_envelope_count).toBe(2);
        expect(materialization.dropout_recovery_evidence_status).toBe('encrypted_unmask_envelopes_available');
        expect(materialization.raw_clinical_rows_shared).toBe(false);
        expect(materialization.raw_site_delta_artifacts_stored).toBe(false);
    });

    it('blocks coordinator aggregate evidence when accepted vectors disagree on dimension order', () => {
        const materialization = buildCoordinatorSecureAggregateMaterialization({
            round: round(),
            acceptedSubmissions: [
                submission({
                    id: 'submission-a',
                    masked_update_summary: maskedSummary({ a: 1 }, { dimensionOrderDigest: '1'.repeat(64) }),
                }),
                submission({
                    id: 'submission-b',
                    masked_update_summary: maskedSummary({ a: 1 }, { dimensionOrderDigest: '2'.repeat(64) }),
                }),
            ],
        });

        expect(materialization.status).toBe('blocked');
        expect(materialization.blockers).toContain('dimension_order_digest_mismatch:submission-b');
        expect(materialization.next_actions).toContain('do_not_promote_candidate_from_this_round');
    });
});

function round(overrides: Partial<FederationRoundRow> = {}): FederationRoundRow {
    return {
        id: 'round-001',
        federation_key: 'one_health_amr',
        coordinator_tenant_id: 'coordinator-tenant',
        round_key: 'one_health_amr:20260621',
        status: 'collecting',
        aggregation_strategy: 'secure_aggregation_v1',
        participant_count: 3,
        aggregate_payload: {},
        candidate_artifact_payload: {},
        started_at: '2026-06-21T10:00:00.000Z',
        completed_at: null,
        ...overrides,
    };
}

function membership(overrides: Partial<FederationMembershipRow> = {}): FederationMembershipRow {
    return {
        id: 'membership-001',
        federation_key: 'one_health_amr',
        tenant_id: 'tenant-a',
        coordinator_tenant_id: 'coordinator-tenant',
        status: 'active',
        participation_mode: 'full',
        weight: 1,
        metadata: {},
        ...overrides,
    };
}

function eligibility(overrides: Partial<CoordinatorOutcomeEligibilitySnapshot> = {}): CoordinatorOutcomeEligibilitySnapshot {
    return {
        id: 'elig-001',
        tenant_id: 'tenant-a',
        federation_key: 'one_health_amr',
        eligibility_status: 'eligible',
        outcome_confirmed_rows: 40,
        provenance_verified_rows: 40,
        trust_scored_rows: 40,
        average_trust_score: 0.82,
        source_record_digest: 'a'.repeat(64),
        observed_at: '2026-06-21T12:00:00.000Z',
        ...overrides,
    };
}

function submission(overrides: Partial<FederatedUpdateSubmissionRow> = {}): FederatedUpdateSubmissionRow {
    return {
        id: 'submission-001',
        tenant_id: 'tenant-a',
        request_id: 'request-001',
        federation_round_id: 'round-001',
        round_node_task_id: 'task-001',
        outcome_eligibility_snapshot_id: 'elig-001',
        federation_key: 'one_health_amr',
        round_key: 'one_health_amr:20260621',
        node_ref: 'clinic-a-node',
        partner_ref: 'clinic-a',
        participant_ref: 'one_health_amr:clinic-a-node',
        contribution_role: 'diagnosis',
        submission_status: 'accepted',
        masking_protocol: 'x25519_hkdf_pairwise_masked_v1',
        payload_commitment_hash: 'a'.repeat(64),
        mask_commitment_hash: 'b'.repeat(64),
        signed_payload_hash: 'c'.repeat(64),
        signature_algorithm: 'hmac-sha256-local-node-key-v1',
        signature_hash: 'd'.repeat(64),
        signing_key_fingerprint: 'fingerprint',
        masked_update_summary: maskedSummary({ symptom_vomiting: 1 }),
        public_summary: {},
        evidence: {},
        observed_at: '2026-06-21T12:00:00.000Z',
        created_at: '2026-06-21T12:00:00.000Z',
        ...overrides,
    };
}

function maskedSummary(
    maskedIntegerVector: Record<string, number>,
    overrides: {
        dimensionOrderDigest?: string;
        maskedVectorDigest?: string;
        encryptedEnvelopeCount?: number;
    } = {},
) {
    return {
        schema: 'vetios_masked_model_delta_commitment_v1',
        secure_aggregation: {
            schema: 'vetios_secure_aggregation_materialization_v1',
            masking_protocol: 'x25519_hkdf_pairwise_masked_v1',
            dimension_count: Object.keys(maskedIntegerVector).length,
            dimension_order_digest: overrides.dimensionOrderDigest ?? 'f'.repeat(64),
            masked_integer_vector: maskedIntegerVector,
            masked_vector_digest: overrides.maskedVectorDigest ?? 'e'.repeat(64),
            pairwise_mask_count: 1,
            unmask_share_count: 1,
            encrypted_unmask_share_envelope_count: overrides.encryptedEnvelopeCount ?? 1,
            encrypted_unmask_share_envelopes: [{
                envelope_hash: '9'.repeat(64),
            }],
        },
        raw_delta_included: false,
        raw_records_included: false,
    };
}
