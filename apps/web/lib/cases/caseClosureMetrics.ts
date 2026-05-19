import type { CaseSummary } from '@/lib/cases/caseWorkflow';

const DEFAULT_OVERDUE_HOURS = 24;
const DEFAULT_DIGEST_LIMIT = 10;
const HOUR_MS = 60 * 60 * 1000;

export interface CaseClosureCohortMetrics {
    cohort_id: string;
    total_cases: number;
    inferred_cases: number;
    open_cases: number;
    closed_cases: number;
    overdue_open_cases: number;
    closure_rate: number;
    inferred_closure_rate: number;
    average_hours_to_closure: number | null;
    median_hours_to_closure: number | null;
}

export interface CaseClosureMetrics extends CaseClosureCohortMetrics {
    closure_backlog: number;
    by_clinician: CaseClosureCohortMetrics[];
    by_clinic: CaseClosureCohortMetrics[];
}

export interface CaseClosureDigestItem {
    case_id: string;
    patient_name: string;
    species: string;
    complaint: string;
    top_differential: string | null;
    confidence: number | null;
    created_at: string;
    age_hours: number;
    overdue: boolean;
    closure_ready: boolean;
    recommended_action: string;
}

export interface CaseClosureDigest {
    generated_at: string;
    overdue_hours: number;
    metrics: CaseClosureMetrics;
    items: CaseClosureDigestItem[];
    truncated: boolean;
}

export function computeCaseClosureMetrics(
    cases: CaseSummary[],
    options: { now?: Date; overdueHours?: number } = {},
): CaseClosureMetrics {
    const now = options.now ?? new Date();
    const overdueHours = options.overdueHours ?? DEFAULT_OVERDUE_HOURS;
    const aggregate = computeCohortMetrics('all', cases, now, overdueHours);

    return {
        ...aggregate,
        closure_backlog: aggregate.open_cases,
        by_clinician: computeGroupedMetrics(cases, now, overdueHours, (entry) => entry.user_id ?? 'unassigned'),
        by_clinic: computeGroupedMetrics(cases, now, overdueHours, (entry) => entry.clinic_id ?? 'unassigned'),
    };
}

export function buildOpenCaseClosureDigest(
    cases: CaseSummary[],
    options: { now?: Date; overdueHours?: number; limit?: number } = {},
): CaseClosureDigest {
    const now = options.now ?? new Date();
    const overdueHours = options.overdueHours ?? DEFAULT_OVERDUE_HOURS;
    const limit = Math.max(1, options.limit ?? DEFAULT_DIGEST_LIMIT);
    const allItems = cases
        .filter((entry) => !isClosedCase(entry))
        .map((entry) => {
            const ageHours = ageInHours(entry.created_at, now) ?? 0;
            const closureReady = Boolean(entry.latest_inference_event_id);
            return {
                case_id: entry.id,
                patient_name: entry.patient_name ?? 'Unnamed patient',
                species: entry.species_display ?? entry.species_canonical ?? 'unknown',
                complaint: entry.presenting_complaint ?? entry.symptom_summary ?? 'No complaint recorded',
                top_differential: entry.top_diagnosis,
                confidence: entry.diagnosis_confidence,
                created_at: entry.created_at,
                age_hours: roundMetric(ageHours),
                overdue: ageHours >= overdueHours,
                closure_ready: closureReady,
                recommended_action: closureReady
                    ? 'Confirm or correct the top differential, then submit outcome closure.'
                    : 'Run inference before outcome closure can be submitted.',
            } satisfies CaseClosureDigestItem;
        })
        .sort((left, right) => {
            if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
            if (left.closure_ready !== right.closure_ready) return left.closure_ready ? -1 : 1;
            if (right.age_hours !== left.age_hours) return right.age_hours - left.age_hours;
            return (right.confidence ?? -1) - (left.confidence ?? -1);
        });

    return {
        generated_at: now.toISOString(),
        overdue_hours: overdueHours,
        metrics: computeCaseClosureMetrics(cases, { now, overdueHours }),
        items: allItems.slice(0, limit),
        truncated: allItems.length > limit,
    };
}

export function isClosedCase(entry: CaseSummary): boolean {
    return entry.case_status === 'closed'
        || Boolean(entry.closed_at)
        || Boolean(entry.confirmed_diagnosis)
        || Boolean(entry.latest_outcome_event_id);
}

export function caseAgeHours(entry: CaseSummary, now = new Date()): number | null {
    return ageInHours(entry.created_at, now);
}

function computeGroupedMetrics(
    cases: CaseSummary[],
    now: Date,
    overdueHours: number,
    keyFn: (entry: CaseSummary) => string,
): CaseClosureCohortMetrics[] {
    const groups = new Map<string, CaseSummary[]>();
    for (const entry of cases) {
        const key = keyFn(entry);
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
    }

    return Array.from(groups.entries())
        .map(([key, entries]) => computeCohortMetrics(key, entries, now, overdueHours))
        .sort((left, right) => {
            if (right.open_cases !== left.open_cases) return right.open_cases - left.open_cases;
            return left.cohort_id.localeCompare(right.cohort_id);
        });
}

function computeCohortMetrics(
    cohortId: string,
    cases: CaseSummary[],
    now: Date,
    overdueHours: number,
): CaseClosureCohortMetrics {
    const closedCases = cases.filter(isClosedCase);
    const inferredCases = cases.filter((entry) => Boolean(entry.latest_inference_event_id));
    const inferredClosedCases = inferredCases.filter(isClosedCase);
    const openCases = cases.filter((entry) => !isClosedCase(entry));
    const closureDurations = closedCases
        .map((entry) => durationHours(entry.created_at, entry.closed_at))
        .filter((value): value is number => value != null)
        .sort((left, right) => left - right);

    return {
        cohort_id: cohortId,
        total_cases: cases.length,
        inferred_cases: inferredCases.length,
        open_cases: openCases.length,
        closed_cases: closedCases.length,
        overdue_open_cases: openCases.filter((entry) => (ageInHours(entry.created_at, now) ?? 0) >= overdueHours).length,
        closure_rate: rate(closedCases.length, cases.length),
        inferred_closure_rate: rate(inferredClosedCases.length, inferredCases.length),
        average_hours_to_closure: average(closureDurations),
        median_hours_to_closure: median(closureDurations),
    };
}

function rate(numerator: number, denominator: number): number {
    return denominator > 0 ? roundMetric(numerator / denominator) : 0;
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const middle = Math.floor(values.length / 2);
    if (values.length % 2 === 1) return roundMetric(values[middle]);
    return roundMetric((values[middle - 1] + values[middle]) / 2);
}

function ageInHours(createdAt: string, now: Date): number | null {
    const start = Date.parse(createdAt);
    if (!Number.isFinite(start)) return null;
    return Math.max(0, (now.getTime() - start) / HOUR_MS);
}

function durationHours(createdAt: string, closedAt: string | null): number | null {
    if (!closedAt) return null;
    const start = Date.parse(createdAt);
    const end = Date.parse(closedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return Math.max(0, roundMetric((end - start) / HOUR_MS));
}

function roundMetric(value: number): number {
    return Number(value.toFixed(4));
}
