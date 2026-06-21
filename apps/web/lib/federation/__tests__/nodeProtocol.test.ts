import { describe, expect, it } from 'vitest';
import {
    buildFederationNodeProtocolAssessment,
    latestNodeRows,
    summarizeFederationNodeProtocolEvents,
    type FederationNodeRuntimeEventRow,
} from '@/lib/federation/nodeProtocol';

const NOW = new Date('2026-06-21T12:00:00.000Z');

describe('federation live node protocol', () => {
    it('blocks online nodes until secure aggregation and outcome eligibility are both ready', () => {
        const assessment = buildFederationNodeProtocolAssessment({
            node_status: 'online',
            runtime_event: 'heartbeat',
            last_heartbeat_at: '2026-06-21T11:45:00.000Z',
            secure_aggregation_status: 'keys_registered',
            outcome_eligibility_status: 'insufficient_evidence',
            now: NOW,
        });

        expect(assessment.readiness).toBe('blocked');
        expect(assessment.blockers).toContain('secure_aggregation_not_ready');
        expect(assessment.blockers).toContain('outcome_eligibility_not_ready');
        expect(assessment.next_required_action).toBe('register_secure_aggregation_keys');
    });

    it('waits for a task once the node, heartbeat, secure aggregation, and outcome evidence are ready', () => {
        const assessment = buildFederationNodeProtocolAssessment({
            node_status: 'online',
            runtime_event: 'heartbeat',
            last_heartbeat_at: '2026-06-21T11:45:00.000Z',
            secure_aggregation_status: 'ready',
            outcome_eligibility_status: 'eligible',
            now: NOW,
        });

        expect(assessment.readiness).toBe('waiting_for_task');
        expect(assessment.blockers).toEqual([]);
        expect(assessment.next_required_action).toBe('issue_round_node_task');
    });

    it('marks issued or pulled round tasks as update-pending', () => {
        const assessment = buildFederationNodeProtocolAssessment({
            node_status: 'online',
            runtime_event: 'round_plan_pulled',
            task_status: 'pulled',
            last_heartbeat_at: '2026-06-21T11:45:00.000Z',
            secure_aggregation_status: 'ready',
            outcome_eligibility_status: 'eligible',
            now: NOW,
        });

        expect(assessment.readiness).toBe('update_pending');
        expect(assessment.signals.task_available).toBe(true);
        expect(assessment.next_required_action).toBe('submit_masked_update');
    });

    it('recognizes masked update submission without exposing raw deltas', () => {
        const assessment = buildFederationNodeProtocolAssessment({
            node_status: 'online',
            runtime_event: 'masked_update_submitted',
            task_status: 'submitted',
            submission_status: 'submitted',
            last_heartbeat_at: '2026-06-21T11:45:00.000Z',
            secure_aggregation_status: 'ready',
            outcome_eligibility_status: 'eligible',
            now: NOW,
        });

        expect(assessment.readiness).toBe('update_submitted');
        expect(assessment.signals.update_submitted).toBe(true);
        expect(assessment.next_required_action).toBe('await_coordinator_acceptance');
    });

    it('treats stale heartbeat nodes as offline', () => {
        const assessment = buildFederationNodeProtocolAssessment({
            node_status: 'online',
            runtime_event: 'heartbeat',
            last_heartbeat_at: '2026-06-19T11:45:00.000Z',
            secure_aggregation_status: 'ready',
            outcome_eligibility_status: 'eligible',
            now: NOW,
        });

        expect(assessment.readiness).toBe('offline');
        expect(assessment.blockers).toContain('heartbeat_stale_or_missing');
        expect(assessment.next_required_action).toBe('restore_node_heartbeat');
    });

    it('summarizes latest event per node', () => {
        const rows: FederationNodeRuntimeEventRow[] = [
            nodeRow({
                node_ref: 'clinic_a',
                node_status: 'offline',
                observed_at: '2026-06-21T09:00:00.000Z',
            }),
            nodeRow({
                node_ref: 'clinic_a',
                runtime_event: 'round_plan_pulled',
                node_status: 'online',
                secure_aggregation_status: 'ready',
                outcome_eligibility_status: 'eligible',
                last_heartbeat_at: '2026-06-21T11:45:00.000Z',
                observed_at: '2026-06-21T11:50:00.000Z',
            }),
            nodeRow({
                node_ref: 'clinic_b',
                node_status: 'online',
                secure_aggregation_status: 'not_ready',
                outcome_eligibility_status: 'eligible',
                last_heartbeat_at: '2026-06-21T11:45:00.000Z',
                observed_at: '2026-06-21T11:55:00.000Z',
            }),
        ];

        const latest = latestNodeRows(rows);
        const summary = summarizeFederationNodeProtocolEvents(rows);

        expect(latest).toHaveLength(2);
        expect(summary.total_nodes).toBe(2);
        expect(summary.waiting_nodes).toBe(1);
        expect(summary.blocked_nodes).toBe(1);
        expect(summary.latest_signal_at).toBe('2026-06-21T11:55:00.000Z');
        expect(summary.top_blockers).toEqual([{ blocker: 'secure_aggregation_not_ready', count: 1 }]);
    });
});

function nodeRow(overrides: Partial<FederationNodeRuntimeEventRow> = {}): FederationNodeRuntimeEventRow {
    return {
        federation_key: 'one_health_amr',
        node_ref: 'clinic_node',
        runtime_event: 'heartbeat',
        node_status: 'online',
        secure_aggregation_status: 'ready',
        outcome_eligibility_status: 'eligible',
        last_heartbeat_at: '2026-06-21T11:30:00.000Z',
        observed_at: '2026-06-21T10:00:00.000Z',
        created_at: '2026-06-21T10:00:00.000Z',
        ...overrides,
    };
}
