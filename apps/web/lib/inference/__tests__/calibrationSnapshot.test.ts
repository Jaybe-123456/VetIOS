import { describe, expect, it } from 'vitest';
import {
    buildInferenceCalibrationSnapshot,
    extractDifferentialDistribution,
    recordInferenceCalibrationSnapshot,
} from '../calibrationSnapshot';

describe('inference calibration snapshot moat', () => {
    it('extracts ranked distributions from clinical output payloads', () => {
        const distribution = extractDifferentialDistribution({
            diagnosis: {
                top_differentials: [
                    { name: 'Canine Parvovirus', probability: 0.82 },
                    { name: 'HGE', probability: 0.11 },
                ],
            },
        });

        expect(distribution).toEqual([
            { label: 'Canine Parvovirus', probability: 0.82 },
            { label: 'HGE', probability: 0.11 },
        ]);
    });

    it('classifies labels without enough outcomes as needing calibration evidence', async () => {
        const client = {
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

        const snapshot = await buildInferenceCalibrationSnapshot(client as never, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            confidenceScore: 0.82,
            phiHat: 0.76,
            outputPayload: {
                contradiction_score: 0.1,
                differentials: [
                    { label: 'Parvovirus', p: 0.82 },
                    { label: 'HGE', p: 0.11 },
                ],
            },
        });

        expect(snapshot.calibration_status).toBe('needs_outcome');
        expect(snapshot.historical_sample_count).toBe(0);
        expect(snapshot.recommended_action).toContain('confirmed outcomes');
        expect(snapshot.snapshot.privacy_boundary).toContain('no raw symptoms');
    });

    it('stores compact append-only rows with historical calibration context', async () => {
        const inserted: Array<Record<string, unknown>> = [];
        const client = {
            from: (table: string) => {
                if (table === 'label_calibration') {
                    return {
                        select: () => ({
                            eq: () => ({
                                eq: () => ({
                                    maybeSingle: async () => ({
                                        data: { sample_count: 12, mean_delta: -0.12 },
                                        error: null,
                                    }),
                                }),
                            }),
                        }),
                    };
                }
                if (table === 'inference_calibration_snapshots') {
                    return {
                        insert: (payload: Record<string, unknown>) => {
                            inserted.push(payload);
                            return {
                                select: () => ({
                                    single: async () => ({
                                        data: {
                                            id: '33333333-3333-4333-8333-333333333333',
                                            inference_event_id: payload.inference_event_id,
                                            top_label: payload.top_label,
                                            top_confidence: payload.top_confidence,
                                            phi_hat: payload.phi_hat,
                                            contradiction_score: payload.contradiction_score,
                                            differential_count: payload.differential_count,
                                            differential_entropy: payload.differential_entropy,
                                            margin_top2: payload.margin_top2,
                                            calibration_bucket: payload.calibration_bucket,
                                            calibration_status: payload.calibration_status,
                                            historical_sample_count: payload.historical_sample_count,
                                            historical_mean_delta: payload.historical_mean_delta,
                                            expected_calibration_error: payload.expected_calibration_error,
                                            calibration_reliability_score: payload.calibration_reliability_score,
                                            reliability_badge: payload.reliability_badge,
                                            recommended_action: payload.recommended_action,
                                            snapshot: payload.snapshot,
                                            created_at: '2026-06-12T00:00:00.000Z',
                                        },
                                        error: null,
                                    }),
                                }),
                            };
                        },
                    };
                }
                throw new Error(`Unexpected table ${table}`);
            },
        };

        const result = await recordInferenceCalibrationSnapshot(client as never, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            requestId: 'request-1',
            outputPayload: {
                differentials: [
                    { label: 'Parvovirus', p: 0.9 },
                    { label: 'HGE', p: 0.05 },
                ],
                cire: { phi_hat: 0.88 },
            },
            confidenceScore: 0.9,
        });

        expect(result.error).toBeNull();
        expect(result.data?.calibration_status).toBe('overconfident');
        expect(result.data?.expected_calibration_error).toBe(0.12);
        expect(inserted[0]).toMatchObject({
            tenant_id: '11111111-1111-4111-8111-111111111111',
            inference_event_id: '22222222-2222-4222-8222-222222222222',
            top_label: 'Parvovirus',
            historical_sample_count: 12,
        });
        expect(inserted[0]?.snapshot).not.toHaveProperty('output_payload');
    });

    it('prefers real outcome calibration buckets over the legacy label counter', async () => {
        const client = {
            from: (table: string) => {
                if (table === 'outcome_calibration_buckets') {
                    return {
                        select: () => ({
                            eq: () => ({
                                eq: () => ({
                                    order: () => ({
                                        limit: () => ({
                                            maybeSingle: async () => ({
                                                data: {
                                                    outcome_label_count: 18,
                                                    mean_delta: 0.01,
                                                    expected_calibration_error: 0.03,
                                                    calibration_status: 'calibrated',
                                                    model_version: 'vetios-clinical-v1',
                                                },
                                                error: null,
                                            }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    };
                }
                if (table === 'label_calibration') {
                    return {
                        select: () => ({
                            eq: () => ({
                                eq: () => ({
                                    maybeSingle: async () => ({
                                        data: { sample_count: 2, mean_delta: -0.3 },
                                        error: null,
                                    }),
                                }),
                            }),
                        }),
                    };
                }
                throw new Error(`Unexpected table ${table}`);
            },
        };

        const snapshot = await buildInferenceCalibrationSnapshot(client as never, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            modelVersion: 'vetios-clinical-v1',
            confidenceScore: 0.91,
            phiHat: 0.9,
            outputPayload: {
                differentials: [
                    { label: 'Ehrlichiosis', p: 0.91 },
                    { label: 'Anaplasmosis', p: 0.06 },
                ],
            },
        });

        expect(snapshot.calibration_status).toBe('calibrated');
        expect(snapshot.historical_sample_count).toBe(18);
        expect(snapshot.expected_calibration_error).toBe(0.03);
        expect(snapshot.snapshot.historical_calibration_source).toBe('outcome_calibration_buckets');
    });
});
