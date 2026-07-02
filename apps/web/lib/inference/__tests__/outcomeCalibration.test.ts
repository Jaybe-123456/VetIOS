import { describe, expect, it } from 'vitest';
import {
    buildOutcomeCalibrationBuckets,
    recordOutcomeCalibrationRun,
    type OutcomeCalibrationCase,
} from '../outcomeCalibration';

const tenantId = '11111111-1111-4111-8111-111111111111';

function row(overrides: Partial<OutcomeCalibrationCase> = {}): OutcomeCalibrationCase {
    return {
        tenantId,
        outcomeEventId: overrides.outcomeEventId ?? 'outcome-1',
        inferenceEventId: overrides.inferenceEventId ?? 'inference-1',
        label: 'Ehrlichiosis',
        predictedLabel: 'Ehrlichiosis',
        predictedProbability: 0.9,
        actualProbability: 0.9,
        actualConfidence: 0.9,
        calibrationDelta: 0,
        topDifferentials: [
            { label: 'Ehrlichiosis', probability: 0.9 },
            { label: 'Anaplasmosis', probability: 0.07 },
            { label: 'Babesiosis', probability: 0.03 },
        ],
        species: 'canine',
        modelVersion: 'vetios-clinical-v1',
        evidenceType: 'lab_confirmed',
        severity: 'high',
        careEnvironment: 'general_practice',
        region: 'us',
        ...overrides,
    };
}

describe('outcome calibration loop', () => {
    it('builds stratified calibration buckets and excludes synthetic rows', () => {
        const rows = [
            row({ outcomeEventId: 'outcome-1', inferenceEventId: 'inference-1' }),
            row({ outcomeEventId: 'outcome-2', inferenceEventId: 'inference-2' }),
            row({ outcomeEventId: 'outcome-3', inferenceEventId: 'inference-3' }),
            row({ outcomeEventId: 'outcome-4', inferenceEventId: 'inference-4' }),
            row({ outcomeEventId: 'outcome-5', inferenceEventId: 'inference-5' }),
            row({
                outcomeEventId: 'outcome-6',
                inferenceEventId: 'inference-6',
                predictedLabel: 'Anaplasmosis',
                predictedProbability: 0.95,
                actualProbability: 0.05,
                actualConfidence: 0.05,
                topDifferentials: [
                    { label: 'Anaplasmosis', probability: 0.95 },
                    { label: 'Ehrlichiosis', probability: 0.05 },
                ],
            }),
            row({ synthetic: true, labelType: 'synthetic', outcomeEventId: 'synthetic-outcome' }),
        ];

        const summary = buildOutcomeCalibrationBuckets({
            tenantId,
            rows,
            minimumRequiredOutcomes: 5,
        });

        expect(summary.run_status).toBe('completed');
        expect(summary.synthetic_rows_excluded).toBe(1);
        expect(summary.blockers).toContain('synthetic_rows_excluded_from_calibration');
        expect(summary.buckets).toHaveLength(1);
        expect(summary.buckets[0]).toMatchObject({
            normalized_label: 'ehrlichiosis',
            species: 'canine',
            model_version: 'vetios-clinical-v1',
            evidence_type: 'lab_confirmed',
            outcome_label_count: 6,
            top1_accuracy: 0.8333,
            top3_recall: 1,
            overconfidence_rate: 0.1667,
            calibration_status: 'calibrated',
        });
        expect(summary.buckets[0]?.source_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(summary.buckets[0]?.evidence).not.toHaveProperty('raw_notes');
    });

    it('refuses to mark synthetic-only evidence as operational calibration', () => {
        const summary = buildOutcomeCalibrationBuckets({
            tenantId,
            rows: [
                row({ synthetic: true, labelType: 'synthetic' }),
                row({ synthetic: true, sourceKind: 'synthetic' }),
            ],
            minimumRequiredOutcomes: 5,
        });

        expect(summary.run_status).toBe('insufficient_evidence');
        expect(summary.eligible_rows).toBe(0);
        expect(summary.bucket_count).toBe(0);
        expect(summary.blockers).toEqual(expect.arrayContaining([
            'insufficient_real_outcome_rows',
            'synthetic_rows_excluded_from_calibration',
        ]));
    });

    it('persists an append-only run and bucket rows without raw clinical payloads', async () => {
        const insertedRuns: Array<Record<string, unknown>> = [];
        const insertedBuckets: Array<Record<string, unknown>> = [];
        const client = {
            from: (table: string) => {
                if (table === 'outcome_calibration_runs') {
                    return {
                        insert: (payload: Record<string, unknown>) => {
                            insertedRuns.push(payload);
                            return {
                                select: () => ({
                                    single: async () => ({
                                        data: { id: '33333333-3333-4333-8333-333333333333' },
                                        error: null,
                                    }),
                                }),
                            };
                        },
                    };
                }
                if (table === 'outcome_calibration_buckets') {
                    return {
                        insert: async (payload: Array<Record<string, unknown>>) => {
                            insertedBuckets.push(...payload);
                            return { error: null };
                        },
                    };
                }
                throw new Error(`Unexpected table ${table}`);
            },
        };

        const result = await recordOutcomeCalibrationRun(client as never, {
            tenantId,
            requestId: 'calibration-run-1',
            runKind: 'manual_recompute',
            rows: [
                row({ outcomeEventId: 'outcome-1' }),
                row({ outcomeEventId: 'outcome-2' }),
                row({ outcomeEventId: 'outcome-3' }),
                row({ outcomeEventId: 'outcome-4' }),
                row({ outcomeEventId: 'outcome-5' }),
            ],
            minimumRequiredOutcomes: 5,
        });

        expect(result.error).toBeNull();
        expect(insertedRuns[0]).toMatchObject({
            tenant_id: tenantId,
            run_status: 'completed',
            eligible_rows: 5,
        });
        expect(insertedRuns[0]?.run_packet).not.toHaveProperty('rows');
        expect(insertedBuckets[0]).toMatchObject({
            calibration_run_id: '33333333-3333-4333-8333-333333333333',
            outcome_label_count: 5,
            calibration_status: 'indeterminate',
        });
        expect(insertedBuckets[0]?.evidence).not.toHaveProperty('raw_output_payload');
    });
});
