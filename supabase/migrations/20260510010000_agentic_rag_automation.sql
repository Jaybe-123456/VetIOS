-- VetIOS Agentic RAG automation layer
-- Adds source refresh metadata, corpus readiness metrics, and query links into
-- causal memory, counterfactual reasoning, and One Health surveillance.

ALTER TABLE public.rag_sources
    ADD COLUMN IF NOT EXISTS external_key TEXT,
    ADD COLUMN IF NOT EXISTS refresh_policy JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5, 4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_refresh_at TIMESTAMPTZ;

ALTER TABLE public.rag_documents
    ADD COLUMN IF NOT EXISTS auto_indexed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS refresh_status TEXT NOT NULL DEFAULT 'current'
        CHECK (refresh_status IN ('current', 'stale', 'failed')),
    ADD COLUMN IF NOT EXISTS source_fetched_at TIMESTAMPTZ;

ALTER TABLE public.rag_queries
    ADD COLUMN IF NOT EXISTS causal_memory_context JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS counterfactual_context JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS one_health_context JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_sources_tenant_external_key
    ON public.rag_sources (tenant_id, external_key)
    WHERE external_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rag_sources_refresh_due
    ON public.rag_sources (tenant_id, next_refresh_at)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_rag_documents_refresh_status
    ON public.rag_documents (tenant_id, refresh_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.rag_source_refresh_runs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          TEXT NOT NULL,
    actor_kind         TEXT NOT NULL DEFAULT 'system',
    run_mode           TEXT NOT NULL DEFAULT 'catalog_refresh'
        CHECK (run_mode IN ('catalog_seed', 'catalog_refresh', 'corpus_evaluation')),
    status             TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'partial')),
    sources_attempted  INTEGER NOT NULL DEFAULT 0,
    sources_indexed    INTEGER NOT NULL DEFAULT 0,
    documents_indexed  INTEGER NOT NULL DEFAULT 0,
    chunks_indexed     INTEGER NOT NULL DEFAULT 0,
    evaluation         JSONB NOT NULL DEFAULT '{}',
    errors             JSONB NOT NULL DEFAULT '[]',
    started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rag_source_refresh_runs_tenant_created
    ON public.rag_source_refresh_runs (tenant_id, started_at DESC);

ALTER TABLE public.rag_source_refresh_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_rag_source_refresh_runs" ON public.rag_source_refresh_runs
    USING (tenant_id = current_setting('app.tenant_id', TRUE) OR auth.role() = 'service_role');

COMMENT ON COLUMN public.rag_sources.external_key IS 'Stable connector key used by automated source catalog refresh jobs.';
COMMENT ON COLUMN public.rag_sources.refresh_policy IS 'Refresh interval, connector mode, and trust restrictions for automated RAG ingestion.';
COMMENT ON TABLE public.rag_source_refresh_runs IS 'Audit ledger for automated Agentic RAG source seeding, refresh, and evaluation jobs.';
