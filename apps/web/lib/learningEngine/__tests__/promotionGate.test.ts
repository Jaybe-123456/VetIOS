import { describe, expect, it } from 'vitest';
import { evaluateModelPromotionGate, type RegressionRunEvidence } from '../promotionGate';
import type {
    LearningBenchmarkReportRecord,
    LearningCalibrationReportRecord,
    ModelRegistryEntryRecord,
} from '../types';

describe('model promotion gate', () => {
    it('allows promotion only when benchmark, calibration, adversarial, and regression evidence pass', () => {
        const result = evaluateModelPromotionGate({
            candidateModelVersion: 'diag_candidate_v2',
            targetEntries: [registryEntry()],
            benchmarkReports: [
                benchmarkReport({ family: 'clean_labeled_diagnosis', taskType: 'diagnosis' }),
                benchmarkReport({ id: 'bench-adversarial', family: 'adversarial_safety', taskType: 'safety' }),
            ],
            calibrationReports: [calibrationReport()],
            regressionRuns: [regressionRun()],
        });

        expect(result.allowed).toBe(true);
        expect(result.blockers).toEqual([]);
        expect(result.evidence.regression_run_id).toBe('regression-run-1');
    });

    it('blocks promotion when durable safety evidence is missing', () => {
        const result = evaluateModelPromotionGate({
            candidateModelVersion: 'diag_candidate_v2',
            targetEntries: [registryEntry()],
            benchmarkReports: [benchmarkReport({ family: 'clean_labeled_diagnosis', taskType: 'diagnosis' })],
            calibrationReports: [calibrationReport()],
            regressionRuns: [],
        });

        expect(result.allowed).toBe(false);
        expect(result.blockers).toContain('No safety benchmark report was found for this candidate.');
        expect(result.blockers).toContain('No adversarial safety report was found for this candidate.');
        expect(result.blockers).toContain('No completed regression simulation was found for this candidate.');
    });

    it('blocks promotion when the latest regression fixture run failed', () => {
        const result = evaluateModelPromotionGate({
            candidateModelVersion: 'diag_candidate_v2',
            targetEntries: [registryEntry()],
            benchmarkReports: [
                benchmarkReport({ family: 'clean_labeled_diagnosis', taskType: 'diagnosis' }),
                benchmarkReport({ id: 'bench-adversarial', family: 'adversarial_safety', taskType: 'safety' }),
            ],
            calibrationReports: [calibrationReport()],
            regressionRuns: [regressionRun({ results: { candidate_model: 'diag_candidate_v2', fixture_count: 6, passed: 5, failed: 1 } })],
        });

        expect(result.allowed).toBe(false);
        expect(result.blockers).toContain('Regression fixture simulation failed 1 fixture(s).');
    });
});

function registryEntry(overrides: Partial<ModelRegistryEntryRecord> = {}): ModelRegistryEntryRecord {
    return {
        id: 'model-entry-1',
        tenant_id: 'tenant-1',
        model_name: 'vetios_diagnosis',
        model_version: 'diag_candidate_v2',
        task_type: 'diagnosis',
        training_dataset_version: 'dataset-v1',
        feature_schema_version: 'clinical-case-vector-v2',
        label_policy_version: 'learning-label-policy-v1',
        artifact_payload: {},
        benchmark_scorecard: {},
        calibration_report_id: 'calibration-1',
        promotion_status: 'candidate',
        is_champion: false,
        latency_profile: null,
        resource_profile: null,
        parent_model_version: null,
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
        ...overrides,
    };
}

function benchmarkReport(input: {
    id?: string;
    family: string;
    taskType: string;
    passStatus?: string;
}): LearningBenchmarkReportRecord {
    return {
        id: input.id ?? `bench-${input.family}`,
        tenant_id: 'tenant-1',
        learning_cycle_id: 'cycle-1',
        model_registry_id: 'model-entry-1',
        benchmark_family: input.family,
        task_type: input.taskType,
        report_payload: {
            family: input.family,
            pass: input.passStatus !== 'fail',
        },
        summary_score: input.passStatus === 'fail' ? 0 : 1,
        pass_status: input.passStatus ?? 'pass',
        created_at: '2026-05-09T00:00:00.000Z',
    };
}

function calibrationReport(input: {
    status?: 'pass' | 'needs_recalibration' | 'insufficient_data';
    ece?: number;
} = {}): LearningCalibrationReportRecord {
    const status = input.status ?? 'pass';
    const ece = input.ece ?? 0.04;
    return {
        id: 'calibration-1',
        tenant_id: 'tenant-1',
        learning_cycle_id: 'cycle-1',
        model_registry_id: 'model-entry-1',
        task_type: 'diagnosis',
        report_payload: {
            expected_calibration_error: ece,
            recommendation: { status },
        },
        brier_score: 0.08,
        ece_score: ece,
        created_at: '2026-05-09T00:00:00.000Z',
    };
}

function regressionRun(overrides: Partial<RegressionRunEvidence> = {}): RegressionRunEvidence {
    return {
        id: 'regression-run-1',
        status: 'complete',
        mode: 'regression',
        candidate_model_version: 'diag_candidate_v2',
        config: { candidate_model: 'diag_candidate_v2' },
        results: {
            candidate_model: 'diag_candidate_v2',
            fixture_count: 6,
            passed: 6,
            failed: 0,
        },
        summary: {},
        created_at: '2026-05-09T00:00:00.000Z',
        completed_at: '2026-05-09T00:01:00.000Z',
        ...overrides,
    };
}
