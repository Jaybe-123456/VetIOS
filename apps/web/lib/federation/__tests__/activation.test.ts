import { describe, expect, it } from 'vitest';
import {
    buildFederationActivationAssessment,
    latestFederationActivationRows,
    summarizeFederationActivation,
    type FederationActivationEventRow,
} from '@/lib/federation/activation';

describe('federation activation moat', () => {
    it('keeps invited nodes pending until policy, attestation, keys, and heartbeat are proven', () => {
        const assessment = buildFederationActivationAssessment({
            activation_stage: 'invited',
            data_policy_status: 'not_reviewed',
            attestation_status: 'not_attested',
            secure_aggregation_status: 'not_ready',
            heartbeat_status: 'not_seen',
            now: new Date('2026-06-19T12:00:00.000Z'),
        });

        expect(assessment.activation_status).toBe('pending');
        expect(assessment.readiness_score).toBeLessThan(0.2);
        expect(assessment.next_required_step).toBe('approve_data_policy');
        expect(assessment.blockers).toContain('data_policy_not_reviewed');
        expect(assessment.blockers).toContain('secure_aggregation_not_ready');
    });

    it('marks an active production node only after complete activation proof', () => {
        const assessment = buildFederationActivationAssessment({
            activation_stage: 'active_node',
            deployment_environment: 'production',
            data_policy_status: 'approved',
            attestation_status: 'verified',
            secure_aggregation_status: 'ready',
            heartbeat_status: 'healthy',
            last_heartbeat_at: '2026-06-19T11:30:00.000Z',
            now: new Date('2026-06-19T12:00:00.000Z'),
        });

        expect(assessment.activation_status).toBe('active');
        expect(assessment.readiness_score).toBe(1);
        expect(assessment.blockers).toEqual([]);
        expect(assessment.next_required_step).toBeNull();
    });

    it('blocks rejected or failed activation evidence even when other signals are present', () => {
        const assessment = buildFederationActivationAssessment({
            activation_stage: 'secure_aggregation_ready',
            deployment_environment: 'staging',
            data_policy_status: 'rejected',
            attestation_status: 'verified',
            secure_aggregation_status: 'ready',
            heartbeat_status: 'healthy',
            last_heartbeat_at: '2026-06-19T11:30:00.000Z',
            now: new Date('2026-06-19T12:00:00.000Z'),
        });

        expect(assessment.activation_status).toBe('blocked');
        expect(assessment.readiness_score).toBeLessThanOrEqual(0.35);
        expect(assessment.blockers).toContain('data_policy_rejected');
    });

    it('summarizes the latest event per federation partner', () => {
        const rows: FederationActivationEventRow[] = [
            row({
                partner_ref: 'clinic_a',
                activation_status: 'pending',
                readiness_score: 0.3,
                observed_at: '2026-06-19T10:00:00.000Z',
            }),
            row({
                partner_ref: 'clinic_a',
                activation_status: 'active',
                readiness_score: 1,
                data_policy_status: 'approved',
                attestation_status: 'verified',
                secure_aggregation_status: 'ready',
                heartbeat_status: 'healthy',
                deployment_environment: 'production',
                observed_at: '2026-06-19T12:00:00.000Z',
            }),
            row({
                partner_ref: 'clinic_b',
                activation_status: 'blocked',
                readiness_score: 0.28,
                blockers: ['data_policy_rejected'],
                observed_at: '2026-06-19T11:00:00.000Z',
            }),
        ];

        const latest = latestFederationActivationRows(rows);
        const summary = summarizeFederationActivation(rows);

        expect(latest).toHaveLength(2);
        expect(summary.total_nodes).toBe(2);
        expect(summary.active_nodes).toBe(1);
        expect(summary.blocked_nodes).toBe(1);
        expect(summary.average_readiness_score).toBe(0.64);
        expect(summary.top_blockers).toEqual([{ blocker: 'data_policy_rejected', count: 1 }]);
    });
});

function row(overrides: Partial<FederationActivationEventRow> = {}): FederationActivationEventRow {
    return {
        federation_key: 'one_health_amr',
        partner_ref: 'clinic_ref',
        node_kind: 'clinic',
        deployment_environment: 'sandbox',
        activation_stage: 'invited',
        activation_status: 'pending',
        data_policy_status: 'not_reviewed',
        attestation_status: 'not_attested',
        secure_aggregation_status: 'not_ready',
        heartbeat_status: 'not_seen',
        readiness_score: 0,
        blockers: [],
        observed_at: '2026-06-19T09:00:00.000Z',
        created_at: '2026-06-19T09:00:00.000Z',
        ...overrides,
    };
}
