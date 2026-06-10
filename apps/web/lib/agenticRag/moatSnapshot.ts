import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RagReadinessSummary } from './types';

export type AgenticRagMoatStatus = 'compounding' | 'forming' | 'blocked';
export type AgenticRagEvidenceFreshness = 'fresh' | 'stale' | 'empty';

export interface AgenticRagMoatSnapshot {
    tenant_id: string;
    snapshot_key: string;
    snapshot_date: string;
    sources: number;
    documents: number;
    chunks: number;
    high_authority_sources: number;
    stale_documents: number;
    last_refreshed_at: string | null;
    ready: boolean;
    query_count_30d: number;
    grounded_queries_30d: number;
    grounding_rate: number;
    citation_coverage_avg: number;
    unsupported_claims_30d: number;
    catalog_fallback_queries_30d: number;
    catalog_fallback_rate: number;
    withheld_citations_30d: number;
    feedback_events_30d: number;
    useful_feedback_30d: number;
    needs_review_feedback_30d: number;
    citation_usefulness_rate: number;
    avg_retrieval_ms: number | null;
    top_authority_tier: string | null;
    evidence_freshness: AgenticRagEvidenceFreshness;
    moat_status: AgenticRagMoatStatus;
    readiness_payload: RagReadinessSummary;
    query_metrics_payload: Record<string, unknown>;
    warnings: string[];
    generated_from: string;
}

export interface PersistAgenticRagMoatSnapshotResult {
    snapshot: AgenticRagMoatSnapshot;
    stored: boolean;
    warning: string | null;
}

interface RagQueryMetricRow {
    retrieval_strategy?: unknown;
    retrieval_stats?: unknown;
    evaluation?: unknown;
    created_at?: unknown;
}

interface RagFeedbackMetricRow {
    feedback_kind?: unknown;
    created_at?: unknown;
}

interface RagQueryAggregateMetrics {
    query_count_30d: number;
    grounded_queries_30d: number;
    grounding_rate: number;
    citation_coverage_avg: number;
    unsupported_claims_30d: number;
    catalog_fallback_queries_30d: number;
    catalog_fallback_rate: number;
    withheld_citations_30d: number;
    feedback_events_30d: number;
    useful_feedback_30d: number;
    needs_review_feedback_30d: number;
    citation_usefulness_rate: number;
    avg_retrieval_ms: number | null;
    top_authority_tier: string | null;
    strategy_counts: Record<string, number>;
    query_window_days: number;
    ledger_warning: string | null;
    feedback_warning: string | null;
}

const QUERY_WINDOW_DAYS = 30;
const QUERY_LEDGER_LIMIT = 500;

export async function persistAgenticRagMoatSnapshot(
    client: SupabaseClient,
    input: {
        tenantId: string;
        readiness: RagReadinessSummary;
        now?: Date;
    },
): Promise<PersistAgenticRagMoatSnapshotResult> {
    const queryMetrics = await loadRagQueryAggregateMetrics(client, input.tenantId, input.now);
    const snapshot = buildAgenticRagMoatSnapshot({
        tenantId: input.tenantId,
        readiness: input.readiness,
        queryMetrics,
        now: input.now,
    });

    const { error } = await client
        .from('agentic_rag_moat_snapshots')
        .upsert(toDatabaseRow(snapshot), {
            onConflict: 'snapshot_key',
            ignoreDuplicates: true,
        });

    if (error) {
        if (isMissingSnapshotTable(error)) {
            return {
                snapshot,
                stored: false,
                warning: 'agentic_rag_moat_snapshots table is not available; apply the Agentic RAG moat migration.',
            };
        }
        throw new Error(`Failed to persist Agentic RAG moat snapshot: ${error.message}`);
    }

    return { snapshot, stored: true, warning: null };
}

export async function loadLatestAgenticRagMoatSnapshot(
    client: SupabaseClient,
    tenantId: string,
): Promise<AgenticRagMoatSnapshot | null> {
    const { data, error } = await client
        .from('agentic_rag_moat_snapshots')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('snapshot_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        if (isMissingSnapshotTable(error)) return null;
        throw new Error(`Failed to load Agentic RAG moat snapshot: ${error.message}`);
    }

    return data ? fromDatabaseRow(data as Record<string, unknown>) : null;
}

export async function buildLiveAgenticRagMoatSnapshot(input: {
    client: SupabaseClient;
    tenantId: string;
    readiness: RagReadinessSummary;
    now?: Date;
}): Promise<AgenticRagMoatSnapshot> {
    const queryMetrics = await loadRagQueryAggregateMetrics(input.client, input.tenantId, input.now);
    return buildAgenticRagMoatSnapshot({
        tenantId: input.tenantId,
        readiness: input.readiness,
        queryMetrics,
        now: input.now,
    });
}

export function buildAgenticRagMoatSnapshot(input: {
    tenantId: string;
    readiness: RagReadinessSummary;
    queryMetrics?: Partial<RagQueryAggregateMetrics>;
    now?: Date;
}): AgenticRagMoatSnapshot {
    const now = input.now ?? new Date();
    const snapshotDate = now.toISOString().slice(0, 10);
    const queryMetrics = normalizeQueryMetrics(input.queryMetrics);
    const evidenceFreshness = classifyFreshness(input.readiness);
    const warnings = buildWarnings(input.readiness, queryMetrics, evidenceFreshness);
    const moatStatus = classifyMoatStatus(input.readiness, queryMetrics);

    return {
        tenant_id: input.tenantId,
        snapshot_key: snapshotKey(input.tenantId, snapshotDate),
        snapshot_date: snapshotDate,
        sources: input.readiness.sources,
        documents: input.readiness.documents,
        chunks: input.readiness.chunks,
        high_authority_sources: input.readiness.high_authority_sources,
        stale_documents: input.readiness.stale_documents,
        last_refreshed_at: input.readiness.last_refreshed_at,
        ready: input.readiness.ready,
        query_count_30d: queryMetrics.query_count_30d,
        grounded_queries_30d: queryMetrics.grounded_queries_30d,
        grounding_rate: queryMetrics.grounding_rate,
        citation_coverage_avg: queryMetrics.citation_coverage_avg,
        unsupported_claims_30d: queryMetrics.unsupported_claims_30d,
        catalog_fallback_queries_30d: queryMetrics.catalog_fallback_queries_30d,
        catalog_fallback_rate: queryMetrics.catalog_fallback_rate,
        withheld_citations_30d: queryMetrics.withheld_citations_30d,
        feedback_events_30d: queryMetrics.feedback_events_30d,
        useful_feedback_30d: queryMetrics.useful_feedback_30d,
        needs_review_feedback_30d: queryMetrics.needs_review_feedback_30d,
        citation_usefulness_rate: queryMetrics.citation_usefulness_rate,
        avg_retrieval_ms: queryMetrics.avg_retrieval_ms,
        top_authority_tier: queryMetrics.top_authority_tier,
        evidence_freshness: evidenceFreshness,
        moat_status: moatStatus,
        readiness_payload: input.readiness,
        query_metrics_payload: {
            query_window_days: QUERY_WINDOW_DAYS,
            strategy_counts: queryMetrics.strategy_counts,
            ledger_warning: queryMetrics.ledger_warning,
            feedback_warning: queryMetrics.feedback_warning,
        },
        warnings,
        generated_from: 'agentic_rag_query_ledger',
    };
}

async function loadRagQueryAggregateMetrics(
    client: SupabaseClient,
    tenantId: string,
    now: Date = new Date(),
): Promise<RagQueryAggregateMetrics> {
    const since = new Date(now.getTime() - QUERY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await client
        .from('rag_queries')
        .select('retrieval_strategy,retrieval_stats,evaluation,created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(QUERY_LEDGER_LIMIT);

    if (error) {
        if (isMissingRagQueryTable(error)) {
            return normalizeQueryMetrics({
                ledger_warning: 'RAG query ledger is not available; apply the Agentic RAG service migration.',
            });
        }
        throw new Error(`Failed to load Agentic RAG query metrics: ${error.message}`);
    }

    const queryMetrics = aggregateQueryRows(Array.isArray(data) ? data as RagQueryMetricRow[] : []);
    const feedbackMetrics = await loadRagFeedbackAggregateMetrics(client, tenantId, now);
    return normalizeQueryMetrics({
        ...queryMetrics,
        ...feedbackMetrics,
    });
}

async function loadRagFeedbackAggregateMetrics(
    client: SupabaseClient,
    tenantId: string,
    now: Date = new Date(),
): Promise<Partial<RagQueryAggregateMetrics>> {
    const since = new Date(now.getTime() - QUERY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await client
        .from('rag_citation_feedback_events')
        .select('feedback_kind,created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(QUERY_LEDGER_LIMIT);

    if (error) {
        if (isMissingFeedbackTable(error)) {
            return {
                feedback_warning: 'RAG citation feedback ledger is not available; apply supabase/migrations/20260610000000_agentic_rag_citation_feedback.sql.',
            };
        }
        throw new Error(`Failed to load Agentic RAG feedback metrics: ${error.message}`);
    }

    return aggregateFeedbackRows(Array.isArray(data) ? data as RagFeedbackMetricRow[] : []);
}

function aggregateQueryRows(rows: RagQueryMetricRow[]): RagQueryAggregateMetrics {
    let grounded = 0;
    let citationCoverageTotal = 0;
    let unsupportedClaims = 0;
    let catalogFallbackQueries = 0;
    let withheldCitations = 0;
    let retrievalMsTotal = 0;
    let retrievalMsCount = 0;
    const topAuthorityCounts: Record<string, number> = {};
    const strategyCounts: Record<string, number> = {};

    for (const row of rows) {
        const retrievalStats = readRecord(row.retrieval_stats);
        const evaluation = readRecord(row.evaluation);
        const strategy = readText(row.retrieval_strategy) ?? readText(retrievalStats.strategy) ?? 'unknown';
        strategyCounts[strategy] = (strategyCounts[strategy] ?? 0) + 1;

        if (evaluation.grounded === true) grounded += 1;
        citationCoverageTotal += clamp(readNumber(evaluation.citation_coverage));
        unsupportedClaims += readNumber(evaluation.unsupported_claims);
        if (readNumber(retrievalStats.catalog_fallback_hits) > 0) catalogFallbackQueries += 1;
        withheldCitations += readNumber(retrievalStats.withheld_citations);

        const retrievalMs = readNullableNumber(retrievalStats.retrieval_time_ms);
        if (retrievalMs !== null) {
            retrievalMsTotal += retrievalMs;
            retrievalMsCount += 1;
        }

        const authorityTier = readText(retrievalStats.top_authority_tier);
        if (authorityTier) topAuthorityCounts[authorityTier] = (topAuthorityCounts[authorityTier] ?? 0) + 1;
    }

    const queryCount = rows.length;
    return normalizeQueryMetrics({
        query_count_30d: queryCount,
        grounded_queries_30d: grounded,
        grounding_rate: queryCount > 0 ? grounded / queryCount : 0,
        citation_coverage_avg: queryCount > 0 ? citationCoverageTotal / queryCount : 0,
        unsupported_claims_30d: unsupportedClaims,
        catalog_fallback_queries_30d: catalogFallbackQueries,
        catalog_fallback_rate: queryCount > 0 ? catalogFallbackQueries / queryCount : 0,
        withheld_citations_30d: withheldCitations,
        avg_retrieval_ms: retrievalMsCount > 0 ? retrievalMsTotal / retrievalMsCount : null,
        top_authority_tier: mostCommon(topAuthorityCounts),
        strategy_counts: strategyCounts,
    });
}

function aggregateFeedbackRows(rows: RagFeedbackMetricRow[]): Partial<RagQueryAggregateMetrics> {
    let useful = 0;
    let needsReview = 0;

    for (const row of rows) {
        const kind = readText(row.feedback_kind);
        if (kind === 'answer_useful' || kind === 'citation_useful') useful += 1;
        if (kind === 'needs_review') needsReview += 1;
    }

    return {
        feedback_events_30d: rows.length,
        useful_feedback_30d: useful,
        needs_review_feedback_30d: needsReview,
        citation_usefulness_rate: rows.length > 0 ? useful / rows.length : 0,
    };
}

function normalizeQueryMetrics(metrics?: Partial<RagQueryAggregateMetrics>): RagQueryAggregateMetrics {
    const queryCount = Math.max(0, Math.round(metrics?.query_count_30d ?? 0));
    const groundedQueries = Math.max(0, Math.round(metrics?.grounded_queries_30d ?? 0));
    const catalogFallbackQueries = Math.max(0, Math.round(metrics?.catalog_fallback_queries_30d ?? 0));
    return {
        query_count_30d: queryCount,
        grounded_queries_30d: groundedQueries,
        grounding_rate: roundRatio(metrics?.grounding_rate ?? (queryCount > 0 ? groundedQueries / queryCount : 0)),
        citation_coverage_avg: roundRatio(metrics?.citation_coverage_avg ?? 0),
        unsupported_claims_30d: Math.max(0, Math.round(metrics?.unsupported_claims_30d ?? 0)),
        catalog_fallback_queries_30d: catalogFallbackQueries,
        catalog_fallback_rate: roundRatio(metrics?.catalog_fallback_rate ?? (queryCount > 0 ? catalogFallbackQueries / queryCount : 0)),
        withheld_citations_30d: Math.max(0, Math.round(metrics?.withheld_citations_30d ?? 0)),
        feedback_events_30d: Math.max(0, Math.round(metrics?.feedback_events_30d ?? 0)),
        useful_feedback_30d: Math.max(0, Math.round(metrics?.useful_feedback_30d ?? 0)),
        needs_review_feedback_30d: Math.max(0, Math.round(metrics?.needs_review_feedback_30d ?? 0)),
        citation_usefulness_rate: roundRatio(metrics?.citation_usefulness_rate ?? 0),
        avg_retrieval_ms: roundNullable(metrics?.avg_retrieval_ms),
        top_authority_tier: readText(metrics?.top_authority_tier) ?? null,
        strategy_counts: sanitizeStrategyCounts(readRecord(metrics?.strategy_counts)),
        query_window_days: QUERY_WINDOW_DAYS,
        ledger_warning: readText(metrics?.ledger_warning),
        feedback_warning: readText(metrics?.feedback_warning),
    };
}

function classifyFreshness(readiness: RagReadinessSummary): AgenticRagEvidenceFreshness {
    if (readiness.documents === 0 || readiness.chunks === 0) return 'empty';
    return readiness.stale_documents > 0 ? 'stale' : 'fresh';
}

function classifyMoatStatus(readiness: RagReadinessSummary, metrics: RagQueryAggregateMetrics): AgenticRagMoatStatus {
    if (!readiness.ready || readiness.chunks === 0) return 'blocked';
    if (
        metrics.query_count_30d >= 10
        && metrics.grounding_rate >= 0.8
        && metrics.catalog_fallback_rate <= 0.2
        && metrics.feedback_events_30d >= 5
        && metrics.citation_usefulness_rate >= 0.65
    ) {
        return 'compounding';
    }
    return 'forming';
}

function buildWarnings(
    readiness: RagReadinessSummary,
    metrics: RagQueryAggregateMetrics,
    evidenceFreshness: AgenticRagEvidenceFreshness,
): string[] {
    const warnings = [...readiness.warnings];
    if (metrics.ledger_warning) warnings.push(metrics.ledger_warning);
    if (metrics.feedback_warning) warnings.push(metrics.feedback_warning);
    if (evidenceFreshness === 'empty') warnings.push('Agentic RAG has no indexed evidence corpus yet.');
    if (evidenceFreshness === 'stale') warnings.push('Agentic RAG evidence freshness is degraded by stale or failed documents.');
    if (metrics.query_count_30d === 0) warnings.push('No RAG query ledger activity in the last 30 days.');
    if (metrics.query_count_30d > 0 && metrics.grounding_rate < 0.8) warnings.push('Grounded answer rate is below the 80% operating target.');
    if (metrics.query_count_30d > 0 && metrics.feedback_events_30d === 0) warnings.push('No citation usefulness feedback has been recorded for recent RAG answers.');
    if (metrics.feedback_events_30d > 0 && metrics.citation_usefulness_rate < 0.65) warnings.push('Citation usefulness feedback is below the 65% operating target.');
    if (metrics.catalog_fallback_rate > 0.2) warnings.push('Built-in catalog fallback is carrying more than 20% of recent RAG answers.');
    return Array.from(new Set(warnings));
}

function snapshotKey(tenantId: string, snapshotDate: string): string {
    return createHash('sha256')
        .update(`agentic-rag:${tenantId}:${snapshotDate}`)
        .digest('hex');
}

function toDatabaseRow(snapshot: AgenticRagMoatSnapshot): Record<string, unknown> {
    return { ...snapshot };
}

function fromDatabaseRow(row: Record<string, unknown>): AgenticRagMoatSnapshot {
    return {
        tenant_id: readText(row.tenant_id) ?? '',
        snapshot_key: readText(row.snapshot_key) ?? '',
        snapshot_date: readText(row.snapshot_date) ?? '',
        sources: readNumber(row.sources),
        documents: readNumber(row.documents),
        chunks: readNumber(row.chunks),
        high_authority_sources: readNumber(row.high_authority_sources),
        stale_documents: readNumber(row.stale_documents),
        last_refreshed_at: readText(row.last_refreshed_at),
        ready: row.ready === true,
        query_count_30d: readNumber(row.query_count_30d),
        grounded_queries_30d: readNumber(row.grounded_queries_30d),
        grounding_rate: readNumber(row.grounding_rate),
        citation_coverage_avg: readNumber(row.citation_coverage_avg),
        unsupported_claims_30d: readNumber(row.unsupported_claims_30d),
        catalog_fallback_queries_30d: readNumber(row.catalog_fallback_queries_30d),
        catalog_fallback_rate: readNumber(row.catalog_fallback_rate),
        withheld_citations_30d: readNumber(row.withheld_citations_30d),
        feedback_events_30d: readNumber(row.feedback_events_30d),
        useful_feedback_30d: readNumber(row.useful_feedback_30d),
        needs_review_feedback_30d: readNumber(row.needs_review_feedback_30d),
        citation_usefulness_rate: readNumber(row.citation_usefulness_rate),
        avg_retrieval_ms: readNullableNumber(row.avg_retrieval_ms),
        top_authority_tier: readText(row.top_authority_tier),
        evidence_freshness: readFreshness(row.evidence_freshness),
        moat_status: readMoatStatus(row.moat_status),
        readiness_payload: readRecord(row.readiness_payload) as unknown as RagReadinessSummary,
        query_metrics_payload: readRecord(row.query_metrics_payload),
        warnings: readStringArray(row.warnings),
        generated_from: readText(row.generated_from) ?? 'agentic_rag_query_ledger',
    };
}

function isMissingSnapshotTable(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42P01'
        || error.code === 'PGRST116'
        || message.includes('agentic_rag_moat_snapshots')
        || message.includes('schema cache');
}

function isMissingRagQueryTable(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42P01'
        || error.code === 'PGRST116'
        || message.includes('rag_queries')
        || message.includes('schema cache');
}

function isMissingFeedbackTable(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42P01'
        || error.code === 'PGRST116'
        || message.includes('rag_citation_feedback_events')
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

function readRecord(value: unknown): Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, any>
        : {};
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}

function readFreshness(value: unknown): AgenticRagEvidenceFreshness {
    return value === 'fresh' || value === 'stale' || value === 'empty' ? value : 'empty';
}

function readMoatStatus(value: unknown): AgenticRagMoatStatus {
    return value === 'compounding' || value === 'forming' || value === 'blocked' ? value : 'blocked';
}

function sanitizeStrategyCounts(value: Record<string, unknown>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [key, count] of Object.entries(value)) {
        const safeKey = /^[a-z_]{2,40}$/.test(key) ? key : 'unknown';
        counts[safeKey] = (counts[safeKey] ?? 0) + readNumber(count);
    }
    return counts;
}

function mostCommon(counts: Record<string, number>): string | null {
    let winner: string | null = null;
    let max = 0;
    for (const [key, count] of Object.entries(counts)) {
        if (count > max) {
            winner = key;
            max = count;
        }
    }
    return winner;
}

function clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function roundRatio(value: number): number {
    return Number(clamp(value).toFixed(4));
}

function roundNullable(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}
