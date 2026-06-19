export const SPECIALIST_REVIEW_ROUTES = [
    'none',
    'primary_clinician',
    'emergency_veterinarian',
    'internal_medicine',
    'diagnostic_imaging',
    'toxicology',
    'cardiology',
    'neurology',
    'oncology',
    'surgery',
    'dermatology',
    'ophthalmology',
    'anesthesia',
    'pathology',
] as const;

export const SPECIALIST_REVIEW_URGENCY_LEVELS = [
    'routine',
    'priority',
    'urgent',
    'emergency',
] as const;

export const SPECIALIST_REVIEW_STAGES = [
    'requested',
    'assigned',
    'in_review',
    'report_ready',
    'returned_to_clinician',
    'closed',
] as const;

export const SPECIALIST_REVIEW_STATUSES = [
    'pending',
    'completed',
    'cancelled',
    'escalated',
    'unable_to_review',
] as const;

export const SPECIALIST_AI_DISPOSITIONS = [
    'not_reviewed',
    'supported',
    'partially_supported',
    'corrected',
    'contradicted',
    'insufficient_evidence',
] as const;

export const SPECIALIST_CLINICIAN_ACTIONS = [
    'none',
    'accepted_ai',
    'modified_plan',
    'referred',
    'emergency_transfer',
    'additional_tests',
    'treatment_changed',
] as const;

export const SPECIALIST_REPORT_STATUSES = [
    'not_started',
    'draft',
    'final',
    'amended',
] as const;

export const SPECIALIST_PACS_STATUSES = [
    'not_applicable',
    'pending',
    'linked',
    'unavailable',
] as const;

export type SpecialistReviewRoute = typeof SPECIALIST_REVIEW_ROUTES[number];
export type SpecialistReviewUrgencyLevel = typeof SPECIALIST_REVIEW_URGENCY_LEVELS[number];
export type SpecialistReviewStage = typeof SPECIALIST_REVIEW_STAGES[number];
export type SpecialistReviewStatus = typeof SPECIALIST_REVIEW_STATUSES[number];
export type SpecialistAIDisposition = typeof SPECIALIST_AI_DISPOSITIONS[number];
export type SpecialistClinicianAction = typeof SPECIALIST_CLINICIAN_ACTIONS[number];
export type SpecialistReportStatus = typeof SPECIALIST_REPORT_STATUSES[number];
export type SpecialistPacsStatus = typeof SPECIALIST_PACS_STATUSES[number];

export interface SpecialistReviewEventRow {
    reviewer_route?: SpecialistReviewRoute | string | null;
    specialty?: string | null;
    urgency_level?: SpecialistReviewUrgencyLevel | string | null;
    review_stage?: SpecialistReviewStage | string | null;
    review_status?: SpecialistReviewStatus | string | null;
    ai_disposition?: SpecialistAIDisposition | string | null;
    clinician_action?: SpecialistClinicianAction | string | null;
    report_status?: SpecialistReportStatus | string | null;
    pacs_status?: SpecialistPacsStatus | string | null;
    outcome_required?: boolean | null;
    outcome_captured?: boolean | null;
    learning_eligible?: boolean | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface SpecialistReviewAggregate {
    total_events: number;
    pending_reviews: number;
    completed_reviews: number;
    specialist_reviews: number;
    emergency_reviews: number;
    ai_supported_events: number;
    ai_corrected_events: number;
    ai_contradicted_events: number;
    outcome_captured_events: number;
    learning_eligible_events: number;
    final_report_events: number;
    pacs_linked_events: number;
    completion_rate: number;
    correction_rate: number;
    learning_eligible_rate: number;
    top_reviewer_routes: Array<{ reviewer_route: string; count: number }>;
    top_ai_dispositions: Array<{ ai_disposition: string; count: number }>;
    top_clinician_actions: Array<{ clinician_action: string; count: number }>;
    latest_observed_at: string | null;
}

export interface SpecialistLearningEligibilityInput {
    review_status: SpecialistReviewStatus;
    ai_disposition: SpecialistAIDisposition;
    report_status: SpecialistReportStatus;
    outcome_required: boolean;
    outcome_captured: boolean;
}

const SPECIALIST_ROUTES = new Set<string>([
    'emergency_veterinarian',
    'internal_medicine',
    'diagnostic_imaging',
    'toxicology',
    'cardiology',
    'neurology',
    'oncology',
    'surgery',
    'dermatology',
    'ophthalmology',
    'anesthesia',
    'pathology',
]);

const REVIEWED_AI_DISPOSITIONS = new Set<SpecialistAIDisposition>([
    'supported',
    'partially_supported',
    'corrected',
    'contradicted',
]);

export function resolveSpecialistLearningEligibility(input: SpecialistLearningEligibilityInput): boolean {
    const reportFinal = input.report_status === 'final' || input.report_status === 'amended';
    const outcomeReady = !input.outcome_required || input.outcome_captured;
    return input.review_status === 'completed'
        && reportFinal
        && outcomeReady
        && REVIEWED_AI_DISPOSITIONS.has(input.ai_disposition);
}

export function aggregateSpecialistReviewEvents(rows: SpecialistReviewEventRow[]): SpecialistReviewAggregate {
    const total = rows.length;
    const completed = rows.filter((row) => row.review_status === 'completed').length;
    const corrected = rows.filter((row) => row.ai_disposition === 'corrected' || row.ai_disposition === 'partially_supported').length;
    const reviewed = rows.filter((row) => REVIEWED_AI_DISPOSITIONS.has(row.ai_disposition as SpecialistAIDisposition)).length;
    const learningEligible = rows.filter((row) => row.learning_eligible === true).length;

    return {
        total_events: total,
        pending_reviews: rows.filter((row) => row.review_status === 'pending').length,
        completed_reviews: completed,
        specialist_reviews: rows.filter((row) => isSpecialistRoute(row.reviewer_route)).length,
        emergency_reviews: rows.filter((row) => row.urgency_level === 'emergency' || row.reviewer_route === 'emergency_veterinarian').length,
        ai_supported_events: rows.filter((row) => row.ai_disposition === 'supported').length,
        ai_corrected_events: corrected,
        ai_contradicted_events: rows.filter((row) => row.ai_disposition === 'contradicted').length,
        outcome_captured_events: rows.filter((row) => row.outcome_captured === true).length,
        learning_eligible_events: learningEligible,
        final_report_events: rows.filter((row) => row.report_status === 'final' || row.report_status === 'amended').length,
        pacs_linked_events: rows.filter((row) => row.pacs_status === 'linked').length,
        completion_rate: ratio(completed, total),
        correction_rate: ratio(corrected, reviewed),
        learning_eligible_rate: ratio(learningEligible, total),
        top_reviewer_routes: countTop(rows.map((row) => row.reviewer_route), 'unknown')
            .map(([reviewer_route, count]) => ({ reviewer_route, count })),
        top_ai_dispositions: countTop(rows.map((row) => row.ai_disposition), 'unknown')
            .map(([ai_disposition, count]) => ({ ai_disposition, count })),
        top_clinician_actions: countTop(rows.map((row) => row.clinician_action), 'unknown')
            .map(([clinician_action, count]) => ({ clinician_action, count })),
        latest_observed_at: latestObservedAt(rows),
    };
}

export function normalizeSpecialistReviewLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function normalizeOptionalSpecialistReviewLabel(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = normalizeSpecialistReviewLabel(value);
    return normalized || null;
}

export function normalizeSpecialistReviewText(value: string | null | undefined, maxLength = 2000): string | null {
    const normalized = value?.trim();
    return normalized ? normalized.slice(0, maxLength) : null;
}

function isSpecialistRoute(value: unknown): boolean {
    return typeof value === 'string' && SPECIALIST_ROUTES.has(value);
}

function countTop(values: Array<string | null | undefined>, fallback: string): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const value of values) {
        const key = normalizeOptionalSpecialistReviewLabel(value) ?? fallback;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10);
}

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function latestObservedAt(rows: SpecialistReviewEventRow[]): string | null {
    return rows
        .map((row) => row.observed_at ?? row.created_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
}
