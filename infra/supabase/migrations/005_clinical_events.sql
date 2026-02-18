-- 005_clinical_events.sql
-- Clinical events: append-only log of everything that happens in an encounter.
-- No UPDATE or DELETE policies — this is an immutable audit trail.

CREATE TYPE public.clinical_event_type AS ENUM (
  'vitals_recorded',
  'symptom_noted',
  'diagnosis_suggested',
  'treatment_planned',
  'prescription_ordered',
  'note_added',
  'ai_suggestion',
  'lab_result_received'
);

CREATE TABLE public.clinical_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  encounter_id  UUID NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  event_type    public.clinical_event_type NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  created_by    UUID NOT NULL REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clinical_events_encounter ON public.clinical_events(encounter_id);
CREATE INDEX idx_clinical_events_tenant ON public.clinical_events(tenant_id);
CREATE INDEX idx_clinical_events_type ON public.clinical_events(encounter_id, event_type);

ALTER TABLE public.clinical_events ENABLE ROW LEVEL SECURITY;

-- Append-only: SELECT and INSERT only. No UPDATE or DELETE.
CREATE POLICY "clinical_events_select_own_tenant"
  ON public.clinical_events FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "clinical_events_insert_own_tenant"
  ON public.clinical_events FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());
