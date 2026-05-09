import type { SupabaseClient } from '@supabase/supabase-js';
import type {
    LearningBenchmarkReportRecord,
    LearningCalibrationReportRecord,
    ModelRegistryEntryRecord,
} from '@/lib/learningEngine/types';

export interface RegressionRunEvidence {
    id: string;
    status: string | null;
    mode: string | null;
    candidate_model_version: string | null;
    config: Record<string, unknown>;
    results: Record<string, unknown>;
    summary: Record<string, unknown>;
    created_at: string | null;
    completed_at: string | null;
}

export interface PromotionGateResult {
    allowed: boolean;
    blockers: string[];
    warnings: string[];
    evidence: {
        benchmark_report_ids: string[];
        calibration_report_ids: string[];
        regression_run_id: string | null;
        regression_status: string | null;
        regression_results: Record<string, unknown> | null;
    };
}

export async function listCandidateRegressionRuns(
    client: SupabaseClient,
    tenantId: string,
    candidateModelVersion: string,
): Promise<RegressionRunEvidence[]> {
    const { data, error } = await client
        .from('simulations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('mode', 'regression')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        throw new Error(`Failed to load regression simulation evidence: ${error.message}`);
    }

    return ((data ?? []) as Record<string, unknown>[])
        .map(mapRegressionRunEvidence)
        .filter((run) => regressionRunMatchesCandidate(run, candidateModelVersion));
}

export function evaluateModelPromotionGate(input: {
    candidateModelVersion: string;
    targetEntries: ModelRegistryEntryRecord[];
    benchmarkReports: LearningBenchmarkReportRecord[];
    calibrationReports: LearningCalibrationReportRecord[];
    regressionRuns: RegressionRunEvidence[];
}): PromotionGateResult {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const targetIds = new Set(input.targetEntries.map((entry) => entry.id));
    const benchmarkReports = input.benchmarkReports.filter((report) =>
        report.model_registry_id != null && targetIds.has(report.model_registry_id),
    );
    const calibrationReports = input.calibrationReports.filter((report) =>
        report.model_registry_id != null && targetIds.has(report.model_registry_id)
        || input.targetEntries.some((entry) => entry.calibration_report_id === report.id),
    );
    const latestRegressionRun = input.regressionRuns[0] ?? null;

    if (input.targetEntries.length === 0) {
        blockers.push('No model registry entries were found for the requested candidate version.');
    }

    const disallowedStatuses = input.targetEntries
        .filter((entry) => ['archived', 'rejected', 'rolled_back'].includes(entry.promotion_status))
        .map((entry) => `${entry.task_type}:${entry.promotion_status}`);
    if (disallowedStatuses.length > 0) {
        blockers.push(`Candidate contains registry entries that cannot be promoted: ${disallowedStatuses.join(', ')}.`);
    }

    for (const entry of input.targetEntries) {
        const entryReports = benchmarkReports.filter((report) => report.model_registry_id === entry.id);
        if (entryReports.length === 0) {
            blockers.push(`No benchmark reports were found for the ${entry.task_type} registry entry.`);
            continue;
        }

        const taskReports = entryReports.filter((report) =>
            report.task_type === entry.task_type
            || (entry.task_type === 'hybrid' && (report.task_type === 'diagnosis' || report.task_type === 'severity')),
        );
        if (taskReports.length === 0) {
            blockers.push(`No task-specific benchmark report was found for the ${entry.task_type} registry entry.`);
        }
    }

    for (const report of benchmarkReports) {
        if (report.pass_status.toLowerCase() !== 'pass') {
            blockers.push(`Benchmark ${report.benchmark_family} did not pass.`);
        }
    }

    const safetyReports = benchmarkReports.filter(isSafetyBenchmark);
    if (safetyReports.length === 0) {
        blockers.push('No safety benchmark report was found for this candidate.');
    }
    const adversarialReports = benchmarkReports.filter(isAdversarialBenchmark);
    if (adversarialReports.length === 0) {
        blockers.push('No adversarial safety report was found for this candidate.');
    } else if (adversarialReports.some((report) => report.pass_status.toLowerCase() !== 'pass')) {
        blockers.push('Adversarial safety report did not pass.');
    }

    const diagnosisEntries = input.targetEntries.filter((entry) => entry.task_type === 'diagnosis' || entry.task_type === 'hybrid');
    if (diagnosisEntries.length > 0) {
        if (calibrationReports.length === 0) {
            blockers.push('No calibration report was found for the diagnosis candidate.');
        }
        for (const report of calibrationReports) {
            const status = readText(asRecord(asRecord(report.report_payload).recommendation).status);
            const ece = readNumber(report.ece_score) ?? readNumber(report.report_payload.expected_calibration_error);
            if (status && status !== 'pass') {
                blockers.push(`Calibration report ${report.id} status is ${status}.`);
            }
            if (ece != null && ece > 0.12) {
                blockers.push(`Calibration report ${report.id} has ECE ${ece}, above the 0.12 promotion threshold.`);
            }
        }
    }

    const regressionBlocker = evaluateRegressionRun(latestRegressionRun);
    if (regressionBlocker) {
        blockers.push(regressionBlocker);
    }

    if (benchmarkReports.length === 0 && input.targetEntries.length > 0) {
        warnings.push('Run a weekly benchmark or manual review cycle to generate promotion evidence.');
    }
    if (!latestRegressionRun) {
        warnings.push('Run /api/simulations/regression for this candidate before promotion.');
    }

    return {
        allowed: blockers.length === 0,
        blockers,
        warnings,
        evidence: {
            benchmark_report_ids: benchmarkReports.map((report) => report.id),
            calibration_report_ids: calibrationReports.map((report) => report.id),
            regression_run_id: latestRegressionRun?.id ?? null,
            regression_status: latestRegressionRun?.status ?? null,
            regression_results: latestRegressionRun?.results ?? null,
        },
    };
}

function evaluateRegressionRun(run: RegressionRunEvidence | null): string | null {
    if (!run) {
        return 'No completed regression simulation was found for this candidate.';
    }

    const status = (run.status ?? '').toLowerCase();
    if (status !== 'complete' && status !== 'completed') {
        return `Latest regression simulation is ${run.status ?? 'unknown'}, not complete.`;
    }

    const results = Object.keys(run.results).length > 0 ? run.results : run.summary;
    if (readBoolean(results.blocked) === true || readBoolean(results.candidate_blocked) === true) {
        return 'Latest regression simulation blocked the candidate.';
    }

    const fixtureCount = readNumber(results.fixture_count);
    if (fixtureCount != null) {
        const failed = readNumber(results.failed) ?? 0;
        if (fixtureCount <= 0) {
            return 'Regression fixture simulation did not execute any fixtures.';
        }
        if (failed > 0) {
            return `Regression fixture simulation failed ${failed} fixture(s).`;
        }
        return null;
    }

    const totalReplayed = readNumber(results.total_replayed);
    const regressionRate = readNumber(results.regression_rate);
    const thresholdPct = readNumber(results.threshold_pct) ?? 10;
    if (totalReplayed == null || totalReplayed <= 0) {
        return 'Regression replay simulation did not replay any baseline events.';
    }
    if (regressionRate != null && regressionRate > thresholdPct) {
        return `Regression replay rate ${regressionRate}% exceeds threshold ${thresholdPct}%.`;
    }

    return null;
}

function isSafetyBenchmark(report: LearningBenchmarkReportRecord): boolean {
    const family = report.benchmark_family.toLowerCase();
    return report.task_type === 'safety'
        || family.includes('safety')
        || family.includes('adversarial')
        || family.includes('low_signal')
        || family.includes('subgroup');
}

function isAdversarialBenchmark(report: LearningBenchmarkReportRecord): boolean {
    const family = report.benchmark_family.toLowerCase();
    return family.includes('adversarial');
}

function regressionRunMatchesCandidate(run: RegressionRunEvidence, candidateModelVersion: string): boolean {
    return run.candidate_model_version === candidateModelVersion
        || readText(run.config.candidate_model) === candidateModelVersion
        || readText(run.config.candidate_model_version) === candidateModelVersion
        || readText(run.results.candidate_model) === candidateModelVersion
        || readText(run.summary.candidate_model) === candidateModelVersion;
}

function mapRegressionRunEvidence(row: Record<string, unknown>): RegressionRunEvidence {
    return {
        id: String(row.id),
        status: readText(row.status),
        mode: readText(row.mode),
        candidate_model_version: readText(row.candidate_model_version),
        config: asRecord(row.config),
        results: asRecord(row.results),
        summary: asRecord(row.summary),
        created_at: readText(row.created_at),
        completed_at: readText(row.completed_at),
    };
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
