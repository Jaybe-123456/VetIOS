import { describe, expect, it } from 'vitest';
import {
    OUTCOME_CALIBRATION_MATERIALIZER_VERSION,
    buildOutcomeCalibrationMaterialization,
    loadOutcomeCalibrationInferenceRows,
    type OutcomeMaterializationInferenceRow,
    type OutcomeMaterializationOutcomeRow,
} from '../outcomeCalibrationMaterializer';
import type { SupabaseClient } from '@supabase/supabase-js';

const tenantId = '11111111-1111-4111-8111-111111111111';

function inference(
    overrides: Partial<OutcomeMaterializationInferenceRow> = {},
): OutcomeMaterializationInferenceRow {
    return {
        id: '22222222-2222-4222-8222-222222222222',
        tenant_id: tenantId,
        model_name: 'vetios-clinical',
        model_version: 'v1',
        confidence_score: 0.8,
        differentials: [
            { label: 'Ehrlichiosis', probability: 0.8 },
            { label: 'Anaplasmosis', probability: 0.2 },
        ],
        output_payload: {},
        input_signature: { species: 'canine' },
        is_synthetic: false,
        simulation_id: null,
        created_at: '2026-07-27T10:00:00.000Z',
        ...overrides,
    };
}

function outcome(
    overrides: Partial<OutcomeMaterializationOutcomeRow> = {},
): OutcomeMaterializationOutcomeRow {
    return {
        id: '33333333-3333-4333-8333-333333333333',
        tenant_id: tenantId,
        inference_event_id: '22222222-2222-4222-8222-222222222222',
        outcome_type: 'clinical_diagnosis',
        outcome_payload: {
            actual_diagnosis: 'Ehrlichiosis',
            notes: 'must never enter materialized evidence',
        },
        outcome_timestamp: '2026-07-28T10:00:00.000Z',
        label_type: 'expert_reviewed',
        actual_label: 'Ehrlichiosis',
        is_synthetic: false,
        simulation_id: null,
        source_module: 'clinical_outcome_closure',
        created_at: '2026-07-28T10:00:00.000Z',
        ...overrides,
    };
}

describe('outcome calibration materializer', () => {
    it('materializes evidence-grade real outcomes with correctly named binary scores', () => {
        const build = buildOutcomeCalibrationMaterialization({
            tenantId,
            requestId: 'request-1',
            inferenceEvents: [inference()],
            outcomeEvents: [outcome()],
        });

        expect(build.algorithm_version).toBe(OUTCOME_CALIBRATION_MATERIALIZER_VERSION);
        expect(build.materialized_count).toBe(1);
        expect(build.blocked_count).toBe(0);
        expect(build.canonical_materialized_count).toBe(1);
        expect(build.calibration_rows).toHaveLength(1);
        expect(build.events[0]).toMatchObject({
            materialization_status: 'materialized',
            canonical_label: 'ehrlichiosis',
            predicted_label: 'Ehrlichiosis',
            top_label_confidence: 0.8,
            top_label_correct: true,
            top_label_brier_score: 0.04,
            top_label_log_loss: 0.223144,
            absolute_confidence_error: 0.2,
            distribution_scope: 'top_label_only',
            multiclass_brier_score: null,
            blocker_codes: [],
        });
        expect(JSON.stringify(build.events[0]?.evidence)).not.toContain('must never enter');
        expect(build.source_digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it('records weak authority and synthetic provenance as explicit blockers', () => {
        const build = buildOutcomeCalibrationMaterialization({
            tenantId,
            requestId: 'request-2',
            inferenceEvents: [
                inference({ is_synthetic: true, simulation_id: 'simulation-1' }),
            ],
            outcomeEvents: [
                outcome({
                    label_type: 'expert',
                    is_synthetic: true,
                    simulation_id: 'simulation-1',
                }),
            ],
        });

        expect(build.materialized_count).toBe(0);
        expect(build.blocked_count).toBe(1);
        expect(build.events[0]?.blocker_codes).toEqual(expect.arrayContaining([
            'outcome_authority_not_evidence_grade',
            'synthetic_inference',
            'synthetic_outcome',
        ]));
        expect(build.blocker_counts).toMatchObject({
            outcome_authority_not_evidence_grade: 1,
            synthetic_inference: 1,
            synthetic_outcome: 1,
        });
    });

    it('uses one strongest current outcome per inference for aggregate calibration', () => {
        const expert = outcome({
            id: '33333333-3333-4333-8333-333333333333',
            label_type: 'expert_reviewed',
            outcome_timestamp: '2026-07-28T12:00:00.000Z',
        });
        const lab = outcome({
            id: '44444444-4444-4444-8444-444444444444',
            label_type: 'lab_confirmed',
            outcome_timestamp: '2026-07-27T12:00:00.000Z',
        });
        const build = buildOutcomeCalibrationMaterialization({
            tenantId,
            requestId: 'request-3',
            inferenceEvents: [inference()],
            outcomeEvents: [expert, lab],
        });

        expect(build.materialized_count).toBe(2);
        expect(build.canonical_materialized_count).toBe(1);
        expect(build.calibration_rows).toHaveLength(1);
        expect(build.calibration_rows[0]?.evidenceType).toBe('lab_confirmed');
        expect(
            build.events.find((event) => event.outcome_event_id === lab.id)
                ?.is_canonical_at_materialization,
        ).toBe(true);
    });

    it('computes multiclass scores only for an explicit complete distribution', () => {
        const build = buildOutcomeCalibrationMaterialization({
            tenantId,
            requestId: 'request-4',
            inferenceEvents: [
                inference({
                    confidence_score: 0.7,
                    differentials: [
                        { label: 'Ehrlichiosis', p: 0.7 },
                        { label: 'Anaplasmosis', p: 0.2 },
                        { label: 'Babesiosis', p: 0.1 },
                    ],
                    output_payload: {
                        probability_distribution_complete: true,
                    },
                }),
            ],
            outcomeEvents: [
                outcome({
                    actual_label: 'Anaplasmosis',
                    outcome_payload: { actual_label: 'Anaplasmosis' },
                }),
            ],
        });

        expect(build.events[0]).toMatchObject({
            distribution_scope: 'complete_multiclass',
            top_label_correct: false,
            top_label_brier_score: 0.49,
            top_label_log_loss: 1.203973,
            confirmed_label_probability: 0.2,
            multiclass_brier_score: 1.14,
            multiclass_log_loss: 1.609438,
        });
    });

    it('produces a stable source digest regardless of source row ordering', () => {
        const secondInference = inference({
            id: '55555555-5555-4555-8555-555555555555',
        });
        const secondOutcome = outcome({
            id: '66666666-6666-4666-8666-666666666666',
            inference_event_id: secondInference.id,
        });
        const forward = buildOutcomeCalibrationMaterialization({
            tenantId,
            requestId: 'request-forward',
            inferenceEvents: [inference(), secondInference],
            outcomeEvents: [outcome(), secondOutcome],
        });
        const reverse = buildOutcomeCalibrationMaterialization({
            tenantId,
            requestId: 'request-reverse',
            inferenceEvents: [secondInference, inference()],
            outcomeEvents: [secondOutcome, outcome()],
        });

        expect(forward.source_digest).toBe(reverse.source_digest);
    });

    it('falls back to output payload when the optional differentials column is absent', async () => {
        const selectedColumns: string[] = [];
        const storedInference = inference({
            differentials: undefined,
            confidence_score: 0.8,
            output_payload: {
                diagnosis: {
                    top_differentials: [
                        { label: 'Ehrlichiosis', probability: 0.8 },
                        { label: 'Anaplasmosis', probability: 0.2 },
                    ],
                },
            },
        });
        const client = {
            from: () => ({
                select: (columns: string) => {
                    selectedColumns.push(columns);
                    const builder = {
                        eq: () => builder,
                        in: async () => columns.includes('differentials')
                            ? {
                                data: null,
                                error: {
                                    code: '42703',
                                    message:
                                        'column ai_inference_events.differentials does not exist',
                                },
                            }
                            : {
                                data: [storedInference],
                                error: null,
                            },
                    };
                    return builder;
                },
            }),
        } as unknown as SupabaseClient;

        const loaded = await loadOutcomeCalibrationInferenceRows(
            client,
            tenantId,
            [String(storedInference.id)],
        );
        const build = buildOutcomeCalibrationMaterialization({
            tenantId,
            requestId: 'request-schema-fallback',
            inferenceEvents: loaded,
            outcomeEvents: [outcome()],
        });

        expect(selectedColumns).toHaveLength(2);
        expect(selectedColumns[0]).toContain('differentials');
        expect(selectedColumns[1]).not.toContain('differentials');
        expect(build.events[0]).toMatchObject({
            materialization_status: 'materialized',
            predicted_label: 'Ehrlichiosis',
            top_label_confidence: 0.8,
        });
    });

    it('uses populated output differentials when a compatibility column is empty', () => {
        const build = buildOutcomeCalibrationMaterialization({
            tenantId,
            requestId: 'request-empty-compatibility-column',
            inferenceEvents: [
                inference({
                    differentials: [],
                    output_payload: {
                        diagnosis: {
                            top_differentials: [
                                { label: 'Ehrlichiosis', probability: 0.8 },
                                { label: 'Anaplasmosis', probability: 0.2 },
                            ],
                        },
                    },
                }),
            ],
            outcomeEvents: [outcome()],
        });

        expect(build.events[0]).toMatchObject({
            materialization_status: 'materialized',
            predicted_label: 'Ehrlichiosis',
            top_label_confidence: 0.8,
        });
    });
});
