import { describe, expect, it } from 'vitest';
import {
    buildFederatedCandidateEvidencePlan,
    buildFederatedRuntimeEvidenceFromRows,
} from '@/lib/federation/evidenceGenerator';
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

    it('assembles runtime evidence from live federation ledger rows before generating reports', () => {
        const entry = registryEntry();
        const runtimeEvidence = buildFederatedRuntimeEvidenceFromRows({
            candidateModelVersion: entry.model_version,
            round: {
                id: '11111111-1111-4111-8111-111111111111',
                federation_key: 'one_health_amr',
                coordinator_tenant_id: 'coordinator-tenant',
                round_key: 'round-20260621',
                status: 'completed',
                participant_count: 3,
                aggregate_payload: {
                    accepted_update_aggregation: {
                        status: 'aggregate_candidates_ready',
                    },
                    federated_runtime_evidence: {
                        safety: { case_count: 18, incident_count: 0 },
                        adversarial: { case_count: 10, passed: 10, failed: 0, score: 0.94 },
                        regression: { fixture_count: 12, passed: 12, failed: 0 },
                        calibration: { row_count: 72, expected_calibration_error: 0.06, brier_score: 0.07 },
                    },
                },
                candidate_artifact_payload: {},
                completed_at: '2026-06-21T20:00:00.000Z',
            },
            updateSubmissions: [
                runtimeSubmission('submission-a', 'node-a', 'eligibility-a', 0.91),
                runtimeSubmission('submission-b', 'node-b', 'eligibility-b', 0.9),
                runtimeSubmission('submission-c', 'node-c', 'eligibility-c', 0.92),
            ],
            outcomeEligibilitySnapshots: [
                runtimeEligibility('eligibility-a', 24, 0.85),
                runtimeEligibility('eligibility-b', 24, 0.88),
                runtimeEligibility('eligibility-c', 24, 0.85),
            ],
        });

        const plan = buildFederatedCandidateEvidencePlan({
            candidateModelVersion: entry.model_version,
            registryEntries: [entry],
            runtimeEvidence,
            now: '2026-06-21T20:00:00.000Z',
        });

        expect(runtimeEvidence).toMatchObject({
            evidence_source: 'federated_runtime_ledger',
            participantCount: 3,
            acceptedUpdateSubmissions: 3,
            outcomeConfirmedRows: 72,
            provenanceVerifiedRows: 72,
            trustScoredRows: 72,
            secureAggregationStatus: 'live_node_commitments_ready',
        });
        expect(runtimeEvidence.sourceHashBundle?.accepted_update_payload_hashes).toHaveLength(3);
        expect(plan.promotion_gate_posture).toBe('gate_ready');
        expect(plan.blockers).toEqual([]);
    });

    it('generates benchmark and regression packets from secure aggregate artifacts without operator-supplied reports', () => {
        const entry = registryEntry();
        const runtimeEvidence = buildFederatedRuntimeEvidenceFromRows({
            candidateModelVersion: entry.model_version,
            round: {
                id: '11111111-1111-4111-8111-111111111111',
                federation_key: 'one_health_amr',
                coordinator_tenant_id: 'coordinator-tenant',
                round_key: 'round-20260621',
                status: 'completed',
                participant_count: 3,
                aggregate_payload: {
                    accepted_update_aggregation: {
                        status: 'aggregate_candidates_ready',
                    },
                },
                candidate_artifact_payload: {
                    diagnosis: aggregateArtifact(),
                },
                completed_at: '2026-06-21T20:00:00.000Z',
            },
            updateSubmissions: [
                runtimeSubmission('submission-a', 'node-a', 'eligibility-a', 0.91),
                runtimeSubmission('submission-b', 'node-b', 'eligibility-b', 0.9),
                runtimeSubmission('submission-c', 'node-c', 'eligibility-c', 0.92),
            ],
            outcomeEligibilitySnapshots: [
                runtimeEligibility('eligibility-a', 24, 0.85),
                runtimeEligibility('eligibility-b', 24, 0.88),
                runtimeEligibility('eligibility-c', 24, 0.85),
            ],
        });

        const plan = buildFederatedCandidateEvidencePlan({
            candidateModelVersion: entry.model_version,
            registryEntries: [entry],
            runtimeEvidence,
            now: '2026-06-21T20:00:00.000Z',
        });

        const promotionGate = evaluateModelPromotionGate({
            candidateModelVersion: entry.model_version,
            targetEntries: [entry],
            benchmarkReports: materializeBenchmarkReports(plan.benchmark_reports),
            calibrationReports: materializeCalibrationReports(plan.calibration_reports),
            regressionRuns: [materializeRegressionRun(plan.regression_run)],
        });

        expect(runtimeEvidence).toMatchObject({
            secureAggregationStatus: 'secure_aggregation_ready',
            aggregateArtifactCount: 1,
            materializedAggregateArtifactCount: 1,
        });
        expect(plan.benchmark_reports.map((report) => report.pass_status)).toEqual(['pass', 'pass', 'pass']);
        expect(plan.benchmark_reports[1]?.report_payload.evidence_summary).toMatchObject({
            generated_from_aggregate_artifact: true,
        });
        expect(plan.regression_run.results).toMatchObject({
            failed: 0,
            blocked: false,
        });
        expect(Number(plan.regression_run.results.fixture_count)).toBeGreaterThan(0);
        expect(plan.promotion_gate_posture).toBe('gate_ready');
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

function runtimeSubmission(id: string, nodeRef: string, eligibilityId: string, accuracy: number) {
    return {
        id,
        tenant_id: `tenant-${nodeRef}`,
        federation_round_id: '11111111-1111-4111-8111-111111111111',
        outcome_eligibility_snapshot_id: eligibilityId,
        federation_key: 'one_health_amr',
        round_key: 'round-20260621',
        node_ref: nodeRef,
        partner_ref: `partner-${nodeRef}`,
        participant_ref: `participant-${nodeRef}`,
        contribution_role: 'diagnosis',
        submission_status: 'accepted',
        payload_commitment_hash: `${id.at(-1) ?? 'a'}`.repeat(64).slice(0, 64),
        mask_commitment_hash: 'f'.repeat(64),
        signed_payload_hash: 'e'.repeat(64),
        signature_hash: 'd'.repeat(64),
        masked_update_summary: {
            metric_summary: {
                accuracy,
                expected_calibration_error: 0.06,
                brier_score: 0.07,
            },
        },
        public_summary: {},
        evidence: {},
    };
}

function runtimeEligibility(id: string, rows: number, trustScore: number) {
    return {
        id,
        tenant_id: `tenant-${id}`,
        eligibility_status: 'eligible',
        outcome_confirmed_rows: rows,
        provenance_verified_rows: rows,
        trust_scored_rows: rows,
        average_trust_score: trustScore,
        external_validation_events: 1,
        source_record_digest: 'c'.repeat(64),
        source_hash_bundle: {
            eligible_records: `${id}:digest`,
        },
        evidence: {},
    };
}

function aggregateArtifact(): Record<string, unknown> {
    return {
        artifact_type: 'federated_secure_aggregate_materialization_v1',
        aggregation_mode: 'secure_aggregation_masked_vector_sum',
        task_type: 'diagnosis',
        model_version: 'fed-one-health-amr-round-20260621-diagnosis',
        dataset_version: `federated:round-20260621:${'a'.repeat(64)}`,
        accepted_update_count: 3,
        accepted_node_refs: ['node-a', 'node-b', 'node-c'],
        outcome_eligibility_snapshot_ids: ['eligibility-a', 'eligibility-b', 'eligibility-c'],
        payload_commitment_hashes: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)],
        mask_commitment_hashes: ['4'.repeat(64), '5'.repeat(64), '6'.repeat(64)],
        signature_hashes: ['7'.repeat(64), '8'.repeat(64), '9'.repeat(64)],
        source_update_digest: 'a'.repeat(64),
        raw_site_delta_artifacts_stored: false,
        raw_clinical_rows_shared: false,
        coordinator_visibility: 'commitments_public_summaries_and_secure_aggregate_only',
        blockers: [],
        secure_aggregate_materialization: {
            status: 'materialized',
            protocol: 'x25519_hkdf_pairwise_masked_v1',
            accepted_update_count: 3,
            quantization_scale: 1000,
            dimension_count: 4,
            dimension_order_digest: 'b'.repeat(64),
            aggregate_masked_vector_digest: 'c'.repeat(64),
            encrypted_unmask_share_envelope_count: 6,
            dropout_recovery_evidence_status: 'decrypted_no_dropout_correction_needed',
            blockers: [],
        },
    };
}
