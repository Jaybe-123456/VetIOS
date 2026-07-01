import { describe, expect, it } from 'vitest';
import {
    buildInferenceReliabilityPacket,
    recordInferenceReliabilityPacket,
} from '../reliabilityOrchestrator';

const calibratedSnapshot = {
    id: '33333333-3333-4333-8333-333333333333',
    inference_event_id: '22222222-2222-4222-8222-222222222222',
    top_label: 'Ehrlichiosis',
    top_confidence: 0.91,
    phi_hat: 0.89,
    contradiction_score: 0.03,
    differential_count: 2,
    differential_entropy: 0.18,
    margin_top2: 0.82,
    calibration_bucket: '0.9-1.0',
    calibration_status: 'calibrated' as const,
    historical_sample_count: 42,
    historical_mean_delta: 0.01,
    expected_calibration_error: 0.01,
    calibration_reliability_score: 0.93,
    reliability_badge: 'HIGH' as const,
    recommended_action: 'Calibration evidence is within operating tolerance.',
    snapshot: {},
};

const highGate = {
    id: '44444444-4444-4444-8444-444444444444',
    inference_event_id: '22222222-2222-4222-8222-222222222222',
    calibration_snapshot_id: '33333333-3333-4333-8333-333333333333',
    decision: 'actionable_with_confirmation' as const,
    actionability_score: 0.91,
    recommended_next_step: 'Action may proceed as clinical decision support with routine outcome confirmation.',
    top_label: 'Ehrlichiosis',
    top_confidence: 0.91,
    phi_hat: 0.89,
    reliability_badge: 'HIGH' as const,
    calibration_status: 'calibrated' as const,
    historical_sample_count: 42,
    contradiction_score: 0.03,
    margin_top2: 0.82,
    differential_entropy: 0.18,
    abstain_recommendation: false,
    urgent_confirmatory_testing: false,
    required_confirmatory_tests: [],
    blockers: [],
    warnings: [],
    policy_snapshot: {},
};

describe('inference reliability orchestrator', () => {
    it('marks calibrated, citation-clean inference as trusted and training eligible', () => {
        const packet = buildInferenceReliabilityPacket({
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            outputPayload: {
                diagnosis: {
                    top_differentials: [
                        { label: 'Ehrlichiosis', probability: 0.91 },
                        { label: 'Anaplasmosis', probability: 0.09 },
                    ],
                },
                risk_assessment: { emergency_level: 'high' },
                rag_grounding: {
                    citation_required: true,
                    citation_quality_score: 0.93,
                    source_authority_score: 0.92,
                    citation_faithfulness_score: 0.9,
                    source_versions_present: true,
                },
                evidence_normalization: {
                    normalized_findings: [{ canonical_path: 'pcr.ehrlichia_pcr' }],
                },
            },
            calibrationSnapshot: calibratedSnapshot,
            actionabilityGate: highGate,
        });

        expect(packet.final_state).toBe('trusted');
        expect(packet.training_eligible).toBe(true);
        expect(packet.packet.policy_basis).toMatchObject({
            version: 'vetios_reliability_orchestrator_v1',
        });
        expect(packet.packet_digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it('holds high-confidence output that lacks outcome calibration', () => {
        const packet = buildInferenceReliabilityPacket({
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            confidenceScore: 0.96,
            phiHat: 0.9,
            outputPayload: {
                differentials: [
                    { label: 'Parvovirus', p: 0.96 },
                    { label: 'HGE', p: 0.03 },
                ],
                risk_assessment: { emergency_level: 'critical' },
            },
            calibrationSnapshot: {
                ...calibratedSnapshot,
                top_label: 'Parvovirus',
                top_confidence: 0.96,
                calibration_status: 'needs_outcome',
                historical_sample_count: 0,
            },
            actionabilityGate: {
                ...highGate,
                top_label: 'Parvovirus',
                top_confidence: 0.96,
                calibration_status: 'needs_outcome',
                historical_sample_count: 0,
                decision: 'actionable_with_confirmation',
            },
        });

        expect(packet.final_state).toBe('hold');
        expect(packet.blockers).toContain('high_confidence_without_outcome_calibration');
        expect(packet.training_eligible).toBe(false);
    });

    it('suppresses security and false reassurance risks', () => {
        const packet = buildInferenceReliabilityPacket({
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            confidenceScore: 0.86,
            phiHat: 0.88,
            outputPayload: {
                differentials: [{ label: 'GDV', p: 0.86 }],
                security: {
                    prompt_injection_flag: true,
                },
            },
            actionabilityGate: {
                ...highGate,
                decision: 'suppressed',
                blockers: ['unsafe output'],
            },
        });

        expect(packet.final_state).toBe('suppress');
        expect(packet.blockers).toContain('security_boundary_failed');
        expect(packet.blockers).toContain('actionability_gate_suppressed');
    });

    it('persists packet and compact gate decision without raw output payload fields', async () => {
        const insertedPackets: Array<Record<string, unknown>> = [];
        const insertedDecisions: Array<Record<string, unknown>> = [];
        const client = {
            from: (table: string) => {
                if (table === 'inference_reliability_packets') {
                    return {
                        insert: (payload: Record<string, unknown>) => {
                            insertedPackets.push(payload);
                            return {
                                select: () => ({
                                    single: async () => ({
                                        data: {
                                            id: '55555555-5555-4555-8555-555555555555',
                                            ...payload,
                                            created_at: '2026-07-01T00:00:00.000Z',
                                        },
                                        error: null,
                                    }),
                                }),
                            };
                        },
                    };
                }
                if (table === 'gate_decision_events') {
                    return {
                        insert: async (payload: Record<string, unknown>) => {
                            insertedDecisions.push(payload);
                            return { error: null };
                        },
                    };
                }
                throw new Error(`Unexpected table ${table}`);
            },
        };

        const result = await recordInferenceReliabilityPacket(client as never, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            outputPayload: {
                differentials: [{ label: 'Ehrlichiosis', p: 0.91 }],
                raw_consultation: 'Owner name and raw narrative should never be copied.',
            },
            calibrationSnapshot: calibratedSnapshot,
            actionabilityGate: highGate,
        });

        expect(result.error).toBeNull();
        expect(insertedPackets).toHaveLength(1);
        expect(insertedDecisions).toHaveLength(1);
        expect(insertedPackets[0]).not.toHaveProperty('output_payload');
        expect(insertedPackets[0]?.packet).not.toHaveProperty('raw_consultation');
        expect(insertedDecisions[0]).toMatchObject({
            gate_kind: 'inference_reliability',
            final_state: 'trusted',
            decision: 'trusted',
        });
    });
});
