-- ============================================================================
-- 015 — Model Evaluation Events
--
-- The evaluation moat. Every inference, outcome, and simulation generates
-- a structured evaluation event that measures intelligence quality.
--
-- This is what separates VetIOS from commodity AI:
--   - Calibration error: |predicted confidence - actual correctness|
--   - Drift score: model degradation over time
--   - Outcome alignment delta: predicted vs actual diagnosis distance
--   - Simulation degradation: adversarial resilience decay
--
-- V1 Tenant Model: tenant_id = auth.uid()
-- ============================================================================

CREATE TABLE public.model_evaluation_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               TEXT NOT NULL,

    -- Source linkage
    inference_event_id      UUID REFERENCES public.ai_inference_events(id),
    outcome_event_id        UUID REFERENCES public.clinical_outcome_events(id),

    -- Evaluation trigger
    trigger_type            TEXT NOT NULL CHECK (trigger_type IN (
        'inference',          -- Baseline eval after inference
        'outcome',            -- Alignment eval after outcome attachment
        'simulation'          -- Degradation eval after simulation
    )),

    -- Core evaluation metrics
    calibration_error       DOUBLE PRECISION,   -- |predicted_confidence - actual_correctness|
    drift_score             DOUBLE PRECISION,   -- Model degradation signal (0 = stable, 1 = drifted)
    outcome_alignment_delta DOUBLE PRECISION,   -- Predicted vs actual diagnosis distance
    simulation_degradation  DOUBLE PRECISION,   -- Adversarial resilience decay

    -- Confidence stratification (frontier-level)
    calibrated_confidence   DOUBLE PRECISION,   -- Adjusted confidence after calibration
    epistemic_uncertainty   DOUBLE PRECISION,   -- Uncertainty from lack of knowledge
    aleatoric_uncertainty   DOUBLE PRECISION,   -- Uncertainty from inherent noise

    -- Model identity
    model_name              TEXT NOT NULL,
    model_version           TEXT NOT NULL,

    -- Raw evaluation payload (extensible)
    evaluation_payload      JSONB NOT NULL DEFAULT '{}',

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_mee_tenant         ON public.model_evaluation_events(tenant_id);
CREATE INDEX idx_mee_trigger        ON public.model_evaluation_events(trigger_type);
CREATE INDEX idx_mee_inference      ON public.model_evaluation_events(inference_event_id)
    WHERE inference_event_id IS NOT NULL;
CREATE INDEX idx_mee_outcome        ON public.model_evaluation_events(outcome_event_id)
    WHERE outcome_event_id IS NOT NULL;
CREATE INDEX idx_mee_model          ON public.model_evaluation_events(model_name, model_version);
CREATE INDEX idx_mee_created        ON public.model_evaluation_events(created_at DESC);
CREATE INDEX idx_mee_drift          ON public.model_evaluation_events(drift_score)
    WHERE drift_score IS NOT NULL;
CREATE INDEX idx_mee_calibration    ON public.model_evaluation_events(calibration_error)
    WHERE calibration_error IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.model_evaluation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_insert_eval ON public.model_evaluation_events
    FOR INSERT WITH CHECK (tenant_id = auth.uid()::text);

CREATE POLICY tenant_select_eval ON public.model_evaluation_events
    FOR SELECT USING (tenant_id = auth.uid()::text);

-- No UPDATE or DELETE policies: evaluation events are append-only.
