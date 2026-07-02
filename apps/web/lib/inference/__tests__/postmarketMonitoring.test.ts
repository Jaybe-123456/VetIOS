import { describe, expect, it } from 'vitest';
import {
    buildInferencePostmarketMonitoringEvent,
    recordInferencePostmarketMonitoringEvent,
    type InferenceMonitoringSignal,
} from '../postmarketMonitoring';

const tenantId = '11111111-1111-4111-8111-111111111111';

function signal(overrides: Partial<InferenceMonitoringSignal> = {}): InferenceMonitoringSignal {
    const index = overrides.inferenceEventId ?? 'inference-1';
    return {
        tenantId,
        inferenceEventId: index,
        requestId: `request-${index}`,
        modelVersion: 'vetios-clinical-v1',
        species: 'canine',
        topLabel: 'Ehrlichiosis',
        topConfidence: 0.86,
        finalState: 'trusted',
        riskClass: 'routine',
        calibrationStatus: 'calibrated',
        actionabilityDecision: 'actionable_with_confirmation',
        trainingEligible: true,
        latencyMs: 2400,
        outcomeConfirmed: true,
        predictionCorrect: true,
        blockers: [],
        warnings: [],
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('inference post-market monitoring', () => {
    it('marks a stable monitored window as healthy', () => {
        const signals = Array.from({ length: 24 }, (_, index) => signal({
            inferenceEventId: `inference-${index}`,
            requestId: `request-${index}`,
            createdAt: `2026-07-01T00:${String(index).padStart(2, '0')}:00.000Z`,
            topLabel: index % 4 === 0 ? 'Anaplasmosis' : 'Ehrlichiosis',
            topConfidence: 0.78 + ((index % 4) * 0.02),
            latencyMs: 2000 + (index * 40),
        }));

        const event = buildInferencePostmarketMonitoringEvent({
            tenantId,
            signals,
            minimumSignals: 20,
        });

        expect(event.monitoring_status).toBe('healthy');
        expect(event.rollback_recommended).toBe(false);
        expect(event.inference_count).toBe(24);
        expect(event.outcome_confirmation_rate).toBe(1);
        expect(event.synthetic_rows_excluded).toBe(0);
        expect(event.packet_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(event.monitoring_packet).not.toHaveProperty('raw_output_payload');
    });

    it('recommends rollback when suppression, security, drift, and latency degrade together', () => {
        const stable = Array.from({ length: 12 }, (_, index) => signal({
            inferenceEventId: `stable-${index}`,
            requestId: `stable-request-${index}`,
            createdAt: `2026-07-01T00:${String(index).padStart(2, '0')}:00.000Z`,
            topLabel: 'Ehrlichiosis',
        }));
        const degraded = Array.from({ length: 12 }, (_, index) => signal({
            inferenceEventId: `degraded-${index}`,
            requestId: `degraded-request-${index}`,
            createdAt: `2026-07-01T01:${String(index).padStart(2, '0')}:00.000Z`,
            topLabel: 'GDV',
            topConfidence: 0.95,
            finalState: index < 4 ? 'suppress' : 'hold',
            riskClass: 'critical',
            calibrationStatus: 'needs_outcome',
            trainingEligible: false,
            latencyMs: 18000 + (index * 100),
            outcomeConfirmed: index < 2,
            blockers: index < 4 ? ['security_boundary_failed'] : ['actionability_gate_hold'],
        }));

        const event = buildInferencePostmarketMonitoringEvent({
            tenantId,
            signals: [...stable, ...degraded, signal({ synthetic: true, inferenceEventId: 'synthetic-1' })],
            minimumSignals: 20,
            latencyP95ThresholdMs: 12000,
        });

        expect(event.monitoring_status).toBe('rollback_recommended');
        expect(event.rollback_recommended).toBe(true);
        expect(event.blockers).toEqual(expect.arrayContaining([
            'suppression_rate_above_threshold',
            'critical_case_hold_rate_above_threshold',
            'security_boundary_failures_present',
            'label_distribution_shift_above_threshold',
            'latency_p95_above_threshold',
        ]));
        expect(event.synthetic_rows_excluded).toBe(1);
        expect(event.high_confidence_uncalibrated_count).toBe(12);
        expect(event.label_distribution_shift).toBeGreaterThanOrEqual(0.25);
    });

    it('persists compact post-market monitoring packets', async () => {
        const inserted: Array<Record<string, unknown>> = [];
        const client = {
            from: (table: string) => {
                if (table !== 'inference_postmarket_monitoring_events') {
                    throw new Error(`Unexpected table ${table}`);
                }
                return {
                    insert: (payload: Record<string, unknown>) => {
                        inserted.push(payload);
                        return {
                            select: () => ({
                                single: async () => ({
                                    data: payload,
                                    error: null,
                                }),
                            }),
                        };
                    },
                };
            },
        };

        const result = await recordInferencePostmarketMonitoringEvent(client as never, {
            tenantId,
            requestId: 'monitoring-run-1',
            signals: Array.from({ length: 20 }, (_, index) => signal({ inferenceEventId: `inference-${index}` })),
            minimumSignals: 20,
        });

        expect(result.error).toBeNull();
        expect(inserted[0]).toMatchObject({
            tenant_id: tenantId,
            request_id: 'monitoring-run-1',
            inference_count: 20,
            monitoring_status: 'healthy',
        });
        expect(inserted[0]?.monitoring_packet).not.toHaveProperty('signals');
        expect(result.data?.monitoring_packet).not.toHaveProperty('raw_clinical_notes');
    });
});
