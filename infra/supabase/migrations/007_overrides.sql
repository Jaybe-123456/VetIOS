-- 007_overrides.sql
-- Human Override records: captures acceptance, rejection, or modification of AI decisions.
-- Append-only for auditability.

CREATE TYPE public.override_action AS ENUM ('accepted', 'rejected', 'modified');

CREATE TABLE public.overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  decision_id     UUID NOT NULL REFERENCES public.ai_decision_logs(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id),
  action          public.override_action NOT NULL,
  modification    JSONB,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_overrides_decision ON public.overrides(decision_id);
CREATE INDEX idx_overrides_tenant ON public.overrides(tenant_id);

ALTER TABLE public.overrides ENABLE ROW LEVEL SECURITY;

-- Append-only: SELECT and INSERT only.
CREATE POLICY "overrides_select_own_tenant"
  ON public.overrides FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "overrides_insert_own_tenant"
  ON public.overrides FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());
