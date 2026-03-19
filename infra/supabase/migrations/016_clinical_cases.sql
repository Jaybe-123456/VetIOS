-- =============================================================================
-- Migration 016: Canonical Clinical Cases
--
-- Creates a tenant-scoped canonical case table so inference events can attach to
-- a durable clinical_case instead of floating as unlinked event rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.clinical_cases (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    clinic_id               uuid,
    case_key                text NOT NULL,
    source_case_reference   text,
    species                 text,
    species_raw             text,
    breed                   text,
    symptom_vector          text[] NOT NULL DEFAULT '{}'::text[],
    symptom_summary         text,
    metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
    latest_input_signature  jsonb NOT NULL DEFAULT '{}'::jsonb,
    latest_inference_event_id uuid REFERENCES public.ai_inference_events(id) ON DELETE SET NULL,
    inference_event_count   integer NOT NULL DEFAULT 0,
    first_inference_at      timestamptz NOT NULL DEFAULT now(),
    last_inference_at       timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT clinical_cases_tenant_case_key_key UNIQUE (tenant_id, case_key)
);

COMMENT ON TABLE public.clinical_cases IS
    'Canonical tenant-scoped clinical cases derived from inference submissions.';

CREATE INDEX IF NOT EXISTS idx_clinical_cases_tenant_time
    ON public.clinical_cases (tenant_id, last_inference_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_cases_latest_inference
    ON public.clinical_cases (latest_inference_event_id)
    WHERE latest_inference_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_cases_source_reference
    ON public.clinical_cases (tenant_id, source_case_reference)
    WHERE source_case_reference IS NOT NULL;

ALTER TABLE public.clinical_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinical_cases_select_own" ON public.clinical_cases;
CREATE POLICY "clinical_cases_select_own"
    ON public.clinical_cases
    FOR SELECT
    USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "clinical_cases_insert_own" ON public.clinical_cases;
CREATE POLICY "clinical_cases_insert_own"
    ON public.clinical_cases
    FOR INSERT
    WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "clinical_cases_update_own" ON public.clinical_cases;
CREATE POLICY "clinical_cases_update_own"
    ON public.clinical_cases
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (tenant_id = public.current_tenant_id());

DROP TRIGGER IF EXISTS set_updated_at_clinical_cases ON public.clinical_cases;
CREATE TRIGGER set_updated_at_clinical_cases
    BEFORE UPDATE ON public.clinical_cases
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();
