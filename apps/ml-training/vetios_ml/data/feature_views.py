"""
SQL feature views for extracting training data from Supabase.

These queries join across the VetIOS event tables to build feature matrices
with strict temporal alignment (no future data leakage).
"""

# ─────────────────────────────────────────────────────────────────────────────
# View 1: Inference + Outcome alignment dataset
# Joins ai_inference_events with clinical_outcome_events to create
# supervised (prediction, ground_truth) pairs.
# ─────────────────────────────────────────────────────────────────────────────
INFERENCE_OUTCOME_VIEW = """
SELECT
    ie.id                   AS inference_id,
    ie.tenant_id,
    ie.model_name,
    ie.model_version,
    ie.input_signature,
    ie.output_payload       AS predicted_output,
    ie.confidence_score     AS predicted_confidence,
    ie.uncertainty_metrics,
    ie.inference_latency_ms,
    ie.created_at           AS inference_ts,

    oe.id                   AS outcome_id,
    oe.outcome_type,
    oe.outcome_payload      AS actual_outcome,
    oe.outcome_timestamp    AS outcome_ts,

    -- Temporal gap between prediction and outcome (in hours)
    EXTRACT(EPOCH FROM (oe.outcome_timestamp - ie.created_at)) / 3600.0
        AS hours_to_outcome

FROM public.ai_inference_events ie
INNER JOIN public.clinical_outcome_events oe
    ON oe.inference_event_id = ie.id

-- Temporal safety: only outcomes that happened AFTER the inference
WHERE oe.outcome_timestamp > ie.created_at

ORDER BY ie.created_at ASC
"""

# ─────────────────────────────────────────────────────────────────────────────
# View 2: Encounter risk features
# Joins encounters with patients, outcomes, and decisions to build
# a feature set for risk scoring and triage ranking.
# ─────────────────────────────────────────────────────────────────────────────
ENCOUNTER_RISK_VIEW = """
SELECT
    e.id                    AS encounter_id,
    e.tenant_id,
    e.status                AS encounter_status,
    e.chief_complaint,
    e.started_at,
    e.ended_at,

    p.species,
    p.breed,

    -- Outcome label: 1 if any adverse outcome recorded, 0 otherwise
    CASE
        WHEN EXISTS (
            SELECT 1 FROM public.outcomes o
            WHERE o.encounter_id = e.id
              AND o.outcome_type IN ('adverse', 'complication', 'readmission')
        ) THEN 1
        ELSE 0
    END AS adverse_outcome_label,

    -- Decision count per encounter
    (SELECT COUNT(*) FROM public.ai_decision_logs d
     WHERE d.encounter_id = e.id) AS decision_count,

    -- Override count (clinician corrections)
    (SELECT COUNT(*) FROM public.overrides ov
     JOIN public.ai_decision_logs d2 ON ov.decision_id = d2.id
     WHERE d2.encounter_id = e.id) AS override_count

FROM public.encounters e
LEFT JOIN public.patients p ON p.id = e.patient_id

WHERE e.status = 'discharged'   -- Only completed encounters
ORDER BY e.started_at ASC
"""

# ─────────────────────────────────────────────────────────────────────────────
# View 3: Model evaluation metrics (for drift detection)
# ─────────────────────────────────────────────────────────────────────────────
MODEL_EVAL_METRICS_VIEW = """
SELECT
    model_name,
    model_version,
    trigger_type,
    calibration_error,
    drift_score,
    outcome_alignment_delta,
    simulation_degradation,
    calibrated_confidence,
    epistemic_uncertainty,
    aleatoric_uncertainty,
    created_at

FROM public.model_evaluation_events

ORDER BY created_at DESC
LIMIT 1000
"""
