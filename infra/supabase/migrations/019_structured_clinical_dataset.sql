-- =============================================================================
-- Migration 019: Structured Clinical Dataset Layer
--
-- Upgrades canonical clinical cases into a validation-aware, learning-ready
-- dataset asset with quarantine handling, diagnosis/severity metadata,
-- contradiction fields, adversarial tagging, and a filtered live view.
-- =============================================================================

ALTER TABLE public.clinical_cases
    ADD COLUMN IF NOT EXISTS symptom_text_raw text,
    ADD COLUMN IF NOT EXISTS symptom_vector_normalized jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS ingestion_status text NOT NULL DEFAULT 'accepted',
    ADD COLUMN IF NOT EXISTS invalid_case boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS validation_error_code text,
    ADD COLUMN IF NOT EXISTS primary_condition_class text,
    ADD COLUMN IF NOT EXISTS top_diagnosis text,
    ADD COLUMN IF NOT EXISTS confirmed_diagnosis text,
    ADD COLUMN IF NOT EXISTS label_type text NOT NULL DEFAULT 'inferred_only',
    ADD COLUMN IF NOT EXISTS diagnosis_confidence double precision,
    ADD COLUMN IF NOT EXISTS severity_score double precision,
    ADD COLUMN IF NOT EXISTS emergency_level text,
    ADD COLUMN IF NOT EXISTS triage_priority text,
    ADD COLUMN IF NOT EXISTS contradiction_score double precision,
    ADD COLUMN IF NOT EXISTS contradiction_flags text[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS adversarial_case boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS adversarial_case_type text,
    ADD COLUMN IF NOT EXISTS uncertainty_notes text[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS case_cluster text,
    ADD COLUMN IF NOT EXISTS model_version text,
    ADD COLUMN IF NOT EXISTS telemetry_status text;

ALTER TABLE public.clinical_outcome_events
    ADD COLUMN IF NOT EXISTS label_type text;

UPDATE public.clinical_cases
SET
    symptom_text_raw = COALESCE(symptom_text_raw, symptoms_raw, symptom_summary, NULLIF(array_to_string(symptoms_normalized, ', '), ''), NULLIF(array_to_string(symptom_vector, ', '), '')),
    symptom_vector_normalized = CASE
        WHEN symptom_vector_normalized <> '{}'::jsonb THEN symptom_vector_normalized
        ELSE COALESCE(
            (
                SELECT COALESCE(jsonb_object_agg(symptom_key, true), '{}'::jsonb)
                FROM unnest(COALESCE(symptoms_normalized, symptom_vector, '{}'::text[])) AS symptom_key
            ),
            '{}'::jsonb
        )
    END,
    contradiction_flags = COALESCE(contradiction_flags, '{}'::text[]),
    uncertainty_notes = COALESCE(uncertainty_notes, '{}'::text[]),
    label_type = COALESCE(NULLIF(label_type, ''), 'inferred_only'),
    ingestion_status = COALESCE(NULLIF(ingestion_status, ''), 'accepted'),
    invalid_case = COALESCE(invalid_case, false);

UPDATE public.clinical_cases
SET
    invalid_case = CASE
        WHEN lower(COALESCE(species_display, species_canonical, species_raw, species, '')) IN ('', 'unknown', 'unresolved', '-')
             AND COALESCE(symptom_text_raw, '') IN ('', '-', '--') THEN true
        WHEN lower(COALESCE(species_display, species_canonical, species_raw, species, '')) IN ('', 'unknown', 'unresolved', '-') THEN true
        WHEN COALESCE(symptom_text_raw, '') IN ('', '-', '--') AND symptom_vector_normalized = '{}'::jsonb THEN true
        ELSE invalid_case
    END,
    validation_error_code = CASE
        WHEN lower(COALESCE(species_display, species_canonical, species_raw, species, '')) IN ('', 'unknown', 'unresolved', '-')
             AND COALESCE(symptom_text_raw, '') IN ('', '-', '--') THEN 'MISSING_SPECIES_AND_SYMPTOMS'
        WHEN lower(COALESCE(species_display, species_canonical, species_raw, species, '')) IN ('', 'unknown', 'unresolved', '-') THEN 'MISSING_SPECIES'
        WHEN COALESCE(symptom_text_raw, '') IN ('', '-', '--') AND symptom_vector_normalized = '{}'::jsonb THEN 'MISSING_SYMPTOMS'
        ELSE validation_error_code
    END,
    ingestion_status = CASE
        WHEN lower(COALESCE(species_display, species_canonical, species_raw, species, '')) IN ('', 'unknown', 'unresolved', '-')
             AND COALESCE(symptom_text_raw, '') IN ('', '-', '--') THEN 'rejected'
        WHEN lower(COALESCE(species_display, species_canonical, species_raw, species, '')) IN ('', 'unknown', 'unresolved', '-')
             OR (COALESCE(symptom_text_raw, '') IN ('', '-', '--') AND symptom_vector_normalized = '{}'::jsonb) THEN 'quarantined'
        ELSE ingestion_status
    END;

UPDATE public.clinical_cases cc
SET
    primary_condition_class = COALESCE(cc.primary_condition_class, aie.output_payload -> 'diagnosis' ->> 'primary_condition_class'),
    top_diagnosis = COALESCE(cc.top_diagnosis, aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name'),
    diagnosis_confidence = COALESCE(cc.diagnosis_confidence, aie.confidence_score, (aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'probability')::double precision),
    severity_score = COALESCE(cc.severity_score, (aie.output_payload -> 'risk_assessment' ->> 'severity_score')::double precision),
    emergency_level = COALESCE(cc.emergency_level, aie.output_payload -> 'risk_assessment' ->> 'emergency_level'),
    contradiction_score = COALESCE(cc.contradiction_score, (aie.output_payload ->> 'contradiction_score')::double precision),
    contradiction_flags = CASE
        WHEN COALESCE(array_length(cc.contradiction_flags, 1), 0) > 0 THEN cc.contradiction_flags
        ELSE COALESCE(
            (
                SELECT array_agg(value)
                FROM jsonb_array_elements_text(COALESCE(aie.output_payload -> 'contradiction_reasons', '[]'::jsonb)) AS value
            ),
            '{}'::text[]
        )
    END,
    uncertainty_notes = CASE
        WHEN COALESCE(array_length(cc.uncertainty_notes, 1), 0) > 0 THEN cc.uncertainty_notes
        ELSE COALESCE(
            (
                SELECT array_agg(value)
                FROM jsonb_array_elements_text(COALESCE(aie.output_payload -> 'uncertainty_notes', '[]'::jsonb)) AS value
            ),
            '{}'::text[]
        )
    END,
    model_version = COALESCE(cc.model_version, aie.model_version)
FROM public.ai_inference_events aie
WHERE cc.latest_inference_event_id = aie.id;

UPDATE public.clinical_cases cc
SET
    confirmed_diagnosis = COALESCE(cc.confirmed_diagnosis, coe.outcome_payload ->> 'confirmed_diagnosis', coe.outcome_payload ->> 'diagnosis'),
    primary_condition_class = COALESCE(cc.primary_condition_class, coe.outcome_payload ->> 'primary_condition_class'),
    label_type = COALESCE(NULLIF(coe.label_type, ''), NULLIF(coe.outcome_payload ->> 'label_type', ''), cc.label_type),
    severity_score = COALESCE(cc.severity_score, (coe.outcome_payload ->> 'severity_score')::double precision),
    emergency_level = COALESCE(cc.emergency_level, coe.outcome_payload ->> 'emergency_level')
FROM public.clinical_outcome_events coe
WHERE cc.latest_outcome_event_id = coe.id;

UPDATE public.clinical_cases cc
SET
    adversarial_case = true,
    adversarial_case_type = COALESCE(cc.adversarial_case_type, ese.simulation_type)
FROM public.edge_simulation_events ese
WHERE cc.latest_simulation_event_id = ese.id;

UPDATE public.clinical_cases
SET triage_priority = CASE
    WHEN emergency_level = 'CRITICAL' THEN 'immediate'
    WHEN emergency_level = 'HIGH' THEN 'urgent'
    WHEN emergency_level = 'MODERATE' THEN 'standard'
    WHEN emergency_level = 'LOW' THEN 'low'
    WHEN severity_score >= 0.85 THEN 'immediate'
    WHEN severity_score >= 0.60 THEN 'urgent'
    WHEN severity_score >= 0.30 THEN 'standard'
    WHEN severity_score IS NOT NULL THEN 'low'
    ELSE triage_priority
END;

UPDATE public.clinical_cases
SET case_cluster = CASE
    WHEN adversarial_case = true AND COALESCE(primary_condition_class, '') ILIKE '%mechanical%' THEN 'Adversarial Mechanical'
    WHEN adversarial_case = true AND COALESCE(primary_condition_class, '') ILIKE '%infectious%' THEN 'Adversarial Infectious'
    WHEN COALESCE(confirmed_diagnosis, top_diagnosis, '') ILIKE '%gastric dilatation%' OR COALESCE(confirmed_diagnosis, top_diagnosis, '') ILIKE '%gdv%' THEN 'GDV'
    WHEN COALESCE(confirmed_diagnosis, top_diagnosis, '') ILIKE '%parvo%' THEN 'Parvovirus'
    WHEN COALESCE(confirmed_diagnosis, top_diagnosis, '') ILIKE '%distemper%' THEN 'Distemper'
    WHEN COALESCE(confirmed_diagnosis, top_diagnosis, '') ILIKE '%pancreatitis%' THEN 'Pancreatitis'
    WHEN COALESCE(confirmed_diagnosis, top_diagnosis, '') ILIKE '%toxic%' OR COALESCE(primary_condition_class, '') ILIKE '%toxic%' THEN 'Toxicology'
    WHEN COALESCE(primary_condition_class, '') ILIKE '%mechanical%' THEN 'Mechanical'
    WHEN COALESCE(primary_condition_class, '') ILIKE '%infectious%' THEN 'Infectious'
    ELSE COALESCE(case_cluster, 'Unknown / Mixed')
END;

UPDATE public.clinical_cases
SET telemetry_status = CASE
    WHEN invalid_case THEN ingestion_status
    WHEN (top_diagnosis IS NOT NULL OR confirmed_diagnosis IS NOT NULL OR primary_condition_class IS NOT NULL)
         AND (severity_score IS NOT NULL OR emergency_level IS NOT NULL)
         AND adversarial_case = true THEN 'benchmark_ready'
    WHEN (top_diagnosis IS NOT NULL OR confirmed_diagnosis IS NOT NULL OR primary_condition_class IS NOT NULL)
         AND (severity_score IS NOT NULL OR emergency_level IS NOT NULL) THEN 'learning_ready'
    WHEN top_diagnosis IS NOT NULL OR confirmed_diagnosis IS NOT NULL OR severity_score IS NOT NULL THEN 'partial'
    ELSE COALESCE(telemetry_status, 'pending')
END;

CREATE INDEX IF NOT EXISTS idx_clinical_cases_ingestion_status
    ON public.clinical_cases (tenant_id, ingestion_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_cases_case_cluster
    ON public.clinical_cases (tenant_id, case_cluster);

CREATE INDEX IF NOT EXISTS idx_clinical_cases_label_type
    ON public.clinical_cases (tenant_id, label_type);

CREATE INDEX IF NOT EXISTS idx_clinical_cases_adversarial
    ON public.clinical_cases (tenant_id, adversarial_case);

CREATE OR REPLACE VIEW public.clinical_case_live_view AS
SELECT
    cc.id AS case_id,
    cc.tenant_id,
    cc.user_id,
    COALESCE(cc.species_display, cc.species_canonical, cc.species, cc.species_raw) AS species,
    cc.breed,
    COALESCE(
        cc.symptom_summary,
        NULLIF(cc.symptom_text_raw, ''),
        NULLIF(cc.symptoms_raw, ''),
        NULLIF(array_to_string(cc.symptoms_normalized, ', '), ''),
        NULLIF(array_to_string(cc.symptom_vector, ', '), '')
    ) AS symptoms_summary,
    cc.symptom_vector_normalized,
    cc.primary_condition_class,
    cc.top_diagnosis,
    cc.confirmed_diagnosis,
    cc.label_type,
    cc.diagnosis_confidence,
    cc.severity_score,
    cc.emergency_level AS latest_emergency_level,
    cc.triage_priority,
    cc.contradiction_score,
    cc.contradiction_flags,
    cc.uncertainty_notes,
    cc.case_cluster,
    cc.model_version,
    cc.telemetry_status,
    cc.ingestion_status,
    cc.invalid_case,
    cc.validation_error_code,
    cc.adversarial_case,
    cc.adversarial_case_type,
    cc.latest_inference_event_id,
    cc.latest_outcome_event_id,
    cc.latest_simulation_event_id,
    aie.confidence_score AS latest_confidence,
    cc.source_module,
    cc.updated_at
FROM public.clinical_cases cc
LEFT JOIN public.ai_inference_events aie
    ON aie.id = cc.latest_inference_event_id
WHERE cc.ingestion_status = 'accepted'
  AND COALESCE(cc.invalid_case, false) = false;

NOTIFY pgrst, 'reload schema';
