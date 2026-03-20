-- =============================================================================
-- Migration 020: Clinical Dataset Learning Sync
--
-- Persists prediction/calibration/adversarial metadata directly on canonical
-- clinical cases, backfills historical rows from the latest inference/outcome/
-- simulation history, and refreshes the live dataset projection.
-- =============================================================================

ALTER TABLE public.clinical_cases
    ADD COLUMN IF NOT EXISTS predicted_diagnosis text,
    ADD COLUMN IF NOT EXISTS calibration_status text,
    ADD COLUMN IF NOT EXISTS prediction_correct boolean,
    ADD COLUMN IF NOT EXISTS confidence_error double precision,
    ADD COLUMN IF NOT EXISTS calibration_bucket text,
    ADD COLUMN IF NOT EXISTS degraded_confidence double precision,
    ADD COLUMN IF NOT EXISTS differential_spread jsonb;

UPDATE public.clinical_cases
SET
    species_canonical = COALESCE(public.normalize_species_label(COALESCE(species_canonical, species, species_raw)), species_canonical, species, species_raw),
    species = COALESCE(public.normalize_species_label(COALESCE(species_canonical, species, species_raw)), species, species_canonical, species_raw),
    species_display = CASE
        WHEN COALESCE(public.normalize_species_label(COALESCE(species_canonical, species, species_raw)), species_canonical, species, species_raw) = 'Canis lupus familiaris' THEN 'Dog'
        WHEN COALESCE(public.normalize_species_label(COALESCE(species_canonical, species, species_raw)), species_canonical, species, species_raw) = 'Felis catus' THEN 'Cat'
        WHEN COALESCE(public.normalize_species_label(COALESCE(species_canonical, species, species_raw)), species_canonical, species, species_raw) = 'Equus ferus caballus' THEN 'Horse'
        WHEN COALESCE(public.normalize_species_label(COALESCE(species_canonical, species, species_raw)), species_canonical, species, species_raw) = 'Bos taurus' THEN 'Cow'
        ELSE COALESCE(species_display, species_canonical, species, species_raw)
    END,
    predicted_diagnosis = COALESCE(predicted_diagnosis, top_diagnosis);

WITH latest_case_inference AS (
    SELECT DISTINCT ON (aie.case_id)
        aie.case_id,
        aie.id AS inference_id,
        aie.model_version,
        aie.confidence_score,
        aie.input_signature,
        aie.output_payload,
        aie.created_at
    FROM public.ai_inference_events aie
    WHERE aie.case_id IS NOT NULL
    ORDER BY aie.case_id, aie.created_at DESC, aie.id DESC
)
UPDATE public.clinical_cases cc
SET
    latest_inference_event_id = COALESCE(cc.latest_inference_event_id, lci.inference_id),
    last_inference_at = COALESCE(cc.last_inference_at, lci.created_at),
    predicted_diagnosis = COALESCE(
        lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
        cc.predicted_diagnosis,
        cc.top_diagnosis
    ),
    top_diagnosis = COALESCE(
        cc.top_diagnosis,
        lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
        cc.predicted_diagnosis
    ),
    primary_condition_class = COALESCE(
        cc.primary_condition_class,
        lci.output_payload -> 'diagnosis' ->> 'primary_condition_class'
    ),
    diagnosis_confidence = COALESCE(
        cc.diagnosis_confidence,
        lci.confidence_score,
        (lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'probability')::double precision
    ),
    severity_score = COALESCE(
        cc.severity_score,
        (lci.output_payload -> 'risk_assessment' ->> 'severity_score')::double precision
    ),
    emergency_level = COALESCE(
        cc.emergency_level,
        lci.output_payload -> 'risk_assessment' ->> 'emergency_level'
    ),
    contradiction_score = COALESCE(
        cc.contradiction_score,
        (lci.output_payload ->> 'contradiction_score')::double precision
    ),
    contradiction_flags = CASE
        WHEN COALESCE(array_length(cc.contradiction_flags, 1), 0) > 0 THEN cc.contradiction_flags
        ELSE COALESCE(
            ARRAY(
                SELECT jsonb_array_elements_text(COALESCE(lci.output_payload -> 'contradiction_reasons', '[]'::jsonb))
            ),
            '{}'::text[]
        )
    END,
    uncertainty_notes = CASE
        WHEN COALESCE(array_length(cc.uncertainty_notes, 1), 0) > 0 THEN cc.uncertainty_notes
        ELSE COALESCE(
            ARRAY(
                SELECT jsonb_array_elements_text(COALESCE(lci.output_payload -> 'uncertainty_notes', '[]'::jsonb))
            ),
            '{}'::text[]
        )
    END,
    model_version = COALESCE(cc.model_version, lci.model_version),
    degraded_confidence = CASE
        WHEN COALESCE(cc.adversarial_case, false) = true OR cc.contradiction_score IS NOT NULL
            THEN COALESCE(cc.degraded_confidence, cc.diagnosis_confidence, lci.confidence_score)
        ELSE cc.degraded_confidence
    END,
    differential_spread = COALESCE(
        cc.differential_spread,
        CASE
            WHEN jsonb_typeof(lci.output_payload -> 'differential_spread') = 'object' THEN lci.output_payload -> 'differential_spread'
            ELSE NULL
        END
    )
FROM latest_case_inference lci
WHERE cc.id = lci.case_id;

WITH latest_case_outcome AS (
    SELECT DISTINCT ON (coe.case_id)
        coe.case_id,
        coe.id AS outcome_id,
        coe.label_type,
        coe.outcome_payload,
        coe.outcome_timestamp,
        coe.created_at
    FROM public.clinical_outcome_events coe
    WHERE coe.case_id IS NOT NULL
    ORDER BY coe.case_id, coe.outcome_timestamp DESC, coe.created_at DESC, coe.id DESC
)
UPDATE public.clinical_cases cc
SET
    latest_outcome_event_id = COALESCE(cc.latest_outcome_event_id, lco.outcome_id),
    confirmed_diagnosis = COALESCE(
        cc.confirmed_diagnosis,
        lco.outcome_payload ->> 'confirmed_diagnosis',
        lco.outcome_payload ->> 'final_diagnosis',
        lco.outcome_payload ->> 'diagnosis'
    ),
    label_type = COALESCE(
        NULLIF(lco.label_type, ''),
        NULLIF(lco.outcome_payload ->> 'label_type', ''),
        cc.label_type,
        'inferred_only'
    ),
    primary_condition_class = COALESCE(
        cc.primary_condition_class,
        lco.outcome_payload ->> 'primary_condition_class',
        lco.outcome_payload ->> 'condition_class'
    ),
    severity_score = COALESCE(
        cc.severity_score,
        (lco.outcome_payload ->> 'severity_score')::double precision
    ),
    emergency_level = COALESCE(
        cc.emergency_level,
        lco.outcome_payload ->> 'emergency_level'
    )
FROM latest_case_outcome lco
WHERE cc.id = lco.case_id;

WITH latest_case_simulation AS (
    SELECT DISTINCT ON (ese.case_id)
        ese.case_id,
        ese.id AS simulation_id,
        ese.simulation_type,
        ese.stress_metrics,
        ese.created_at
    FROM public.edge_simulation_events ese
    WHERE ese.case_id IS NOT NULL
    ORDER BY ese.case_id, ese.created_at DESC, ese.id DESC
)
UPDATE public.clinical_cases cc
SET
    latest_simulation_event_id = COALESCE(cc.latest_simulation_event_id, lcs.simulation_id),
    adversarial_case = true,
    adversarial_case_type = COALESCE(cc.adversarial_case_type, lcs.simulation_type),
    contradiction_score = COALESCE(
        cc.contradiction_score,
        (lcs.stress_metrics ->> 'contradiction_score')::double precision,
        (lcs.stress_metrics -> 'contradiction_analysis' ->> 'contradiction_score')::double precision,
        CASE WHEN lcs.simulation_id IS NOT NULL THEN 0.25 ELSE NULL END
    ),
    contradiction_flags = CASE
        WHEN COALESCE(array_length(cc.contradiction_flags, 1), 0) > 0 THEN cc.contradiction_flags
        ELSE COALESCE(
            ARRAY(
                SELECT jsonb_array_elements_text(
                    COALESCE(
                        lcs.stress_metrics -> 'contradiction_reasons',
                        lcs.stress_metrics -> 'contradiction_analysis' -> 'contradiction_reasons',
                        '[]'::jsonb
                    )
                )
            ),
            '{}'::text[]
        )
    END,
    degraded_confidence = COALESCE(cc.degraded_confidence, cc.diagnosis_confidence),
    differential_spread = COALESCE(
        cc.differential_spread,
        CASE
            WHEN jsonb_typeof(lcs.stress_metrics -> 'differential_spread') = 'object' THEN lcs.stress_metrics -> 'differential_spread'
            ELSE NULL
        END
    )
FROM latest_case_simulation lcs
WHERE cc.id = lcs.case_id;

UPDATE public.clinical_cases
SET
    predicted_diagnosis = COALESCE(predicted_diagnosis, top_diagnosis),
    triage_priority = CASE
        WHEN emergency_level = 'CRITICAL' THEN 'immediate'
        WHEN emergency_level = 'HIGH' THEN 'urgent'
        WHEN emergency_level = 'MODERATE' THEN 'standard'
        WHEN emergency_level = 'LOW' THEN 'low'
        WHEN severity_score >= 0.85 THEN 'immediate'
        WHEN severity_score >= 0.60 THEN 'urgent'
        WHEN severity_score >= 0.30 THEN 'standard'
        WHEN severity_score IS NOT NULL THEN 'low'
        ELSE triage_priority
    END,
    primary_condition_class = COALESCE(
        primary_condition_class,
        CASE
            WHEN COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%gdv%'
              OR COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%volvulus%'
              OR COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%obstruction%' THEN 'Mechanical'
            WHEN COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%parvo%'
              OR COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%distemper%'
              OR COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%infect%' THEN 'Infectious'
            WHEN COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%toxic%' THEN 'Toxicology'
            WHEN COALESCE(predicted_diagnosis, top_diagnosis, '') ILIKE '%undifferentiated%' THEN 'Undifferentiated'
            ELSE primary_condition_class
        END
    ),
    calibration_bucket = CASE
        WHEN COALESCE(degraded_confidence, diagnosis_confidence) IS NULL THEN calibration_bucket
        WHEN COALESCE(degraded_confidence, diagnosis_confidence) < 0.2 THEN '0-20'
        WHEN COALESCE(degraded_confidence, diagnosis_confidence) < 0.4 THEN '20-40'
        WHEN COALESCE(degraded_confidence, diagnosis_confidence) < 0.6 THEN '40-60'
        WHEN COALESCE(degraded_confidence, diagnosis_confidence) < 0.8 THEN '60-80'
        ELSE '80-100'
    END,
    prediction_correct = CASE
        WHEN confirmed_diagnosis IS NULL OR predicted_diagnosis IS NULL THEN prediction_correct
        ELSE lower(predicted_diagnosis) = lower(confirmed_diagnosis)
            OR lower(predicted_diagnosis) LIKE '%' || lower(confirmed_diagnosis) || '%'
            OR lower(confirmed_diagnosis) LIKE '%' || lower(predicted_diagnosis) || '%'
    END,
    confidence_error = CASE
        WHEN confirmed_diagnosis IS NULL OR predicted_diagnosis IS NULL OR COALESCE(degraded_confidence, diagnosis_confidence) IS NULL THEN confidence_error
        ELSE abs(
            (CASE
                WHEN lower(predicted_diagnosis) = lower(confirmed_diagnosis)
                    OR lower(predicted_diagnosis) LIKE '%' || lower(confirmed_diagnosis) || '%'
                    OR lower(confirmed_diagnosis) LIKE '%' || lower(predicted_diagnosis) || '%'
                THEN 1
                ELSE 0
            END) - COALESCE(degraded_confidence, diagnosis_confidence)
        )
    END,
    calibration_status = CASE
        WHEN predicted_diagnosis IS NULL THEN 'no_prediction_anchor'
        WHEN confirmed_diagnosis IS NULL THEN 'pending_outcome'
        WHEN lower(predicted_diagnosis) = lower(confirmed_diagnosis)
            OR lower(predicted_diagnosis) LIKE '%' || lower(confirmed_diagnosis) || '%'
            OR lower(confirmed_diagnosis) LIKE '%' || lower(predicted_diagnosis) || '%' THEN 'calibrated_match'
        ELSE 'calibrated_mismatch'
    END,
    degraded_confidence = CASE
        WHEN adversarial_case = true OR contradiction_score IS NOT NULL
            THEN COALESCE(degraded_confidence, diagnosis_confidence)
        ELSE degraded_confidence
    END,
    case_cluster = CASE
        WHEN adversarial_case = true AND COALESCE(primary_condition_class, '') ILIKE '%mechanical%' THEN 'Adversarial Mechanical'
        WHEN adversarial_case = true AND COALESCE(primary_condition_class, '') ILIKE '%infectious%' THEN 'Adversarial Infectious'
        WHEN COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%gastric dilatation%'
          OR COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%gdv%' THEN 'GDV'
        WHEN COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%parvo%' THEN 'Parvovirus'
        WHEN COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%distemper%' THEN 'Distemper'
        WHEN COALESCE(confirmed_diagnosis, predicted_diagnosis, top_diagnosis, '') ILIKE '%pancreatitis%' THEN 'Pancreatitis'
        WHEN COALESCE(primary_condition_class, '') ILIKE '%mechanical%' THEN 'Mechanical'
        WHEN COALESCE(primary_condition_class, '') ILIKE '%infectious%' THEN 'Infectious'
        ELSE COALESCE(case_cluster, 'Unknown / Mixed')
    END,
    telemetry_status = CASE
        WHEN invalid_case THEN ingestion_status
        WHEN predicted_diagnosis IS NOT NULL
             AND confirmed_diagnosis IS NOT NULL
             AND prediction_correct IS NOT NULL
             AND confidence_error IS NOT NULL THEN 'calibration_ready'
        WHEN (top_diagnosis IS NOT NULL OR primary_condition_class IS NOT NULL)
             AND (severity_score IS NOT NULL OR emergency_level IS NOT NULL)
             AND adversarial_case = true THEN 'benchmark_ready'
        WHEN (top_diagnosis IS NOT NULL OR primary_condition_class IS NOT NULL)
             AND (severity_score IS NOT NULL OR emergency_level IS NOT NULL) THEN 'learning_ready'
        WHEN top_diagnosis IS NOT NULL OR confirmed_diagnosis IS NOT NULL OR severity_score IS NOT NULL THEN 'partial'
        ELSE COALESCE(telemetry_status, 'pending')
    END;

CREATE INDEX IF NOT EXISTS idx_clinical_cases_calibration_status
    ON public.clinical_cases (tenant_id, calibration_status);

CREATE INDEX IF NOT EXISTS idx_clinical_cases_prediction_correct
    ON public.clinical_cases (tenant_id, prediction_correct);

DROP VIEW IF EXISTS public.clinical_case_live_view;

CREATE VIEW public.clinical_case_live_view AS
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
    cc.predicted_diagnosis,
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
    cc.calibration_status,
    cc.prediction_correct,
    cc.confidence_error,
    cc.calibration_bucket,
    cc.degraded_confidence,
    cc.differential_spread,
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
