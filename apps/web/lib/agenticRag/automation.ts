import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCatalogDocumentPlans } from './catalogConnectors';
import { ingestRagDocument } from './service';
import { getCuratedRagCatalog, type CuratedRagSourceDefinition } from './sourceCatalog';
import type { RagReadinessSummary } from './types';

export interface RagCatalogRunResult {
    run_id: string | null;
    run_mode: 'catalog_seed' | 'catalog_refresh';
    sources_attempted: number;
    sources_indexed: number;
    documents_indexed: number;
    chunks_indexed: number;
    readiness: RagReadinessSummary;
    errors: Array<{ source: string; message: string }>;
}

export async function seedCuratedRagCatalog(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    forceRefresh?: boolean;
}): Promise<RagCatalogRunResult> {
    return runCuratedCatalogJob({
        ...input,
        runMode: input.forceRefresh ? 'catalog_refresh' : 'catalog_seed',
    });
}

export async function refreshCuratedRagCatalog(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    onlyDue?: boolean;
}): Promise<RagCatalogRunResult> {
    return runCuratedCatalogJob({
        ...input,
        runMode: 'catalog_refresh',
        onlyDue: input.onlyDue ?? true,
        forceRefresh: true,
    });
}

export async function evaluateRagReadiness(client: SupabaseClient, tenantId: string): Promise<RagReadinessSummary> {
    const [schemaCheck, sourceRows, documentRows, chunkRows, highAuthorityRows, staleDocumentRows, lastRefresh] = await Promise.all([
        checkRagSchema(client, tenantId),
        countRows(client, 'rag_sources', tenantId),
        countRows(client, 'rag_documents', tenantId),
        countRows(client, 'rag_chunks', tenantId),
        countRows(client, 'rag_sources', tenantId, (query) => query.in('authority_tier', ['peer_reviewed', 'specialist_guideline', 'regulatory', 'institutional'])),
        countRows(client, 'rag_documents', tenantId, (query) => query.in('refresh_status', ['stale', 'failed'])),
        latestRefresh(client, tenantId),
    ]);

    const sources = sourceRows.count;
    const documents = documentRows.count;
    const chunks = chunkRows.count;
    const highAuthoritySources = highAuthorityRows.count;
    const staleDocuments = staleDocumentRows.count;
    const schemaErrors = [schemaCheck, sourceRows, documentRows, chunkRows, highAuthorityRows, staleDocumentRows]
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

    return {
        sources,
        documents,
        chunks,
        high_authority_sources: highAuthoritySources,
        stale_documents: staleDocuments,
        last_refreshed_at: lastRefresh,
        ready: sources > 0 && documents > 0 && chunks > 0 && highAuthoritySources > 0,
        warnings,
    };
}

async function runCuratedCatalogJob(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    runMode: 'catalog_seed' | 'catalog_refresh';
    onlyDue?: boolean;
    forceRefresh?: boolean;
}): Promise<RagCatalogRunResult> {
    const catalog = getCuratedRagCatalog();
    const runId = await createRefreshRun(input.client, {
        tenantId: input.tenantId,
        actorKind: input.actorLabel ?? 'system',
        runMode: input.runMode,
        sourcesAttempted: catalog.length,
    });

    let sourcesIndexed = 0;
    let documentsIndexed = 0;
    let chunksIndexed = 0;
    const errors: Array<{ source: string; message: string }> = [];

    for (const definition of catalog) {
        try {
            if (input.onlyDue && !await sourceIsDue(input.client, input.tenantId, definition)) {
                continue;
            }

            const result = await ingestCatalogDefinition(input, definition);
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

    return {
        run_id: runId,
        run_mode: input.runMode,
        sources_attempted: catalog.length,
        sources_indexed: sourcesIndexed,
        documents_indexed: documentsIndexed,
        chunks_indexed: chunksIndexed,
        readiness,
        errors,
    };
}

async function ingestCatalogDefinition(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    forceRefresh?: boolean;
}, definition: CuratedRagSourceDefinition) {
    const now = new Date();
    const nextRefresh = addDaysIso(now, definition.refresh_policy.refresh_interval_days);
    const plan = await buildCatalogDocumentPlans({ definition, now });
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
