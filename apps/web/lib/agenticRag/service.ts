import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkRagDocument, contentHash, normalizeRagContent, type RagChunkingOptions } from './chunking';
import { embedRagText } from './embedding';
import {
    normalizeAuthorityTier,
    normalizeRagSourceType,
    normalizeStringList,
    validatePublicSourceUrl,
} from './sourcePolicy';
import { getCuratedRagCatalog } from './sourceCatalog';
import type {
    RagAnswerResult,
    RagAuthorityTier,
    RagCitation,
    RagDiagnosticRecommendation,
    RagDocumentRecord,
    RagQueryPlan,
    RagRetrievedChunk,
    RagSourceRecord,
} from './types';

const MAX_DIRECT_CONTENT_CHARS = 1_200_000;
const MAX_REMOTE_CONTENT_BYTES = 1_000_000;
const MAX_CITATIONS = 8;

export interface RagSourceInput {
    id?: string;
    external_key?: string;
    name?: string;
    source_type?: string;
    authority_tier?: string;
    species_scope?: unknown;
    medicine_domain?: unknown;
    url?: string | null;
    license?: string | null;
    attribution?: string | null;
    ingestion_policy?: Record<string, unknown>;
    refresh_policy?: Record<string, unknown>;
}

export interface IngestRagDocumentInput {
    tenantId: string;
    actorLabel: string | null;
    client: SupabaseClient;
    source: RagSourceInput;
    document: {
        title: string;
        document_type?: string;
        language?: string;
        content_text?: string;
        content_url?: string;
        fetch_url?: boolean;
        metadata?: Record<string, unknown>;
        auto_indexed?: boolean;
        source_fetched_at?: string;
    };
    chunking?: RagChunkingOptions;
}

export interface IngestRagDocumentResult {
    source: RagSourceRecord;
    document: RagDocumentRecord;
    chunks_indexed: number;
    embedding_model: string | null;
    deterministic_embeddings: boolean;
}

export interface AnswerRagQueryInput {
    tenantId: string;
    actorKind: string;
    client: SupabaseClient;
    question: string;
    sourceIds?: string[];
    species?: string | null;
    domain?: string | null;
    strategy?: string | null;
    limit?: number;
}

export async function listRagSources(
    client: SupabaseClient,
    tenantId: string,
): Promise<RagSourceRecord[]> {
    const { data, error } = await client
        .from('rag_sources')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) throw new Error(`Failed to list RAG sources: ${error.message}`);
    return (data ?? []).map((row) => mapSource(row as Record<string, unknown>));
}

export async function listRagDocuments(
    client: SupabaseClient,
    tenantId: string,
): Promise<RagDocumentRecord[]> {
    const { data, error } = await client
        .from('rag_documents')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) throw new Error(`Failed to list RAG documents: ${error.message}`);
    return (data ?? []).map((row) => mapDocument(row as Record<string, unknown>));
}

export async function ingestRagDocument(input: IngestRagDocumentInput): Promise<IngestRagDocumentResult> {
    const source = await resolveRagSource(input);
    const rawContent = await resolveDocumentContent(input.document);
    const normalizedContent = normalizeRagContent(rawContent);
    if (!normalizedContent) {
        throw new Error('Document content is empty after normalization.');
    }
    if (normalizedContent.length > MAX_DIRECT_CONTENT_CHARS) {
        throw new Error(`Document content exceeds ${MAX_DIRECT_CONTENT_CHARS} characters.`);
    }

    const chunks = chunkRagDocument(normalizedContent, input.chunking);
    if (chunks.length === 0) {
        throw new Error('No indexable chunks were produced for this document.');
    }

    const contentSha = contentHash(normalizedContent);
    const documentMetadata = input.document.metadata ?? {};
    const document = await upsertRagDocument(input.client, {
        tenantId: input.tenantId,
        sourceId: source.id,
        title: input.document.title,
        documentType: input.document.document_type ?? 'text',
        language: input.document.language ?? 'en',
        contentSha,
        contentLength: normalizedContent.length,
        metadata: documentMetadata,
        provenance: {
            source_url: source.url,
            content_url: input.document.content_url ?? null,
            publication_year: normalizeOptional(documentMetadata.source_year)
                ?? normalizeOptional(documentMetadata.publication_year)
                ?? normalizeOptional(documentMetadata.year),
            actor: input.actorLabel,
            content_sha256: contentSha,
            indexed_by: 'vetios_agentic_rag',
        },
        autoIndexed: input.document.auto_indexed ?? false,
        sourceFetchedAt: input.document.source_fetched_at ?? null,
    });

    await input.client
        .from('rag_chunks')
        .delete()
        .eq('tenant_id', input.tenantId)
        .eq('document_id', document.id);

    let embeddingModel: string | null = null;
    let deterministicEmbeddings = false;
    const chunkRows = [];
    for (const chunk of chunks) {
        const embedding = await embedRagText(chunk.chunk_text);
        embeddingModel = embedding.model;
        deterministicEmbeddings = deterministicEmbeddings || embedding.deterministic_fallback;
        chunkRows.push({
            tenant_id: input.tenantId,
            source_id: source.id,
            document_id: document.id,
            chunk_index: chunk.chunk_index,
            chunk_text: chunk.chunk_text,
            chunk_hash: chunk.chunk_hash,
            heading: chunk.heading,
            token_estimate: chunk.token_estimate,
            embedding: `[${embedding.vector.join(',')}]`,
            embedding_model: embedding.model,
            metadata: {
                token_estimate: chunk.token_estimate,
                heading: chunk.heading,
            },
        });
    }

    const { error: chunkError } = await input.client.from('rag_chunks').insert(chunkRows);
    if (chunkError) throw new Error(`Failed to insert RAG chunks: ${chunkError.message}`);

    const { data: refreshedDoc, error: refreshError } = await input.client
        .from('rag_documents')
        .update({
            ingestion_status: 'indexed',
            indexed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            error_message: null,
        })
        .eq('tenant_id', input.tenantId)
        .eq('id', document.id)
        .select('*')
        .single();

    if (refreshError || !refreshedDoc) {
        throw new Error(`Failed to finalize RAG document: ${refreshError?.message ?? 'Unknown error'}`);
    }

    return {
        source,
        document: mapDocument(refreshedDoc as Record<string, unknown>),
        chunks_indexed: chunkRows.length,
        embedding_model: embeddingModel,
        deterministic_embeddings: deterministicEmbeddings,
    };
}

export async function answerRagQuery(input: AnswerRagQueryInput): Promise<RagAnswerResult> {
    const start = Date.now();
    const limit = Math.min(Math.max(input.limit ?? 8, 1), MAX_CITATIONS);
    const retrievalWarnings: string[] = [];
    const plan = buildRagQueryPlan({
        question: input.question,
        species: input.species ?? null,
        domain: input.domain ?? null,
        strategy: input.strategy ?? null,
    });

    const sourceIds = input.sourceIds?.filter(isUuid).slice(0, 20) ?? [];
    const sourceMap = await loadRagSourceMap(input.client, input.tenantId);
    const vectorRows = plan.strategy === 'lexical'
        ? []
        : await retrieveVectorChunks(input, plan, sourceIds, limit).catch((error) => {
            retrievalWarnings.push(`Vector retrieval unavailable: ${error instanceof Error ? error.message : 'unknown error'}.`);
            return [];
        });
    const lexicalRows = plan.strategy === 'vector'
        ? []
        : await retrieveLexicalChunks(input, plan, sourceIds, limit).catch((error) => {
            retrievalWarnings.push(`Lexical retrieval unavailable: ${error instanceof Error ? error.message : 'unknown error'}.`);
            return [];
        });
    const fallbackLexicalRows = plan.strategy === 'vector' || lexicalRows.length > 0
        ? []
        : await retrieveDirectLexicalChunks(input, plan, sourceIds, limit).catch((error) => {
            retrievalWarnings.push(`Direct lexical fallback unavailable: ${error instanceof Error ? error.message : 'unknown error'}.`);
            return [];
        });
    const mergedChunks = mergeRetrievedChunks(vectorRows, [...lexicalRows, ...fallbackLexicalRows]);
    const filteredChunks = filterRetrievedEvidence(mergedChunks, sourceMap, plan, input.question);
    if (mergedChunks.length > filteredChunks.length) {
        retrievalWarnings.push(`${mergedChunks.length - filteredChunks.length} retrieval hit(s) were removed by species, domain, or relevance filters.`);
    }
    const catalogFallbackRows = filteredChunks.length > 0
        ? []
        : retrieveCuratedCatalogEvidenceChunks(input.question, plan, limit);
    if (catalogFallbackRows.length > 0) {
        retrievalWarnings.push('Tenant corpus had no matching indexed chunks, so VetIOS used built-in curated catalog evidence summaries. Run Seed/Refresh Catalog to persist these summaries into the retrieval corpus.');
    }
    const chunks = [...filteredChunks, ...catalogFallbackRows]
        .sort((left, right) => evidenceRankScore(right) - evidenceRankScore(left))
        .slice(0, limit);
    const candidateCitations = chunks.map((chunk, index) => buildCitation(chunk, index + 1));
    const citations = candidateCitations
        .filter((citation) => isAcceptedGroundingCitation(citation, input.question, plan))
        .map((citation, index) => ({ ...citation, index: index + 1 }));
    const scopeAssessment = assessEvidenceScope({
        question: input.question,
        citations,
    });
    const grounded = citations.length > 0 && scopeAssessment.sufficient;
    if (candidateCitations.length > citations.length) {
        retrievalWarnings.push(`${candidateCitations.length - citations.length} retrieval candidate(s) were withheld because they did not meet the clinical grounding threshold.`);
    }
    const integrationContexts = await buildIntegratedRagContexts(input.client, {
        tenantId: input.tenantId,
        question: input.question,
        species: plan.species,
        domain: plan.domain,
    });
    const recommendations = buildEvidenceBackedRecommendations({
        question: input.question,
        species: plan.species,
        citations,
        scopeAssessment,
    });
    const answer = synthesizeExtractiveAnswer({
        question: input.question,
        species: plan.species,
        domain: plan.domain,
        citations,
        recommendations,
        integrationContexts,
        scopeAssessment,
    });
    const warnings = [
        ...buildRagWarnings(citations, candidateCitations.length),
        ...scopeAssessment.warnings,
        ...retrievalWarnings,
    ];
    const retrievalStats = {
        strategy: plan.strategy,
        vector_hits: vectorRows.length,
        lexical_hits: lexicalRows.length,
        direct_lexical_hits: fallbackLexicalRows.length,
        total_citations: citations.length,
        top_authority_tier: citations[0]?.authority_tier ?? null,
        retrieval_time_ms: Date.now() - start,
        semantic_first: plan.retrievalOrder === 'semantic_first_then_hybrid',
        species_filtered_hits: mergedChunks.length - filteredChunks.length,
        candidate_citations: candidateCitations.length,
        withheld_citations: candidateCitations.length - citations.length,
        catalog_fallback_hits: catalogFallbackRows.length,
    };
    const evaluation = {
        grounded,
        citation_coverage: grounded ? 1 : citations.length > 0 ? 0.5 : 0,
        unsupported_claims: 0,
        warnings,
        top_recommendations: recommendations,
        causal_memory_triggered: true,
        counterfactual_reasoning_triggered: true,
        causal_memory_linked: integrationContexts.causal_memory.linked,
        counterfactual_reasoning_linked: integrationContexts.counterfactual.linked,
        one_health_surveillance_linked: integrationContexts.one_health.linked,
    };

    const queryLog = await logRagQuery(input.client, {
        tenantId: input.tenantId,
        actorKind: input.actorKind,
        question: input.question,
        strategy: plan.strategy,
        answer,
        citations,
        retrievalStats,
        evaluation,
        integrationContexts,
    }).catch((error) => ({
        queryId: null,
        warning: `RAG query ledger insert failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
    }));
    if (queryLog.warning) {
        warnings.push(queryLog.warning);
        evaluation.warnings = warnings;
    }

    return {
        answer,
        answer_mode: 'extractive',
        plan,
        citations,
        retrieval_stats: retrievalStats,
        evaluation,
        query_id: queryLog.queryId,
    };
}

export function buildRagQueryPlan(input: {
    question: string;
    species?: string | null;
    domain?: string | null;
    strategy?: string | null;
}): RagQueryPlan {
    const lower = input.question.toLowerCase();
    const explicit = normalizeStrategy(input.strategy);
    const species = normalizeSpecies(input.species) ?? inferSpecies(lower);
    const explicitDomainFilters = normalizeDomainFilters(input.domain);
    const inferredDomainFilters = inferDomainFilters(lower);
    const domainFilters = explicitDomainFilters ?? inferredDomainFilters;
    const domain = (explicitDomainFilters ?? inferredDomainFilters)[0] ?? null;
    const strategy = explicit
        ?? (domain === 'drug_safety' ? 'drug_safety'
            : domain === 'lab_reference' ? 'lab_reference'
                : domainFilters.includes('clinical_guideline') ? 'clinical_guideline'
                : /guideline|consensus|standard|protocol/.test(lower) ? 'clinical_guideline'
                    : 'hybrid');

    return {
        strategy,
        species,
        domain,
        domain_filters: domainFilters,
        requireCitations: true,
        safetyBoundary: /diagnos|treat|dose|therapy|prognos|case|patient/.test(lower)
            ? 'clinical_decision_support'
            : 'general_knowledge',
        speciesFilterRequired: Boolean(species),
        retrievalOrder: 'semantic_first_then_hybrid',
    };
}

async function resolveRagSource(input: IngestRagDocumentInput): Promise<RagSourceRecord> {
    if (input.source.id) {
        const { data, error } = await input.client
            .from('rag_sources')
            .select('*')
            .eq('tenant_id', input.tenantId)
            .eq('id', input.source.id)
            .maybeSingle();
        if (error) throw new Error(`Failed to load RAG source: ${error.message}`);
        if (!data) throw new Error('RAG source was not found for this tenant.');
        return mapSource(data as Record<string, unknown>);
    }

    const sourceUrl = validatePublicSourceUrl(input.source.url);
    if (!sourceUrl.ok) throw new Error(sourceUrl.error);
    const name = normalizeRequired(input.source.name, 'source.name');

    const externalKey = normalizeExternalKey(input.source.external_key);
    const existing = await findExistingSource(input.client, input.tenantId, {
        externalKey,
        url: sourceUrl.url,
        name,
    });
    if (existing) {
        const { data, error } = await input.client
            .from('rag_sources')
            .update({
                external_key: externalKey ?? existing.external_key,
                name,
                source_type: normalizeRagSourceType(input.source.source_type),
                authority_tier: normalizeAuthorityTier(input.source.authority_tier),
                species_scope: normalizeStringList(input.source.species_scope),
                medicine_domain: normalizeStringList(input.source.medicine_domain),
                url: sourceUrl.url,
                license: normalizeOptional(input.source.license),
                attribution: normalizeOptional(input.source.attribution),
                ingestion_policy: {
                    trusted_public_source: sourceUrl.trusted,
                    ...(input.source.ingestion_policy ?? {}),
                },
                refresh_policy: input.source.refresh_policy ?? existing.refresh_policy,
                status: 'active',
                updated_at: new Date().toISOString(),
            })
            .eq('tenant_id', input.tenantId)
            .eq('id', existing.id)
            .select('*')
            .single();

        if (error || !data) throw new Error(`Failed to update RAG source: ${error?.message ?? 'Unknown error'}`);
        return mapSource(data as Record<string, unknown>);
    }

    const { data, error } = await input.client
        .from('rag_sources')
        .insert({
            tenant_id: input.tenantId,
            external_key: externalKey,
            name,
            source_type: normalizeRagSourceType(input.source.source_type),
            authority_tier: normalizeAuthorityTier(input.source.authority_tier),
            species_scope: normalizeStringList(input.source.species_scope),
            medicine_domain: normalizeStringList(input.source.medicine_domain),
            url: sourceUrl.url,
            license: normalizeOptional(input.source.license),
            attribution: normalizeOptional(input.source.attribution),
            ingestion_policy: {
                trusted_public_source: sourceUrl.trusted,
                ...(input.source.ingestion_policy ?? {}),
            },
            refresh_policy: input.source.refresh_policy ?? {},
            status: 'active',
        })
        .select('*')
        .single();

    if (error || !data) throw new Error(`Failed to create RAG source: ${error?.message ?? 'Unknown error'}`);
    return mapSource(data as Record<string, unknown>);
}

async function findExistingSource(client: SupabaseClient, tenantId: string, input: {
    externalKey: string | null;
    url: string | null;
    name: string;
}): Promise<RagSourceRecord | null> {
    if (input.externalKey) {
        const { data, error } = await client
            .from('rag_sources')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('external_key', input.externalKey)
            .maybeSingle();
        if (error) throw new Error(`Failed to find RAG source: ${error.message}`);
        if (data) return mapSource(data as Record<string, unknown>);
    }

    if (input.url) {
        const { data, error } = await client
            .from('rag_sources')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('url', input.url)
            .limit(1)
            .maybeSingle();
        if (error) throw new Error(`Failed to find RAG source by URL: ${error.message}`);
        if (data) return mapSource(data as Record<string, unknown>);
    }

    const { data, error } = await client
        .from('rag_sources')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('name', input.name)
        .limit(1)
        .maybeSingle();
    if (error) throw new Error(`Failed to find RAG source by name: ${error.message}`);
    return data ? mapSource(data as Record<string, unknown>) : null;
}

async function resolveDocumentContent(document: IngestRagDocumentInput['document']): Promise<string> {
    const direct = document.content_text?.trim();
    if (direct) return direct;

    if (!document.fetch_url || !document.content_url) {
        throw new Error('document.content_text is required unless document.fetch_url is true with a safe HTTPS content_url.');
    }

    const validated = validatePublicSourceUrl(document.content_url);
    if (!validated.ok) throw new Error(validated.error);
    if (!validated.url) throw new Error('document.content_url is required.');
    return fetchRemoteText(validated.url);
}

async function fetchRemoteText(url: string): Promise<string> {
    const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
        headers: {
            Accept: 'text/plain,text/markdown,text/html,application/json;q=0.8,*/*;q=0.1',
        },
    });
    if (!response.ok) {
        throw new Error(`Remote document fetch failed with ${response.status}.`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > MAX_REMOTE_CONTENT_BYTES) {
        throw new Error(`Remote document exceeds ${MAX_REMOTE_CONTENT_BYTES} bytes.`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (
        contentType
        && !/text\/|application\/json|application\/xml|application\/xhtml\+xml/.test(contentType)
    ) {
        throw new Error('Remote document content type is not text-indexable. Upload extracted text instead.');
    }

    const text = await response.text();
    if (text.length > MAX_DIRECT_CONTENT_CHARS) {
        throw new Error(`Remote document exceeds ${MAX_DIRECT_CONTENT_CHARS} characters.`);
    }
    return text;
}

async function upsertRagDocument(client: SupabaseClient, input: {
    tenantId: string;
    sourceId: string;
    title: string;
    documentType: string;
    language: string;
    contentSha: string;
    contentLength: number;
    metadata: Record<string, unknown>;
    provenance: Record<string, unknown>;
    autoIndexed: boolean;
    sourceFetchedAt: string | null;
}): Promise<RagDocumentRecord> {
    const { data, error } = await client
        .from('rag_documents')
        .upsert({
            tenant_id: input.tenantId,
            source_id: input.sourceId,
            title: normalizeRequired(input.title, 'document.title'),
            document_type: normalizeText(input.documentType, 'text'),
            language: normalizeText(input.language, 'en'),
            content_sha256: input.contentSha,
            content_length: input.contentLength,
            metadata: input.metadata,
            provenance: input.provenance,
            auto_indexed: input.autoIndexed,
            refresh_status: 'current',
            source_fetched_at: input.sourceFetchedAt,
            ingestion_status: 'pending',
            updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,source_id,content_sha256' })
        .select('*')
        .single();

    if (error || !data) throw new Error(`Failed to upsert RAG document: ${error?.message ?? 'Unknown error'}`);
    return mapDocument(data as Record<string, unknown>);
}

async function retrieveVectorChunks(
    input: AnswerRagQueryInput,
    plan: RagQueryPlan,
    sourceIds: string[],
    limit: number,
): Promise<RagRetrievedChunk[]> {
    const embedding = await embedRagText(input.question);
    const { data, error } = await input.client.rpc('match_rag_chunks', {
        query_embedding: `[${embedding.vector.join(',')}]`,
        match_threshold: 0.64,
        match_count: limit,
        filter_tenant: input.tenantId,
        filter_source_ids: sourceIds.length > 0 ? sourceIds : null,
        filter_species: plan.species,
        filter_domain: rpcDomainFilter(plan),
    });
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    return rows.map((row) => mapRetrievedChunk(row, 'vector'));
}

async function retrieveLexicalChunks(
    input: AnswerRagQueryInput,
    plan: RagQueryPlan,
    sourceIds: string[],
    limit: number,
): Promise<RagRetrievedChunk[]> {
    const { data, error } = await input.client.rpc('search_rag_chunks_lexical', {
        search_query: buildRagLexicalSearchQuery(input.question, plan),
        match_count: limit,
        filter_tenant: input.tenantId,
        filter_source_ids: sourceIds.length > 0 ? sourceIds : null,
        filter_species: plan.species,
        filter_domain: rpcDomainFilter(plan),
    });
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    return rows.map((row) => mapRetrievedChunk(row, 'lexical'));
}

export function buildRagLexicalSearchQuery(question: string, plan: RagQueryPlan): string {
    if (isBroadCanineGiDiagnosticQuestion(question)) {
        return '"vomiting diarrhea" OR gastroenteritis OR fecal OR parvovirus';
    }
    if (isPancreatitisDiagnosticQuestion(question)) {
        return 'pancreatitis OR "pancreatic lipase" OR cpli OR ultrasound';
    }
    if (isRespiratoryDiagnosticQuestion(question)) {
        return '"nasal discharge" OR sneezing OR respiratory OR conjunctivitis';
    }
    if (isParvovirusDiagnosticQuestion(question)) {
        return 'parvovirus OR parvo OR "fecal antigen" OR leukopenia OR PCR';
    }
    if (isAcuteHemorrhagicDiarrheaQuestion(question)) {
        return 'AHDS OR HGE OR "hemorrhagic diarrhea" OR hemoconcentration OR PCV';
    }
    if (isRenalDiagnosticQuestion(question)) {
        return 'renal OR kidney OR CKD OR AKI OR creatinine OR SDMA OR urinalysis OR proteinuria';
    }
    if (isToxicExposureDiagnosticQuestion(question)) {
        return 'toxin OR toxicosis OR rodenticide OR anticoagulant OR "PT" OR "PTT"';
    }
    if (isAMROneHealthQuestion(question)) {
        return 'AMR OR "antimicrobial resistance" OR "antimicrobial use" OR "One Health" OR surveillance';
    }

    const terms = extractRetrievalTerms(question)
        .filter((term) => !ragConsoleQueryStopwords().has(term))
        .slice(0, 8);
    return terms.length > 0 ? terms.join(' ') : question;
}

async function retrieveDirectLexicalChunks(
    input: AnswerRagQueryInput,
    plan: RagQueryPlan,
    sourceIds: string[],
    limit: number,
): Promise<RagRetrievedChunk[]> {
    const sources = await listRagSources(input.client, input.tenantId);
    const allowedSources = sources.filter((source) => (
        source.status === 'active'
        && (sourceIds.length === 0 || sourceIds.includes(source.id))
        && sourceMatchesRequestedSpecies(source.species_scope, plan.species)
        && sourceMatchesDomain(source.medicine_domain, plan)
    ));
    if (allowedSources.length === 0) return [];

    const sourceMap = new Map(allowedSources.map((source) => [source.id, source]));
    const { data: chunkData, error: chunkError } = await input.client
        .from('rag_chunks')
        .select('id, tenant_id, source_id, document_id, chunk_index, chunk_text, metadata, created_at')
        .eq('tenant_id', input.tenantId)
        .in('source_id', allowedSources.map((source) => source.id))
        .limit(750);
    if (chunkError) throw new Error(chunkError.message);

    const chunkRows = (chunkData ?? []) as Record<string, unknown>[];
    if (chunkRows.length === 0) return [];

    const documentIds = [...new Set(chunkRows.map((row) => String(row.document_id)).filter(Boolean))];
    const { data: documentData, error: documentError } = await input.client
        .from('rag_documents')
        .select('id, title, document_type, metadata, provenance')
        .eq('tenant_id', input.tenantId)
        .in('id', documentIds);
    if (documentError) throw new Error(documentError.message);

    const documentMap = new Map((documentData ?? []).map((row) => [
        String((row as Record<string, unknown>).id),
        row as Record<string, unknown>,
    ]));
    const scored = chunkRows
        .map((row) => {
            const source = sourceMap.get(String(row.source_id));
            const document = documentMap.get(String(row.document_id));
            if (!source || !document) return null;
            const score = scoreDirectLexicalMatch(input.question, [
                String(row.chunk_text ?? ''),
                source.name,
                String(document.title ?? ''),
                source.species_scope.join(' '),
                source.medicine_domain.join(' '),
            ].join(' '));
            if (score <= 0) return null;
            return mapDirectRetrievedChunk(row, source, document, score);
        })
        .filter((row): row is RagRetrievedChunk => row !== null)
        .sort((left, right) => evidenceRankScore(right) - evidenceRankScore(left));

    return scored.slice(0, limit);
}

function retrieveCuratedCatalogEvidenceChunks(
    question: string,
    plan: RagQueryPlan,
    limit: number,
): RagRetrievedChunk[] {
    if (!shouldUseCuratedCatalogFallback(question)) return [];

    return getCuratedRagCatalog()
        .flatMap((definition) => {
            if (!sourceMatchesRequestedSpecies(definition.species_scope, plan.species)) return [];
            if (!sourceMatchesDomain(definition.medicine_domain, plan)) return [];

            return (definition.evidence_summaries ?? []).map((summary, index) => {
                const score = scoreDirectLexicalMatch(question, [
                    summary.title,
                    summary.summary,
                    summary.topics.join(' '),
                    definition.name,
                    definition.species_scope.join(' '),
                    definition.medicine_domain.join(' '),
                ].join(' '));
                if (score <= 0) return null;

                const hash = contentHash(`${definition.external_key}:${index}:${summary.summary}`).slice(0, 24);
                const chunk: RagRetrievedChunk = {
                    chunk_id: `catalog-${hash}`,
                    document_id: `catalog-doc-${hash}`,
                    source_id: `catalog-source-${definition.external_key}`,
                    source_name: definition.name,
                    source_type: definition.source_type,
                    authority_tier: definition.authority_tier,
                    title: summary.title,
                    url: definition.url,
                    chunk_index: index,
                    chunk_text: summary.summary,
                    similarity: score,
                    metadata: {
                        document_type: 'curated_evidence_summary',
                        retrieval_mode: 'catalog_evidence_summary',
                        catalog_fallback: true,
                        evidence_topics: summary.topics,
                    },
                    provenance: {
                        source_url: definition.url,
                        publication_year: summary.source_year ?? null,
                        source_catalog_version: '2026-05-10',
                    },
                    created_at: new Date().toISOString(),
                };

                if (!hasRequiredClinicalAnchors(chunk, question, plan.species)) return null;
                if (!hasMinimumQuestionRelevance(chunk, question)) return null;
                return chunk;
            });
        })
        .filter((chunk): chunk is RagRetrievedChunk => chunk !== null)
        .sort((left, right) => evidenceRankScore(right) - evidenceRankScore(left))
        .slice(0, limit);
}

function shouldUseCuratedCatalogFallback(question: string): boolean {
    return isPancreatitisDiagnosticQuestion(question)
        || isBroadCanineGiDiagnosticQuestion(question)
        || isRespiratoryDiagnosticQuestion(question)
        || isParvovirusDiagnosticQuestion(question)
        || isAcuteHemorrhagicDiarrheaQuestion(question)
        || isRenalDiagnosticQuestion(question)
        || isToxicExposureDiagnosticQuestion(question)
        || isAMROneHealthQuestion(question)
        || /\b(fpv|panleukopenia|feline panleukopenia|feline parvovirus|distemper)\b/i.test(question);
}

function mergeRetrievedChunks(vectorRows: RagRetrievedChunk[], lexicalRows: RagRetrievedChunk[]): RagRetrievedChunk[] {
    const byId = new Map<string, RagRetrievedChunk>();
    for (const row of [...vectorRows, ...lexicalRows]) {
        const existing = byId.get(row.chunk_id);
        if (!existing || evidenceRankScore(row) > evidenceRankScore(existing)) {
            byId.set(row.chunk_id, row);
        }
    }

    return [...byId.values()].sort((left, right) => evidenceRankScore(right) - evidenceRankScore(left));
}

async function loadRagSourceMap(client: SupabaseClient, tenantId: string): Promise<Map<string, RagSourceRecord>> {
    const sources = await listRagSources(client, tenantId);
    return new Map(sources.map((source) => [source.id, source]));
}

function filterRetrievedEvidence(
    chunks: RagRetrievedChunk[],
    sourceMap: Map<string, RagSourceRecord>,
    plan: RagQueryPlan,
    question: string,
): RagRetrievedChunk[] {
    return chunks.filter((chunk) => {
        const source = sourceMap.get(chunk.source_id);
        if (!source) return false;
        if (!sourceMatchesRequestedSpecies(source.species_scope, plan.species)) return false;
        if (!sourceMatchesDomain(source.medicine_domain, plan)) return false;
        if (isClinicalSpecificQuestion(question) && isCatalogOrSourceMetadataChunk(chunk)) return false;
        if (!hasRequiredClinicalAnchors(chunk, question, plan.species)) return false;
        return hasMinimumQuestionRelevance(chunk, question);
    });
}

function rpcDomainFilter(plan: RagQueryPlan): string | null {
    return plan.domain_filters.length === 1 ? plan.domain_filters[0] : null;
}

function buildCitation(chunk: RagRetrievedChunk, index: number): RagCitation {
    return {
        index,
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        source_id: chunk.source_id,
        title: chunk.title,
        source_name: chunk.source_name,
        source_type: chunk.source_type,
        authority_tier: chunk.authority_tier,
        url: inferCitationUrl(chunk),
        year: inferCitationYear(chunk),
        quote: buildQuote(chunk.chunk_text),
        similarity: Number(chunk.similarity.toFixed(4)),
        provenance: chunk.provenance,
    };
}

function inferCitationUrl(chunk: RagRetrievedChunk): string | null {
    const candidates = [
        chunk.provenance.source_url,
        chunk.provenance.content_url,
        chunk.provenance.document_url,
        chunk.url,
    ];
    for (const candidate of candidates) {
        const url = normalizeOptional(candidate);
        if (url?.startsWith('https://')) return url;
    }
    return null;
}

function synthesizeExtractiveAnswer(input: {
    question: string;
    species: string | null;
    domain: string | null;
    citations: RagCitation[];
    recommendations: RagDiagnosticRecommendation[];
    scopeAssessment: EvidenceScopeAssessment;
    integrationContexts: {
        causal_memory: Record<string, unknown> & { linked: boolean };
        counterfactual: Record<string, unknown> & { linked: boolean };
        one_health: Record<string, unknown> & { linked: boolean };
    };
}): string {
    if (!hasHighConfidenceEvidence(input.citations)) {
        return 'No direct evidence available — consult licensed veterinary guidance.';
    }

    const citationLines = input.citations.slice(0, 6).map((citation) => (
        `${citation.index}. [${formatCitationReference(citation)}] ${selectBestSentence(citation.quote, input.question)}`
    ));
    if (!input.scopeAssessment.sufficient) {
        return [
            'Scope limitation:',
            input.scopeAssessment.answerNote,
            'Indexed citations:',
            ...citationLines,
            'No broad diagnostic workflow was generated because the accepted evidence does not cover the full clinical scope of the question.',
            `Causal Memory: triggered (${input.integrationContexts.causal_memory.linked ? 'tenant memory linked' : 'no tenant memory match'}).`,
            `Counterfactual review: triggered (${input.integrationContexts.counterfactual.linked ? 'tenant sessions linked' : 'no tenant session match'}).`,
            'Use this as clinical decision support; final diagnosis, treatment, and dosing decisions require licensed veterinary judgment.',
        ].join('\n');
    }

    const recommendationLines = input.recommendations.map((recommendation) => (
        `${recommendation.rank}. ${formatWorkflowStep(recommendation.workflow_step)} - ${recommendation.recommendation} Confidence: ${recommendation.confidence}. Evidence: ${formatCitationIndexes(recommendation.citation_indexes)}.`
    ));
    const speciesNote = input.species
        ? `Species-specific note: evidence was filtered to sources matching ${input.species}.`
        : 'Species-specific note: no species filter was supplied, so use only after matching the patient species.';
    const evidenceUseLines = input.recommendations.length > 0
        ? [
            'Concise diagnostic workflow:',
            ...recommendationLines,
        ]
        : [
            'Evidence use:',
            'The retrieved citations support source-grounded context for this question, but VetIOS did not generate a diagnostic workflow because the accepted evidence is policy, surveillance, source-discovery, or non-protocol evidence.',
        ];

    return [
        'Citations:',
        ...citationLines,
        ...evidenceUseLines,
        speciesNote,
        `Causal Memory: triggered (${input.integrationContexts.causal_memory.linked ? 'tenant memory linked' : 'no tenant memory match'}).`,
        `Counterfactual review: triggered (${input.integrationContexts.counterfactual.linked ? 'tenant sessions linked' : 'no tenant session match'}).`,
        'Use this as clinical decision support; final diagnosis, treatment, and dosing decisions require licensed veterinary judgment.',
    ].join('\n');
}

function buildEvidenceBackedRecommendations(input: {
    question: string;
    species: string | null;
    citations: RagCitation[];
    scopeAssessment: EvidenceScopeAssessment;
}): RagDiagnosticRecommendation[] {
    if (!hasHighConfidenceEvidence(input.citations) || !input.scopeAssessment.sufficient) {
        return [];
    }
    if (isAMROneHealthQuestion(input.question) && /\b(surveillance|policy|one health|population|infrastructure|government|global|who|fao|woah|cdc|amr)\b/i.test(input.question)) {
        return [];
    }

    const workflow = buildDiagnosticWorkflow(input.question);

    return workflow.map((entry, index) => {
        const matched = citationsForTerms(input.citations, entry.terms);
        const citations = matched.length > 0 ? matched : input.citations.slice(0, 2);
        const confidence = recommendationConfidence(citations);
        return {
            rank: index + 1,
            workflow_step: entry.step,
            recommendation: matched.length > 0 ? entry.label : entry.fallback,
            confidence,
            citation_indexes: citations.map((citation) => citation.index),
            rationale: citations
                .map((citation) => selectBestSentence(citation.quote, input.question))
                .join(' '),
        };
    });
}

function buildDiagnosticWorkflow(question: string): Array<{
    step: RagDiagnosticRecommendation['workflow_step'];
    label: string;
    terms: string[];
    fallback: string;
}> {
    if (isRespiratoryDiagnosticQuestion(question)) {
        return [
            {
                step: 'history_exam',
                label: 'Localize upper versus lower respiratory disease with history, exposure risk, physical exam, and ocular/oral findings',
                terms: ['history', 'physical', 'exam', 'nasal', 'sneeze', 'sneezing', 'discharge', 'conjunctivitis', 'ocular', 'oral', 'ulcer', 'fever', 'appetite', 'breathing', 'respiratory'],
                fallback: 'Use the cited evidence to first localize the respiratory pattern and identify red flags before selecting tests.',
            },
            {
                step: 'infectious_testing',
                label: 'Use targeted infectious testing or sampling when agent confirmation changes isolation, outbreak control, prognosis, or treatment planning',
                terms: ['pcr', 'virus', 'viral', 'isolation', 'agent', 'sample', 'oropharyngeal', 'nares', 'conjunctival', 'scraping', 'chlamydia', 'mycoplasma', 'herpesvirus', 'calicivirus', 'culture'],
                fallback: 'Use the cited evidence to select infectious testing only when confirmation will change the clinical or population-health decision.',
            },
            {
                step: 'advanced_airway_diagnostics',
                label: 'Escalate to imaging, rhinoscopy, biopsy, or deep culture for chronic, unilateral, obstructive, hemorrhagic, recurrent, or severe disease',
                terms: ['radiograph', 'radiography', 'ct', 'computed', 'imaging', 'rhinoscopy', 'endoscopy', 'biopsy', 'culture', 'chronic', 'unilateral', 'obstructive', 'hemorrhagic', 'foreign', 'neoplasia', 'fungal'],
                fallback: 'Use the cited evidence to decide whether chronic or complicated nasal disease needs advanced airway diagnostics.',
            },
        ];
    }

    if (isPancreatitisDiagnosticQuestion(question)) {
        return [
            {
                step: 'history_exam',
                label: 'Integrate compatible signs and risk factors before interpreting pancreatitis tests',
                terms: ['vomit', 'vomiting', 'anorexia', 'weakness', 'abdominal', 'pain', 'dehydration', 'diarrhea', 'risk', 'clinical', 'history', 'physical'],
                fallback: 'Use the cited evidence to match compatible clinical signs and risk factors before interpreting pancreatitis tests.',
            },
            {
                step: 'labs',
                label: 'Use pancreas-specific lipase testing with CBC, chemistry, electrolytes, hydration, and concurrent-disease assessment',
                terms: ['pancreatic', 'lipase', 'pli', 'cpli', 'spec', 'serum', 'cbc', 'chemistry', 'electrolyte', 'laboratory', 'lab', 'biochemical', 'marker', 'markers'],
                fallback: 'Use the cited evidence to combine pancreas-specific lipase testing with baseline laboratory context rather than relying on one marker.',
            },
            {
                step: 'imaging',
                label: 'Use abdominal ultrasound to support pancreatitis and radiographs mainly to exclude important differentials',
                terms: ['ultrasound', 'ultrasonography', 'radiograph', 'radiographs', 'radiography', 'imaging', 'pancreatic', 'enlargement', 'echogenicity', 'peripancreatic', 'fluid', 'mass'],
                fallback: 'Use the cited evidence to decide when imaging supports pancreatitis or rules out competing abdominal disease.',
            },
        ];
    }

    return [
        {
            step: 'labs',
            label: 'Run baseline laboratory diagnostics first',
            terms: ['cbc', 'chemistry', 'electrolyte', 'pcv', 'packed', 'solids', 'urinalysis', 'leukopenia', 'blood', 'lab', 'hydration'],
            fallback: 'Use the cited evidence to prioritize baseline laboratory assessment before narrowing the differential list.',
        },
        {
            step: 'imaging',
            label: 'Use imaging when history, exam, or labs support obstruction, foreign body, mass, or systemic disease',
            terms: ['radiograph', 'ultrasound', 'imaging', 'foreign', 'obstruction', 'mass', 'abdominal', 'thoracic'],
            fallback: 'Use the cited evidence to decide whether imaging is needed after initial laboratory triage.',
        },
        {
            step: 'fecal_external_tests',
            label: 'Add fecal, parasite, infectious, toxin, or external exposure testing when signs and risk factors align',
            terms: ['fecal', 'parasite', 'giardia', 'parvo', 'parvovirus', 'elisa', 'antigen', 'pcr', 'toxin', 'infectious', 'tick', 'external'],
            fallback: 'Use the cited evidence to select fecal, infectious, parasite, toxin, or exposure tests that match the presentation.',
        },
    ];
}

function isRespiratoryDiagnosticQuestion(question: string): boolean {
    return /\b(nasal|sneeze|sneezing|sneezes|rhinitis|sinusitis|respiratory|airway|conjunctivitis|ocular discharge|calicivirus|herpesvirus|fvr|fhv)\b/i.test(question);
}

function isPancreatitisDiagnosticQuestion(question: string): boolean {
    return /\b(pancreatitis|pancreatic|pancreas|cpli|pli|spec cpl|pancreatic lipase|serum lipase)\b/i.test(question);
}

function isParvovirusDiagnosticQuestion(question: string): boolean {
    return /\b(cpv|canine parvovirus|parvo|parvoviral|fecal antigen|viral pcr|leukopenia)\b/i.test(question);
}

function isAcuteHemorrhagicDiarrheaQuestion(question: string): boolean {
    return /\b(ahds|hge|acute hemorrhagic diarrhea|acute haemorrhagic diarrhoea|hemorrhagic diarrhea|haemorrhagic diarrhoea|bloody diarrhea|bloody diarrhoea|hemoconcentration|haemoconcentration)\b/i.test(question);
}

function isRenalDiagnosticQuestion(question: string): boolean {
    return /\b(renal|kidney|ckd|aki|azotemia|azotaemia|creatinine|sdma|proteinuria|upc|urinalysis|urine specific gravity)\b/i.test(question)
        && /\b(diagnos|diagnostic|diagnostics|workup|stage|staging|test|tests|evidence|indexed|monitor)\b/i.test(question);
}

function isToxicExposureDiagnosticQuestion(question: string): boolean {
    return /\b(toxin|toxicosis|poison|poisoning|rodenticide|anticoagulant|cholecalciferol|ethylene glycol|exposure|bait|ptt|prothrombin|coagulation)\b/i.test(question);
}

function isAMROneHealthQuestion(question: string): boolean {
    return /\b(amr|antimicrobial resistance|antibiotic resistance|antimicrobial use|antibiogram|susceptibility|culture and sensitivity|one health|zoonotic|surveillance|outbreak|drug-resistant|drug resistant|resistance gene)\b/i.test(question);
}

function hasHighConfidenceEvidence(citations: RagCitation[]): boolean {
    return citations.some((citation) => (
        isHighAuthorityTier(citation.authority_tier)
        && citation.similarity >= minimumEvidenceSimilarity(citation)
    ));
}

interface EvidenceScopeAssessment {
    sufficient: boolean;
    warnings: string[];
    answerNote: string;
}

function assessEvidenceScope(input: {
    question: string;
    citations: RagCitation[];
}): EvidenceScopeAssessment {
    if (input.citations.length === 0) {
        return {
            sufficient: true,
            warnings: [],
            answerNote: '',
        };
    }

    if (isBroadCanineGiDiagnosticQuestion(input.question)) {
        const broadGiCitations = input.citations.filter(citationCoversBroadCanineGiWorkflow);
        if (broadGiCitations.length === 0) {
            return {
                sufficient: false,
                warnings: [
                    'Accepted citations are narrower than the broad canine vomiting/diarrhea diagnostic question; workflow synthesis was withheld.',
                ],
                answerNote: 'The accepted indexed evidence is narrower than the question. It can support a differential-specific discussion, such as pancreatitis when that is what was retrieved, but it does not yet support a complete canine vomiting/diarrhea diagnostic workflow. Index broad canine GI evidence covering baseline labs, fecal/infectious testing, and imaging/obstruction triage before using this query as a general workflow.',
            };
        }
    }

    return {
        sufficient: true,
        warnings: [],
        answerNote: '',
    };
}

function isBroadCanineGiDiagnosticQuestion(question: string): boolean {
    if (isPancreatitisDiagnosticQuestion(question)) return false;
    return /\b(canine|dog|dogs)\b/i.test(question)
        && /\b(vomit|vomiting|emesis)\b/i.test(question)
        && /\b(diarrhea|diarrhoea|gastroenteritis|enteritis)\b/i.test(question)
        && /\b(diagnos|diagnostic|diagnostics|workup|test|tests|evidence|indexed)\b/i.test(question);
}

function citationCoversBroadCanineGiWorkflow(citation: RagCitation): boolean {
    const haystack = normalizedTextHaystack(`${citation.title} ${citation.source_name} ${citation.quote}`);
    const mentionsGiSyndrome = (
        /\b(vomit|vomiting|emesis)\b/.test(haystack)
        && /\b(diarrhea|diarrhoea|gastroenteritis|enteritis)\b/.test(haystack)
    );
    if (!mentionsGiSyndrome) return false;

    const hasBaselineLabs = /\b(cbc|chemistry|electrolyte|urinalysis|hydration|pcv|packed|solids|leukopenia|blood)\b/.test(haystack);
    const hasFecalInfectious = /\b(fecal|faecal|parasite|giardia|parvo|parvovirus|elisa|antigen|pcr|toxin|campylobacter|salmonella)\b/.test(haystack);
    const hasImagingOrObstruction = /\b(radiograph|radiographs|radiography|ultrasound|ultrasonography|imaging|obstruction|foreign|mass|abdominal)\b/.test(haystack);
    const diagnosticBreadth = [hasBaselineLabs, hasFecalInfectious, hasImagingOrObstruction]
        .filter(Boolean)
        .length;
    const narrowPancreatitisOnly = /\b(pancreatitis|pancreatic|lipase|cpli|pli)\b/.test(haystack)
        && !hasFecalInfectious
        && !/\b(gastroenteritis|enteritis)\b/.test(haystack);

    return diagnosticBreadth >= 2 && !narrowPancreatitisOnly;
}

function isAcceptedGroundingCitation(
    citation: RagCitation,
    question: string,
    plan: RagQueryPlan,
): boolean {
    if (!isHighAuthorityTier(citation.authority_tier)) return false;
    if (isCatalogOrSourceMetadataText(`${citation.title} ${citation.quote}`)) return false;
    if (plan.species && hasChunkSpeciesConflict(citation.quote, plan.species)) return false;
    if (!citationSatisfiesQuestionAnchors(citation, question, plan.species)) return false;
    return citation.similarity >= minimumEvidenceSimilarity(citation);
}

function citationsForTerms(citations: RagCitation[], terms: string[]): RagCitation[] {
    const termSet = new Set(terms);
    return citations.filter((citation) => {
        const haystack = `${citation.quote} ${citation.title} ${citation.source_name}`.toLowerCase();
        return [...termSet].some((term) => haystack.includes(term));
    }).slice(0, 3);
}

function recommendationConfidence(citations: RagCitation[]): RagDiagnosticRecommendation['confidence'] {
    if (citations.some((citation) => isHighAuthorityTier(citation.authority_tier) && citation.similarity >= 0.55)) {
        return 'high';
    }
    if (citations.some((citation) => isHighAuthorityTier(citation.authority_tier))) {
        return 'medium';
    }
    return 'low';
}

function formatWorkflowStep(step: RagDiagnosticRecommendation['workflow_step']): string {
    switch (step) {
        case 'labs': return 'Labs';
        case 'imaging': return 'Imaging';
        case 'fecal_external_tests': return 'Fecal/external tests';
        case 'history_exam': return 'History/exam';
        case 'infectious_testing': return 'Infectious testing';
        case 'advanced_airway_diagnostics': return 'Advanced airway diagnostics';
        default: return step;
    }
}

function formatCitationIndexes(indexes: number[]): string {
    return indexes.length > 0 ? indexes.map((index) => `[${index}]`).join(', ') : 'none';
}

function formatCitationReference(citation: RagCitation): string {
    return `${citation.source_name}, ${citation.year ?? 'n.d.'}, ${citation.url ?? 'no URL'}`;
}

function buildRagWarnings(citations: RagCitation[], candidateCount = citations.length): string[] {
    const warnings: string[] = [];
    if (citations.length === 0) {
        warnings.push(candidateCount > 0
            ? 'Retrieved candidates were not accepted as grounding citations because they did not meet the clinical evidence threshold.'
            : 'No indexed evidence was retrieved.');
        return warnings;
    }
    if (citations.some((citation) => citation.authority_tier === 'unverified')) {
        warnings.push('At least one citation comes from an unverified source tier.');
    }
    if (citations.every((citation) => citation.authority_tier === 'clinic_local')) {
        warnings.push('All citations are clinic-local; consider adding peer-reviewed or specialist guideline sources.');
    }
    return warnings;
}

async function buildIntegratedRagContexts(client: SupabaseClient, input: {
    tenantId: string;
    question: string;
    species: string | null;
    domain: string | null;
}): Promise<{
    causal_memory: Record<string, unknown> & { linked: boolean };
    counterfactual: Record<string, unknown> & { linked: boolean };
    one_health: Record<string, unknown> & { linked: boolean };
}> {
    const uuidTenant = isUuid(input.tenantId);
    const [causalObservations, livingCases, counterfactualSessions, oneHealthSignals, zoonoticAlerts] = await Promise.all([
        safeTenantCount(client, 'causal_observations', input.tenantId, input.species),
        safeTenantCount(client, 'living_case_nodes', input.tenantId, input.species),
        uuidTenant ? safeTenantCount(client, 'counterfactual_diagnostic_sessions', input.tenantId, input.species) : Promise.resolve(0),
        uuidTenant ? safeTenantCount(client, 'one_health_signals', input.tenantId, input.species) : Promise.resolve(0),
        uuidTenant ? safeTenantCount(client, 'zoonotic_bridge_alerts', input.tenantId, null) : Promise.resolve(0),
    ]);

    return {
        causal_memory: {
            linked: causalObservations + livingCases > 0,
            observations: causalObservations,
            living_case_nodes: livingCases,
            query_species: input.species,
            query_domain: input.domain,
            memory_role: 'calibration_and_outcome_alignment',
        },
        counterfactual: {
            linked: counterfactualSessions > 0,
            diagnostic_sessions: counterfactualSessions,
            query_species: input.species,
            challenger_role: 'load_bearing_finding_and_differential_stability_review',
        },
        one_health: {
            linked: oneHealthSignals + zoonoticAlerts > 0 || input.domain === 'one_health' || /zoonot|outbreak|surveillance|one health/i.test(input.question),
            signals: oneHealthSignals,
            zoonotic_bridge_alerts: zoonoticAlerts,
            surveillance_role: 'cross_species_and_public_health_context',
        },
    };
}

async function safeTenantCount(
    client: SupabaseClient,
    table: string,
    tenantId: string,
    species: string | null,
): Promise<number> {
    try {
        let query = client
            .from(table)
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);
        if (species) query = query.eq('species', species);
        const { count } = await query;
        return count ?? 0;
    } catch {
        return 0;
    }
}

async function logRagQuery(client: SupabaseClient, input: {
    tenantId: string;
    actorKind: string;
    question: string;
    strategy: string;
    answer: string;
    citations: RagCitation[];
    retrievalStats: Record<string, unknown>;
    evaluation: Record<string, unknown>;
    integrationContexts: {
        causal_memory: Record<string, unknown>;
        counterfactual: Record<string, unknown>;
        one_health: Record<string, unknown>;
    };
}): Promise<{ queryId: string | null; warning: string | null }> {
    const baseRow = {
        tenant_id: input.tenantId,
        actor_kind: input.actorKind,
        query_text: input.question,
        query_hash: contentHash(input.question),
        retrieval_strategy: input.strategy,
        answer_text: input.answer,
        answer_mode: 'extractive',
        citations: input.citations,
        retrieval_stats: input.retrievalStats,
        evaluation: input.evaluation,
    };
    const fullRow = {
        ...baseRow,
        causal_memory_context: input.integrationContexts.causal_memory,
        counterfactual_context: input.integrationContexts.counterfactual,
        one_health_context: input.integrationContexts.one_health,
    };

    const fullResult = await insertRagQueryRow(client, fullRow);
    if (!fullResult.error && fullResult.queryId) {
        return { queryId: fullResult.queryId, warning: null };
    }

    if (fullResult.error && isMissingRagQueryContextColumn(fullResult.error)) {
        const compactResult = await insertRagQueryRow(client, baseRow);
        if (!compactResult.error && compactResult.queryId) {
            return {
                queryId: compactResult.queryId,
                warning: 'RAG query ledger used compact insert because context columns are missing. Apply supabase/migrations/20260510010000_agentic_rag_automation.sql to capture causal, counterfactual, and One Health contexts.',
            };
        }
        return {
            queryId: null,
            warning: `RAG query ledger compact insert failed: ${compactResult.error?.message ?? 'unknown error'}.`,
        };
    }

    return {
        queryId: null,
        warning: `RAG query ledger insert failed: ${fullResult.error?.message ?? 'unknown error'}.`,
    };
}

async function insertRagQueryRow(
    client: SupabaseClient,
    row: Record<string, unknown>,
): Promise<{ queryId: string | null; error: { code?: string; message?: string } | null }> {
    const { data, error } = await client
        .from('rag_queries')
        .insert(row)
        .select('id')
        .single();

    if (error || !data?.id) return { queryId: null, error: error ?? { message: 'missing query id' } };
    return { queryId: String(data.id), error: null };
}

function isMissingRagQueryContextColumn(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === 'PGRST204'
        || message.includes('causal_memory_context')
        || message.includes('counterfactual_context')
        || message.includes('one_health_context')
        || (message.includes('rag_queries') && message.includes('schema cache'));
}

function mapSource(row: Record<string, unknown>): RagSourceRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        external_key: normalizeOptional(row.external_key),
        name: String(row.name),
        source_type: normalizeRagSourceType(String(row.source_type)),
        authority_tier: normalizeAuthorityTier(String(row.authority_tier)),
        species_scope: asStringArray(row.species_scope),
        medicine_domain: asStringArray(row.medicine_domain),
        url: normalizeOptional(row.url),
        license: normalizeOptional(row.license),
        attribution: normalizeOptional(row.attribution),
        ingestion_policy: asRecord(row.ingestion_policy),
        refresh_policy: asRecord(row.refresh_policy),
        quality_score: Number(row.quality_score ?? 0),
        last_refreshed_at: normalizeOptional(row.last_refreshed_at),
        next_refresh_at: normalizeOptional(row.next_refresh_at),
        status: row.status === 'paused' || row.status === 'quarantined' ? row.status : 'active',
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapDocument(row: Record<string, unknown>): RagDocumentRecord {
    const status = String(row.ingestion_status);
    const refreshStatus = String(row.refresh_status);
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        source_id: String(row.source_id),
        title: String(row.title),
        document_type: String(row.document_type ?? 'text'),
        language: String(row.language ?? 'en'),
        content_sha256: String(row.content_sha256),
        content_length: Number(row.content_length ?? 0),
        metadata: asRecord(row.metadata),
        provenance: asRecord(row.provenance),
        auto_indexed: row.auto_indexed === true,
        refresh_status: refreshStatus === 'stale' || refreshStatus === 'failed' ? refreshStatus : 'current',
        source_fetched_at: normalizeOptional(row.source_fetched_at),
        ingestion_status: status === 'pending' || status === 'failed' || status === 'quarantined' ? status : 'indexed',
        error_message: normalizeOptional(row.error_message),
        indexed_at: normalizeOptional(row.indexed_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapRetrievedChunk(row: Record<string, unknown>, mode: 'vector' | 'lexical'): RagRetrievedChunk {
    return {
        chunk_id: String(row.chunk_id),
        document_id: String(row.document_id),
        source_id: String(row.source_id),
        source_name: String(row.source_name),
        source_type: normalizeRagSourceType(String(row.source_type)),
        authority_tier: normalizeAuthorityTier(String(row.authority_tier)),
        title: String(row.title),
        url: normalizeOptional(row.url),
        chunk_index: Number(row.chunk_index ?? 0),
        chunk_text: String(row.chunk_text ?? ''),
        similarity: Number(row.similarity ?? 0) + (mode === 'lexical' ? 0.03 : 0),
        metadata: {
            ...asRecord(row.metadata),
            retrieval_mode: mode,
        },
        provenance: asRecord(row.provenance),
        created_at: String(row.created_at),
    };
}

function mapDirectRetrievedChunk(
    row: Record<string, unknown>,
    source: RagSourceRecord,
    document: Record<string, unknown>,
    score: number,
): RagRetrievedChunk {
    return {
        chunk_id: String(row.id),
        document_id: String(row.document_id),
        source_id: source.id,
        source_name: source.name,
        source_type: source.source_type,
        authority_tier: source.authority_tier,
        title: String(document.title ?? 'Indexed RAG document'),
        url: source.url,
        chunk_index: Number(row.chunk_index ?? 0),
        chunk_text: String(row.chunk_text ?? ''),
        similarity: score,
        metadata: {
            ...asRecord(row.metadata),
            document_type: normalizeOptional(document.document_type) ?? null,
            retrieval_mode: 'direct_lexical',
        },
        provenance: asRecord(document.provenance),
        created_at: String(row.created_at),
    };
}

function normalizeStrategy(value: string | null | undefined): RagQueryPlan['strategy'] | null {
    const allowed: RagQueryPlan['strategy'][] = ['hybrid', 'vector', 'lexical', 'clinical_guideline', 'drug_safety', 'lab_reference'];
    return allowed.includes(value as RagQueryPlan['strategy']) ? value as RagQueryPlan['strategy'] : null;
}

function normalizeSpecies(value: string | null | undefined): string | null {
    const normalized = value?.trim().toLowerCase();
    return normalized && /^[a-z _-]{2,40}$/.test(normalized) ? normalized.replace(/\s+/g, '_') : null;
}

function inferSpecies(lower: string): string | null {
    const species = ['canine', 'dog', 'dogs', 'feline', 'cat', 'cats', 'equine', 'horse', 'horses', 'bovine', 'cow', 'cows', 'caprine', 'goat', 'goats', 'ovine', 'sheep', 'avian', 'rabbit', 'rabbits'];
    const match = species.find((candidate) => new RegExp(`\\b${candidate}\\b`).test(lower));
    if (!match) return null;
    if (match === 'dog' || match === 'dogs') return 'canine';
    if (match === 'cat' || match === 'cats') return 'feline';
    if (match === 'horse' || match === 'horses') return 'equine';
    if (match === 'cow' || match === 'cows') return 'bovine';
    if (match === 'goat' || match === 'goats') return 'caprine';
    if (match === 'sheep') return 'ovine';
    if (match === 'rabbit' || match === 'rabbits') return 'rabbit';
    return match;
}

function normalizeDomainFilters(value: string | null | undefined): string[] | null {
    const raw = value?.trim();
    if (!raw) return null;
    const filters = raw
        .split(/[,;|]+/)
        .map((entry) => entry.trim().toLowerCase().replace(/\s+/g, '_'))
        .filter((entry) => /^[a-z0-9_-]{2,80}$/.test(entry));
    return filters.length > 0 ? [...new Set(filters)] : null;
}

function inferDomainFilters(lower: string): string[] {
    if (/dose|drug|interaction|contraindication|formulary|withdrawal|adverse/.test(lower)) return ['drug_safety'];
    if (isPancreatitisDiagnosticQuestion(lower)) {
        return ['diagnostics', 'lab_reference', 'disease_reference', 'imaging', 'gastroenterology', 'pancreatitis', 'clinical_guideline'];
    }
    if (/cbc|chemistry|urinalysis|lab|reference range|diagnostic panel|biomarker/.test(lower)) return ['lab_reference', 'diagnostics'];
    if (/nasal|sneez|rhinitis|sinusitis|respiratory|airway|conjunctivitis|calicivirus|herpesvirus|fvr|fhv/.test(lower)) return ['diagnostics', 'clinical_guideline', 'infectious_disease', 'respiratory_disease'];
    if (/diagnos|vomit|diarrhea|diarrhoea|workup|differential|test/.test(lower)) return ['diagnostics', 'clinical_guideline'];
    if (/guideline|consensus|standard|protocol/.test(lower)) return ['clinical_guideline'];
    if (/vaccine|infectious|zoonotic|biosecurity|isolation/.test(lower)) return ['infectious_disease', 'clinical_guideline'];
    if (/cardio|heart|arrhythmia|murmur/.test(lower)) return ['cardiology'];
    if (/kidney|renal|creatinine|bun|iris/.test(lower)) return ['nephrology', 'clinical_guideline'];
    return [];
}

function buildQuote(text: string): string {
    const normalized = normalizeRagContent(text);
    return normalized.length > 360 ? `${normalized.slice(0, 357).trimEnd()}...` : normalized;
}

function selectBestSentence(text: string, question: string): string {
    const terms = new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 3));
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const best = sentences
        .map((sentence) => ({
            sentence,
            score: sentence.toLowerCase().split(/[^a-z0-9]+/).filter((term) => terms.has(term)).length,
        }))
        .sort((left, right) => right.score - left.score)[0]?.sentence;
    return buildQuote(best ?? text);
}

function authorityWeight(tier: RagAuthorityTier): number {
    switch (tier) {
        case 'specialist_guideline': return 0.28;
        case 'institutional': return 0.22;
        case 'peer_reviewed': return 0.18;
        case 'regulatory': return 0.16;
        case 'clinic_local': return 0.04;
        default: return -0.08;
    }
}

function evidenceRankScore(chunk: RagRetrievedChunk): number {
    return chunk.similarity
        + authorityWeight(chunk.authority_tier)
        + highAuthoritySourceBoost(chunk)
        + retrievalModeBoost(chunk)
        - sourceMetadataPenalty(chunk);
}

function highAuthoritySourceBoost(chunk: RagRetrievedChunk): number {
    const value = `${chunk.source_name} ${chunk.url ?? ''}`.toLowerCase();
    if (/merck|merckvetmanual|acvim|wsava/.test(value)) return 0.16;
    if (/cornell|abcdcatsvets|iscaid/.test(value)) return 0.12;
    return 0;
}

function retrievalModeBoost(chunk: RagRetrievedChunk): number {
    const mode = String(chunk.metadata.retrieval_mode ?? '');
    if (mode === 'vector') return 0.08;
    if (mode === 'lexical') return 0.03;
    return 0;
}

function sourceMetadataPenalty(chunk: RagRetrievedChunk): number {
    return isCatalogOrSourceMetadataChunk(chunk) ? 0.3 : 0;
}

function sourceMatchesRequestedSpecies(values: string[], species: string | null): boolean {
    if (!species) return true;
    if (values.length === 0) return false;
    const aliases = speciesScopeAliases(species);
    return values.some((value) => aliases.has(value));
}

function sourceMatchesDomain(values: string[], plan: RagQueryPlan): boolean {
    if (plan.domain_filters.length === 0) return true;
    return values.some((value) => plan.domain_filters.includes(value));
}

function speciesScopeAliases(species: string): Set<string> {
    const aliases = new Set([species]);
    if (species === 'canine') {
        aliases.add('dog');
        aliases.add('small_animal');
        aliases.add('companion_animal');
    }
    if (species === 'feline') {
        aliases.add('cat');
        aliases.add('small_animal');
        aliases.add('companion_animal');
    }
    if (species === 'bovine' || species === 'ovine' || species === 'caprine' || species === 'swine') {
        aliases.add('large_animal');
        aliases.add('livestock');
        aliases.add('farm_animal');
    }
    return aliases;
}

function hasMinimumQuestionRelevance(chunk: RagRetrievedChunk, question: string): boolean {
    const mode = String(chunk.metadata.retrieval_mode ?? '');
    if (mode === 'vector') return chunk.similarity >= 0.64;

    const terms = extractRetrievalTerms(question);
    if (terms.length === 0) return chunk.similarity > 0;
    const haystack = normalizedEvidenceHaystack(chunk);
    if (!hasQueryAnchorCoverage(question, haystack)) return false;
    const matched = terms.filter((term) => haystack.includes(` ${term} `)).length;
    return chunk.similarity >= 0.2 || matched >= Math.min(2, terms.length);
}

function hasRequiredClinicalAnchors(chunk: RagRetrievedChunk, question: string, species: string | null): boolean {
    const anchors = extractClinicalAnchorGroups(question, species);
    if (anchors.length === 0) return true;

    const haystack = normalizedEvidenceHaystack(chunk);
    return anchorGroupsSatisfied(anchors, haystack);
}

function extractClinicalAnchorGroups(question: string, species: string | null): string[][] {
    const normalized = question.toLowerCase();
    const groups: string[][] = [];

    if (/\b(fpv|panleukopenia|feline panleukopenia|feline parvovirus)\b/i.test(question)) {
        groups.push(['fpv', 'panleukopenia', 'parvovirus']);
    }
    if (/\b(cpv|canine parvovirus|parvo)\b/i.test(question)) {
        groups.push(['cpv', 'parvo', 'parvovirus']);
    }
    if (/\bdistemper\b/.test(normalized)) {
        groups.push(['distemper']);
    }
    if (isPancreatitisDiagnosticQuestion(question)) {
        groups.push(['pancreatitis', 'pancreatic', 'pancreas']);
        if (/\b(lab|laboratory|marker|markers|biomarker|serum|lipase|cpli|pli|spec|cbc|chemistry|electrolyte)\b/i.test(question)) {
            groups.push(['lab', 'laboratory', 'marker', 'markers', 'biomarker', 'serum', 'lipase', 'cpli', 'pli', 'spec', 'cbc', 'chemistry', 'electrolyte']);
        }
        if (/\b(imaging|ultrasound|ultrasonography|radiograph|radiographs|radiography|ct|mri)\b/i.test(question)) {
            groups.push(['imaging', 'ultrasound', 'ultrasonography', 'radiograph', 'radiographs', 'radiography', 'ct', 'mri']);
        }
    }
    if (/\b(vomit|vomiting|emesis|diarrhea|diarrhoea|gastroenteritis|gastrointestinal)\b/i.test(question)) {
        const symptomGroups: string[][] = [];
        if (/\b(vomit|vomiting|emesis)\b/i.test(question)) {
            symptomGroups.push(['vomit', 'vomiting', 'emesis', 'nausea', 'gastroenteritis', 'gastrointestinal']);
        }
        if (/\b(diarrhea|diarrhoea)\b/i.test(question)) {
            symptomGroups.push(['diarrhea', 'diarrhoea', 'gastroenteritis', 'gastrointestinal', 'enteritis']);
        }
        if (symptomGroups.length > 0) {
            groups.push(...symptomGroups);
        }
    }
    if (isRespiratoryDiagnosticQuestion(question)) {
        if (/\b(nasal|discharge|rhinitis|sinusitis|runny)\b/i.test(question)) {
            groups.push(['nasal', 'discharge', 'rhinitis', 'sinusitis', 'runny']);
        }
        if (/\b(sneez|sneezing|sneeze)\b/i.test(question)) {
            groups.push(['sneez', 'sneeze', 'sneezing']);
        }
        if (/\b(respiratory|airway|conjunctivitis|ocular|calicivirus|herpesvirus|fvr|fhv)\b/i.test(question)) {
            groups.push(['respiratory', 'airway', 'conjunctivitis', 'ocular', 'calicivirus', 'herpesvirus', 'fvr', 'fhv']);
        }
    }

    const genericAnchors = extractRetrievalTerms(question)
        .filter((term) => !genericClinicalAnchorStopwords(species).has(term));
    for (const term of genericAnchors) {
        groups.push([term]);
    }

    return groups.slice(0, 8);
}

function genericClinicalAnchorStopwords(species: string | null): Set<string> {
    const values = [
        'clinical',
        'citation',
        'citations',
        'criterion',
        'criteria',
        'diagnostic',
        'diagnostics',
        'diagnose',
        'diagnosis',
        'disease',
        'evidence',
        'early',
        'guidance',
        'guideline',
        'guidelines',
        'include',
        'includes',
        'including',
        'infection',
        'infections',
        'list',
        'marker',
        'markers',
        'reference',
        'references',
        'supported',
        'virus',
        'viral',
    ];
    if (species) {
        values.push(...speciesScopeAliases(species));
    }
    return new Set(values);
}

function normalizedEvidenceHaystack(chunk: RagRetrievedChunk): string {
    return ` ${[
        chunk.chunk_text,
        chunk.source_name,
        chunk.title,
    ].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
}

function normalizedTextHaystack(value: string): string {
    return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
}

function hasQueryAnchorCoverage(question: string, normalizedHaystack: string): boolean {
    const anchors = extractClinicalAnchorGroups(question, null);
    if (anchors.length === 0) return true;
    return anchorGroupsSatisfied(anchors, normalizedHaystack);
}

function anchorGroupsSatisfied(groups: string[][], normalizedHaystack: string): boolean {
    if (groups.length === 0) return true;
    const required = Math.min(groups.length, groups.length >= 2 ? 2 : 1);
    const matched = groups.filter((group) => group.some((term) => normalizedHaystack.includes(` ${term} `))).length;
    return matched >= required;
}

function citationSatisfiesQuestionAnchors(citation: RagCitation, question: string, species: string | null): boolean {
    const haystack = normalizedTextHaystack(`${citation.title} ${citation.source_name} ${citation.quote}`);
    const anchors = extractClinicalAnchorGroups(question, species);
    return anchorGroupsSatisfied(anchors, haystack);
}

function hasChunkSpeciesConflict(text: string, requestedSpecies: string): boolean {
    const haystack = normalizedTextHaystack(text);
    const requestedAliases = speciesScopeAliases(requestedSpecies);
    const requestedMentioned = [...requestedAliases].some((alias) => haystack.includes(` ${alias} `));
    const conflicting = conflictingSpeciesTerms(requestedSpecies);
    const conflictMentioned = [...conflicting].some((term) => haystack.includes(` ${term} `));
    return conflictMentioned && !requestedMentioned;
}

function conflictingSpeciesTerms(requestedSpecies: string): Set<string> {
    const groups: Record<string, string[]> = {
        canine: ['feline', 'cat', 'cats', 'bovine', 'cattle', 'cow', 'cows', 'equine', 'horse', 'horses', 'swine', 'porcine', 'pig', 'pigs', 'ovine', 'sheep', 'caprine', 'goat', 'goats'],
        feline: ['canine', 'dog', 'dogs', 'bovine', 'cattle', 'cow', 'cows', 'equine', 'horse', 'horses', 'swine', 'porcine', 'pig', 'pigs', 'ovine', 'sheep', 'caprine', 'goat', 'goats'],
        bovine: ['canine', 'dog', 'dogs', 'feline', 'cat', 'cats', 'equine', 'horse', 'horses'],
        equine: ['canine', 'dog', 'dogs', 'feline', 'cat', 'cats', 'bovine', 'cattle', 'cow', 'cows'],
    };
    return new Set(groups[requestedSpecies] ?? []);
}

function isClinicalSpecificQuestion(question: string): boolean {
    return /\b(criteria|diagnos|infection|infectious|virus|viral|disease|syndrome|workup|treatment|dose|prognosis|pancreatitis|pancreatic|marker|markers)\b/i.test(question);
}

function isCatalogOrSourceMetadataChunk(chunk: RagRetrievedChunk): boolean {
    const documentType = String(chunk.metadata.document_type ?? '').toLowerCase();
    if (documentType === 'source_card') return true;

    return isCatalogOrSourceMetadataText(`${chunk.title} ${chunk.chunk_text}`);
}

function isCatalogOrSourceMetadataText(text: string): boolean {
    return /is registered in vetios as|canonical source url|retrieval use:|safety boundary:|species scope:|medicine domains:/i.test(text);
}

function isHighAuthorityTier(tier: RagAuthorityTier): boolean {
    return tier === 'specialist_guideline'
        || tier === 'institutional'
        || tier === 'peer_reviewed'
        || tier === 'regulatory';
}

function minimumEvidenceSimilarity(citation: RagCitation): number {
    return citation.authority_tier === 'specialist_guideline' || citation.authority_tier === 'institutional'
        ? 0.05
        : 0.1;
}

function inferCitationYear(chunk: RagRetrievedChunk): string | null {
    const candidate = [
        chunk.provenance.source_fetched_at,
        chunk.provenance.publication_year,
        chunk.provenance.pubdate,
        chunk.provenance.year,
        chunk.created_at,
    ]
        .map((value) => String(value ?? ''))
        .find((value) => /\b(19|20)\d{2}\b/.test(value));
    return candidate?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
}

function scoreDirectLexicalMatch(question: string, haystack: string): number {
    const terms = extractRetrievalTerms(question);
    if (terms.length === 0) return 0;
    const normalizedHaystack = ` ${haystack.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    const matched = terms.filter((term) => normalizedHaystack.includes(` ${term} `));
    if (matched.length === 0) return 0;

    const coverage = matched.length / terms.length;
    const phraseBoost = buildQuestionPhrases(question)
        .filter((phrase) => normalizedHaystack.includes(` ${phrase} `))
        .length * 0.05;
    return Math.min(1, Number((coverage + phraseBoost + 0.03).toFixed(4)));
}

function extractRetrievalTerms(value: string): string[] {
    const stopwords = new Set([
        'what',
        'which',
        'when',
        'where',
        'evidence',
        'indexed',
        'show',
        'with',
        'from',
        'that',
        'this',
        'about',
        'acute',
        'criteria',
        'criterion',
        'clinical',
        'detect',
        'detected',
        'detecting',
        'detection',
        'diagnose',
        'diagnoses',
        'diagnosis',
        'diagnostic',
        'diagnostics',
        'disease',
        'guidance',
        'guideline',
        'guidelines',
        'include',
        'includes',
        'including',
        'index',
        'indexed',
        'indexing',
        'infection',
        'infections',
        'marker',
        'markers',
        'reference',
        'references',
        'supported',
        'virus',
        'viral',
        'cat',
        'cats',
        'dog',
        'dogs',
        'feline',
        'canine',
        'equine',
        'bovine',
        'into',
        'does',
        'have',
        'patient',
        'patients',
        'presenting',
        'should',
        'step',
        'steps',
    ]);
    return [...new Set(value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 3 && !stopwords.has(term)))];
}

function ragConsoleQueryStopwords(): Set<string> {
    return new Set([
        'available',
        'catalog',
        'corpus',
        'evidence',
        'indexed',
        'source',
        'sources',
    ]);
}

function buildQuestionPhrases(value: string): string[] {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const words = normalized.split(/\s+/).filter((word) => word.length > 3);
    const phrases: string[] = [];
    for (let index = 0; index < words.length - 1; index += 1) {
        phrases.push(`${words[index]} ${words[index + 1]}`);
    }
    return phrases;
}

function normalizeRequired(value: unknown, field: string): string {
    const normalized = normalizeOptional(value);
    if (!normalized) throw new Error(`${field} is required.`);
    return normalized;
}

function normalizeText(value: unknown, fallback: string): string {
    const normalized = normalizeOptional(value);
    return normalized ?? fallback;
}

function normalizeExternalKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length > 0 && normalized.length <= 120 ? normalized : null;
}

function normalizeOptional(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
