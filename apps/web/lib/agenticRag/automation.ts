import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCatalogDocumentPlans } from './catalogConnectors';
import { getRagEmbeddingReadiness } from './embedding';
import { ingestRagDocument } from './service';
import { getCuratedRagCatalog, type CuratedRagSourceDefinition } from './sourceCatalog';
import type {
    RagChunkRecord,
    RagDocumentRecord,
    RagReadinessSummary,
    RagSourceRecord,
    RagVeterinaryCorpusReadiness,
} from './types';
import {
    buildVeterinaryCorpusAuditEventDraft,
    buildVeterinaryCorpusManifest,
    summarizeVeterinaryCorpusManifest,
} from './veterinaryCorpus';

const MAX_CORPUS_READINESS_ROWS = 5_000;

export interface RagCatalogRunResult {
    run_id: string | null;
    run_mode: 'catalog_seed' | 'catalog_refresh';
    catalog_total: number;
    batch_size: number;
    cursor: string | null;
    next_cursor: string | null;
    has_more: boolean;
    remote_mode: RagCatalogRemoteMode;
    sources_attempted: number;
    sources_indexed: number;
    documents_indexed: number;
    chunks_indexed: number;
    corpus_audit_event_id: string | null;
    readiness: RagReadinessSummary;
    warnings: string[];
    errors: Array<{ source: string; message: string }>;
}

export type RagCatalogRemoteMode = 'summaries_only' | 'full_remote';

export async function seedCuratedRagCatalog(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    forceRefresh?: boolean;
    batchSize?: number;
    cursor?: string | null;
    remoteMode?: RagCatalogRemoteMode;
}): Promise<RagCatalogRunResult> {
    return runCuratedCatalogJob({
        ...input,
        runMode: input.forceRefresh ? 'catalog_refresh' : 'catalog_seed',
        remoteMode: input.remoteMode ?? 'summaries_only',
    });
}

export async function refreshCuratedRagCatalog(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    onlyDue?: boolean;
    batchSize?: number;
    cursor?: string | null;
    remoteMode?: RagCatalogRemoteMode;
}): Promise<RagCatalogRunResult> {
    return runCuratedCatalogJob({
        ...input,
        runMode: 'catalog_refresh',
        onlyDue: input.onlyDue ?? true,
        forceRefresh: true,
        remoteMode: input.remoteMode ?? 'full_remote',
    });
}

export async function evaluateRagReadiness(client: SupabaseClient, tenantId: string): Promise<RagReadinessSummary> {
    const [schemaCheck, sourceRows, documentRows, chunkRows, highAuthorityRows, staleDocumentRows, lastRefresh, veterinaryCorpus] = await Promise.all([
        checkRagSchema(client, tenantId),
        countRows(client, 'rag_sources', tenantId),
        countRows(client, 'rag_documents', tenantId),
        countRows(client, 'rag_chunks', tenantId),
        countRows(client, 'rag_sources', tenantId, (query) => query.in('authority_tier', ['peer_reviewed', 'specialist_guideline', 'regulatory', 'institutional'])),
        countRows(client, 'rag_documents', tenantId, (query) => query.in('refresh_status', ['stale', 'failed'])),
        latestRefresh(client, tenantId),
        loadVeterinaryCorpusReadiness(client, tenantId),
    ]);

    const sources = sourceRows.count;
    const documents = documentRows.count;
    const chunks = chunkRows.count;
    const highAuthoritySources = highAuthorityRows.count;
    const staleDocuments = staleDocumentRows.count;
    const embeddingReadiness = getRagEmbeddingReadiness();
    const schemaErrors = [schemaCheck, sourceRows, documentRows, chunkRows, highAuthorityRows, staleDocumentRows, veterinaryCorpus]
        .map((result) => result.error)
        .filter((error): error is string => Boolean(error));
    const warnings: string[] = [];
    if (schemaErrors.length > 0) {
        if (schemaErrors.some(isMissingRagSchemaError)) {
            warnings.push('RAG database schema is missing. Apply supabase/migrations/20260510000000_agentic_rag_service.sql and supabase/migrations/20260510010000_agentic_rag_automation.sql, then rerun Seed Catalog.');
        } else {
            warnings.push(`RAG readiness check could not query the corpus tables: ${schemaErrors[0]}`);
        }
    }
    if (sources === 0) warnings.push('No RAG sources are registered.');
    if (documents === 0) warnings.push('No RAG documents are indexed.');
    if (chunks === 0) warnings.push('No retrieval chunks are available.');
    if (highAuthoritySources === 0) warnings.push('No high-authority veterinary or medical sources are indexed.');
    if (staleDocuments > 0) warnings.push(`${staleDocuments} indexed document(s) need refresh or review.`);
    if (veterinaryCorpus.summary) {
        if (veterinaryCorpus.summary.moat_status !== 'operating') {
            warnings.push(`Veterinary corpus moat is ${veterinaryCorpus.summary.moat_status}; source-version, authorization, or domain coverage evidence is incomplete.`);
        }
        warnings.push(...veterinaryCorpus.summary.blockers.map((blocker) => `Veterinary corpus blocker: ${blocker}`));
        warnings.push(...veterinaryCorpus.summary.warnings.slice(0, 8).map((warning) => `Veterinary corpus warning: ${warning}`));
    }
    warnings.push(...embeddingReadiness.warnings);

    return {
        sources,
        documents,
        chunks,
        high_authority_sources: highAuthoritySources,
        stale_documents: staleDocuments,
        last_refreshed_at: lastRefresh,
        embedding_mode: embeddingReadiness.embedding_mode,
        embedding_model: embeddingReadiness.embedding_model,
        embedding_dimensions: embeddingReadiness.embedding_dimensions,
        embedding_live_provider_configured: embeddingReadiness.embedding_live_provider_configured,
        veterinary_corpus: veterinaryCorpus.summary,
        ready: sources > 0 && documents > 0 && chunks > 0 && highAuthoritySources > 0,
        warnings,
    };
}

async function loadVeterinaryCorpusReadiness(
    client: SupabaseClient,
    tenantId: string,
): Promise<{ summary: RagVeterinaryCorpusReadiness | null; error: string | null }> {
    const [sources, documents, chunks] = await Promise.all([
        loadCorpusRows<RagSourceRecord>(client, 'rag_sources', tenantId),
        loadCorpusRows<RagDocumentRecord>(client, 'rag_documents', tenantId),
        loadCorpusRows<RagChunkRecord>(client, 'rag_chunks', tenantId),
    ]);
    const error = sources.error ?? documents.error ?? chunks.error;
    if (error) return { summary: null, error };

    const manifest = buildVeterinaryCorpusManifest({
        sources: sources.rows,
        documents: documents.rows,
        chunks: chunks.rows,
    });
    const summary = summarizeVeterinaryCorpusManifest(manifest);
    const capped = sources.capped || documents.capped || chunks.capped;
    if (capped) {
        return {
            summary: {
                ...summary,
                warnings: [
                    ...summary.warnings,
                    `Corpus readiness manifest is capped at ${MAX_CORPUS_READINESS_ROWS} rows per table; use offline audit export for full-corpus certification.`,
                ],
            },
            error: null,
        };
    }
    return { summary, error: null };
}

async function loadCorpusRows<T>(
    client: SupabaseClient,
    table: string,
    tenantId: string,
): Promise<{ rows: T[]; capped: boolean; error: string | null }> {
    const { data, error } = await client
        .from(table)
        .select('*')
        .eq('tenant_id', tenantId)
        .limit(MAX_CORPUS_READINESS_ROWS + 1);

    const rows = (data ?? []) as T[];
    return {
        rows: rows.slice(0, MAX_CORPUS_READINESS_ROWS),
        capped: rows.length > MAX_CORPUS_READINESS_ROWS,
        error: error?.message ?? null,
    };
}

async function runCuratedCatalogJob(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    runMode: 'catalog_seed' | 'catalog_refresh';
    onlyDue?: boolean;
    forceRefresh?: boolean;
    batchSize?: number;
    cursor?: string | null;
    remoteMode?: RagCatalogRemoteMode;
}): Promise<RagCatalogRunResult> {
    const catalog = getCuratedRagCatalog();
    const warnings: string[] = [];
    const batchSelection = selectCatalogBatch({
        catalog,
        cursor: input.cursor ?? null,
        batchSize: input.batchSize,
    });
    warnings.push(...batchSelection.warnings);
    if (batchSelection.hasMore) {
        warnings.push('Catalog refresh is running in batches to avoid Vercel function timeouts. Continue with next_cursor to finish the catalog.');
    }
    const remoteMode = input.remoteMode ?? 'full_remote';
    const runId = await createRefreshRun(input.client, {
        tenantId: input.tenantId,
        actorKind: input.actorLabel ?? 'system',
        runMode: input.runMode,
        sourcesAttempted: batchSelection.batch.length,
    });

    let sourcesIndexed = 0;
    let documentsIndexed = 0;
    let chunksIndexed = 0;
    const errors: Array<{ source: string; message: string }> = [];

    for (const definition of batchSelection.batch) {
        try {
            if (input.onlyDue && !await sourceIsDue(input.client, input.tenantId, definition)) {
                continue;
            }

            const result = await ingestCatalogDefinition({
                ...input,
                includeRemoteSnapshots: remoteMode === 'full_remote',
                includeConnectors: remoteMode === 'full_remote',
            }, definition);
            sourcesIndexed += 1;
            documentsIndexed += result.documents_indexed;
            chunksIndexed += result.chunks_indexed;
            for (const warning of result.connector_warnings) {
                errors.push({
                    source: definition.external_key,
                    message: warning,
                });
            }
        } catch (error) {
            errors.push({
                source: definition.external_key,
                message: error instanceof Error ? error.message : 'Unknown RAG catalog ingest failure',
            });
        }
    }

    const readiness = await evaluateRagReadiness(input.client, input.tenantId);
    await completeRefreshRun(input.client, {
        runId,
        status: errors.length === 0 ? 'completed' : sourcesIndexed > 0 ? 'partial' : 'failed',
        sourcesIndexed,
        documentsIndexed,
        chunksIndexed,
        readiness,
        errors,
    });
    const corpusAudit = await persistVeterinaryCorpusAuditEvent(input.client, {
        tenantId: input.tenantId,
        refreshRunId: runId,
        auditType: input.runMode,
        evidence: {
            catalog_total: catalog.length,
            batch_size: batchSelection.batchSize,
            cursor: input.cursor ?? null,
            next_cursor: batchSelection.nextCursor,
            has_more: batchSelection.hasMore,
            remote_mode: remoteMode,
            sources_attempted: batchSelection.batch.length,
            sources_indexed: sourcesIndexed,
            documents_indexed: documentsIndexed,
            chunks_indexed: chunksIndexed,
            error_count: errors.length,
        },
    });
    if (corpusAudit.warning) warnings.push(corpusAudit.warning);

    return {
        run_id: runId,
        run_mode: input.runMode,
        catalog_total: catalog.length,
        batch_size: batchSelection.batchSize,
        cursor: input.cursor ?? null,
        next_cursor: batchSelection.nextCursor,
        has_more: batchSelection.hasMore,
        remote_mode: remoteMode,
        sources_attempted: batchSelection.batch.length,
        sources_indexed: sourcesIndexed,
        documents_indexed: documentsIndexed,
        chunks_indexed: chunksIndexed,
        corpus_audit_event_id: corpusAudit.id,
        readiness,
        warnings,
        errors,
    };
}

async function ingestCatalogDefinition(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    forceRefresh?: boolean;
    includeRemoteSnapshots?: boolean;
    includeConnectors?: boolean;
}, definition: CuratedRagSourceDefinition) {
    const now = new Date();
    const nextRefresh = addDaysIso(now, definition.refresh_policy.refresh_interval_days);
    const plan = await buildCatalogDocumentPlans({
        definition,
        now,
        includeRemoteSnapshots: input.includeRemoteSnapshots,
        includeConnectors: input.includeConnectors,
    });
    const connectorWarnings = [...plan.connector_warnings];
    const results = [];

    for (const documentPlan of plan.documents) {
        try {
            results.push(await ingestRagDocument({
                tenantId: input.tenantId,
                actorLabel: input.actorLabel,
                client: input.client,
                source: buildSourceInput(definition),
                document: documentPlan.document,
                chunking: documentPlan.chunking,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown catalog document ingest failure';
            if (!documentPlan.optional) throw new Error(message);
            connectorWarnings.push(`${documentPlan.document.title}: ${message}`);
        }
    }

    if (results.length === 0) {
        throw new Error('No catalog documents were indexed for this source.');
    }

    await input.client
        .from('rag_sources')
        .update({
            refresh_policy: definition.refresh_policy,
            quality_score: authorityQualityScore(definition.authority_tier),
            last_refreshed_at: now.toISOString(),
            next_refresh_at: nextRefresh,
            updated_at: now.toISOString(),
        })
        .eq('tenant_id', input.tenantId)
        .eq('id', results[0].source.id);

    return {
        source: results[0].source,
        documents_indexed: results.length,
        chunks_indexed: results.reduce((sum, result) => sum + result.chunks_indexed, 0),
        connector_warnings: connectorWarnings,
    };
}

function buildSourceInput(definition: CuratedRagSourceDefinition) {
    return {
        external_key: definition.external_key,
        name: definition.name,
        source_type: definition.source_type,
        authority_tier: definition.authority_tier,
        species_scope: definition.species_scope,
        medicine_domain: definition.medicine_domain,
        url: definition.url,
        license: definition.license,
        attribution: definition.attribution,
        ingestion_policy: {
            ...definition.ingestion_policy,
            curated_catalog: true,
            source_catalog_version: '2026-05-10',
        },
        refresh_policy: definition.refresh_policy,
    };
}

async function sourceIsDue(client: SupabaseClient, tenantId: string, definition: CuratedRagSourceDefinition): Promise<boolean> {
    const { data, error } = await client
        .from('rag_sources')
        .select('next_refresh_at')
        .eq('tenant_id', tenantId)
        .eq('external_key', definition.external_key)
        .maybeSingle();

    if (error || !data) return true;
    const nextRefresh = typeof data.next_refresh_at === 'string' ? Date.parse(data.next_refresh_at) : Number.NaN;
    return Number.isNaN(nextRefresh) || nextRefresh <= Date.now();
}

async function createRefreshRun(client: SupabaseClient, input: {
    tenantId: string;
    actorKind: string;
    runMode: 'catalog_seed' | 'catalog_refresh';
    sourcesAttempted: number;
}): Promise<string | null> {
    const { data, error } = await client
        .from('rag_source_refresh_runs')
        .insert({
            tenant_id: input.tenantId,
            actor_kind: input.actorKind,
            run_mode: input.runMode,
            sources_attempted: input.sourcesAttempted,
            status: 'running',
        })
        .select('id')
        .single();

    if (error || !data?.id) return null;
    return String(data.id);
}

async function completeRefreshRun(client: SupabaseClient, input: {
    runId: string | null;
    status: 'completed' | 'partial' | 'failed';
    sourcesIndexed: number;
    documentsIndexed: number;
    chunksIndexed: number;
    readiness: RagReadinessSummary;
    errors: Array<{ source: string; message: string }>;
}): Promise<void> {
    if (!input.runId) return;
    await client
        .from('rag_source_refresh_runs')
        .update({
            status: input.status,
            sources_indexed: input.sourcesIndexed,
            documents_indexed: input.documentsIndexed,
            chunks_indexed: input.chunksIndexed,
            evaluation: input.readiness,
            errors: input.errors,
            completed_at: new Date().toISOString(),
        })
        .eq('id', input.runId);
}

async function persistVeterinaryCorpusAuditEvent(client: SupabaseClient, input: {
    tenantId: string;
    refreshRunId: string | null;
    auditType: 'catalog_seed' | 'catalog_refresh';
    evidence: Record<string, unknown>;
}): Promise<{ id: string | null; warning: string | null }> {
    const [sources, documents, chunks] = await Promise.all([
        loadCorpusRows<RagSourceRecord>(client, 'rag_sources', input.tenantId),
        loadCorpusRows<RagDocumentRecord>(client, 'rag_documents', input.tenantId),
        loadCorpusRows<RagChunkRecord>(client, 'rag_chunks', input.tenantId),
    ]);
    const loadError = sources.error ?? documents.error ?? chunks.error;
    if (loadError) {
        return {
            id: null,
            warning: `Veterinary corpus audit event was not persisted because corpus rows could not be loaded: ${loadError}`,
        };
    }

    const manifest = buildVeterinaryCorpusManifest({
        sources: sources.rows,
        documents: documents.rows,
        chunks: chunks.rows,
    });
    const draft = buildVeterinaryCorpusAuditEventDraft({
        tenantId: input.tenantId,
        refreshRunId: input.refreshRunId,
        auditType: input.auditType,
        manifest,
        evidence: {
            ...input.evidence,
            capped_source_rows: sources.capped,
            capped_document_rows: documents.capped,
            capped_chunk_rows: chunks.capped,
        },
    });
    const { data, error } = await client
        .from('veterinary_retrieval_corpus_audit_events')
        .insert(draft)
        .select('id')
        .single();

    if (error || !data?.id) {
        const message = error?.message ?? 'unknown persistence failure';
        return {
            id: null,
            warning: isMissingCorpusAuditStorage(message)
                ? 'Veterinary corpus audit ledger is not installed; apply supabase/migrations/20260622010000_veterinary_retrieval_corpus_audit_events.sql to persist corpus audit evidence.'
                : `Veterinary corpus audit event was not persisted: ${message}`,
        };
    }

    return { id: String(data.id), warning: null };
}

function isMissingCorpusAuditStorage(message: string): boolean {
    return message.includes('veterinary_retrieval_corpus_audit_events')
        && (
            message.includes('does not exist')
            || message.includes('Could not find the table')
            || message.includes('schema cache')
        );
}

async function countRows(
    client: SupabaseClient,
    table: string,
    tenantId: string,
    refine?: (query: any) => any,
): Promise<{ count: number; error: string | null }> {
    let query = client.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    if (refine) query = refine(query);
    const { count, error } = await query;
    return {
        count: count ?? 0,
        error: error?.message ?? null,
    };
}

async function checkRagSchema(
    client: SupabaseClient,
    tenantId: string,
): Promise<{ count: number; error: string | null }> {
    const { error } = await client
        .from('rag_sources')
        .select('id')
        .eq('tenant_id', tenantId)
        .limit(1);

    return {
        count: 0,
        error: error?.message ?? null,
    };
}

async function latestRefresh(client: SupabaseClient, tenantId: string): Promise<string | null> {
    const { data } = await client
        .from('rag_sources')
        .select('last_refreshed_at')
        .eq('tenant_id', tenantId)
        .not('last_refreshed_at', 'is', null)
        .order('last_refreshed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    return typeof data?.last_refreshed_at === 'string' ? data.last_refreshed_at : null;
}

function authorityQualityScore(tier: string): number {
    switch (tier) {
        case 'specialist_guideline': return 0.95;
        case 'peer_reviewed': return 0.9;
        case 'regulatory': return 0.88;
        case 'institutional': return 0.78;
        case 'clinic_local': return 0.6;
        default: return 0.35;
    }
}

function addDaysIso(date: Date, days: number): string {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isMissingRagSchemaError(message: string): boolean {
    return /Could not find the table 'public\.rag_|relation "public\.rag_|schema cache/i.test(message);
}

function selectCatalogBatch(input: {
    catalog: CuratedRagSourceDefinition[];
    cursor: string | null;
    batchSize?: number;
}): {
    batch: CuratedRagSourceDefinition[];
    batchSize: number;
    nextCursor: string | null;
    hasMore: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];
    const batchSize = normalizeCatalogBatchSize(input.batchSize, input.catalog.length);
    let startIndex = 0;

    if (input.cursor) {
        const cursorIndex = input.catalog.findIndex((definition) => definition.external_key === input.cursor);
        if (cursorIndex >= 0) {
            startIndex = cursorIndex + 1;
        } else {
            warnings.push(`Catalog cursor "${input.cursor}" was not found; refresh restarted at the beginning.`);
        }
    }

    const batch = input.catalog.slice(startIndex, startIndex + batchSize);
    const hasMore = startIndex + batch.length < input.catalog.length;
    const nextCursor = hasMore ? batch.at(-1)?.external_key ?? null : null;

    return {
        batch,
        batchSize,
        nextCursor,
        hasMore,
        warnings,
    };
}

function normalizeCatalogBatchSize(value: unknown, catalogLength: number): number {
    const fallback = catalogLength > 0 ? catalogLength : 1;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.floor(parsed), 1), Math.max(catalogLength, 1));
}
