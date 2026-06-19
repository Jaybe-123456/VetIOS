export type AMRStewardshipEventRow = {
    species: string | null;
    pathogen_label?: string | null;
    infection_site?: string | null;
    drug_name?: string | null;
    drug_class?: string | null;
    decision_stage?: string | null;
    stewardship_status?: string | null;
    outcome_status?: string | null;
    culture_collected?: boolean | null;
    resistance_suspected?: boolean | null;
    de_escalation_recommended?: boolean | null;
    review_required?: boolean | null;
    resistance_classes?: string[] | null;
    observed_at?: string | null;
};

export type AMRStewardshipAggregate = {
    total_events: number;
    culture_guided_events: number;
    culture_guided_rate: number;
    resistance_suspected_events: number;
    resistance_suspected_rate: number;
    review_required_events: number;
    review_required_rate: number;
    de_escalation_recommended_events: number;
    top_drug_classes: Array<{ drug_class: string; count: number }>;
    top_pathogens: Array<{ pathogen_label: string; count: number }>;
    outcome_statuses: Array<{ outcome_status: string; count: number }>;
    stewardship_statuses: Array<{ stewardship_status: string; count: number }>;
    resistance_classes: Array<{ resistance_class: string; count: number }>;
    latest_observed_at: string | null;
};

export const AMR_DECISION_STAGES = [
    'unknown',
    'empiric',
    'culture_guided',
    'de_escalated',
    'escalated',
    'stopped',
    'prophylaxis',
    'watchful_waiting',
] as const;

export const AMR_STEWARDSHIP_STATUSES = [
    'monitoring',
    'pending_culture',
    'culture_guided',
    'non_antimicrobial',
    'watchful_waiting',
    'success',
    'failure',
    'relapse',
    'adverse_event',
] as const;

export const AMR_OUTCOME_STATUSES = [
    'improved',
    'resolved',
    'unchanged',
    'worsened',
    'relapsed',
    'adverse_event',
    'unknown',
] as const;

export function normalizeAMRLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function normalizeOptionalAMRLabel(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = normalizeAMRLabel(value);
    return normalized || null;
}

export function normalizeAMRString(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized || null;
}

export function normalizeAMRStringList(value: string[] | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(normalizeOptionalAMRLabel).filter((item): item is string => Boolean(item))));
}

export function aggregateAMRStewardship(rows: AMRStewardshipEventRow[]): AMRStewardshipAggregate {
    const total = rows.length;
    const cultureGuided = rows.filter((row) => row.culture_collected === true || row.decision_stage === 'culture_guided').length;
    const resistanceSuspected = rows.filter((row) => row.resistance_suspected === true).length;
    const reviewRequired = rows.filter((row) => row.review_required === true).length;
    const deEscalation = rows.filter((row) => row.de_escalation_recommended === true).length;

    return {
        total_events: total,
        culture_guided_events: cultureGuided,
        culture_guided_rate: ratio(cultureGuided, total),
        resistance_suspected_events: resistanceSuspected,
        resistance_suspected_rate: ratio(resistanceSuspected, total),
        review_required_events: reviewRequired,
        review_required_rate: ratio(reviewRequired, total),
        de_escalation_recommended_events: deEscalation,
        top_drug_classes: countTop(rows.map((row) => row.drug_class), 'unknown').map(([drug_class, count]) => ({ drug_class, count })),
        top_pathogens: countTop(rows.map((row) => row.pathogen_label), 'unknown').map(([pathogen_label, count]) => ({ pathogen_label, count })),
        outcome_statuses: countTop(rows.map((row) => row.outcome_status), 'unknown').map(([outcome_status, count]) => ({ outcome_status, count })),
        stewardship_statuses: countTop(rows.map((row) => row.stewardship_status), 'unknown').map(([stewardship_status, count]) => ({ stewardship_status, count })),
        resistance_classes: countTop(rows.flatMap((row) => row.resistance_classes ?? []), 'unknown').map(([resistance_class, count]) => ({ resistance_class, count })),
        latest_observed_at: latestObservedAt(rows),
    };
}

function countTop(values: Array<string | null | undefined>, fallback: string): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const value of values) {
        const key = normalizeOptionalAMRLabel(value) ?? fallback;
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

function latestObservedAt(rows: AMRStewardshipEventRow[]): string | null {
    return rows
        .map((row) => row.observed_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
}
