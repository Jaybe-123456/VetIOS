-- VetIOS: Treatment Integrity Pass
-- Fixes: diagnosis_source missing from treatment_candidates and treatment_events.
--        clinician_confirmed_diagnosis missing from treatment_events.
--        treatment_pathway is extracted from JSONB in treatment_events.

-- ── 1. Update treatment_candidates ───────────────────────────────────────────
-- The error reported was specifically on this table.
ALTER TABLE public.treatment_candidates
    ADD COLUMN IF NOT EXISTS diagnosis_source TEXT
        NOT NULL DEFAULT 'ai_inference'
        CHECK (diagnosis_source IN ('ai_inference', 'clinician_override'));

COMMENT ON COLUMN public.treatment_candidates.diagnosis_source IS
    'Origin of the disease label for this candidate. Usually ''ai_inference''.';

-- ── 2. Update treatment_events ────────────────────────────────────────────────
-- Stores the vet's confirmed diagnosis when they override the AI differential.
ALTER TABLE public.treatment_events
    ADD COLUMN IF NOT EXISTS clinician_confirmed_diagnosis TEXT;

ALTER TABLE public.treatment_events
    ADD COLUMN IF NOT EXISTS diagnosis_source TEXT
        NOT NULL DEFAULT 'ai_inference'
        CHECK (diagnosis_source IN ('ai_inference', 'clinician_override'));

COMMENT ON COLUMN public.treatment_events.clinician_confirmed_diagnosis IS
    'The diagnosis confirmed by the clinician when overriding the AI output. '
    'NULL when the AI primary differential was accepted.';

COMMENT ON COLUMN public.treatment_events.diagnosis_source IS
    'Origin of the disease label used for this treatment event. '
    '''ai_inference'' = the top differential from the inference pipeline was used. '
    '''clinician_override'' = the vet corrected the diagnosis before selecting a pathway.';

-- ── 3. Back-fill existing rows ────────────────────────────────────────────────
UPDATE public.treatment_events
SET    diagnosis_source = 'clinician_override'
WHERE  clinician_override = TRUE
  AND  diagnosis_source   = 'ai_inference';

-- ── 4. Indexes for performance ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_treatment_events_diagnosis_source
    ON public.treatment_events (tenant_id, diagnosis_source, disease);

CREATE INDEX IF NOT EXISTS idx_treatment_candidates_diagnosis_source
    ON public.treatment_candidates (tenant_id, diagnosis_source, disease);

-- ── 5. Materialized view helper ──────────────────────────────────────────────
-- treatment_pathway is NOT a column on treatment_events — it is stored inside
-- the selected_treatment JSONB field. Extract it with ->>.
DROP MATERIALIZED VIEW IF EXISTS public.treatment_performance_by_source;
CREATE MATERIALIZED VIEW public.treatment_performance_by_source AS
SELECT
    tenant_id,
    COALESCE(clinician_confirmed_diagnosis, disease)        AS effective_disease,
    disease                                                 AS ai_disease,
    diagnosis_source,
    selected_treatment ->> 'treatment_pathway'              AS treatment_pathway,
    COUNT(*)                                                AS sample_size,
    COUNT(*) FILTER (
        WHERE diagnosis_source      = 'clinician_override'
          AND clinician_confirmed_diagnosis IS DISTINCT FROM disease
    )                                                       AS ai_misclassification_count,
    ROUND(
        COUNT(*) FILTER (
            WHERE diagnosis_source = 'clinician_override'
              AND clinician_confirmed_diagnosis IS NOT DISTINCT FROM disease
        )::NUMERIC
        / NULLIF(
            COUNT(*) FILTER (WHERE diagnosis_source = 'clinician_override'), 0
          ) * 100,
        2
    )                                                       AS ai_accuracy_pct_where_overridden,
    MAX(created_at)                                         AS last_event_at
FROM   public.treatment_events
GROUP  BY
    tenant_id,
    COALESCE(clinician_confirmed_diagnosis, disease),
    disease,
    diagnosis_source,
    selected_treatment ->> 'treatment_pathway'
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_performance_by_source_unique
    ON public.treatment_performance_by_source (
        tenant_id, effective_disease, ai_disease, diagnosis_source, treatment_pathway
    );

-- ── 6. Refresh function ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_treatment_performance_view()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.treatment_performance_by_source;
END;
$$;
