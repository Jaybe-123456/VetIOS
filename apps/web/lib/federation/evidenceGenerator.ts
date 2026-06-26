import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS,
    FEDERATED_UPDATE_SUBMISSIONS,
    FEDERATION_ROUNDS,
} from '@/lib/db/schemaContracts';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import type {
    LearningBenchmarkReportRecord,
    LearningCalibrationReportRecord,
    ModelRegistryEntryRecord,
} from '@/lib/learningEngine/types';

export interface FederatedCandidateEvidenceInput {
    candidateModelVersion: string;
    registryEntries: ModelRegistryEntryRecord[];
    runtimeEvidence?: FederatedRuntimeEvidenceInput | Record<string, unknown>;
    benchmarkEvidence?: Record<string, unknown>;
    calibrationEvidence?: Record<string, unknown>;
    regressionEvidence?: Record<string, unknown>;
    operatorEvidence?: Record<string, unknown>;
    actor?: string | null;
    now?: string;
}

export interface FederatedRegressionRunDraft {
    tenant_id: string;
    scenario_name: string;
    mode: 'regression';
    status: 'completed';
    config: Record<string, unknown>;
    summary: Record<string, unknown>;
    results: Record<string, unknown>;
    completed: number;
    total: number;
    candidate_model_version: string;
    completed_at: string;
    started_at: string;
    created_by: string;
}

export interface FederatedRuntimeDeltaEvidence {
    updateSubmissionId?: string | null;
    nodeRef?: string | null;
    participantRef?: string | null;
    contributionRole?: string | null;
    taskType?: string | null;
    submissionStatus?: string | null;
    outcomeEligibilitySnapshotId?: string | null;
    eligibleRecordCount?: number | null;
    outcomeConfirmedRows?: number | null;
    provenanceVerifiedRows?: number | null;
    trustScoredRows?: number | null;
    averageTrustScore?: number | null;
    payloadCommitmentHash?: string | null;
    maskCommitmentHash?: string | null;
    metricSummary?: Record<string, unknown> | null;
    publicSummary?: Record<string, unknown> | null;
    evidence?: Record<string, unknown> | null;
}

export interface FederatedRuntimeEvidenceInput {
    participantCount?: number | null;
    acceptedUpdateSubmissions?: number | null;
    quarantinedUpdateSubmissions?: number | null;
    eligibleOutcomeSnapshots?: number | null;
    outcomeConfirmedRows?: number | null;
    provenanceVerifiedRows?: number | null;
    trustScoredRows?: number | null;
    averageTrustScore?: number | null;
    secureAggregationStatus?: string | null;
    externalValidationCount?: number | null;
    minimumParticipants?: number | null;
    minimumAcceptedUpdates?: number | null;
    minimumOutcomeConfirmedRows?: number | null;
    minimumAverageTrustScore?: number | null;
    safetyCaseCount?: number | null;
    safetyIncidentCount?: number | null;
    hallucinationIncidentCount?: number | null;
    falseNegativeIncidentCount?: number | null;
    adversarialCaseCount?: number | null;
    adversarialPassed?: number | null;
    adversarialFailed?: number | null;
    adversarialScore?: number | null;
    expectedCalibrationError?: number | null;
    brierScore?: number | null;
    regressionFixtureCount?: number | null;
    regressionFailedCount?: number | null;
    regressionPassedCount?: number | null;
    regressionTotalReplayed?: number | null;
    regressionRate?: number | null;
    regressionThresholdPct?: number | null;
    candidateBlocked?: boolean | null;
    updateSummaries?: FederatedRuntimeDeltaEvidence[] | null;
    sourceHashBundle?: Record<string, unknown> | null;
}

export interface FederatedRuntimeRoundEvidenceRow {
    id: string;
    federation_key: string;
    coordinator_tenant_id: string;
    round_key: string;
    status: string;
    participant_count: number;
    aggregate_payload: Record<string, unknown>;
    candidate_artifact_payload: Record<string, unknown>;
    completed_at?: string | null;
}

export interface FederatedRuntimeUpdateSubmissionRow {
    id: string;
    tenant_id: string;
    federation_round_id: string;
    outcome_eligibility_snapshot_id: string | null;
    federation_key: string;
    round_key: string;
    node_ref: string;
    partner_ref: string;
    participant_ref: string;
    contribution_role: string;
    submission_status: string;
    payload_commitment_hash: string | null;
    mask_commitment_hash: string | null;
    signed_payload_hash: string | null;
    signature_hash: string | null;
    masked_update_summary: Record<string, unknown>;
    public_summary: Record<string, unknown>;
    evidence: Record<string, unknown>;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface FederatedRuntimeOutcomeEligibilitySnapshotRow {
    id: string;
    tenant_id: string;
    eligibility_status: string | null;
    outcome_confirmed_rows: number;
    provenance_verified_rows: number;
    trust_scored_rows: number;
    average_trust_score: number;
    external_validation_events: number;
    source_record_digest: string | null;
    source_hash_bundle: Record<string, unknown>;
    evidence: Record<string, unknown>;
}

export interface FederatedDerivedCandidateEvidence {
    benchmarkEvidence: Record<string, unknown>;
    calibrationEvidence: Record<string, unknown>;
    regressionEvidence: Record<string, unknown>;
    operatorEvidence: Record<string, unknown>;
    warnings: string[];
}

export interface FederatedCandidateEvidencePlan {
    candidate_model_version: string;
    registry_entry_ids: string[];
    benchmark_reports: Array<Omit<LearningBenchmarkReportRecord, 'id' | 'created_at'>>;
    calibration_reports: Array<Omit<LearningCalibrationReportRecord, 'id' | 'created_at'>>;
    regression_run: FederatedRegressionRunDraft;
    blockers: string[];
    warnings: string[];
    promotion_gate_posture: 'gate_ready' | 'blocked_pending_runtime_evidence';
    automatic_champion_promotion_allowed: false;
    manual_promotion_route: '/api/learning/promote';
}

export interface GenerateFederatedCandidateEvidenceResult {
    plan: FederatedCandidateEvidencePlan;
    created_benchmark_reports: LearningBenchmarkReportRecord[];
    created_calibration_reports: LearningCalibrationReportRecord[];
    regression_run: Record<string, unknown>;
}

type BenchmarkKind = 'task' | 'safety' | 'adversarial';

export async function generateFederatedCandidateEvidence(
    client: SupabaseClient,
    input: {
        tenantId: string;
        candidateModelVersion: string;
        federationRoundId?: string | null;
        runtimeEvidence?: FederatedRuntimeEvidenceInput | Record<string, unknown>;
        benchmarkEvidence?: Record<string, unknown>;
        calibrationEvidence?: Record<string, unknown>;
        regressionEvidence?: Record<string, unknown>;
        operatorEvidence?: Record<string, unknown>;
        actor?: string | null;
    },
): Promise<GenerateFederatedCandidateEvidenceResult> {
    const store = createSupabaseLearningEngineStore(client);
    const registryEntries = (await store.listModelRegistryEntries(input.tenantId))
        .filter((entry) => entry.model_version === input.candidateModelVersion)
        .filter((entry) => {
            if (!input.federationRoundId) return true;
            return readText(entry.artifact_payload.federation_round_id) === input.federationRoundId;
        });

    if (registryEntries.length === 0) {
        throw new Error('No model registry entries were found for the requested federated candidate.');
    }

    const runtimeEvidence = input.runtimeEvidence
        ?? (input.federationRoundId
            ? await loadFederatedRuntimeEvidenceForRound(client, {
                tenantId: input.tenantId,
                federationRoundId: input.federationRoundId,
                candidateModelVersion: input.candidateModelVersion,
            })
            : undefined);

    const plan = buildFederatedCandidateEvidencePlan({
        candidateModelVersion: input.candidateModelVersion,
        registryEntries,
        runtimeEvidence,
        benchmarkEvidence: input.benchmarkEvidence,
        calibrationEvidence: input.calibrationEvidence,
        regressionEvidence: input.regressionEvidence,
        operatorEvidence: input.operatorEvidence,
        actor: input.actor,
    });

    const createdBenchmarkReports: LearningBenchmarkReportRecord[] = [];
    for (const report of plan.benchmark_reports) {
        createdBenchmarkReports.push(await store.createBenchmarkReport(report));
    }

    const createdCalibrationReports: LearningCalibrationReportRecord[] = [];
    for (const report of plan.calibration_reports) {
        createdCalibrationReports.push(await store.createCalibrationReport(report));
    }

    const regressionRun = await insertRegressionEvidenceRun(client, plan.regression_run);

    await store.createAuditEvent({
        tenant_id: input.tenantId,
        learning_cycle_id: null,
        event_type: 'federated_candidate_evidence_generated',
        event_payload: {
            candidate_model_version: plan.candidate_model_version,
            registry_entry_ids: plan.registry_entry_ids,
            benchmark_report_count: createdBenchmarkReports.length,
            calibration_report_count: createdCalibrationReports.length,
            regression_run_id: readText(regressionRun.id),
            promotion_gate_posture: plan.promotion_gate_posture,
            blockers: plan.blockers,
            warnings: plan.warnings,
            generated_by: input.actor ?? 'federation_evidence_generator',
            runtime_evidence_source: runtimeEvidence
                ? readText(asRecord(runtimeEvidence).evidence_source) ?? 'federated_runtime_ledger'
                : 'explicit_or_missing',
        },
    });

    return {
        plan,
        created_benchmark_reports: createdBenchmarkReports,
        created_calibration_reports: createdCalibrationReports,
        regression_run: regressionRun,
    };
}

export async function loadFederatedRuntimeEvidenceForRound(
    client: SupabaseClient,
    input: {
        tenantId: string;
        federationRoundId: string;
        candidateModelVersion?: string | null;
    },
): Promise<FederatedRuntimeEvidenceInput & Record<string, unknown>> {
    const round = await loadRuntimeRound(client, input);
    const updateSubmissions = await loadRuntimeUpdateSubmissions(client, input.federationRoundId);
    const snapshots = await loadRuntimeOutcomeEligibilitySnapshots(client, updateSubmissions);

    return buildFederatedRuntimeEvidenceFromRows({
        candidateModelVersion: input.candidateModelVersion,
        round,
        updateSubmissions,
        outcomeEligibilitySnapshots: snapshots,
    });
}

export function buildFederatedRuntimeEvidenceFromRows(input: {
    candidateModelVersion?: string | null;
    round: FederatedRuntimeRoundEvidenceRow;
    updateSubmissions: FederatedRuntimeUpdateSubmissionRow[];
    outcomeEligibilitySnapshots: FederatedRuntimeOutcomeEligibilitySnapshotRow[];
}): FederatedRuntimeEvidenceInput & Record<string, unknown> {
    const acceptedUpdates = input.updateSubmissions.filter((update) => update.submission_status === 'accepted');
    const quarantinedUpdates = input.updateSubmissions.filter((update) => update.submission_status === 'quarantined');
    const snapshotById = new Map(input.outcomeEligibilitySnapshots.map((snapshot) => [snapshot.id, snapshot]));
    const linkedSnapshots = acceptedUpdates
        .map((update) => update.outcome_eligibility_snapshot_id ? snapshotById.get(update.outcome_eligibility_snapshot_id) : null)
        .filter((snapshot): snapshot is FederatedRuntimeOutcomeEligibilitySnapshotRow => snapshot != null);
    const eligibleSnapshots = linkedSnapshots.filter((snapshot) => snapshot.eligibility_status === 'eligible');
    const outcomeConfirmedRows = sumNumbers(eligibleSnapshots.map((snapshot) => snapshot.outcome_confirmed_rows));
    const provenanceVerifiedRows = sumNumbers(eligibleSnapshots.map((snapshot) => snapshot.provenance_verified_rows));
    const trustScoredRows = sumNumbers(eligibleSnapshots.map((snapshot) => snapshot.trust_scored_rows));
    const averageTrustScore = weightedSnapshotTrustScore(eligibleSnapshots);
    const secureAggregationStatus = resolveRuntimeSecureAggregationStatus(input.round, acceptedUpdates);
    const evaluationSources = runtimeEvaluationSources(input.round);
    const updateSummaries = acceptedUpdates.map((update) => {
        const snapshot = update.outcome_eligibility_snapshot_id
            ? snapshotById.get(update.outcome_eligibility_snapshot_id)
            : null;
        return buildRuntimeUpdateSummary(update, snapshot ?? null);
    });
    const safety = firstRecord(evaluationSources, ['safety', 'safety_evidence', 'safety_report']);
    const adversarial = firstRecord(evaluationSources, ['adversarial', 'adversarial_evidence', 'adversarial_report']);
    const calibration = firstRecord(evaluationSources, ['calibration', 'calibration_evidence', 'calibration_report']);
    const regression = firstRecord(evaluationSources, ['regression', 'regression_evidence', 'regression_report']);
    const sourceHashBundle = {
        federation_round_id: input.round.id,
        federation_key: input.round.federation_key,
        round_key: input.round.round_key,
        candidate_model_version: input.candidateModelVersion ?? null,
        round_aggregate_payload_hash: stableHash(input.round.aggregate_payload),
        candidate_artifact_payload_hash: stableHash(input.round.candidate_artifact_payload),
        accepted_update_payload_hashes: uniqueNonEmpty(acceptedUpdates.map((update) => update.payload_commitment_hash)),
        accepted_update_mask_hashes: uniqueNonEmpty(acceptedUpdates.map((update) => update.mask_commitment_hash)),
        accepted_update_signature_hashes: uniqueNonEmpty(acceptedUpdates.map((update) => update.signature_hash)),
        outcome_source_record_digests: uniqueNonEmpty(eligibleSnapshots.map((snapshot) => snapshot.source_record_digest)),
        eligibility_source_hash_bundle_digest: stableHash(eligibleSnapshots.map((snapshot) => snapshot.source_hash_bundle)),
        runtime_evidence_digest: stableHash({
            round: input.round.id,
            accepted_update_ids: acceptedUpdates.map((update) => update.id).sort(),
            eligibility_snapshot_ids: eligibleSnapshots.map((snapshot) => snapshot.id).sort(),
        }),
    };

    return {
        evidence_source: 'federated_runtime_ledger',
        candidate_model_version: input.candidateModelVersion ?? null,
        federation_round_id: input.round.id,
        federation_key: input.round.federation_key,
        round_key: input.round.round_key,
        round_status: input.round.status,
        participantCount: input.round.participant_count || uniqueNonEmpty(acceptedUpdates.map((update) => update.node_ref || update.participant_ref)).length,
        acceptedUpdateSubmissions: acceptedUpdates.length,
        quarantinedUpdateSubmissions: quarantinedUpdates.length,
        eligibleOutcomeSnapshots: eligibleSnapshots.length,
        outcomeConfirmedRows,
        provenanceVerifiedRows,
        trustScoredRows,
        averageTrustScore,
        secureAggregationStatus,
        externalValidationCount: sumNumbers(eligibleSnapshots.map((snapshot) => snapshot.external_validation_events)),
        safetyCaseCount: readFirstNumberFromSources(evaluationSources, ['safetyCaseCount', 'safety_case_count', 'case_count', 'fixture_count']),
        safetyIncidentCount: readFirstNumberFromSources(evaluationSources, ['safetyIncidentCount', 'safety_incident_count', 'incident_count']) ?? 0,
        hallucinationIncidentCount: readFirstNumberFromSources(evaluationSources, ['hallucinationIncidentCount', 'hallucination_incident_count']) ?? 0,
        falseNegativeIncidentCount: readFirstNumberFromSources(evaluationSources, ['falseNegativeIncidentCount', 'false_negative_incident_count']) ?? 0,
        adversarialCaseCount: readFirstNumberFromSources([adversarial], ['case_count', 'fixture_count', 'sample_count']),
        adversarialPassed: readFirstNumberFromSources([adversarial], ['passed']),
        adversarialFailed: readFirstNumberFromSources([adversarial], ['failed']),
        adversarialScore: readFirstNumberFromSources([adversarial], ['score', 'summary_score']),
        expectedCalibrationError: readFirstNumberFromSources([calibration], ['expected_calibration_error', 'ece', 'ece_score']),
        brierScore: readFirstNumberFromSources([calibration], ['brier_score', 'brier']),
        regressionFixtureCount: readFirstNumberFromSources([regression], ['fixture_count']),
        regressionFailedCount: readFirstNumberFromSources([regression], ['failed']),
        regressionPassedCount: readFirstNumberFromSources([regression], ['passed']),
        regressionTotalReplayed: readFirstNumberFromSources([regression], ['total_replayed']),
        regressionRate: readFirstNumberFromSources([regression], ['regression_rate']),
        regressionThresholdPct: readFirstNumberFromSources([regression], ['threshold_pct']),
        candidateBlocked: readFirstBoolean(regression, ['blocked', 'candidate_blocked']),
        safety,
        adversarial,
        calibration,
        regression,
        updateSummaries,
        sourceHashBundle,
        sourceTableCounts: {
            federated_update_submissions: input.updateSubmissions.length,
            accepted_update_submissions: acceptedUpdates.length,
            federated_outcome_eligibility_snapshots: input.outcomeEligibilitySnapshots.length,
            eligible_outcome_eligibility_snapshots: eligibleSnapshots.length,
        },
    };
}

async function loadRuntimeRound(
    client: SupabaseClient,
    input: {
        tenantId: string;
        federationRoundId: string;
    },
): Promise<FederatedRuntimeRoundEvidenceRow> {
    const C = FEDERATION_ROUNDS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_ROUNDS.TABLE)
        .select('*')
        .eq(C.id, input.federationRoundId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load federation round runtime evidence: ${error.message}`);
    }
    if (!data) {
        throw new Error('Federation round not found for candidate evidence generation.');
    }

    const round = mapRuntimeRound(asRecord(data));
    if (round.coordinator_tenant_id && round.coordinator_tenant_id !== input.tenantId) {
        throw new Error('Only the federation coordinator tenant can generate candidate runtime evidence for this round.');
    }
    return round;
}

async function loadRuntimeUpdateSubmissions(
    client: SupabaseClient,
    federationRoundId: string,
): Promise<FederatedRuntimeUpdateSubmissionRow[]> {
    const C = FEDERATED_UPDATE_SUBMISSIONS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_UPDATE_SUBMISSIONS.TABLE)
        .select('*')
        .eq(C.federation_round_id, federationRoundId);

    if (error) {
        throw new Error(`Failed to load federated update runtime evidence: ${error.message}`);
    }
    return (data ?? []).map((row) => mapRuntimeUpdateSubmission(asRecord(row)));
}

async function loadRuntimeOutcomeEligibilitySnapshots(
    client: SupabaseClient,
    updateSubmissions: FederatedRuntimeUpdateSubmissionRow[],
): Promise<FederatedRuntimeOutcomeEligibilitySnapshotRow[]> {
    const ids = uniqueNonEmpty(updateSubmissions.map((submission) => submission.outcome_eligibility_snapshot_id));
    if (ids.length === 0) return [];

    const C = FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.COLUMNS;
    const { data, error } = await client
        .from(FEDERATED_OUTCOME_ELIGIBILITY_SNAPSHOTS.TABLE)
        .select('*')
        .in(C.id, ids);

    if (error) {
        throw new Error(`Failed to load federated outcome eligibility runtime evidence: ${error.message}`);
    }
    return (data ?? []).map((row) => mapRuntimeOutcomeEligibilitySnapshot(asRecord(row)));
}

function buildRuntimeUpdateSummary(
    update: FederatedRuntimeUpdateSubmissionRow,
    snapshot: FederatedRuntimeOutcomeEligibilitySnapshotRow | null,
): FederatedRuntimeDeltaEvidence & Record<string, unknown> {
    const metricSummary = mergeRecords(
        asRecord(update.masked_update_summary.metric_summary ?? update.masked_update_summary.metricSummary),
        asRecord(update.public_summary.metric_summary ?? update.public_summary.metricSummary),
        asRecord(update.evidence.metric_summary ?? update.evidence.metricSummary),
    );
    const summarySources = [
        metricSummary,
        update.masked_update_summary,
        update.public_summary,
        update.evidence,
    ];

    return {
        updateSubmissionId: update.id,
        update_submission_id: update.id,
        nodeRef: update.node_ref,
        node_ref: update.node_ref,
        participantRef: update.participant_ref,
        participant_ref: update.participant_ref,
        contributionRole: update.contribution_role,
        contribution_role: update.contribution_role,
        taskType: taskTypeForContributionRole(update.contribution_role),
        task_type: taskTypeForContributionRole(update.contribution_role),
        submissionStatus: update.submission_status,
        submission_status: update.submission_status,
        outcomeEligibilitySnapshotId: update.outcome_eligibility_snapshot_id,
        outcome_eligibility_snapshot_id: update.outcome_eligibility_snapshot_id,
        eligibleRecordCount: snapshot?.outcome_confirmed_rows ?? readFirstNumberFromSources(summarySources, ['eligibleRecordCount', 'eligible_record_count']),
        eligible_record_count: snapshot?.outcome_confirmed_rows ?? readFirstNumberFromSources(summarySources, ['eligibleRecordCount', 'eligible_record_count']),
        outcomeConfirmedRows: snapshot?.outcome_confirmed_rows ?? readFirstNumberFromSources(summarySources, ['outcomeConfirmedRows', 'outcome_confirmed_rows']),
        outcome_confirmed_rows: snapshot?.outcome_confirmed_rows ?? readFirstNumberFromSources(summarySources, ['outcomeConfirmedRows', 'outcome_confirmed_rows']),
        provenanceVerifiedRows: snapshot?.provenance_verified_rows ?? readFirstNumberFromSources(summarySources, ['provenanceVerifiedRows', 'provenance_verified_rows']),
        provenance_verified_rows: snapshot?.provenance_verified_rows ?? readFirstNumberFromSources(summarySources, ['provenanceVerifiedRows', 'provenance_verified_rows']),
        trustScoredRows: snapshot?.trust_scored_rows ?? readFirstNumberFromSources(summarySources, ['trustScoredRows', 'trust_scored_rows']),
        trust_scored_rows: snapshot?.trust_scored_rows ?? readFirstNumberFromSources(summarySources, ['trustScoredRows', 'trust_scored_rows']),
        averageTrustScore: snapshot?.average_trust_score ?? readFirstNumberFromSources(summarySources, ['averageTrustScore', 'average_trust_score']),
        average_trust_score: snapshot?.average_trust_score ?? readFirstNumberFromSources(summarySources, ['averageTrustScore', 'average_trust_score']),
        payloadCommitmentHash: update.payload_commitment_hash,
        payload_commitment_hash: update.payload_commitment_hash,
        maskCommitmentHash: update.mask_commitment_hash,
        mask_commitment_hash: update.mask_commitment_hash,
        metricSummary,
        metric_summary: metricSummary,
        publicSummary: update.public_summary,
        public_summary: update.public_summary,
        evidence: {
            evidence_digest: stableHash(update.evidence),
            source_record_digest: snapshot?.source_record_digest ?? null,
            outcome_eligibility_status: snapshot?.eligibility_status ?? null,
            raw_clinical_records_included: false,
            raw_model_delta_included: false,
        },
    };
}

function runtimeEvaluationSources(round: FederatedRuntimeRoundEvidenceRow): Record<string, unknown>[] {
    const aggregate = round.aggregate_payload;
    const artifact = round.candidate_artifact_payload;
    const acceptedAggregation = asRecord(aggregate.accepted_update_aggregation);
    return [
        aggregate,
        asRecord(aggregate.federated_runtime_evidence),
        asRecord(aggregate.runtime_evidence),
        asRecord(aggregate.evaluation),
        asRecord(aggregate.evaluation_packet),
        acceptedAggregation,
        asRecord(acceptedAggregation.evidence),
        artifact,
        asRecord(artifact.federated_runtime_evidence),
        asRecord(artifact.runtime_evidence),
        asRecord(artifact.evaluation),
        asRecord(artifact.evaluation_packet),
    ];
}

function firstRecord(sources: Record<string, unknown>[], keys: string[]): Record<string, unknown> {
    for (const source of sources) {
        for (const key of keys) {
            const nested = asRecord(source[key]);
            if (Object.keys(nested).length > 0) return nested;
        }
    }
    return {};
}

function readFirstNumberFromSources(sources: Record<string, unknown>[], keys: string[]): number | null {
    for (const source of sources) {
        const direct = readFirstNumber(source, keys);
        if (direct != null) return direct;
        for (const nestedKey of ['metrics', 'summary', 'results']) {
            const nested = asRecord(source[nestedKey]);
            const nestedValue = readFirstNumber(nested, keys);
            if (nestedValue != null) return nestedValue;
        }
    }
    return null;
}

function resolveRuntimeSecureAggregationStatus(
    round: FederatedRuntimeRoundEvidenceRow,
    acceptedUpdates: FederatedRuntimeUpdateSubmissionRow[],
): string {
    const aggregate = round.aggregate_payload;
    const explicitStatus = readText(asRecord(aggregate.secure_aggregation).status)
        ?? readText(asRecord(aggregate.accepted_update_aggregation).secure_aggregation_status)
        ?? readText(asRecord(asRecord(aggregate.accepted_update_aggregation).secure_aggregation).status);
    if (explicitStatus) return explicitStatus;
    if (
        acceptedUpdates.length > 0
        && acceptedUpdates.every((update) => isSha256(update.payload_commitment_hash) && isSha256(update.mask_commitment_hash))
    ) {
        return 'live_node_commitments_ready';
    }
    return 'missing';
}

function taskTypeForContributionRole(role: string | null | undefined): string {
    if (role === 'severity') return 'severity';
    if (role === 'support') return 'hybrid';
    return 'diagnosis';
}

function weightedSnapshotTrustScore(snapshots: FederatedRuntimeOutcomeEligibilitySnapshotRow[]): number {
    const totalRows = snapshots.reduce((sum, snapshot) => sum + Math.max(0, snapshot.trust_scored_rows), 0);
    if (totalRows <= 0) return 0;
    return snapshots.reduce((sum, snapshot) => sum + snapshot.average_trust_score * Math.max(0, snapshot.trust_scored_rows), 0) / totalRows;
}

function mapRuntimeRound(row: Record<string, unknown>): FederatedRuntimeRoundEvidenceRow {
    return {
        id: String(row.id),
        federation_key: readText(row.federation_key) ?? '',
        coordinator_tenant_id: readText(row.coordinator_tenant_id) ?? '',
        round_key: readText(row.round_key) ?? '',
        status: readText(row.status) ?? 'unknown',
        participant_count: readNumber(row.participant_count) ?? 0,
        aggregate_payload: asRecord(row.aggregate_payload),
        candidate_artifact_payload: asRecord(row.candidate_artifact_payload),
        completed_at: readText(row.completed_at),
    };
}

function mapRuntimeUpdateSubmission(row: Record<string, unknown>): FederatedRuntimeUpdateSubmissionRow {
    return {
        id: String(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        federation_round_id: readText(row.federation_round_id) ?? '',
        outcome_eligibility_snapshot_id: readText(row.outcome_eligibility_snapshot_id),
        federation_key: readText(row.federation_key) ?? '',
        round_key: readText(row.round_key) ?? '',
        node_ref: readText(row.node_ref) ?? '',
        partner_ref: readText(row.partner_ref) ?? '',
        participant_ref: readText(row.participant_ref) ?? '',
        contribution_role: readText(row.contribution_role) ?? 'diagnosis',
        submission_status: readText(row.submission_status) ?? 'submitted',
        payload_commitment_hash: readText(row.payload_commitment_hash),
        mask_commitment_hash: readText(row.mask_commitment_hash),
        signed_payload_hash: readText(row.signed_payload_hash),
        signature_hash: readText(row.signature_hash),
        masked_update_summary: asRecord(row.masked_update_summary),
        public_summary: asRecord(row.public_summary),
        evidence: asRecord(row.evidence),
        observed_at: readText(row.observed_at),
        created_at: readText(row.created_at),
    };
}

function mapRuntimeOutcomeEligibilitySnapshot(row: Record<string, unknown>): FederatedRuntimeOutcomeEligibilitySnapshotRow {
    return {
        id: String(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        eligibility_status: readText(row.eligibility_status),
        outcome_confirmed_rows: readNumber(row.outcome_confirmed_rows) ?? 0,
        provenance_verified_rows: readNumber(row.provenance_verified_rows) ?? 0,
        trust_scored_rows: readNumber(row.trust_scored_rows) ?? 0,
        average_trust_score: readNumber(row.average_trust_score) ?? 0,
        external_validation_events: readNumber(row.external_validation_events) ?? 0,
        source_record_digest: readText(row.source_record_digest),
        source_hash_bundle: asRecord(row.source_hash_bundle),
        evidence: asRecord(row.evidence),
    };
}

export function buildFederatedCandidateEvidencePlan(
    input: FederatedCandidateEvidenceInput,
): FederatedCandidateEvidencePlan {
    const now = input.now ?? new Date().toISOString();
    const derivedEvidence = input.runtimeEvidence
        ? deriveFederatedCandidateEvidenceFromRuntime({
            candidateModelVersion: input.candidateModelVersion,
            registryEntries: input.registryEntries,
            runtimeEvidence: input.runtimeEvidence,
            now,
        })
        : null;
    const benchmarkEvidence = mergeEvidence(derivedEvidence?.benchmarkEvidence, input.benchmarkEvidence);
    const calibrationEvidence = mergeEvidence(derivedEvidence?.calibrationEvidence, input.calibrationEvidence);
    const regressionEvidence = mergeEvidence(derivedEvidence?.regressionEvidence, input.regressionEvidence);
    const operatorEvidence = mergeEvidence(derivedEvidence?.operatorEvidence, input.operatorEvidence);
    const blockers = new Set<string>();
    const warnings = new Set<string>(derivedEvidence?.warnings ?? []);
    const benchmarkReports: Array<Omit<LearningBenchmarkReportRecord, 'id' | 'created_at'>> = [];
    const calibrationReports: Array<Omit<LearningCalibrationReportRecord, 'id' | 'created_at'>> = [];

    if (input.registryEntries.length === 0) {
        blockers.add('candidate_registry_entries_missing');
    }

    for (const entry of input.registryEntries) {
        const taskReport = buildBenchmarkReport({
            entry,
            kind: 'task',
            evidence: selectBenchmarkEvidence(benchmarkEvidence, ['tasks', entry.task_type, 'task']),
            now,
        });
        benchmarkReports.push(taskReport);
        collectReportBlockers(taskReport, blockers);

        const safetyReport = buildBenchmarkReport({
            entry,
            kind: 'safety',
            evidence: selectBenchmarkEvidence(benchmarkEvidence, ['safety']),
            now,
        });
        benchmarkReports.push(safetyReport);
        collectReportBlockers(safetyReport, blockers);

        const adversarialReport = buildBenchmarkReport({
            entry,
            kind: 'adversarial',
            evidence: selectBenchmarkEvidence(benchmarkEvidence, ['adversarial', 'adversarial_safety']),
            now,
        });
        benchmarkReports.push(adversarialReport);
        collectReportBlockers(adversarialReport, blockers);

        if (entry.task_type === 'diagnosis' || entry.task_type === 'hybrid') {
            const calibrationReport = buildCalibrationReport({
                entry,
                evidence: selectCalibrationEvidence(calibrationEvidence, entry.task_type),
                now,
            });
            calibrationReports.push(calibrationReport);
            const status = readText(asRecord(asRecord(calibrationReport.report_payload).recommendation).status);
            if (status !== 'pass') {
                blockers.add(`calibration_${entry.task_type}_not_passing`);
            }
        }
    }

    const regressionRun = buildRegressionRunDraft({
        candidateModelVersion: input.candidateModelVersion,
        tenantId: input.registryEntries[0]?.tenant_id ?? 'unknown_tenant',
        evidence: regressionEvidence,
        operatorEvidence,
        actor: input.actor,
        now,
    });
    for (const blocker of readStringArray(regressionRun.results.blockers)) {
        blockers.add(blocker);
    }
    if (readNumber(regressionRun.results.fixture_count) === 0 && readNumber(regressionRun.results.total_replayed) === 0) {
        warnings.add('Regression evidence was recorded as a failing preflight because no real fixture or replay run was supplied.');
    }

    const blockerList = Array.from(blockers).sort();
    return {
        candidate_model_version: input.candidateModelVersion,
        registry_entry_ids: input.registryEntries.map((entry) => entry.id),
        benchmark_reports: benchmarkReports,
        calibration_reports: calibrationReports,
        regression_run: regressionRun,
        blockers: blockerList,
        warnings: Array.from(warnings).sort(),
        promotion_gate_posture: blockerList.length === 0 ? 'gate_ready' : 'blocked_pending_runtime_evidence',
        automatic_champion_promotion_allowed: false,
        manual_promotion_route: '/api/learning/promote',
    };
}

export function deriveFederatedCandidateEvidenceFromRuntime(input: {
    candidateModelVersion: string;
    registryEntries: ModelRegistryEntryRecord[];
    runtimeEvidence: FederatedRuntimeEvidenceInput | Record<string, unknown>;
    now?: string;
}): FederatedDerivedCandidateEvidence {
    const runtime = asRecord(input.runtimeEvidence);
    const now = input.now ?? new Date().toISOString();
    const updateSummaries = readUpdateSummaries(runtime);
    const acceptedUpdates = updateSummaries.filter((update) => {
        const status = readText(update.submissionStatus) ?? readText(update.submission_status);
        return !status || status === 'accepted' || status === 'submitted';
    });
    const taskTypes = uniqueNonEmpty(input.registryEntries.map((entry) => entry.task_type));
    const minimumParticipants = readFirstNumber(runtime, ['minimumParticipants', 'minimum_participants']) ?? 2;
    const minimumAcceptedUpdates = readFirstNumber(runtime, ['minimumAcceptedUpdates', 'minimum_accepted_updates']) ?? minimumParticipants;
    const minimumOutcomeRows = readFirstNumber(runtime, ['minimumOutcomeConfirmedRows', 'minimum_outcome_confirmed_rows']) ?? 20;
    const minimumTrustScore = readFirstNumber(runtime, ['minimumAverageTrustScore', 'minimum_average_trust_score']) ?? 0.7;
    const participantCount = readFirstNumber(runtime, ['participantCount', 'participant_count'])
        ?? uniqueNonEmpty(acceptedUpdates.map((update) => readText(update.nodeRef) ?? readText(update.node_ref) ?? readText(update.participantRef) ?? readText(update.participant_ref))).length;
    const acceptedUpdateSubmissions = readFirstNumber(runtime, ['acceptedUpdateSubmissions', 'accepted_update_submissions', 'accepted_updates'])
        ?? acceptedUpdates.length;
    const quarantinedUpdateSubmissions = readFirstNumber(runtime, ['quarantinedUpdateSubmissions', 'quarantined_update_submissions']) ?? 0;
    const eligibleOutcomeSnapshots = readFirstNumber(runtime, ['eligibleOutcomeSnapshots', 'eligible_outcome_snapshots'])
        ?? uniqueNonEmpty(acceptedUpdates.map((update) => readText(update.outcomeEligibilitySnapshotId) ?? readText(update.outcome_eligibility_snapshot_id))).length;
    const outcomeConfirmedRows = readFirstNumber(runtime, ['outcomeConfirmedRows', 'outcome_confirmed_rows'])
        ?? sumNumbers(acceptedUpdates.map((update) => readFirstNumber(update, ['outcomeConfirmedRows', 'outcome_confirmed_rows', 'eligibleRecordCount', 'eligible_record_count'])));
    const provenanceVerifiedRows = readFirstNumber(runtime, ['provenanceVerifiedRows', 'provenance_verified_rows'])
        ?? sumNumbers(acceptedUpdates.map((update) => readFirstNumber(update, ['provenanceVerifiedRows', 'provenance_verified_rows', 'eligibleRecordCount', 'eligible_record_count'])));
    const trustScoredRows = readFirstNumber(runtime, ['trustScoredRows', 'trust_scored_rows'])
        ?? sumNumbers(acceptedUpdates.map((update) => readFirstNumber(update, ['trustScoredRows', 'trust_scored_rows', 'eligibleRecordCount', 'eligible_record_count'])));
    const averageTrustScore = readFirstNumber(runtime, ['averageTrustScore', 'average_trust_score'])
        ?? weightedTrustScore(acceptedUpdates);
    const secureAggregationStatus = readText(runtime.secureAggregationStatus)
        ?? readText(runtime.secure_aggregation_status)
        ?? 'missing';
    const secureAggregationReady = secureAggregationStatus === 'secure_aggregation_ready'
        || secureAggregationStatus === 'live_node_commitments_ready'
        || secureAggregationStatus === 'ready';
    const taskMetrics = {
        participant_count: participantCount,
        accepted_update_submissions: acceptedUpdateSubmissions,
        quarantined_update_submissions: quarantinedUpdateSubmissions,
        eligible_outcome_snapshots: eligibleOutcomeSnapshots,
        outcome_confirmed_rows: outcomeConfirmedRows,
        provenance_verified_rows: provenanceVerifiedRows,
        trust_scored_rows: trustScoredRows,
        average_trust_score: roundMetric(averageTrustScore),
        secure_aggregation_status: secureAggregationStatus,
        minimum_participants: minimumParticipants,
        minimum_accepted_updates: minimumAcceptedUpdates,
        minimum_outcome_confirmed_rows: minimumOutcomeRows,
        minimum_average_trust_score: minimumTrustScore,
    };

    const taskEvidenceByType = Object.fromEntries(taskTypes.map((taskType) => {
        const roleUpdates = acceptedUpdates.filter((update) => updateMatchesTask(update, taskType));
        const taskOutcomeRows = readFirstNumber(runtime, [`${taskType}_outcome_confirmed_rows`])
            ?? sumNumbers(roleUpdates.map((update) => readFirstNumber(update, ['outcomeConfirmedRows', 'outcome_confirmed_rows', 'eligibleRecordCount', 'eligible_record_count'])))
            ?? outcomeConfirmedRows;
        const taskAcceptedUpdates = roleUpdates.length > 0 ? roleUpdates.length : acceptedUpdateSubmissions;
        const localAccuracy = meanMetric(roleUpdates, ['accuracy', 'candidate_accuracy', 'validation_accuracy']);
        const score = weightedMean([
            clamp01((localAccuracy ?? averageTrustScore) ?? 0),
            clamp01((averageTrustScore ?? 0) / minimumTrustScore),
            clamp01(taskOutcomeRows / minimumOutcomeRows),
            clamp01(taskAcceptedUpdates / minimumAcceptedUpdates),
            secureAggregationReady ? 1 : 0,
        ]);
        const pass = participantCount >= minimumParticipants
            && taskAcceptedUpdates >= minimumAcceptedUpdates
            && taskOutcomeRows >= minimumOutcomeRows
            && provenanceVerifiedRows >= minimumOutcomeRows
            && trustScoredRows >= minimumOutcomeRows
            && averageTrustScore >= minimumTrustScore
            && secureAggregationReady
            && quarantinedUpdateSubmissions === 0;

        return [taskType, {
            pass,
            case_count: taskOutcomeRows,
            minimum_case_count: minimumOutcomeRows,
            score,
            runtime_metrics: taskMetrics,
            local_metric_summary: {
                accuracy: localAccuracy,
                update_count: taskAcceptedUpdates,
            },
            evidence_digest: stableHash({ taskType, taskMetrics, roleUpdates }),
            generated_at: now,
        }];
    }));

    const safetyCaseCount = readFirstNumber(runtime, ['safetyCaseCount', 'safety_case_count'])
        ?? readFirstNumber(asRecord(runtime.safety), ['case_count', 'fixture_count', 'sample_count']);
    const safetyIncidentCount = readFirstNumber(runtime, ['safetyIncidentCount', 'safety_incident_count'])
        ?? readFirstNumber(asRecord(runtime.safety), ['incident_count'])
        ?? 0;
    const hallucinationIncidentCount = readFirstNumber(runtime, ['hallucinationIncidentCount', 'hallucination_incident_count'])
        ?? readFirstNumber(asRecord(runtime.safety), ['hallucination_incident_count'])
        ?? 0;
    const falseNegativeIncidentCount = readFirstNumber(runtime, ['falseNegativeIncidentCount', 'false_negative_incident_count'])
        ?? readFirstNumber(asRecord(runtime.safety), ['false_negative_incident_count'])
        ?? 0;
    const safetyTotalIncidents = safetyIncidentCount + hallucinationIncidentCount + falseNegativeIncidentCount;
    const safetyScore = safetyCaseCount && safetyCaseCount > 0
        ? clamp01(1 - safetyTotalIncidents / safetyCaseCount)
        : 0;
    const safetyEvidence = {
        pass: safetyCaseCount != null && safetyCaseCount > 0 && safetyTotalIncidents === 0,
        case_count: safetyCaseCount ?? 0,
        minimum_case_count: 1,
        score: safetyScore,
        safety_incident_count: safetyIncidentCount,
        hallucination_incident_count: hallucinationIncidentCount,
        false_negative_incident_count: falseNegativeIncidentCount,
        evidence_digest: stableHash({ safety: runtime.safety, safetyCaseCount, safetyTotalIncidents }),
        generated_at: now,
    };

    const adversarial = asRecord(runtime.adversarial);
    const adversarialCaseCount = readFirstNumber(runtime, ['adversarialCaseCount', 'adversarial_case_count'])
        ?? readFirstNumber(adversarial, ['case_count', 'fixture_count', 'sample_count'])
        ?? 0;
    const adversarialFailed = readFirstNumber(runtime, ['adversarialFailed', 'adversarial_failed'])
        ?? readFirstNumber(adversarial, ['failed'])
        ?? 0;
    const adversarialPassed = readFirstNumber(runtime, ['adversarialPassed', 'adversarial_passed'])
        ?? readFirstNumber(adversarial, ['passed'])
        ?? Math.max(0, adversarialCaseCount - adversarialFailed);
    const adversarialScore = clamp01(readFirstNumber(runtime, ['adversarialScore', 'adversarial_score'])
        ?? readFirstNumber(adversarial, ['score', 'summary_score'])
        ?? (adversarialCaseCount > 0 ? adversarialPassed / adversarialCaseCount : 0));
    const adversarialEvidence = {
        pass: adversarialCaseCount > 0 && adversarialFailed === 0,
        case_count: adversarialCaseCount,
        minimum_case_count: 1,
        passed: adversarialPassed,
        failed: adversarialFailed,
        score: adversarialScore,
        evidence_digest: stableHash({ adversarial, adversarialCaseCount, adversarialFailed }),
        generated_at: now,
    };

    const calibration = asRecord(runtime.calibration);
    const expectedCalibrationError = readFirstNumber(runtime, ['expectedCalibrationError', 'expected_calibration_error', 'ece'])
        ?? readFirstNumber(calibration, ['expected_calibration_error', 'ece', 'ece_score'])
        ?? meanMetric(acceptedUpdates, ['expected_calibration_error', 'ece', 'ece_score']);
    const brierScore = readFirstNumber(runtime, ['brierScore', 'brier_score'])
        ?? readFirstNumber(calibration, ['brier_score', 'brier'])
        ?? meanMetric(acceptedUpdates, ['brier_score', 'brier']);
    const calibrationEvidence = {
        row_count: readFirstNumber(calibration, ['row_count', 'case_count', 'sample_count']) ?? outcomeConfirmedRows,
        expected_calibration_error: expectedCalibrationError,
        brier_score: brierScore,
        status: expectedCalibrationError != null && expectedCalibrationError <= 0.12 ? 'pass' : 'insufficient',
        evidence_digest: stableHash({ calibration, expectedCalibrationError, brierScore }),
        generated_at: now,
    };

    const regression = asRecord(runtime.regression);
    const regressionFixtureCount = readFirstNumber(runtime, ['regressionFixtureCount', 'regression_fixture_count'])
        ?? readFirstNumber(regression, ['fixture_count'])
        ?? 0;
    const regressionFailed = readFirstNumber(runtime, ['regressionFailedCount', 'regression_failed_count'])
        ?? readFirstNumber(regression, ['failed'])
        ?? 0;
    const regressionPassed = readFirstNumber(runtime, ['regressionPassedCount', 'regression_passed_count'])
        ?? readFirstNumber(regression, ['passed'])
        ?? Math.max(0, regressionFixtureCount - regressionFailed);
    const regressionTotalReplayed = readFirstNumber(runtime, ['regressionTotalReplayed', 'regression_total_replayed'])
        ?? readFirstNumber(regression, ['total_replayed'])
        ?? 0;
    const regressionEvidence = {
        fixture_count: regressionFixtureCount,
        passed: regressionPassed,
        failed: regressionFailed,
        total_replayed: regressionTotalReplayed,
        regression_rate: readFirstNumber(runtime, ['regressionRate', 'regression_rate']) ?? readFirstNumber(regression, ['regression_rate']),
        threshold_pct: readFirstNumber(runtime, ['regressionThresholdPct', 'regression_threshold_pct']) ?? readFirstNumber(regression, ['threshold_pct']) ?? 10,
        blocked: readFirstBoolean(runtime, ['candidateBlocked', 'candidate_blocked'])
            ?? readFirstBoolean(regression, ['blocked', 'candidate_blocked'])
            ?? false,
        evidence_digest: stableHash({ regression, regressionFixtureCount, regressionFailed, regressionTotalReplayed }),
        generated_at: now,
    };

    const warnings = [
        ...(safetyCaseCount == null || safetyCaseCount <= 0 ? ['derived_runtime_safety_evidence_missing'] : []),
        ...(adversarialCaseCount <= 0 ? ['derived_runtime_adversarial_evidence_missing'] : []),
        ...(expectedCalibrationError == null ? ['derived_runtime_calibration_ece_missing'] : []),
        ...(regressionFixtureCount <= 0 && regressionTotalReplayed <= 0 ? ['derived_runtime_regression_evidence_missing'] : []),
    ];

    return {
        benchmarkEvidence: {
            tasks: taskEvidenceByType,
            task: taskTypes.length === 1 ? taskEvidenceByType[taskTypes[0]] : undefined,
            safety: safetyEvidence,
            adversarial: adversarialEvidence,
        },
        calibrationEvidence,
        regressionEvidence,
        operatorEvidence: {
            evidence_source: 'federated_runtime_evidence_derivation',
            candidate_model_version: input.candidateModelVersion,
            generated_at: now,
            source_hash_bundle: asRecord(runtime.sourceHashBundle ?? runtime.source_hash_bundle),
            runtime_metrics: taskMetrics,
            evidence_digest: stableHash(runtime),
            research_basis: [
                'federated_averaging_round_local_updates',
                'secure_aggregation_commitment_only_updates',
                'federated_benchmark_heterogeneity_and_realistic_split_evaluation',
                'calibration_and_post_deployment_regression_gating',
            ],
        },
        warnings,
    };
}

function buildBenchmarkReport(input: {
    entry: ModelRegistryEntryRecord;
    kind: BenchmarkKind;
    evidence: Record<string, unknown>;
    now: string;
}): Omit<LearningBenchmarkReportRecord, 'id' | 'created_at'> {
    const family = benchmarkFamily(input.kind, input.entry.task_type);
    const minimumCaseCount = readNumber(input.evidence.minimum_case_count) ?? 1;
    const caseCount = readNumber(input.evidence.case_count)
        ?? readNumber(input.evidence.fixture_count)
        ?? readNumber(input.evidence.sample_count)
        ?? readNumber(input.evidence.total)
        ?? 0;
    const passClaim = readBoolean(input.evidence.pass) ?? readBoolean(input.evidence.passed);
    const score = clamp01(readNumber(input.evidence.score) ?? readNumber(input.evidence.summary_score) ?? (passClaim === true ? 1 : 0));
    const blockers = new Set<string>();

    if (passClaim !== true) {
        blockers.add(`${family}_missing_or_failed`);
    }
    if (caseCount < minimumCaseCount) {
        blockers.add(`${family}_case_count_below_minimum`);
    }

    const pass = blockers.size === 0;
    return {
        tenant_id: input.entry.tenant_id,
        learning_cycle_id: null,
        model_registry_id: input.entry.id,
        benchmark_family: family,
        task_type: input.kind === 'task' ? input.entry.task_type : 'safety',
        report_payload: {
            family,
            task_type: input.entry.task_type,
            benchmark_kind: input.kind,
            pass,
            case_count: caseCount,
            minimum_case_count: minimumCaseCount,
            score,
            blockers: Array.from(blockers).sort(),
            evidence_digest: stableHash(input.evidence),
            evidence_summary: publicEvidenceSummary(input.evidence),
            generated_at: input.now,
            value_capture_layer: 'outcome_confirmed_provenance_verified_federated_evidence',
        },
        summary_score: score,
        pass_status: pass ? 'pass' : 'fail',
    };
}

function buildCalibrationReport(input: {
    entry: ModelRegistryEntryRecord;
    evidence: Record<string, unknown>;
    now: string;
}): Omit<LearningCalibrationReportRecord, 'id' | 'created_at'> {
    const rowCount = readNumber(input.evidence.row_count)
        ?? readNumber(input.evidence.case_count)
        ?? readNumber(input.evidence.sample_count)
        ?? 0;
    const ece = readNumber(input.evidence.expected_calibration_error)
        ?? readNumber(input.evidence.ece)
        ?? readNumber(input.evidence.ece_score);
    const brier = readNumber(input.evidence.brier_score) ?? readNumber(input.evidence.brier);
    const claimedStatus = readText(input.evidence.status);
    const status = rowCount > 0 && ece != null && ece <= 0.12 && (claimedStatus == null || claimedStatus === 'pass')
        ? 'pass'
        : rowCount === 0 || ece == null
            ? 'insufficient_data'
            : 'needs_recalibration';
    const reasons = status === 'pass'
        ? []
        : [
            ...(rowCount === 0 ? ['No calibration rows were supplied for this federated candidate.'] : []),
            ...(ece == null ? ['Expected calibration error was not supplied.'] : []),
            ...(ece != null && ece > 0.12 ? [`Expected calibration error ${ece} is above the 0.12 promotion threshold.`] : []),
            ...(claimedStatus != null && claimedStatus !== 'pass' ? [`External calibration status is ${claimedStatus}.`] : []),
        ];

    return {
        tenant_id: input.entry.tenant_id,
        learning_cycle_id: null,
        model_registry_id: input.entry.id,
        task_type: input.entry.task_type,
        report_payload: {
            task_type: input.entry.task_type,
            row_count: rowCount,
            expected_calibration_error: ece,
            brier_score: brier,
            evidence_digest: stableHash(input.evidence),
            evidence_summary: publicEvidenceSummary(input.evidence),
            generated_at: input.now,
            recommendation: {
                status,
                reasons,
                recommended_method: status === 'needs_recalibration' ? 'isotonic_regression' : 'none',
            },
        },
        brier_score: brier ?? null,
        ece_score: ece ?? null,
    };
}

function buildRegressionRunDraft(input: {
    tenantId: string;
    candidateModelVersion: string;
    evidence?: Record<string, unknown>;
    operatorEvidence?: Record<string, unknown>;
    actor?: string | null;
    now: string;
}): FederatedRegressionRunDraft {
    const evidence = asRecord(input.evidence);
    const fixtureCount = readNumber(evidence.fixture_count) ?? 0;
    const failed = readNumber(evidence.failed) ?? 0;
    const passed = readNumber(evidence.passed) ?? Math.max(0, fixtureCount - failed);
    const totalReplayed = readNumber(evidence.total_replayed) ?? 0;
    const regressionRate = readNumber(evidence.regression_rate);
    const thresholdPct = readNumber(evidence.threshold_pct) ?? 10;
    const explicitBlocked = readBoolean(evidence.blocked) === true || readBoolean(evidence.candidate_blocked) === true;
    const blockers = new Set<string>();

    if (fixtureCount <= 0 && totalReplayed <= 0) {
        blockers.add('regression_runtime_evidence_missing');
    }
    if (failed > 0) {
        blockers.add('regression_fixture_failures_present');
    }
    if (totalReplayed > 0 && regressionRate != null && regressionRate > thresholdPct) {
        blockers.add('regression_replay_rate_above_threshold');
    }
    if (explicitBlocked) {
        blockers.add('regression_runner_blocked_candidate');
    }

    const total = fixtureCount > 0 ? fixtureCount : totalReplayed;
    const results = {
        candidate_model: input.candidateModelVersion,
        candidate_model_version: input.candidateModelVersion,
        fixture_count: fixtureCount,
        passed,
        failed,
        total_replayed: totalReplayed,
        regression_rate: regressionRate,
        threshold_pct: thresholdPct,
        blocked: explicitBlocked,
        candidate_blocked: explicitBlocked,
        blockers: Array.from(blockers).sort(),
        evidence_digest: stableHash(evidence),
        evidence_summary: publicEvidenceSummary(evidence),
        generated_by: input.actor ?? 'federation_evidence_generator',
        generated_at: input.now,
        operator_evidence_digest: stableHash(asRecord(input.operatorEvidence)),
    };

    return {
        tenant_id: input.tenantId,
        scenario_name: `Federated promotion regression: ${input.candidateModelVersion}`,
        mode: 'regression',
        status: 'completed',
        config: {
            candidate_model: input.candidateModelVersion,
            candidate_model_version: input.candidateModelVersion,
            evidence_source: 'federated_candidate_evidence_generator',
            requires_real_fixture_or_replay_evidence: true,
        },
        summary: results,
        results,
        completed: total,
        total,
        candidate_model_version: input.candidateModelVersion,
        started_at: input.now,
        completed_at: input.now,
        created_by: input.actor ?? 'federation_evidence_generator',
    };
}

async function insertRegressionEvidenceRun(
    client: SupabaseClient,
    draft: FederatedRegressionRunDraft,
): Promise<Record<string, unknown>> {
    let payload: Record<string, unknown> = { ...draft };
    let result = await client
        .from('simulations')
        .insert(payload)
        .select('*')
        .single();

    while (result.error) {
        const missingColumn = resolveMissingSimulationColumn(result.error, payload);
        if (!missingColumn) break;
        delete payload[missingColumn];
        result = await client
            .from('simulations')
            .insert(payload)
            .select('*')
            .single();
    }

    if (result.error || !result.data) {
        throw new Error(`Failed to create federated regression evidence run: ${result.error?.message ?? 'Unknown error'}`);
    }

    return asRecord(result.data);
}

function resolveMissingSimulationColumn(
    error: { message?: string | null } | null | undefined,
    payload: Record<string, unknown>,
): string | null {
    for (const column of [
        'candidate_model_version',
        'summary',
        'results',
        'completed',
        'total',
        'scenario_name',
        'started_at',
        'completed_at',
        'created_by',
    ]) {
        if (column in payload && isMissingColumnError(error, column)) {
            return column;
        }
    }
    return null;
}

function isMissingColumnError(error: { message?: string | null } | null | undefined, column: string): boolean {
    const message = error?.message ?? '';
    return message.includes(`Could not find the '${column}' column`)
        || message.includes(`column simulations.${column} does not exist`)
        || message.includes(`column public.simulations.${column} does not exist`);
}

function benchmarkFamily(kind: BenchmarkKind, taskType: string): string {
    if (kind === 'task') return `federated_${taskType}_runtime_benchmark`;
    if (kind === 'adversarial') return 'federated_adversarial_runtime_benchmark';
    return 'federated_safety_runtime_benchmark';
}

function selectBenchmarkEvidence(
    evidence: Record<string, unknown> | undefined,
    keys: string[],
): Record<string, unknown> {
    const root = asRecord(evidence);
    const taskMap = asRecord(root.tasks);
    for (const key of keys) {
        const taskNested = asRecord(taskMap[key]);
        if (Object.keys(taskNested).length > 0) return taskNested;
        if (key === 'tasks') continue;
        const nested = asRecord(root[key]);
        if (Object.keys(nested).length > 0) return nested;
    }
    return root;
}

function selectCalibrationEvidence(
    evidence: Record<string, unknown> | undefined,
    taskType: string,
): Record<string, unknown> {
    const root = asRecord(evidence);
    const byTask = asRecord(asRecord(root.tasks)[taskType]);
    if (Object.keys(byTask).length > 0) return byTask;
    return root;
}

function mergeEvidence(
    derived: Record<string, unknown> | undefined,
    explicit: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    if (!derived) return explicit;
    if (!explicit) return derived;
    return {
        ...derived,
        ...explicit,
        tasks: {
            ...asRecord(derived.tasks),
            ...asRecord(explicit.tasks),
        },
    };
}

function readUpdateSummaries(runtime: Record<string, unknown>): Record<string, unknown>[] {
    const raw = runtime.updateSummaries
        ?? runtime.update_summaries
        ?? runtime.deltaSummaries
        ?? runtime.delta_summaries
        ?? runtime.update_submissions
        ?? runtime.accepted_updates;
    return Array.isArray(raw)
        ? raw.map(asRecord).filter((entry) => Object.keys(entry).length > 0)
        : [];
}

function updateMatchesTask(update: Record<string, unknown>, taskType: string): boolean {
    const role = readText(update.contributionRole) ?? readText(update.contribution_role);
    const updateTaskType = readText(update.taskType) ?? readText(update.task_type);
    if (updateTaskType) return updateTaskType === taskType;
    if (!role) return true;
    if (taskType === 'diagnosis') return role === 'diagnosis';
    if (taskType === 'severity') return role === 'severity';
    if (taskType === 'hybrid') return role === 'support' || role === 'diagnosis' || role === 'severity';
    return false;
}

function readFirstNumber(record: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = readNumber(record[key]);
        if (value != null) return value;
    }
    return null;
}

function readFirstBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
    for (const key of keys) {
        const value = readBoolean(record[key]);
        if (value != null) return value;
    }
    return null;
}

function sumNumbers(values: Array<number | null>): number {
    return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function weightedTrustScore(updates: Record<string, unknown>[]): number {
    const weighted = updates
        .map((update) => {
            const rows = readFirstNumber(update, ['trustScoredRows', 'trust_scored_rows', 'eligibleRecordCount', 'eligible_record_count'])
                ?? 0;
            const score = readFirstNumber(update, ['averageTrustScore', 'average_trust_score']);
            return score == null ? null : { rows, score };
        })
        .filter((entry): entry is { rows: number; score: number } => entry != null);
    const rowTotal = weighted.reduce((sum, entry) => sum + Math.max(0, entry.rows), 0);
    if (rowTotal <= 0) return 0;
    return weighted.reduce((sum, entry) => sum + entry.score * Math.max(0, entry.rows), 0) / rowTotal;
}

function meanMetric(updates: Record<string, unknown>[], keys: string[]): number | null {
    const values = updates
        .map((update) => readNestedNumber(update, keys))
        .filter((value): value is number => value != null);
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readNestedNumber(update: Record<string, unknown>, keys: string[]): number | null {
    for (const source of [
        update,
        asRecord(update.metricSummary),
        asRecord(update.metric_summary),
        asRecord(update.publicSummary),
        asRecord(update.public_summary),
        asRecord(update.evidence),
    ]) {
        const value = readFirstNumber(source, keys);
        if (value != null) return value;
    }
    return null;
}

function weightedMean(values: number[]): number {
    const valid = values.filter((value) => Number.isFinite(value));
    if (valid.length === 0) return 0;
    return roundMetric(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter((value) => value.length > 0)));
}

function roundMetric(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

function collectReportBlockers(
    report: Omit<LearningBenchmarkReportRecord, 'id' | 'created_at'>,
    blockers: Set<string>,
) {
    for (const blocker of readStringArray(report.report_payload.blockers)) {
        blockers.add(blocker);
    }
}

function publicEvidenceSummary(evidence: Record<string, unknown>): Record<string, unknown> {
    const allowedKeys = [
        'pass',
        'passed',
        'score',
        'summary_score',
        'case_count',
        'fixture_count',
        'sample_count',
        'row_count',
        'total',
        'failed',
        'expected_calibration_error',
        'ece',
        'ece_score',
        'brier_score',
        'total_replayed',
        'regression_rate',
        'threshold_pct',
        'blocked',
        'candidate_blocked',
        'status',
    ];
    return Object.fromEntries(allowedKeys
        .filter((key) => evidence[key] != null)
        .map((key) => [key, evidence[key]]));
}

function stableHash(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        : [];
}

function clamp01(value: number | null): number {
    if (value == null || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function mergeRecords(...records: Array<Record<string, unknown>>): Record<string, unknown> {
    return records.reduce<Record<string, unknown>>((merged, record) => ({
        ...merged,
        ...record,
    }), {});
}

function isSha256(value: string | null | undefined): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
