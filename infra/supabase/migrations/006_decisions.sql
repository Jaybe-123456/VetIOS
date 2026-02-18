-- 006_decisions.sql
-- AI Decision Logs: immutable record of every AI reasoning step.
-- Captures model version, prompt template, context snapshot, and outputs.

CREATE TABLE public.ai_decision_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  encounter_id        UUID NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  trace_id            UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  model_version       TEXT NOT NULL,
  prompt_template_id  TEXT NOT NULL,
  context_snapshot    JSONB NOT NULL DEFAULT '{}',
  raw_output          TEXT NOT NULL DEFAULT '',
  parsed_output       JSONB NOT NULL DEFAULT '{}',
  latency_ms          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_decisions_encounter ON public.ai_decision_logs(encounter_id);
CREATE INDEX idx_decisions_tenant ON public.ai_decision_logs(tenant_id);
CREATE INDEX idx_decisions_trace ON public.ai_decision_logs(trace_id);

ALTER TABLE public.ai_decision_logs ENABLE ROW LEVEL SECURITY;

-- Append-only: SELECT and INSERT only.
CREATE POLICY "decisions_select_own_tenant"
  ON public.ai_decision_logs FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "decisions_insert_own_tenant"
  ON public.ai_decision_logs FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());
