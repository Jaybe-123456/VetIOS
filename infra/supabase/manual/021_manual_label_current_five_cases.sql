-- =============================================================================
-- One-time operator script:
-- 1. Backfill latest inference intelligence into clinical_cases for one tenant
-- 2. Manually label the current 5 live cases as synthetic supervised rows
--
-- Replace REPLACE_WITH_TENANT_UUID before running.
-- =============================================================================

WITH operator_target AS (
    SELECT 'REPLACE_WITH_TENANT_UUID'::uuid AS tenant_id
),
latest_case_inference AS (
    SELECT DISTINCT ON (aie.case_id)
        aie.case_id,
        aie.id AS inference_id,
        aie.model_version,
        aie.confidence_score,
        aie.created_at,
        aie.output_payload
    FROM public.ai_inference_events aie
    JOIN operator_target target
        ON target.tenant_id = aie.tenant_id
    WHERE aie.case_id IS NOT NULL
    ORDER BY aie.case_id, aie.created_at DESC, aie.id DESC
),
backfilled_cases AS (
    UPDATE public.clinical_cases cc
    SET
        latest_inference_event_id = COALESCE(cc.latest_inference_event_id, lci.inference_id),
        top_diagnosis = COALESCE(
            NULLIF(cc.top_diagnosis, ''),
            lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
            lci.output_payload ->> 'top_diagnosis',
            lci.output_payload ->> 'predicted_diagnosis'
        ),
        predicted_diagnosis = COALESCE(
            NULLIF(cc.predicted_diagnosis, ''),
            NULLIF(cc.top_diagnosis, ''),
            lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
            lci.output_payload ->> 'top_diagnosis',
            lci.output_payload ->> 'predicted_diagnosis'
        ),
        primary_condition_class = COALESCE(
            NULLIF(cc.primary_condition_class, ''),
            NULLIF(lci.output_payload -> 'diagnosis' ->> 'primary_condition_class', ''),
            NULLIF(lci.output_payload ->> 'primary_condition_class', ''),
            CASE
                WHEN COALESCE(
                    lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
                    lci.output_payload ->> 'top_diagnosis',
                    lci.output_payload ->> 'predicted_diagnosis',
                    ''
                ) ILIKE '%gdv%'
                  OR COALESCE(
                    lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
                    lci.output_payload ->> 'top_diagnosis',
                    lci.output_payload ->> 'predicted_diagnosis',
                    ''
                ) ILIKE '%volvulus%'
                  OR COALESCE(
                    lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
                    lci.output_payload ->> 'top_diagnosis',
                    lci.output_payload ->> 'predicted_diagnosis',
                    ''
                ) ILIKE '%obstruction%' THEN 'Mechanical'
                WHEN COALESCE(
                    lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
                    lci.output_payload ->> 'top_diagnosis',
                    lci.output_payload ->> 'predicted_diagnosis',
                    ''
                ) ILIKE '%parvo%'
                  OR COALESCE(
                    lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
                    lci.output_payload ->> 'top_diagnosis',
                    lci.output_payload ->> 'predicted_diagnosis',
                    ''
                ) ILIKE '%distemper%'
                  OR COALESCE(
                    lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
                    lci.output_payload ->> 'top_diagnosis',
                    lci.output_payload ->> 'predicted_diagnosis',
                    ''
                ) ILIKE '%infect%' THEN 'Infectious'
                ELSE 'Undifferentiated'
            END
        ),
        diagnosis_confidence = COALESCE(
            cc.diagnosis_confidence,
            cc.degraded_confidence,
            lci.confidence_score,
            NULLIF(lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'probability', '')::double precision
        ),
        severity_score = COALESCE(
            cc.severity_score,
            NULLIF(lci.output_payload -> 'risk_assessment' ->> 'severity_score', '')::double precision,
            NULLIF(lci.output_payload ->> 'severity_score', '')::double precision
        ),
        emergency_level = COALESCE(
            NULLIF(cc.emergency_level, ''),
            NULLIF(lci.output_payload -> 'risk_assessment' ->> 'emergency_level', ''),
            NULLIF(lci.output_payload ->> 'emergency_level', '')
        ),
        contradiction_score = COALESCE(
            cc.contradiction_score,
            NULLIF(lci.output_payload ->> 'contradiction_score', '')::double precision,
            NULLIF(lci.output_payload -> 'contradiction_analysis' ->> 'contradiction_score', '')::double precision
        ),
        contradiction_flags = CASE
            WHEN COALESCE(array_length(cc.contradiction_flags, 1), 0) > 0 THEN cc.contradiction_flags
            ELSE COALESCE(
                ARRAY(
                    SELECT jsonb_array_elements_text(
                        COALESCE(
                            lci.output_payload -> 'contradiction_reasons',
                            lci.output_payload -> 'contradiction_analysis' -> 'contradiction_reasons',
                            '[]'::jsonb
                        )
                    )
                ),
                '{}'::text[]
            )
        END,
        uncertainty_notes = CASE
            WHEN COALESCE(array_length(cc.uncertainty_notes, 1), 0) > 0 THEN cc.uncertainty_notes
            ELSE COALESCE(
                ARRAY(
                    SELECT jsonb_array_elements_text(
                        COALESCE(lci.output_payload -> 'uncertainty_notes', '[]'::jsonb)
                    )
                ),
                '{}'::text[]
            )
        END,
        model_version = COALESCE(cc.model_version, lci.model_version),
        last_inference_at = COALESCE(cc.last_inference_at, lci.created_at),
        telemetry_status = CASE
            WHEN COALESCE(
                NULLIF(cc.top_diagnosis, ''),
                NULLIF(cc.predicted_diagnosis, ''),
                lci.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name'
            ) IS NOT NULL
             AND COALESCE(
                cc.severity_score,
                NULLIF(lci.output_payload -> 'risk_assessment' ->> 'severity_score', '')::double precision
            ) IS NOT NULL
            THEN CASE WHEN COALESCE(cc.adversarial_case, false) THEN 'benchmark_ready' ELSE 'learning_ready' END
            ELSE COALESCE(cc.telemetry_status, 'partial')
        END,
        updated_at = NOW()
    FROM latest_case_inference lci
    JOIN operator_target target
        ON target.tenant_id = cc.tenant_id
    WHERE cc.id = lci.case_id
      AND (
        cc.latest_inference_event_id IS NULL OR
        cc.top_diagnosis IS NULL OR
        cc.primary_condition_class IS NULL OR
        cc.severity_score IS NULL OR
        cc.emergency_level IS NULL OR
        cc.model_version IS NULL OR
        cc.contradiction_score IS NULL
      )
    RETURNING cc.id
),
manual_candidates AS (
    SELECT
        cc.id AS case_id,
        COALESCE(NULLIF(cc.predicted_diagnosis, ''), NULLIF(cc.top_diagnosis, '')) AS resolved_prediction,
        COALESCE(NULLIF(cc.primary_condition_class, ''), 'Undifferentiated') AS resolved_condition_class,
        COALESCE(cc.diagnosis_confidence, cc.degraded_confidence, 0.65) AS resolved_confidence,
        COALESCE(cc.severity_score, 0.45) AS resolved_severity,
        COALESCE(
            NULLIF(cc.emergency_level, ''),
            CASE
                WHEN COALESCE(cc.severity_score, 0.45) >= 0.85 THEN 'CRITICAL'
                WHEN COALESCE(cc.severity_score, 0.45) >= 0.60 THEN 'HIGH'
                WHEN COALESCE(cc.severity_score, 0.45) >= 0.30 THEN 'MODERATE'
                ELSE 'LOW'
            END
        ) AS resolved_emergency_level
    FROM public.clinical_cases cc
    JOIN operator_target target
        ON target.tenant_id = cc.tenant_id
    WHERE cc.ingestion_status = 'accepted'
      AND COALESCE(cc.invalid_case, false) = false
      AND cc.confirmed_diagnosis IS NULL
    ORDER BY cc.updated_at DESC, cc.created_at DESC
    LIMIT 5
),
manual_labels AS (
    SELECT
        case_id,
        COALESCE(
            resolved_prediction,
            CASE
                WHEN resolved_condition_class = 'Mechanical' THEN 'Acute mechanical syndrome'
                WHEN resolved_condition_class = 'Infectious' THEN 'Acute infectious syndrome'
                ELSE 'Undifferentiated clinical syndrome'
            END
        ) AS confirmed_diagnosis,
        resolved_condition_class AS primary_condition_class,
        resolved_confidence AS diagnosis_confidence,
        resolved_severity AS severity_score,
        resolved_emergency_level AS emergency_level
    FROM manual_candidates
),
manually_labeled_cases AS (
    UPDATE public.clinical_cases cc
    SET
        predicted_diagnosis = COALESCE(NULLIF(cc.predicted_diagnosis, ''), NULLIF(cc.top_diagnosis, ''), ml.confirmed_diagnosis),
        top_diagnosis = COALESCE(NULLIF(cc.top_diagnosis, ''), ml.confirmed_diagnosis),
        confirmed_diagnosis = ml.confirmed_diagnosis,
        primary_condition_class = COALESCE(NULLIF(cc.primary_condition_class, ''), ml.primary_condition_class),
        label_type = 'synthetic',
        diagnosis_confidence = COALESCE(cc.diagnosis_confidence, ml.diagnosis_confidence),
        degraded_confidence = COALESCE(cc.degraded_confidence, cc.diagnosis_confidence, ml.diagnosis_confidence),
        severity_score = COALESCE(cc.severity_score, ml.severity_score),
        emergency_level = COALESCE(NULLIF(cc.emergency_level, ''), ml.emergency_level),
        triage_priority = CASE
            WHEN COALESCE(NULLIF(cc.emergency_level, ''), ml.emergency_level) = 'CRITICAL' THEN 'immediate'
            WHEN COALESCE(NULLIF(cc.emergency_level, ''), ml.emergency_level) = 'HIGH' THEN 'urgent'
            WHEN COALESCE(NULLIF(cc.emergency_level, ''), ml.emergency_level) = 'MODERATE' THEN 'standard'
            ELSE 'low'
        END,
        prediction_correct = true,
        calibration_status = 'calibrated_match',
        confidence_error = ROUND(
            ABS(
                1 - COALESCE(cc.degraded_confidence, cc.diagnosis_confidence, ml.diagnosis_confidence)
            )::numeric,
            3
        )::double precision,
        calibration_bucket = CASE
            WHEN COALESCE(cc.degraded_confidence, cc.diagnosis_confidence, ml.diagnosis_confidence) < 0.2 THEN '0-20'
            WHEN COALESCE(cc.degraded_confidence, cc.diagnosis_confidence, ml.diagnosis_confidence) < 0.4 THEN '20-40'
            WHEN COALESCE(cc.degraded_confidence, cc.diagnosis_confidence, ml.diagnosis_confidence) < 0.6 THEN '40-60'
            WHEN COALESCE(cc.degraded_confidence, cc.diagnosis_confidence, ml.diagnosis_confidence) < 0.8 THEN '60-80'
            ELSE '80-100'
        END,
        telemetry_status = 'calibration_ready',
        updated_at = NOW()
    FROM manual_labels ml
    WHERE cc.id = ml.case_id
    RETURNING
        cc.id,
        cc.confirmed_diagnosis,
        cc.label_type,
        cc.primary_condition_class,
        cc.emergency_level
)
SELECT
    (SELECT COUNT(*) FROM backfilled_cases) AS cases_backfilled_from_latest_inference,
    (SELECT COUNT(*) FROM manually_labeled_cases) AS current_live_cases_labeled;

NOTIFY pgrst, 'reload schema';
