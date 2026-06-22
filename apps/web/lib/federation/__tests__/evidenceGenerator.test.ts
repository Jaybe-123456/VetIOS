import { describe, expect, it } from 'vitest';
import { buildFederatedCandidateEvidencePlan } from '@/lib/federation/evidenceGenerator';
import { evaluateModelPromotionGate, type RegressionRunEvidence } from '@/lib/learningEngine/promotionGate';
import type {
    LearningBenchmarkReportRecord,
    LearningCalibrationReportRecord,
    ModelRegistryEntryRecord,
} from '@/lib/learningEngine/types';

describe('federated candidate evidence generator', () => {
    it('records failing preflight evidence when real runtime evidence is missing', () => {
        const plan = buildFederatedCandidateEvidencePlan({
            candidateModelVersion: 'fed-one-health-diagnosis',
            registryEntries: [registryEntry()],
            now: '2026-06-21T20:00:00.000Z',
        });

        expect(plan.promotion_gate_posture).toBe('blocked_pending_runtime_evidence');
        expect(plan.automatic_champion_promotion_allowed).toBe(false);
        expect(plan.benchmark_reports).toHaveLength(3);
        expect(plan.benchmark_reports.every((report) => report.pass_status === 'fail')).toBe(true);
        expect(plan.calibration_reports[0]?.report_payload.recommendation).toMatchObject({ status: 'insufficient_data' });
        expect(plan.regression_run.status).toBe('completed');
        expect(plan.regression_run.results).toMatchObject({
            fixture_count: 0,
            total_replayed: 0,
            blockers: ['regression_runtime_evidence_missing'],
        });
        expect(plan.blockers).toContain('federated_diagnosis_runtime_benchmark_missing_or_failed');
        expect(plan.blockers).toContain('regression_runtime_evidence_missing');
    });

    it('produces promotion-gate-ready evidence only when runtime benchmark, calibration, and regression inputs pass', () => {
        const entry = registryEntry();
        const plan = buildFederatedCandidateEvidencePlan({
            candidateModelVersion: entry.model_version,
            registryEntries: [entry],
            benchmarkEvidence: {
                task: { pass: true, case_count: 32, score: 0.91 },
                safety: { pass: true, case_count: 12, score: 0.96 },
                adversarial: { pass: true, case_count: 8, score: 0.9 },
            },
            calibrationEvidence: {
                row_count: 24,
                expected_calibration_error: 0.07,
                brier_score: 0.08,
                status: 'pass',
            },
            regressionEvidence: {
                fixture_count: 9,
                passed: 9,
                failed: 0,
            },
            now: '2026-06-21T20:00:00.000Z',
        });

        const promotionGate = evaluateModelPromotionGate({
            candidateModelVersion: entry.model_version,
            targetEntries: [entry],
            benchmarkReports: materializeBenchmarkReports(plan.benchmark_reports),
            calibrationReports: materializeCalibrationReports(plan.calibration_reports),
            regressionRuns: [materializeRegressionRun(plan.regression_run)],
        });

        expect(plan.promotion_gate_posture).toBe('gate_ready');
        expect(plan.blockers).toEqual([]);
        expect(promotionGate.allowed).toBe(true);
        expect(promotionGate.blockers).toEqual([]);
    });

    it('derives benchmark, calibration, and regression evidence from federated runtime summaries', () => {
        const entry = registryEntry();
        const plan = buildFederatedCandidateEvidencePlan({
            candidateModelVersion: entry.model_version,
            registryEntries: [entry],
            runtimeEvidence: {
                participantCount: 3,
                acceptedUpdateSubmissions: 3,
                eligibleOutcomeSnapshots: 3,
                outcomeConfirmedRows: 72,
                provenanceVerifiedRows: 72,
                trustScoredRows: 72,
                averageTrustScore: 0.86,
                secureAggregationStatus: 'live_node_commitments_ready',
                safetyCaseCount: 18,
                safetyIncidentCount: 0,
                hallucinationIncidentCount: 0,
                falseNegativeIncidentCount: 0,
                adversarialCaseCount: 10,
                adversarialPassed: 10,
                adversarialFailed: 0,
                expectedCalibrationError: 0.06,
                brierScore: 0.07,
                regressionFixtureCount: 12,
                regressionPassedCount: 12,
                regressionFailedCount: 0,
                updateSummaries: [
                    runtimeUpdate('node-a', 24, 0.85),
                    runtimeUpdate('node-b', 24, 0.88),
                    runtimeUpdate('node-c', 24, 0.85),
                ],
                sourceHashBundle: {
                    aggregate_manifest: 'a'.repeat(64),
                },
            },
            now: '2026-06-21T20:00:00.000Z',
        });

        const promotionGate = evaluateModelPromotionGate({
            candidateModelVersion: entry.model_version,
            targetEntries: [entry],
            benchmarkReports: materializeBenchmarkReports(plan.benchmark_reports),
            calibrationReports: materializeCalibrationReports(plan.calibration_reports),
            regressionRuns: [materializeRegressionRun(plan.regression_run)],
        });

        expect(plan.promotion_gate_posture).toBe('gate_ready');
        expect(plan.benchmark_reports.map((report) => report.pass_status)).toEqual(['pass', 'pass', 'pass']);
        expect(plan.calibration_reports[0]?.ece_score).toBe(0.06);
        expect(plan.regression_run.results).toMatchObject({ fixture_count: 12, failed: 0 });
        expect(promotionGate.allowed).toBe(true);
    });

    it('keeps the promotion gate blocked when runtime evidence lacks adversarial coverage', () => {
        const entry = registryEntry();
        const plan = buildFederatedCandidateEvidencePlan({
            candidateModelVersion: entry.model_version,
            registryEntries: [entry],
            runtimeEvidence: {
                participantCount: 3,
                acceptedUpdateSubmissions: 3,
                eligibleOutcomeSnapshots: 3,
                outcomeConfirmedRows: 72,
                provenanceVerifiedRows: 72,
                trustScoredRows: 72,
                averageTrustScore: 0.86,
                secureAggregationStatus: 'live_node_commitments_ready',
                safetyCaseCount: 18,
                safetyIncidentCount: 0,
                hallucinationIncidentCount: 0,
                falseNegativeIncidentCount: 0,
                expectedCalibrationError: 0.06,
                regressionFixtureCount: 12,
                regressionPassedCount: 12,
                regressionFailedCount: 0,
                updateSummaries: [
                    runtimeUpdate('node-a', 24, 0.85),
                    runtimeUpdate('node-b', 24, 0.88),
                    runtimeUpdate('node-c', 24, 0.85),
                ],
            },
            now: '2026-06-21T20:00:00.000Z',
        });

        expect(plan.promotion_gate_posture).toBe('blocked_pending_runtime_evidence');
        expect(plan.warnings).toContain('derived_runtime_adversarial_evidence_missing');
        expect(plan.blockers).toContain('federated_adversarial_runtime_benchmark_missing_or_failed');
        expect(plan.blockers).toContain('federated_adversarial_runtime_benchmark_case_count_below_minimum');
    });
});

function materializeBenchmarkReports(
    reports: Array<Omit<LearningBenchmarkReportRecord, 'id' | 'created_at'>>,
): LearningBenchmarkReportRecord[] {
    return reports.map((report, index) => ({
        ...report,
        id: `benchmark-${index + 1}`,
        created_at: '2026-06-21T20:00:00.000Z',
    }));
}

function materializeCalibrationReports(
    reports: Array<Omit<LearningCalibrationReportRecord, 'id' | 'created_at'>>,
): LearningCalibrationReportRecord[] {
    return reports.map((report, index) => ({
        ...report,
        id: `calibration-${index + 1}`,
        created_at: '2026-06-21T20:00:00.000Z',
    }));
}

function materializeRegressionRun(run: {
    status: string;
    mode: string;
    candidate_model_version: string;
    config: Record<string, unknown>;
    results: Record<string, unknown>;
    summary: Record<string, unknown>;
    completed_at: string;
}): RegressionRunEvidence {
    return {
        id: 'regression-1',
        status: run.status,
        mode: run.mode,
        candidate_model_version: run.candidate_model_version,
        config: run.config,
        results: run.results,
        summary: run.summary,
        created_at: run.completed_at,
        completed_at: run.completed_at,
    };
}

function registryEntry(overrides: Partial<ModelRegistryEntryRecord> = {}): ModelRegistryEntryRecord {
    return {
        id: 'registry-1',
        tenant_id: 'coordinator-tenant',
        model_name: 'VetIOS Federated diagnosis Candidate',
        model_version: 'fed-one-health-diagnosis',
        task_type: 'diagnosis',
        training_dataset_version: 'federated:one-health:abc123',
        feature_schema_version: 'federated_feature_schema_v1',
        label_policy_version: 'outcome_confirmed_federated_v1',
        artifact_payload: {
            federation_round_id: '11111111-1111-4111-8111-111111111111',
            value_capture_layer: {
                outcome_confirmed_rows: 32,
                provenance_verified_rows: 32,
                trust_scored_rows: 32,
            },
        },
        benchmark_scorecard: {},
        calibration_report_id: null,
        promotion_status: 'candidate',
        is_champion: false,
        latency_profile: null,
        resource_profile: null,
        parent_model_version: null,
        created_at: '2026-06-21T16:00:00.000Z',
        updated_at: '2026-06-21T16:00:00.000Z',
        ...overrides,
    };
}

function runtimeUpdate(nodeRef: string, rows: number, trustScore: number): Record<string, unknown> {
    return {
        nodeRef,
        participantRef: `participant:${nodeRef}`,
        contributionRole: 'diagnosis',
        submissionStatus: 'accepted',
        outcomeEligibilitySnapshotId: `eligibility:${nodeRef}`,
        eligibleRecordCount: rows,
        outcomeConfirmedRows: rows,
        provenanceVerifiedRows: rows,
        trustScoredRows: rows,
        averageTrustScore: trustScore,
        metricSummary: {
            accuracy: 0.91,
            expected_calibration_error: 0.06,
            brier_score: 0.07,
        },
    };
}
