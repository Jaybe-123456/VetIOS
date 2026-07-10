import { describe, expect, it } from 'vitest';
import { buildDecisionRailsPacket } from '../decisionRails';

type TableRows = Record<string, Array<Record<string, unknown>>>;

function makeClient(rowsByTable: TableRows, failingTables: string[] = []) {
    return {
        from(table: string) {
            return {
                select() {
                    return {
                        eq() {
                            return {
                                order() {
                                    return {
                                        async limit(limit: number) {
                                            if (failingTables.includes(table)) {
                                                return {
                                                    data: null,
                                                    error: { message: `Could not find the table public.${table} in the schema cache` },
                                                };
                                            }
                                            return {
                                                data: (rowsByTable[table] ?? []).slice(0, limit),
                                                error: null,
                                            };
                                        },
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    };
}

describe('Decision Rails packet', () => {
    it('connects inference, CIRE, gate, review, outcome, ontology, federation, and operating evidence', async () => {
        const tenantId = '5254467f-ad37-4edc-8664-3c6ddc9c88b3';
        const inferenceId = '11111111-1111-4111-8111-111111111111';
        const requestId = '22222222-2222-4222-8222-222222222222';
        const client = makeClient({
            ai_inference_events: [
                {
                    id: inferenceId,
                    tenant_id: tenantId,
                    request_id: requestId,
                    case_id: 'case-1',
                    model_version: 'v1',
                    confidence_score: 0.96,
                    phi_hat: 0.97,
                    inference_latency_ms: 1200,
                    output_payload: {
                        clinical_context: { species: 'canine' },
                        diagnosis: { label: 'Ehrlichiosis' },
                    },
                    created_at: '2026-07-10T00:00:00.000Z',
                },
            ],
            inference_reliability_packets: [
                {
                    id: 'packet-1',
                    tenant_id: tenantId,
                    inference_event_id: inferenceId,
                    request_id: requestId,
                    final_state: 'review',
                    top_label: 'Ehrlichiosis',
                    top_confidence: 0.96,
                    risk_class: 'high',
                    calibration_status: 'needs_outcome',
                    blockers: [],
                    warnings: ['needs_outcome_calibration'],
                    packet_digest: 'a'.repeat(64),
                    created_at: '2026-07-10T00:01:00.000Z',
                },
            ],
            gate_decision_events: [
                {
                    id: 'gate-1',
                    tenant_id: tenantId,
                    inference_event_id: inferenceId,
                    request_id: requestId,
                    gate_kind: 'inference_reliability',
                    final_state: 'review',
                    decision: 'review',
                    blockers: [],
                    warnings: ['needs_outcome_calibration'],
                    created_at: '2026-07-10T00:02:00.000Z',
                },
            ],
            inference_review_queue_events: [
                {
                    id: 'review-1',
                    tenant_id: tenantId,
                    inference_event_id: inferenceId,
                    request_id: requestId,
                    review_status: 'queued',
                    severity: 'high',
                    review_reason: 'Confirm before action',
                    created_at: '2026-07-10T00:03:00.000Z',
                },
            ],
            clinical_outcome_events: [],
            global_biomedical_ontology_completion_snapshot_events: [
                {
                    tenant_id: tenantId,
                    completion_status: 'partial',
                    imported_provider_count: 3,
                    missing_provider_count: 4,
                    latest_coverage_score: 0.42,
                    missing_provider_keys: ['snomed_ct_release'],
                    blockers: ['source_release_required:snomed_ct_release'],
                    warnings: [],
                    created_at: '2026-07-10T00:04:00.000Z',
                },
            ],
            global_biomedical_ontology_population_snapshot_events: [
                {
                    tenant_id: tenantId,
                    population_status: 'public_sources_populated',
                    imported_provider_count: 3,
                    blocked_provider_count: 4,
                    created_at: '2026-07-10T00:04:30.000Z',
                },
            ],
            official_ontology_release_events: [
                {
                    tenant_id: tenantId,
                    provider_key: 'woah_disease_reference',
                    release_status: 'imported',
                    created_at: '2026-07-10T00:05:00.000Z',
                },
            ],
            federation_node_runtime_events: [
                {
                    tenant_id: tenantId,
                    node_status: 'online',
                    secure_aggregation_status: 'ready',
                    runtime_event: 'heartbeat',
                    blockers: [],
                    created_at: '2026-07-10T00:06:00.000Z',
                },
            ],
            federated_update_submissions: [
                {
                    tenant_id: tenantId,
                    submission_status: 'accepted',
                    created_at: '2026-07-10T00:07:00.000Z',
                },
            ],
            workflow_integration_run_events: [
                {
                    tenant_id: tenantId,
                    run_status: 'completed',
                    created_at: '2026-07-10T00:08:00.000Z',
                },
            ],
            specialist_review_events: [],
            specialist_review_operation_events: [],
            amr_lab_feed_surveillance_events: [
                {
                    tenant_id: tenantId,
                    surveillance_status: 'export_ready',
                    created_at: '2026-07-10T00:09:00.000Z',
                },
            ],
            ai_security_test_events: [
                {
                    tenant_id: tenantId,
                    test_status: 'passed',
                    test_case_type: 'prompt_injection',
                    incident_required: false,
                    created_at: '2026-07-10T00:10:00.000Z',
                },
            ],
            regulatory_claim_review_events: [
                {
                    tenant_id: tenantId,
                    claim_review_status: 'approved',
                    created_at: '2026-07-10T00:11:00.000Z',
                },
            ],
        });

        const packet = await buildDecisionRailsPacket({
            client,
            tenantId,
            inferenceEventId: inferenceId,
        });

        expect(packet.decision_id).toBe(`decision:inference:${inferenceId}`);
        expect(packet.anchor).toMatchObject({
            inference_event_id: inferenceId,
            request_id: requestId,
            top_label: 'Ehrlichiosis',
            confidence: 0.96,
            phi_hat: 0.97,
        });
        expect(packet.modules.cire.status).toBe('needs_review');
        expect(packet.modules.review_queue.status).toBe('needs_review');
        expect(packet.modules.outcome_learning.status).toBe('awaiting_outcome');
        expect(packet.modules.ontology.status).toBe('degraded');
        expect(packet.modules.federation.status).toBe('operational');
        expect(packet.posture.status).toBe('blocked');
        expect(packet.posture.next_required_action).toBe('resolve_blockers_before_action');
        expect(packet.posture.compute_strategy.route_mode).toBe('human_review_first');
        expect(packet.blockers).toContain('source_release_required:snomed_ct_release');
        expect(packet.timeline[0]?.module).toBe('regulatory');
    });

    it('degrades gracefully when optional ledgers are missing', async () => {
        const tenantId = '5254467f-ad37-4edc-8664-3c6ddc9c88b3';
        const client = makeClient({
            ai_inference_events: [
                {
                    id: '11111111-1111-4111-8111-111111111111',
                    tenant_id: tenantId,
                    request_id: '22222222-2222-4222-8222-222222222222',
                    confidence_score: 0.72,
                    output_payload: { diagnosis: { label: 'Canine parvovirosis' } },
                    created_at: '2026-07-10T00:00:00.000Z',
                },
            ],
        }, [
            'inference_reliability_packets',
            'gate_decision_events',
            'inference_review_queue_events',
            'ai_security_test_events',
        ]);

        const packet = await buildDecisionRailsPacket({
            client,
            tenantId,
        });

        expect(packet.anchor.top_label).toBe('Canine parvovirosis');
        expect(packet.modules.cire.status).toBe('degraded');
        expect(packet.modules.action_gate.status).toBe('missing');
        expect(packet.modules.review_queue.status).toBe('ready');
        expect(packet.modules.ai_security.status).toBe('missing');
        expect(packet.query_errors).toEqual(expect.arrayContaining([
            expect.stringContaining('inference_reliability_packets'),
            expect.stringContaining('gate_decision_events'),
            expect.stringContaining('ai_security_test_events'),
        ]));
        expect(packet.posture.status).toBe('blocked');
    });
});
