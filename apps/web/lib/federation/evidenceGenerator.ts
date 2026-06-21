import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import type {
    LearningBenchmarkReportRecord,
    LearningCalibrationReportRecord,
    ModelRegistryEntryRecord,
} from '@/lib/learningEngine/types';

export interface FederatedCandidateEvidenceInput {
    candidateModelVersion: string;
    registryEntries: ModelRegistryEntryRecord[];
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

    const plan = buildFederatedCandidateEvidencePlan({
        candidateModelVersion: input.candidateModelVersion,
        registryEntries,
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
        },
    });

    return {
        plan,
        created_benchmark_reports: createdBenchmarkReports,
        created_calibration_reports: createdCalibrationReports,
        regression_run: regressionRun,
    };
}

export function buildFederatedCandidateEvidencePlan(
    input: FederatedCandidateEvidenceInput,
): FederatedCandidateEvidencePlan {
    const now = input.now ?? new Date().toISOString();
    const blockers = new Set<string>();
    const warnings = new Set<string>();
    const benchmarkReports: Array<Omit<LearningBenchmarkReportRecord, 'id' | 'created_at'>> = [];
    const calibrationReports: Array<Omit<LearningCalibrationReportRecord, 'id' | 'created_at'>> = [];

    if (input.registryEntries.length === 0) {
        blockers.add('candidate_registry_entries_missing');
    }

    for (const entry of input.registryEntries) {
        const taskReport = buildBenchmarkReport({
            entry,
            kind: 'task',
            evidence: selectBenchmarkEvidence(input.benchmarkEvidence, ['tasks', entry.task_type, 'task']),
            now,
        });
        benchmarkReports.push(taskReport);
        collectReportBlockers(taskReport, blockers);

        const safetyReport = buildBenchmarkReport({
            entry,
            kind: 'safety',
            evidence: selectBenchmarkEvidence(input.benchmarkEvidence, ['safety']),
            now,
        });
        benchmarkReports.push(safetyReport);
        collectReportBlockers(safetyReport, blockers);

        const adversarialReport = buildBenchmarkReport({
            entry,
            kind: 'adversarial',
            evidence: selectBenchmarkEvidence(input.benchmarkEvidence, ['adversarial', 'adversarial_safety']),
            now,
        });
        benchmarkReports.push(adversarialReport);
        collectReportBlockers(adversarialReport, blockers);

        if (entry.task_type === 'diagnosis' || entry.task_type === 'hybrid') {
            const calibrationReport = buildCalibrationReport({
                entry,
                evidence: selectCalibrationEvidence(input.calibrationEvidence, entry.task_type),
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
        evidence: input.regressionEvidence,
        operatorEvidence: input.operatorEvidence,
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
    for (const key of keys) {
        const nested = asRecord(root[key]);
        if (Object.keys(nested).length > 0) return nested;
        const taskMap = asRecord(root.tasks);
        const taskNested = asRecord(taskMap[key]);
        if (Object.keys(taskNested).length > 0) return taskNested;
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
