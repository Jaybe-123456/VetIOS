-- VetIOS Agentic RAG-as-a-Service
-- Veterinary and medical document source registry, chunk index, retrieval RPCs,
-- and citation-first query ledger.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.rag_sources (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        TEXT NOT NULL,
    name             TEXT NOT NULL,
    source_type      TEXT NOT NULL CHECK (source_type IN (
        'guideline',
        'journal',
        'textbook',
        'drug_label',
        'lab_reference',
        'clinical_protocol',
        'client_handout',
        'dataset',
        'web',
        'file',
        'other'
    )),
    authority_tier   TEXT NOT NULL DEFAULT 'unverified' CHECK (authority_tier IN (
        'peer_reviewed',
        'specialist_guideline',
        'regulatory',
        'institutional',
        'clinic_local',
        'unverified'
    )),
    species_scope    TEXT[] NOT NULL DEFAULT '{}',
    medicine_domain  TEXT[] NOT NULL DEFAULT '{}',
    url              TEXT,
    license          TEXT,
    attribution      TEXT,
    ingestion_policy JSONB NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'quarantined')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.rag_documents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        TEXT NOT NULL,
    source_id        UUID NOT NULL REFERENCES public.rag_sources(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    document_type    TEXT NOT NULL DEFAULT 'text',
    language         TEXT NOT NULL DEFAULT 'en',
    content_sha256   TEXT NOT NULL,
    content_length   INTEGER NOT NULL DEFAULT 0,
    metadata         JSONB NOT NULL DEFAULT '{}',
    provenance       JSONB NOT NULL DEFAULT '{}',
    ingestion_status TEXT NOT NULL DEFAULT 'indexed' CHECK (ingestion_status IN ('pending', 'indexed', 'failed', 'quarantined')),
    error_message    TEXT,
    indexed_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, source_id, content_sha256)
);

CREATE TABLE IF NOT EXISTS public.rag_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT NOT NULL,
    source_id       UUID NOT NULL REFERENCES public.rag_sources(id) ON DELETE CASCADE,
    document_id     UUID NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    chunk_text      TEXT NOT NULL,
    chunk_hash      TEXT NOT NULL,
    heading         TEXT,
    token_estimate  INTEGER NOT NULL DEFAULT 0,
    embedding       vector(1536),
    embedding_model TEXT,
    lexical         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(chunk_text, ''))) STORED,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS public.rag_queries (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          TEXT NOT NULL,
    actor_kind         TEXT NOT NULL DEFAULT 'session',
    query_text         TEXT NOT NULL,
    query_hash         TEXT NOT NULL,
    retrieval_strategy TEXT NOT NULL,
    answer_text        TEXT NOT NULL,
    answer_mode        TEXT NOT NULL DEFAULT 'extractive',
    citations          JSONB NOT NULL DEFAULT '[]',
    retrieval_stats    JSONB NOT NULL DEFAULT '{}',
    evaluation         JSONB NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_sources_tenant_status
    ON public.rag_sources (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_documents_tenant_source
    ON public.rag_documents (tenant_id, source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_documents_sha
    ON public.rag_documents (tenant_id, content_sha256);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant_source
    ON public.rag_chunks (tenant_id, source_id, document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_lexical
    ON public.rag_chunks USING GIN (lexical);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_hnsw
    ON public.rag_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_rag_queries_tenant_created
    ON public.rag_queries (tenant_id, created_at DESC);

ALTER TABLE public.rag_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_rag_sources" ON public.rag_sources
    USING (tenant_id = current_setting('app.tenant_id', TRUE) OR auth.role() = 'service_role');

CREATE POLICY "tenant_isolation_rag_documents" ON public.rag_documents
    USING (tenant_id = current_setting('app.tenant_id', TRUE) OR auth.role() = 'service_role');

CREATE POLICY "tenant_isolation_rag_chunks" ON public.rag_chunks
    USING (tenant_id = current_setting('app.tenant_id', TRUE) OR auth.role() = 'service_role');

CREATE POLICY "tenant_isolation_rag_queries" ON public.rag_queries
    USING (tenant_id = current_setting('app.tenant_id', TRUE) OR auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.match_rag_chunks(
    query_embedding     vector(1536),
    match_threshold     FLOAT DEFAULT 0.68,
    match_count         INT DEFAULT 12,
    filter_tenant       TEXT DEFAULT NULL,
    filter_source_ids   UUID[] DEFAULT NULL,
    filter_species      TEXT DEFAULT NULL,
    filter_domain       TEXT DEFAULT NULL
)
RETURNS TABLE (
    chunk_id        UUID,
    document_id     UUID,
    source_id       UUID,
    source_name     TEXT,
    source_type     TEXT,
    authority_tier  TEXT,
    title           TEXT,
    url             TEXT,
    chunk_index     INTEGER,
    chunk_text      TEXT,
    similarity      FLOAT,
    metadata        JSONB,
    provenance      JSONB,
    created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF filter_tenant IS NULL OR length(filter_tenant) = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        c.source_id,
        s.name,
        s.source_type,
        s.authority_tier,
        d.title,
        s.url,
        c.chunk_index,
        c.chunk_text,
        1 - (c.embedding <=> query_embedding) AS similarity,
        c.metadata,
        d.provenance,
        c.created_at
    FROM public.rag_chunks c
    JOIN public.rag_documents d ON d.id = c.document_id
    JOIN public.rag_sources s ON s.id = c.source_id
    WHERE
        c.tenant_id = filter_tenant
        AND s.tenant_id = filter_tenant
        AND d.tenant_id = filter_tenant
        AND s.status = 'active'
        AND c.embedding IS NOT NULL
        AND 1 - (c.embedding <=> query_embedding) >= match_threshold
        AND (filter_source_ids IS NULL OR c.source_id = ANY(filter_source_ids))
        AND (filter_species IS NULL OR filter_species = ANY(s.species_scope) OR cardinality(s.species_scope) = 0)
        AND (filter_domain IS NULL OR filter_domain = ANY(s.medicine_domain) OR cardinality(s.medicine_domain) = 0)
    ORDER BY c.embedding <=> query_embedding
    LIMIT LEAST(GREATEST(match_count, 1), 30);
END;
$$;

CREATE OR REPLACE FUNCTION public.search_rag_chunks_lexical(
    search_query        TEXT,
    match_count         INT DEFAULT 12,
    filter_tenant       TEXT DEFAULT NULL,
    filter_source_ids   UUID[] DEFAULT NULL,
    filter_species      TEXT DEFAULT NULL,
    filter_domain       TEXT DEFAULT NULL
)
RETURNS TABLE (
    chunk_id        UUID,
    document_id     UUID,
    source_id       UUID,
    source_name     TEXT,
    source_type     TEXT,
    authority_tier  TEXT,
    title           TEXT,
    url             TEXT,
    chunk_index     INTEGER,
    chunk_text      TEXT,
    similarity      FLOAT,
    metadata        JSONB,
    provenance      JSONB,
    created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    tsq TSQUERY;
BEGIN
    IF filter_tenant IS NULL OR length(filter_tenant) = 0 OR search_query IS NULL OR length(trim(search_query)) = 0 THEN
        RETURN;
    END IF;

    tsq := websearch_to_tsquery('english', search_query);

    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        c.source_id,
        s.name,
        s.source_type,
        s.authority_tier,
        d.title,
        s.url,
        c.chunk_index,
        c.chunk_text,
        ts_rank_cd(c.lexical, tsq)::FLOAT AS similarity,
        c.metadata,
        d.provenance,
        c.created_at
    FROM public.rag_chunks c
    JOIN public.rag_documents d ON d.id = c.document_id
    JOIN public.rag_sources s ON s.id = c.source_id
    WHERE
        c.tenant_id = filter_tenant
        AND s.tenant_id = filter_tenant
        AND d.tenant_id = filter_tenant
        AND s.status = 'active'
        AND c.lexical @@ tsq
        AND (filter_source_ids IS NULL OR c.source_id = ANY(filter_source_ids))
        AND (filter_species IS NULL OR filter_species = ANY(s.species_scope) OR cardinality(s.species_scope) = 0)
        AND (filter_domain IS NULL OR filter_domain = ANY(s.medicine_domain) OR cardinality(s.medicine_domain) = 0)
    ORDER BY ts_rank_cd(c.lexical, tsq) DESC, c.created_at DESC
    LIMIT LEAST(GREATEST(match_count, 1), 30);
END;
$$;

COMMENT ON TABLE public.rag_sources IS 'Agentic RAG source registry for veterinary and medical documents.';
COMMENT ON TABLE public.rag_documents IS 'Indexed source documents with provenance and content fingerprints.';
COMMENT ON TABLE public.rag_chunks IS 'Chunk-level retrieval corpus with pgvector and lexical search.';
COMMENT ON TABLE public.rag_queries IS 'RAG query audit ledger with citations, retrieval metrics, and evaluation signals.';
