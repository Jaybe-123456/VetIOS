import { describe, expect, it } from 'vitest';
import {
    recordInferenceReviewQueueEvent,
    reviewReasonFromActionabilityGate,
    reviewSeverityFromActionabilityGate,
    shouldQueueActionabilityGate,
} from '../reviewQueue';
import type { InferenceActionabilityGateResult } from '../actionabilityGate';

const suppressedGate: InferenceActionabilityGateResult = {
    id: '33333333-3333-4333-8333-333333333333',
    inference_event_id: '22222222-2222-4222-8222-222222222222',
    calibration_snapshot_id: null,
    decision: 'suppressed',
    actionability_score: 0.22,
    recommended_next_step: 'Do not act on this output automatically; escalate to clinician review.',
    top_label: 'Parvoviral Enteritis',
    top_confidence: 0.21,
    phi_hat: 0.18,
    reliability_badge: 'SUPPRESSED',
    calibration_status: 'needs_outcome',
    historical_sample_count: 0,
    contradiction_score: 0.72,
    margin_top2: 0.02,
    differential_entropy: 0.91,
    abstain_recommendation: true,
    urgent_confirmatory_testing: true,
    required_confirmatory_tests: ['Parvovirus ELISA'],
    blockers: ['Inference engine recommended abstention.'],
    warnings: ['Label-specific calibration still needs confirmed outcomes.'],
    policy_snapshot: {},
    created_at: '2026-06-12T00:00:00.000Z',
};

describe('inference review queue moat', () => {
    it('queues non-actionable gate decisions for clinical review', () => {
        expect(shouldQueueActionabilityGate(suppressedGate)).toBe(true);
        expect(reviewSeverityFromActionabilityGate(suppressedGate)).toBe('critical');
        expect(reviewReasonFromActionabilityGate(suppressedGate)).toContain('suppressed');
    });

    it('does not auto-queue clean actionability decisions', () => {
        expect(shouldQueueActionabilityGate({
            ...suppressedGate,
            decision: 'actionable_with_confirmation',
            reliability_badge: 'HIGH',
            abstain_recommendation: false,
            blockers: [],
            warnings: [],
        })).toBe(false);
    });

    it('persists append-only review queue events without raw clinical narrative', async () => {
        const inserted: Array<Record<string, unknown>> = [];
        const client = {
            from: (table: string) => {
                expect(table).toBe('inference_review_queue_events');
                return {
                    insert: (payload: Record<string, unknown>) => {
                        inserted.push(payload);
                        return {
                            select: () => ({
                                single: async () => ({
                                    data: {
                                        id: '44444444-4444-4444-8444-444444444444',
                                        tenant_id: payload.tenant_id,
                                        inference_event_id: payload.inference_event_id,
                                        actionability_gate_event_id: payload.actionability_gate_event_id,
                                        request_id: payload.request_id,
                                        case_id: payload.case_id,
                                        review_status: payload.review_status,
                                        severity: payload.severity,
                                        review_reason: payload.review_reason,
                                        source: payload.source,
                                        top_label: payload.top_label,
                                        top_confidence: payload.top_confidence,
                                        phi_hat: payload.phi_hat,
                                        actionability_score: payload.actionability_score,
                                        blockers: payload.blockers,
                                        warnings: payload.warnings,
                                        recommended_next_step: payload.recommended_next_step,
                                        reviewer_note: payload.reviewer_note,
                                        created_by: payload.created_by,
                                        metadata: payload.metadata,
                                        created_at: '2026-06-12T00:00:00.000Z',
                                    },
                                    error: null,
                                }),
                            }),
                        };
                    },
                };
            },
        };

        const result = await recordInferenceReviewQueueEvent(client as never, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            inferenceEventId: '22222222-2222-4222-8222-222222222222',
            actionabilityGate: suppressedGate,
            reviewStatus: 'queued',
            source: 'actionability_gate',
        });

        expect(result.error).toBeNull();
        expect(result.data?.review_status).toBe('queued');
        expect(result.data?.severity).toBe('critical');
        expect(inserted[0]).toMatchObject({
            tenant_id: '11111111-1111-4111-8111-111111111111',
            actionability_gate_event_id: suppressedGate.id,
            top_label: 'Parvoviral Enteritis',
        });
        expect(inserted[0]).not.toHaveProperty('output_payload');
        expect(inserted[0]).not.toHaveProperty('clinical_narrative');
        expect(inserted[0]?.metadata).toMatchObject({
            privacy_boundary: expect.stringContaining('no raw clinical narrative'),
        });
    });
});
