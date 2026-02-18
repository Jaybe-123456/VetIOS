-- 004_encounters.sql
-- Encounters: the core transactional unit representing a patient visit.

CREATE TYPE public.encounter_status AS ENUM (
  'checked_in',
  'in_progress',
  'diagnosed',
  'discharged'
);

CREATE TABLE public.encounters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES public.users(id),
  status           public.encounter_status NOT NULL DEFAULT 'checked_in',
  chief_complaint  TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_encounters_tenant ON public.encounters(tenant_id);
CREATE INDEX idx_encounters_patient ON public.encounters(patient_id);
CREATE INDEX idx_encounters_user ON public.encounters(user_id);
CREATE INDEX idx_encounters_status ON public.encounters(tenant_id, status);

ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "encounters_select_own_tenant"
  ON public.encounters FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "encounters_insert_own_tenant"
  ON public.encounters FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "encounters_update_own_tenant"
  ON public.encounters FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER set_encounters_updated_at
  BEFORE UPDATE ON public.encounters
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
