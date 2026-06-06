import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConfirmedCaseCollectionStats {
    total_cases: number;
    confirmed_cases: number;
    pending_cases: number;
    outcome_events: number;
    deidentified_learning_signals: number;
    confirmed_last_7d: number;
    label_count: number;
    milestone_target: number;
    milestone_percent: number;
    ready_for_validation: boolean;
    top_labels: Array<{ label: string; count: number }>;
    warnings: string[];
    updated_at: string;
}

interface CaseCollectionRow {
    id?: unknown;
    case_status?: unknown;
    confirmed_diagnosis?: unknown;
    label_type?: unknown;
    resolved_at?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
}

interface OutcomeCollectionRow {
    id?: unknown;
    case_id?: unknown;
    outcome_type?: unknown;
    outcome_payload?: unknown;
    label_type?: unknown;
    created_at?: unknown;
}

const COLLECTION_TARGET = 200;
const VALIDATION_READY_MINIMUM = 30;

export async function loadConfirmedCaseCollectionStats(
    client: SupabaseClient,
    tenantId: string,
    limit = 1000,
): Promise<ConfirmedCaseCollectionStats> {
    const warnings: string[] = [];
    const [caseRows, outcomeRows] = await Promise.all([
        loadCaseRows(client, tenantId, limit, warnings),
        loadOutcomeRows(client, tenantId, limit, warnings),
    ]);

    const confirmedCaseIds = new Set<string>();
    for (const row of caseRows) {
        const caseId = readText(row.id);
        if (caseId && isConfirmedCase(row)) {
            confirmedCaseIds.add(caseId);
        }
    }

    const labelCounts = new Map<string, number>();
    for (const row of caseRows) {
        const label = readText(row.confirmed_diagnosis);
        if (label) increment(labelCounts, label);
    }

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let confirmedOutcomeEvents = 0;
    let deidentifiedLearningSignals = 0;
    let confirmedLast7d = 0;

    for (const row of outcomeRows) {
        const payload = asRecord(row.outcome_payload);
        if (!isConfirmedOutcome(row, payload)) continue;

        confirmedOutcomeEvents += 1;
        const caseId = readText(row.case_id);
        if (caseId) confirmedCaseIds.add(caseId);

        const label = readOutcomeLabel(row, payload);
        if (label) increment(labelCounts, label);

        const createdAt = readTimestamp(row.created_at);
        if (createdAt !== null && createdAt >= sevenDaysAgo) {
            confirmedLast7d += 1;
        }

        if (hasDeidentifiedLearningConsent(payload)) {
            deidentifiedLearningSignals += 1;
        }
    }

    const confirmedCases = Math.max(confirmedCaseIds.size, confirmedOutcomeEvents);
    const pendingCases = Math.max(caseRows.length - confirmedCaseIds.size, 0);
    const milestonePercent = Math.min(100, Math.round((confirmedCases / COLLECTION_TARGET) * 100));

    return {
        total_cases: caseRows.length,
        confirmed_cases: confirmedCases,
        pending_cases: pendingCases,
        outcome_events: confirmedOutcomeEvents,
        deidentified_learning_signals: deidentifiedLearningSignals,
        confirmed_last_7d: confirmedLast7d,
        label_count: labelCounts.size,
        milestone_target: COLLECTION_TARGET,
        milestone_percent: milestonePercent,
        ready_for_validation: confirmedCases >= VALIDATION_READY_MINIMUM,
        top_labels: Array.from(labelCounts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 5)
            .map(([label, count]) => ({ label, count })),
        warnings,
        updated_at: new Date().toISOString(),
    };
}

async function loadCaseRows(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
    warnings: string[],
): Promise<CaseCollectionRow[]> {
    const { data, error } = await client
        .from('clinical_cases')
        .select('id, case_status, confirmed_diagnosis, label_type, resolved_at, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false })
        .limit(limit);

    if (error) {
        warnings.push(`clinical_cases unavailable: ${error.message}`);
        return [];
    }

    return (data ?? []) as CaseCollectionRow[];
}

async function loadOutcomeRows(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
    warnings: string[],
): Promise<OutcomeCollectionRow[]> {
    const { data, error } = await client
        .from('clinical_outcome_events')
        .select('id, case_id, outcome_type, outcome_payload, label_type, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        warnings.push(`clinical_outcome_events unavailable: ${error.message}`);
        return [];
    }

    return (data ?? []) as OutcomeCollectionRow[];
}

function isConfirmedCase(row: CaseCollectionRow): boolean {
    return readText(row.case_status) === 'closed'
        || readText(row.confirmed_diagnosis) !== null
        || readText(row.resolved_at) !== null
        || readText(row.label_type) === 'expert_reviewed'
        || readText(row.label_type) === 'lab_confirmed';
}

function isConfirmedOutcome(row: OutcomeCollectionRow, payload: Record<string, unknown>): boolean {
    const outcomeType = readText(row.outcome_type)?.toLowerCase() ?? '';
    return outcomeType.includes('confirmed')
        || readOutcomeLabel(row, payload) !== null;
}

function readOutcomeLabel(row: OutcomeCollectionRow, payload: Record<string, unknown>): string | null {
    return readText(payload.confirmed_diagnosis)
        ?? readText(payload.actual_diagnosis)
        ?? readText(payload.actual_label)
        ?? readText(payload.label)
        ?? readText(row.label_type);
}

function hasDeidentifiedLearningConsent(payload: Record<string, unknown>): boolean {
    const consent = asRecord(payload.learning_consent);
    return consent.deidentified_training === true;
}

function increment(map: Map<string, number>, rawLabel: string) {
    const label = rawLabel.replace(/\s+/g, ' ').trim();
    if (!label) return;
    map.set(label, (map.get(label) ?? 0) + 1);
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function readTimestamp(value: unknown): number | null {
    const text = readText(value);
    if (!text) return null;
    const parsed = new Date(text).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
