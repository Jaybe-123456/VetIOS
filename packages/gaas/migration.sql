-- ============================================================
-- VetIOS GaaS — Supabase Database Migration
-- Run this against your existing VetIOS Supabase project.
-- Adds all tables required for the GaaS layer.
-- ============================================================

-- Enable pgvector for semantic memory search
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Tenant config ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id        TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  active_agents    TEXT[] NOT NULL DEFAULT '{}',
  default_policies JSONB NOT NULL DEFAULT '{}',
  webhook_url      TEXT,
  alert_email      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants (name);

-- ─── Agent runs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id           TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  agent_role       TEXT NOT NULL,
  goal             JSONB NOT NULL,
  policy           JSONB NOT NULL,
  patient_context  JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running',
  steps            JSONB NOT NULL DEFAULT '[]',
  memory_context   JSONB NOT NULL DEFAULT '[]',
  result           JSONB,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  total_tokens     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant   ON agent_runs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status   ON agent_runs (status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_patient  ON agent_runs ((patient_context->>'patient_id'));
CREATE INDEX IF NOT EXISTS idx_agent_runs_role     ON agent_runs (agent_role);

-- ─── Patient memory (longitudinal history) ───────────────────
CREATE TABLE IF NOT EXISTS patient_memory (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id   TEXT NOT NULL,
  type         TEXT NOT NULL,  -- inference | outcome | note | treatment | lab | alert
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content      JSONB NOT NULL,
  embedding    vector(1536),   -- OpenAI-compatible embedding for semantic search
  tenant_id    TEXT REFERENCES tenants(tenant_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_patient_memory_patient   ON patient_memory (patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_memory_type      ON patient_memory (type);
CREATE INDEX IF NOT EXISTS idx_patient_memory_timestamp ON patient_memory (timestamp DESC);

-- pgvector HNSW index for fast semantic retrieval
CREATE INDEX IF NOT EXISTS idx_patient_memory_embedding
  ON patient_memory USING hnsw (embedding vector_cosine_ops);

-- ─── HITL interrupts ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hitl_interrupts (
  interrupt_id     TEXT PRIMARY KEY,
  agent_run_id     TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  reason           TEXT NOT NULL,
  pending_tool     JSONB,
  context_snapshot JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  resolution       TEXT,       -- approved | rejected | modified
  resolved_by      TEXT,
  modified_input   JSONB
);

CREATE INDEX IF NOT EXISTS idx_hitl_pending    ON hitl_interrupts (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hitl_run        ON hitl_interrupts (agent_run_id);

-- ─── Agent messages (inter-agent coordination) ───────────────
CREATE TABLE IF NOT EXISTS agent_messages (
  message_id    TEXT PRIMARY KEY,
  from_agent    TEXT NOT NULL,
  to_agent      TEXT NOT NULL,
  run_id        TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  patient_id    TEXT NOT NULL,
  type          TEXT NOT NULL,  -- handoff | consultation | alert | result
  payload       JSONB NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_to        ON agent_messages (to_agent, acknowledged);
CREATE INDEX IF NOT EXISTS idx_agent_messages_patient   ON agent_messages (patient_id);

-- ─── Usage events (metering for GaaS billing) ────────────────
CREATE TABLE IF NOT EXISTS usage_events (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  agent_role   TEXT,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant    ON usage_events (tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_type      ON usage_events (event_type);

-- ─── RPC: semantic memory search ─────────────────────────────
CREATE OR REPLACE FUNCTION search_patient_memory(
  p_patient_id TEXT,
  p_query      TEXT,
  p_limit      INT DEFAULT 5
)
RETURNS SETOF patient_memory
LANGUAGE sql
AS $$
  -- Full-text fallback (replace embedding logic with pgvector similarity once embeddings are populated)
  SELECT *
  FROM patient_memory
  WHERE patient_id = p_patient_id
    AND content::TEXT ILIKE '%' || p_query || '%'
  ORDER BY timestamp DESC
  LIMIT p_limit;
$$;

-- ─── RLS policies (enable row-level security per tenant) ─────
ALTER TABLE tenants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitl_interrupts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events   ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (for backend API)
-- Tenant-scoped policies (add per-auth.uid() mapping for client-facing access)
CREATE POLICY "service_role_all" ON tenants         USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_role_all" ON agent_runs      USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_role_all" ON patient_memory  USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_role_all" ON hitl_interrupts USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_role_all" ON agent_messages  USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_role_all" ON usage_events    USING (TRUE) WITH CHECK (TRUE);

-- ─── Updated_at trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
