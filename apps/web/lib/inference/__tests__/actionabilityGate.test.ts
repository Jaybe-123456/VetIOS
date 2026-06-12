import { describe, expect, it } from 'vitest';
import {
    buildInferenceActionabilityGate,
    recordInferenceActionabilityGateEvent,
} from '../actionabilityGate';

const emptyClient = {
    from: () => ({
        select: () => ({
            eq: () => ({
                eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                }),
            }),
        }),
    }),
};

describe('inference actionability gate moat', () => {
    it('holds inference when contradiction and abstention are present', async () => {
        const gate = await buildInferenceActionabilityGate(emptyClient as never, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            confidenceScore: 0.83,
            phiHat: 0.7,
            outputPayload: {
                contradiction_score: 0.82,
                abstain_recommendation: true,
                differentials: [
                    { label: 'Parvovirus', p: 0.83 },
                    { label: 'HGE', p: 0.09 },
                ],
                recommended_tests: ['Parvovirus ELISA'],
            },
        });

        expect(gate.decision).toBe('suppressed');
        expect(gate.blockers.join(' ')).toContain('contradiction');
        expect(gate.required_confirmatory_tests).toContain('Parvovirus ELISA');
        expect(gate.policy_snapshot.privacy_boundary).toContain('no raw clinical narrative');
    });

    it('allows high quality calibrated output as decision support with confirmation', async () => {
        const gate = await buildInferenceActionabilityGate(emptyClient as never, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            outputPayload: {
                differentials: [
                    { label: 'Parvovirus', p: 0.88 },
                    { label: 'HGE', p: 0.05 },
                ],
            },
            calibrationSnapshot: {
                id: '33333333-3333-4333-8333-333333333333',
                inference_event_id: '22222222-2222-4222-8222-222222222222',
                top_label: 'Parvovirus',
                top_confidence: 0.88,
                phi_hat: 0.86,
                contradiction_score: 0.04,
                differential_count: 2,
                differential_entropy: 0.22,
                margin_top2: 0.83,
                calibration_bucket: '0.8-0.9',
                calibration_status: 'calibrated',
                historical_sample_count: 18,
                historical_mean_delta: 0.01,
                expected_calibration_error: 0.01,
                calibration_reliability_score: 0.91,
                reliability_badge: 'HIGH',
                recommended_action: 'Calibration evidence is within operating tolerance.',
                snapshot: {},
            },
        });

        expect(gate.decision).toBe('actionable_with_confirmation');
        expect(gate.actionability_score).toBeGreaterThan(0.72);
        expect(gate.calibration_snapshot_id).toBe('33333333-3333-4333-8333-333333333333');
    });

    it('persists compact gate rows without raw output payload', async () => {
        const inserted: Array<Record<string, unknown>> = [];
        const client = {
            from: (table: string) => {
                if (table === 'inference_actionability_gate_events') {
                    return {
                        insert: (payload: Record<string, unknown>) => {
                            inserted.push(payload);
                            return {
                                select: () => ({
                                    single: async () => ({
                                        data: {
                                            id: '44444444-4444-4444-8444-444444444444',
                                            inference_event_id: payload.inference_event_id,
                                            calibration_snapshot_id: payload.calibration_snapshot_id,
                                            decision: payload.decision,
                                            actionability_score: payload.actionability_score,
                                            recommended_next_step: payload.recommended_next_step,
                                            top_label: payload.top_label,
                                            top_confidence: payload.top_confidence,
                                            phi_hat: payload.phi_hat,
                                            reliability_badge: payload.reliability_badge,
                                            calibration_status: payload.calibration_status,
                                            historical_sample_count: payload.historical_sample_count,
                                            contradiction_score: payload.contradiction_score,
                                            margin_top2: payload.margin_top2,
                                            differential_entropy: payload.differential_entropy,
                                            abstain_recommendation: payload.abstain_recommendation,
                                            urgent_confirmatory_testing: payload.urgent_confirmatory_testing,
                                            required_confirmatory_tests: payload.required_confirmatory_tests,
                                            blockers: payload.blockers,
                                            warnings: payload.warnings,
                                            policy_snapshot: payload.policy_snapshot,
                                            created_at: '2026-06-12T00:00:00.000Z',
                                        },
                                        error: null,
                                    }),
                                }),
                            };
                        },
                    };
                }
                return emptyClient.from();
            },
        };

        const result = await recordInferenceActionabilityGateEvent(client as never, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            requestId: 'request-1',
            outputPayload: {
                differentials: [{ label: 'HGE', p: 0.55 }],
                urgent_confirmatory_testing: true,
            },
        });

        expect(result.error).toBeNull();
        expect(inserted[0]).toMatchObject({
            tenant_id: '11111111-1111-4111-8111-111111111111',
            inference_event_id: '22222222-2222-4222-8222-222222222222',
        });
        expect(inserted[0]?.policy_snapshot).not.toHaveProperty('output_payload');
    });
});
