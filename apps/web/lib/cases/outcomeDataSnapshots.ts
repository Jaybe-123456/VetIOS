import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildOpenCaseClosureDigest,
    type CaseClosureDigest,
} from '@/lib/cases/caseClosureMetrics';
import type { CaseSummary } from '@/lib/cases/caseWorkflow';
import type { ConfirmedCaseCollectionStats } from '@/lib/cases/confirmedCaseCollection';

export interface OutcomeDataSnapshot {
    tenant_id: string;
    snapshot_key: string;
    snapshot_date: string;
    total_cases: number;
    confirmed_cases: number;
    pending_cases: number;
    outcome_events: number;
    deidentified_learning_signals: number;
    confirmed_last_7d: number;
    label_count: number;
    validation_target: number;
    validation_progress: number;
    ready_for_validation: boolean;
    open_cases: number;
    closed_cases: number;
    overdue_open_cases: number;
    closure_rate: number;
    inferred_closure_rate: number;
    average_hours_to_closure: number | null;
    median_hours_to_closure: number | null;
    top_labels: Array<{ label: string; count: number }>;
    closure_backlog: Array<{
        case_id: string;
        age_hours: number;
        overdue: boolean;
        closure_ready: boolean;
        recommended_action: string;
    }>;
    metrics_payload: Record<string, unknown>;
    warnings: string[];
    generated_from: string;
}

export interface PersistOutcomeDataSnapshotResult {
    snapshot: OutcomeDataSnapshot;
    stored: boolean;
    warning: string | null;
}

const DIGEST_LIMIT = 12;
const OVERDUE_HOURS = 24;

export function buildOutcomeDataSnapshot(input: {
    tenantId: string;
    cases: CaseSummary[];
    collectionStats: ConfirmedCaseCollectionStats;
    now?: Date;
    digest?: CaseClosureDigest;
}): OutcomeDataSnapshot {
    const now = input.now ?? new Date();
    const snapshotDate = now.toISOString().slice(0, 10);
    const digest = input.digest ?? buildOpenCaseClosureDigest(input.cases, {
        now,
        overdueHours: OVERDUE_HOURS,
        limit: DIGEST_LIMIT,
    });
    const validationProgress = input.collectionStats.milestone_target > 0
        ? roundRatio(input.collectionStats.confirmed_cases / input.collectionStats.milestone_target)
        : 0;

    return {
        tenant_id: input.tenantId,
        snapshot_key: snapshotKey(input.tenantId, snapshotDate),
        snapshot_date: snapshotDate,
        total_cases: input.collectionStats.total_cases,
        confirmed_cases: input.collectionStats.confirmed_cases,
        pending_cases: input.collectionStats.pending_cases,
        outcome_events: input.collectionStats.outcome_events,
        deidentified_learning_signals: input.collectionStats.deidentified_learning_signals,
        confirmed_last_7d: input.collectionStats.confirmed_last_7d,
        label_count: input.collectionStats.label_count,
        validation_target: input.collectionStats.milestone_target,
        validation_progress: validationProgress,
        ready_for_validation: input.collectionStats.ready_for_validation,
        open_cases: digest.metrics.open_cases,
        closed_cases: digest.metrics.closed_cases,
        overdue_open_cases: digest.metrics.overdue_open_cases,
        closure_rate: digest.metrics.closure_rate,
        inferred_closure_rate: digest.metrics.inferred_closure_rate,
        average_hours_to_closure: digest.metrics.average_hours_to_closure,
        median_hours_to_closure: digest.metrics.median_hours_to_closure,
        top_labels: input.collectionStats.top_labels,
        closure_backlog: digest.items.map((item) => ({
            case_id: item.case_id,
            age_hours: item.age_hours,
            overdue: item.overdue,
            closure_ready: item.closure_ready,
            recommended_action: item.recommended_action,
        })),
        metrics_payload: {
            generated_at: digest.generated_at,
            overdue_hours: digest.overdue_hours,
            truncated: digest.truncated,
            closure_metrics: digest.metrics,
            collection_updated_at: input.collectionStats.updated_at,
        },
        warnings: input.collectionStats.warnings,
        generated_from: 'case_closure_digest',
    };
}

export async function persistOutcomeDataSnapshot(
    client: SupabaseClient,
    input: {
        tenantId: string;
        cases: CaseSummary[];
        collectionStats: ConfirmedCaseCollectionStats;
        now?: Date;
        digest?: CaseClosureDigest;
    },
): Promise<PersistOutcomeDataSnapshotResult> {
    const snapshot = buildOutcomeDataSnapshot(input);
    const { error } = await client
        .from('clinical_outcome_moat_snapshots')
        .upsert(toDatabaseRow(snapshot), {
            onConflict: 'snapshot_key',
            ignoreDuplicates: true,
        });

    if (error) {
        if (isMissingSnapshotTable(error)) {
            return {
                snapshot,
                stored: false,
                warning: 'clinical_outcome_moat_snapshots table is not available; apply the outcome data moat migration.',
            };
        }
        throw new Error(`Failed to persist outcome data moat snapshot: ${error.message}`);
    }

    return { snapshot, stored: true, warning: null };
}

export async function loadLatestOutcomeDataSnapshot(
    client: SupabaseClient,
    tenantId: string,
): Promise<OutcomeDataSnapshot | null> {
    const { data, error } = await client
        .from('clinical_outcome_moat_snapshots')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('snapshot_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        if (isMissingSnapshotTable(error)) return null;
        throw new Error(`Failed to load outcome data moat snapshot: ${error.message}`);
    }

    return data ? fromDatabaseRow(data as Record<string, unknown>) : null;
}

function snapshotKey(tenantId: string, snapshotDate: string): string {
    return createHash('sha256')
        .update(`outcome-data:${tenantId}:${snapshotDate}`)
        .digest('hex');
}

function roundRatio(value: number): number {
    return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function toDatabaseRow(snapshot: OutcomeDataSnapshot): Record<string, unknown> {
    return {
        ...snapshot,
        top_labels: snapshot.top_labels,
        closure_backlog: snapshot.closure_backlog,
        metrics_payload: snapshot.metrics_payload,
    };
}

function fromDatabaseRow(row: Record<string, unknown>): OutcomeDataSnapshot {
    return {
        tenant_id: readText(row.tenant_id) ?? '',
        snapshot_key: readText(row.snapshot_key) ?? '',
        snapshot_date: readText(row.snapshot_date) ?? '',
        total_cases: readNumber(row.total_cases),
        confirmed_cases: readNumber(row.confirmed_cases),
        pending_cases: readNumber(row.pending_cases),
        outcome_events: readNumber(row.outcome_events),
        deidentified_learning_signals: readNumber(row.deidentified_learning_signals),
        confirmed_last_7d: readNumber(row.confirmed_last_7d),
        label_count: readNumber(row.label_count),
        validation_target: readNumber(row.validation_target),
        validation_progress: readNumber(row.validation_progress),
        ready_for_validation: row.ready_for_validation === true,
        open_cases: readNumber(row.open_cases),
        closed_cases: readNumber(row.closed_cases),
        overdue_open_cases: readNumber(row.overdue_open_cases),
        closure_rate: readNumber(row.closure_rate),
        inferred_closure_rate: readNumber(row.inferred_closure_rate),
        average_hours_to_closure: readNullableNumber(row.average_hours_to_closure),
        median_hours_to_closure: readNullableNumber(row.median_hours_to_closure),
        top_labels: readArray(row.top_labels),
        closure_backlog: readArray(row.closure_backlog),
        metrics_payload: readRecord(row.metrics_payload),
        warnings: readStringArray(row.warnings),
        generated_from: readText(row.generated_from) ?? 'case_closure_digest',
    };
}

function isMissingSnapshotTable(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42P01'
        || error.code === 'PGRST116'
        || message.includes('clinical_outcome_moat_snapshots')
        || message.includes('schema cache');
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readNullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}
