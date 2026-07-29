import { describe, expect, it } from 'vitest';
import { buildCireValidationReportFromRows } from '../validation';

describe('CIRE validation report', () => {
    it('validates phi_hat when high values align with correct outcomes', () => {
        const inferences = [
            inference('i1', 0.95),
            inference('i2', 0.86),
            inference('i3', 0.78),
            inference('i4', 0.25),
            inference('i5', 0.18),
            inference('i6', 0.11),
        ];
        const outcomes = [
            outcome('i1', true),
            outcome('i2', true),
            outcome('i3', true),
            outcome('i4', false),
            outcome('i5', false),
            outcome('i6', false),
        ];

        const report = buildCireValidationReportFromRows(inferences, outcomes, {
            minSampleSize: 4,
            correlationThreshold: 0.5,
        });

        expect(report.status).toBe('validated');
        expect(report.validated).toBe(true);
        expect(report.sample_size).toBe(6);
        expect(report.spearman_r ?? 0).toBeGreaterThanOrEqual(0.5);
        expect(report.mean_phi_correct ?? 0).toBeGreaterThan(report.mean_phi_incorrect ?? 1);
        expect(report.lineage_coverage.prompt_template_hash).toBe(1);
        expect(report.lineage_coverage.schema_version).toBe(1);
        expect(report.lineage_coverage.top_level_phi_hat).toBe(1);
    });

    it('refuses validation when outcome coverage is too small', () => {
        const report = buildCireValidationReportFromRows(
            [inference('i1', 0.95), inference('i2', 0.1)],
            [outcome('i1', true), outcome('i2', false)],
            { minSampleSize: 5 },
        );

        expect(report.status).toBe('insufficient_outcomes');
        expect(report.validated).toBe(false);
        expect(report.interpretation).toContain('3 more');
    });

    it('uses a 200-case target and excludes synthetic rows for real clinical validation', () => {
        const report = buildCireValidationReportFromRows(
            [
                inference('i1', 0.95),
                inference('i2', 0.1),
                inference('i3', 0.05),
            ],
            [
                outcome('i1', true),
                outcome('i2', false),
                outcome('i3', false, { is_synthetic: true, label_type: 'synthetic' }),
            ],
            { realClinicalOnly: true },
        );

        expect(report.validation_scope).toBe('real_clinical_outcomes');
        expect(report.min_sample_size).toBe(200);
        expect(report.sample_size).toBe(2);
        expect(report.status).toBe('insufficient_outcomes');
    });

    it('excludes inferred-only labels and synthetic source inferences from real clinical validation', () => {
        const report = buildCireValidationReportFromRows(
            [
                inference('expert', 0.9),
                inference('inferred', 0.8),
                inference('synthetic-source', 0.7, { is_synthetic: true }),
            ],
            [
                outcome('expert', true),
                outcome('inferred', true, { label_type: 'inferred_only' }),
                outcome('synthetic-source', true),
            ],
            { realClinicalOnly: true, minSampleSize: 1 },
        );

        expect(report.sample_size).toBe(1);
        expect(report.validation_scope).toBe('real_clinical_outcomes');
    });

    it('counts one canonical outcome per inference and prefers stronger confirmation', () => {
        const report = buildCireValidationReportFromRows(
            [inference('i1', 0.9), inference('i2', 0.1)],
            [
                outcome('i1', false, {
                    label_type: 'expert_reviewed',
                    created_at: '2026-07-01T10:00:00.000Z',
                }),
                outcome('i1', true, {
                    label_type: 'lab_confirmed',
                    created_at: '2026-07-01T09:00:00.000Z',
                }),
                outcome('i2', false),
            ],
            { realClinicalOnly: true, minSampleSize: 2 },
        );

        expect(report.sample_size).toBe(2);
        expect(report.correctness_rate).toBe(0.5);
    });
});

function inference(id: string, phiHat: number, patch: Record<string, unknown> = {}) {
    return {
        id,
        is_synthetic: false,
        model_version: 'test',
        prompt_template_hash: '1b0401e4cfaf264e4e1c7883a455c5ca22f2dd2cce6877cb66d366e7c0affe7b',
        prompt_template_version: 'vetios_clinical_diagnostic_v1',
        schema_version: 'v1',
        phi_hat: phiHat,
        confidence_score: phiHat,
        output_payload: {
            cire: {
                phi_hat: phiHat,
            },
        },
        ...patch,
    };
}

function outcome(
    inferenceId: string,
    predictionCorrect: boolean,
    patch: Record<string, unknown> = {},
) {
    return {
        id: `outcome_${inferenceId}`,
        inference_event_id: inferenceId,
        is_synthetic: false,
        label_type: 'expert_reviewed',
        outcome_payload: {
            prediction_correct: predictionCorrect,
        },
        ...patch,
    };
}
