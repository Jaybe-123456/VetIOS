-- 009_knowledge_vectors.sql
-- Knowledge vector store for RAG (Retrieval-Augmented Generation).
-- Stores embeddings of medical literature, formulary data, and past case summaries.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.knowledge_vectors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,  -- NULL = global knowledge
  content_type  TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  content       TEXT NOT NULL,
  embedding     vector(1536) NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_vectors_tenant ON public.knowledge_vectors(tenant_id);
CREATE INDEX idx_knowledge_vectors_type ON public.knowledge_vectors(content_type);
CREATE UNIQUE INDEX idx_knowledge_vectors_hash ON public.knowledge_vectors(content_hash);

-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX idx_knowledge_vectors_embedding
  ON public.knowledge_vectors
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE public.knowledge_vectors ENABLE ROW LEVEL SECURITY;

-- Users can read global vectors (tenant_id IS NULL) and their own tenant's vectors.
CREATE POLICY "knowledge_vectors_select"
  ON public.knowledge_vectors FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = public.current_tenant_id()
  );

CREATE POLICY "knowledge_vectors_insert_own_tenant"
  ON public.knowledge_vectors FOR INSERT
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = public.current_tenant_id()
  );

-- Similarity search function
CREATE OR REPLACE FUNCTION public.search_knowledge_vectors(
  query_embedding vector(1536),
  match_tenant_id UUID DEFAULT NULL,
  match_count INTEGER DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  content_type TEXT,
  metadata JSONB,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    kv.id,
    kv.content,
    kv.content_type,
    kv.metadata,
    1 - (kv.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_vectors kv
  WHERE
    (kv.tenant_id IS NULL OR kv.tenant_id = match_tenant_id)
    AND (1 - (kv.embedding <=> query_embedding)) > match_threshold
  ORDER BY kv.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql STABLE;
