-- =============================================================================
-- VetIOS GaaS — Migration 003: Patient Memory Store
-- Timestamp: 20260420020000
-- Description: Creates the longitudinal patient memory table with pgvector
--   support for semantic similarity search. This is the persistent context
--   layer that gives agents memory across sessions.
--
-- Prerequisites: pgvector extension (20260420000000), gaas_agent_runs (20260420010000)
-- =============================================================================

-- =============================================================================
-- 1. Memory Entry Type Enum
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'gaas_memory_type'
        AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.gaas_memory_type AS ENUM (
            'inference',
            'outcome',
            'note',
            'treatment',
            'lab',
            'alert'
        );
    END IF;
END $$;

-- =============================================================================
-- 2. Patient Memory Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_patient_memory (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id   TEXT NOT NULL,
    tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    type         public.gaas_memory_type NOT NULL,
    content      JSONB NOT NULL DEFAULT '{}'::JSONB,
    run_id       TEXT,                               -- optional link to originating run
    embedding    vector(1536),                       -- OpenAI text-embedding-3-small compatible
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_gaas_patient_memory_patient_id
    ON public.gaas_patient_memory (patient_id);

CREATE INDEX IF NOT EXISTS idx_gaas_patient_memory_tenant_id
    ON public.gaas_patient_memory (tenant_id);

CREATE INDEX IF NOT EXISTS idx_gaas_patient_memory_type
    ON public.gaas_patient_memory (type);

CREATE INDEX IF NOT EXISTS idx_gaas_patient_memory_created_at
    ON public.gaas_patient_memory (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gaas_patient_memory_patient_tenant
    ON public.gaas_patient_memory (patient_id, tenant_id);

-- pgvector HNSW index for fast approximate nearest-neighbour semantic search
-- ef_construction=128, m=16 are good defaults for clinical text embeddings
CREATE INDEX IF NOT EXISTS idx_gaas_patient_memory_embedding_hnsw
    ON public.gaas_patient_memory
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 128);

-- Updated_at trigger
DROP TRIGGER IF EXISTS gaas_patient_memory_updated_at ON public.gaas_patient_memory;
CREATE TRIGGER gaas_patient_memory_updated_at
    BEFORE UPDATE ON public.gaas_patient_memory
    FOR EACH ROW EXECUTE FUNCTION public.gaas_set_updated_at();

-- =============================================================================
-- 3. Semantic Search RPC
--    Called by SupabaseMemoryStore.search() in the GaaS layer.
--    Falls back to full-text ILIKE when embeddings are not yet populated.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_search_patient_memory(
    p_patient_id   TEXT,
    p_tenant_id    UUID,
    p_query        TEXT,
    p_embedding    vector(1536) DEFAULT NULL,
    p_limit        INT DEFAULT 8
)
RETURNS SETOF public.gaas_patient_memory
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    -- Vector search path: use cosine similarity when embedding is provided
    IF p_embedding IS NOT NULL THEN
        RETURN QUERY
            SELECT *
            FROM public.gaas_patient_memory
            WHERE patient_id  = p_patient_id
              AND tenant_id   = p_tenant_id
            ORDER BY embedding <=> p_embedding
            LIMIT p_limit;
    ELSE
        -- Fallback: keyword search across content JSONB
        RETURN QUERY
            SELECT *
            FROM public.gaas_patient_memory
            WHERE patient_id  = p_patient_id
              AND tenant_id   = p_tenant_id
              AND content::TEXT ILIKE '%' || p_query || '%'
            ORDER BY created_at DESC
            LIMIT p_limit;
    END IF;
END;
$$;

-- =============================================================================
-- 4. Memory Summary RPC
--    Returns a lightweight count summary for a patient — used by agents
--    to quickly load a context header without pulling full records.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_summarize_patient_memory(
    p_patient_id TEXT,
    p_tenant_id  UUID
)
RETURNS TABLE (
    memory_type  TEXT,
    count        BIGINT,
    latest_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        type::TEXT         AS memory_type,
        COUNT(*)           AS count,
        MAX(created_at)    AS latest_at
    FROM public.gaas_patient_memory
    WHERE patient_id = p_patient_id
      AND tenant_id  = p_tenant_id
    GROUP BY type
    ORDER BY latest_at DESC;
$$;

-- =============================================================================
-- 5. Row Level Security
-- =============================================================================

ALTER TABLE public.gaas_patient_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gaas_patient_memory_service_all"
    ON public.gaas_patient_memory
    USING (TRUE)
    WITH CHECK (TRUE);

CREATE POLICY "gaas_patient_memory_tenant_read"
    ON public.gaas_patient_memory
    FOR SELECT
    USING (tenant_id::TEXT = current_setting('app.tenant_id', TRUE));

COMMENT ON TABLE public.gaas_patient_memory IS
    'Longitudinal patient memory — persistent context across agent sessions. Supports vector semantic search via pgvector.';

COMMENT ON COLUMN public.gaas_patient_memory.embedding IS
    'text-embedding-3-small (1536-dim) vector. Populated asynchronously by the embedding worker after insert. Null until embedded.';
