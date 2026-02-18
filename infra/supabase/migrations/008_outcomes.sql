-- 008_outcomes.sql
-- Outcome records: captures clinical outcomes linked to encounters and optionally to decisions.
-- Enables the Learning Loop by tracking what happened after a decision was made.

CREATE TABLE public.outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  encounter_id    UUID NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  decision_id     UUID REFERENCES public.ai_decision_logs(id),
  outcome_type    TEXT NOT NULL,
  result          JSONB NOT NULL DEFAULT '{}',
  recorded_by     UUID NOT NULL REFERENCES public.users(id),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outcomes_encounter ON public.outcomes(encounter_id);
CREATE INDEX idx_outcomes_decision ON public.outcomes(decision_id);
CREATE INDEX idx_outcomes_tenant ON public.outcomes(tenant_id);

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outcomes_select_own_tenant"
  ON public.outcomes FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "outcomes_insert_own_tenant"
  ON public.outcomes FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "outcomes_update_own_tenant"
  ON public.outcomes FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
