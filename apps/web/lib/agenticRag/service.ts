import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkRagDocument, contentHash, normalizeRagContent, type RagChunkingOptions } from './chunking';
import { embedRagText } from './embedding';
import {
    normalizeAuthorityTier,
    normalizeRagSourceType,
    normalizeStringList,
    validatePublicSourceUrl,
} from './sourcePolicy';
import type {
    RagAnswerResult,
    RagAuthorityTier,
    RagCitation,
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
    name?: string;
    source_type?: string;
    authority_tier?: string;
    species_scope?: unknown;
    medicine_domain?: unknown;
    url?: string | null;
    license?: string | null;
    attribution?: string | null;
    ingestion_policy?: Record<string, unknown>;
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
    const document = await upsertRagDocument(input.client, {
        tenantId: input.tenantId,
        sourceId: source.id,
        title: input.document.title,
        documentType: input.document.document_type ?? 'text',
        language: input.document.language ?? 'en',
        contentSha,
        contentLength: normalizedContent.length,
        metadata: input.document.metadata ?? {},
        provenance: {
            source_url: source.url,
            content_url: input.document.content_url ?? null,
            actor: input.actorLabel,
            content_sha256: contentSha,
            indexed_by: 'vetios_agentic_rag',
        },
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
    const plan = buildRagQueryPlan({
        question: input.question,
        species: input.species ?? null,
        domain: input.domain ?? null,
        strategy: input.strategy ?? null,
    });

    const sourceIds = input.sourceIds?.filter(isUuid).slice(0, 20) ?? [];
    const vectorRows = plan.strategy === 'lexical'
        ? []
        : await retrieveVectorChunks(input, plan, sourceIds, limit).catch(() => []);
    const lexicalRows = plan.strategy === 'vector'
        ? []
        : await retrieveLexicalChunks(input, plan, sourceIds, limit).catch(() => []);
    const chunks = mergeRetrievedChunks(vectorRows, lexicalRows).slice(0, limit);
    const citations = chunks.map((chunk, index) => buildCitation(chunk, index + 1));
    const answer = synthesizeExtractiveAnswer(input.question, citations);
    const warnings = buildRagWarnings(citations);
    const retrievalStats = {
        strategy: plan.strategy,
        vector_hits: vectorRows.length,
        lexical_hits: lexicalRows.length,
        total_citations: citations.length,
        top_authority_tier: citations[0]?.authority_tier ?? null,
        retrieval_time_ms: Date.now() - start,
    };
    const evaluation = {
        grounded: citations.length > 0,
        citation_coverage: citations.length > 0 ? 1 : 0,
        unsupported_claims: 0,
        warnings,
    };

    const queryId = await logRagQuery(input.client, {
        tenantId: input.tenantId,
        actorKind: input.actorKind,
        question: input.question,
        strategy: plan.strategy,
        answer,
        citations,
        retrievalStats,
        evaluation,
    }).catch(() => null);

    return {
        answer,
        answer_mode: 'extractive',
        plan,
        citations,
        retrieval_stats: retrievalStats,
        evaluation,
        query_id: queryId,
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
    const domain = normalizeDomain(input.domain) ?? inferDomain(lower);
    const strategy = explicit
        ?? (domain === 'drug_safety' ? 'drug_safety'
            : domain === 'lab_reference' ? 'lab_reference'
                : /guideline|consensus|standard|protocol/.test(lower) ? 'clinical_guideline'
                    : 'hybrid');

    return {
        strategy,
        species,
        domain,
        requireCitations: true,
        safetyBoundary: /diagnos|treat|dose|therapy|prognos|case|patient/.test(lower)
            ? 'clinical_decision_support'
            : 'general_knowledge',
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
    const { data, error } = await input.client
        .from('rag_sources')
        .insert({
            tenant_id: input.tenantId,
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
            status: 'active',
        })
        .select('*')
        .single();

    if (error || !data) throw new Error(`Failed to create RAG source: ${error?.message ?? 'Unknown error'}`);
    return mapSource(data as Record<string, unknown>);
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
        filter_domain: plan.domain,
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
        search_query: input.question,
        match_count: limit,
        filter_tenant: input.tenantId,
        filter_source_ids: sourceIds.length > 0 ? sourceIds : null,
        filter_species: plan.species,
        filter_domain: plan.domain,
    });
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    return rows.map((row) => mapRetrievedChunk(row, 'lexical'));
}

function mergeRetrievedChunks(vectorRows: RagRetrievedChunk[], lexicalRows: RagRetrievedChunk[]): RagRetrievedChunk[] {
    const byId = new Map<string, RagRetrievedChunk>();
    for (const row of [...vectorRows, ...lexicalRows]) {
        const existing = byId.get(row.chunk_id);
        if (!existing || authorityWeight(row.authority_tier) + row.similarity > authorityWeight(existing.authority_tier) + existing.similarity) {
            byId.set(row.chunk_id, row);
        }
    }

    return [...byId.values()].sort((left, right) => (
        (authorityWeight(right.authority_tier) + right.similarity)
        - (authorityWeight(left.authority_tier) + left.similarity)
    ));
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
        url: chunk.url,
        quote: buildQuote(chunk.chunk_text),
        similarity: Number(chunk.similarity.toFixed(4)),
        provenance: chunk.provenance,
    };
}

function synthesizeExtractiveAnswer(question: string, citations: RagCitation[]): string {
    if (citations.length === 0) {
        return [
            'I could not find indexed VetIOS RAG evidence for this question.',
            'No clinical or medical claim is being generated because the answer would be unsupported.',
            'Index a guideline, paper, protocol, lab reference, or formulary document first, then rerun the query.',
        ].join(' ');
    }

    const claims = citations.slice(0, 4).map((citation) => {
        const sentence = selectBestSentence(citation.quote, question);
        return `${sentence} [${citation.index}]`;
    });

    return [
        `I found ${citations.length} indexed evidence passage(s) and can answer only from those cited sources.`,
        ...claims,
        'Use this as clinical decision support; final diagnosis, treatment, and dosing decisions require licensed veterinary judgment.',
    ].join(' ');
}

function buildRagWarnings(citations: RagCitation[]): string[] {
    const warnings: string[] = [];
    if (citations.length === 0) {
        warnings.push('No indexed evidence was retrieved.');
    }
    if (citations.some((citation) => citation.authority_tier === 'unverified')) {
        warnings.push('At least one citation comes from an unverified source tier.');
    }
    if (citations.every((citation) => citation.authority_tier === 'clinic_local')) {
        warnings.push('All citations are clinic-local; consider adding peer-reviewed or specialist guideline sources.');
    }
    return warnings;
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
}): Promise<string | null> {
    const { data, error } = await client
        .from('rag_queries')
        .insert({
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
        })
        .select('id')
        .single();

    if (error || !data?.id) return null;
    return String(data.id);
}

function mapSource(row: Record<string, unknown>): RagSourceRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        name: String(row.name),
        source_type: normalizeRagSourceType(String(row.source_type)),
        authority_tier: normalizeAuthorityTier(String(row.authority_tier)),
        species_scope: asStringArray(row.species_scope),
        medicine_domain: asStringArray(row.medicine_domain),
        url: normalizeOptional(row.url),
        license: normalizeOptional(row.license),
        attribution: normalizeOptional(row.attribution),
        ingestion_policy: asRecord(row.ingestion_policy),
        status: row.status === 'paused' || row.status === 'quarantined' ? row.status : 'active',
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapDocument(row: Record<string, unknown>): RagDocumentRecord {
    const status = String(row.ingestion_status);
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
        metadata: asRecord(row.metadata),
        provenance: asRecord(row.provenance),
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
    const species = ['canine', 'dog', 'feline', 'cat', 'equine', 'horse', 'bovine', 'cow', 'caprine', 'goat', 'ovine', 'sheep', 'avian', 'rabbit'];
    const match = species.find((candidate) => new RegExp(`\\b${candidate}\\b`).test(lower));
    if (!match) return null;
    if (match === 'dog') return 'canine';
    if (match === 'cat') return 'feline';
    if (match === 'horse') return 'equine';
    if (match === 'cow') return 'bovine';
    if (match === 'goat') return 'caprine';
    if (match === 'sheep') return 'ovine';
    return match;
}

function normalizeDomain(value: string | null | undefined): string | null {
    const normalized = value?.trim().toLowerCase().replace(/\s+/g, '_');
    return normalized && /^[a-z0-9_-]{2,80}$/.test(normalized) ? normalized : null;
}

function inferDomain(lower: string): string | null {
    if (/dose|drug|interaction|contraindication|formulary|withdrawal|adverse/.test(lower)) return 'drug_safety';
    if (/cbc|chemistry|urinalysis|lab|reference range|diagnostic panel|biomarker/.test(lower)) return 'lab_reference';
    if (/vaccine|infectious|zoonotic|biosecurity|isolation/.test(lower)) return 'infectious_disease';
    if (/cardio|heart|arrhythmia|murmur/.test(lower)) return 'cardiology';
    if (/kidney|renal|creatinine|bun|iris/.test(lower)) return 'nephrology';
    return null;
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
        case 'specialist_guideline': return 0.18;
        case 'peer_reviewed': return 0.16;
        case 'regulatory': return 0.14;
        case 'institutional': return 0.1;
        case 'clinic_local': return 0.04;
        default: return 0;
    }
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
