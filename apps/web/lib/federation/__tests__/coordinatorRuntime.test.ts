import { describe, expect, it } from 'vitest';
import {
    buildCoordinatorTaskPlan,
    buildCoordinatorTaskPlanHash,
    resolveCoordinatorNodeRef,
    type CoordinatorOutcomeEligibilitySnapshot,
} from '@/lib/federation/coordinatorRuntime';
import type {
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

    it('resolves node refs from membership metadata before falling back to tenant id', () => {
        expect(resolveCoordinatorNodeRef(membership({ metadata: { node_ref: 'Clinic / East' } }))).toBe('clinic_east');
        expect(resolveCoordinatorNodeRef(membership({ tenant_id: 'TENANT:WEST' }))).toBe('tenant:west');
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
