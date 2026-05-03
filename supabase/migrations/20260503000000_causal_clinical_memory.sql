-- Tier 1: Causal Clinical Memory
--
-- Connects existing VetIOS moat tables into a causal memory layer:
--   rlhf_feedback_events -> causal_observations
--   treatment_events -> treatment_outcomes -> causal_observations
--   ai_inference_events -> counterfactual_records
--   patient_longitudinal_records -> living_case_nodes
--
-- Assumptions matched to the current repo schema:
--   * tenant_id is stored as text here because RLHF and longitudinal tables use text.
--   * inference_event_id is nullable uuid for direct joins to public.ai_inference_events.
--   * treatment_event_id is nullable uuid for direct joins to public.treatment_events.
--   * treatment_events.selected_treatment is JSONB, so causal_observations stores both a
--     stable text label and the raw treatment snapshot.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.causal_dag_nodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    node_key text NOT NULL UNIQUE,
    node_type text NOT NULL CHECK (
        node_type IN ('diagnosis', 'treatment', 'outcome', 'species', 'breed', 'biomarker', 'symptom', 'risk_factor')
    ),
    label text NOT NULL,
    species_scope text[],
    observation_count integer NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.causal_dag_edges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_node_key text NOT NULL REFERENCES public.causal_dag_nodes(node_key) ON DELETE CASCADE,
    to_node_key text NOT NULL REFERENCES public.causal_dag_nodes(node_key) ON DELETE CASCADE,
    edge_type text NOT NULL DEFAULT 'causes' CHECK (
        edge_type IN ('causes', 'prevents', 'modifies', 'confounds', 'mediates')
    ),
    ate double precision,
    ate_lower double precision,
    ate_upper double precision,
    support_count integer NOT NULL DEFAULT 0,
    treated_count integer NOT NULL DEFAULT 0,
    control_count integer NOT NULL DEFAULT 0,
    confidence double precision NOT NULL DEFAULT 0.0,
    species_scope text[],
    adjustment_set jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_computed timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (from_node_key, to_node_key, edge_type)
);

CREATE TABLE IF NOT EXISTS public.causal_observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    inference_event_id uuid REFERENCES public.ai_inference_events(id) ON DELETE SET NULL,
    treatment_event_id uuid REFERENCES public.treatment_events(id) ON DELETE SET NULL,
    treatment_outcome_id uuid REFERENCES public.treatment_outcomes(id) ON DELETE SET NULL,
    rlhf_feedback_id text,
    patient_id text,
    species text NOT NULL,
    breed text,
    age_years double precision,
    weight_kg double precision,
    treatment_applied text NOT NULL,
    treatment_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    clinician_override boolean NOT NULL DEFAULT false,
    clinician_validation_status text,
    predicted_diagnosis text,
    confirmed_diagnosis text NOT NULL,
    outcome_status text NOT NULL,
    recovery_time_days double precision,
    had_complications boolean NOT NULL DEFAULT false,
    complications text[] NOT NULL DEFAULT ARRAY[]::text[],
    outcome_horizon text NOT NULL CHECK (outcome_horizon IN ('48h', '7d', '30d', 'final', 'unknown')),
    observed_at timestamptz NOT NULL,
    symptom_vector text[] NOT NULL DEFAULT ARRAY[]::text[],
    biomarker_snapshot jsonb,
    feature_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.counterfactual_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    inference_event_id uuid REFERENCES public.ai_inference_events(id) ON DELETE SET NULL,
    species text NOT NULL,
    breed text,
    age_years double precision,
    confirmed_diagnosis text NOT NULL,
    treatment_actual text NOT NULL,
    outcome_actual text,
    treatment_counterfactual text NOT NULL,
    estimated_outcome text NOT NULL,
    estimated_recovery_days double precision,
    estimated_outcome_score double precision,
    confidence double precision NOT NULL DEFAULT 0.0,
    supporting_case_count integer NOT NULL DEFAULT 0,
    causal_path jsonb NOT NULL DEFAULT '[]'::jsonb,
    adjustment_set jsonb NOT NULL DEFAULT '{}'::jsonb,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.living_case_nodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    patient_id text NOT NULL,
    latest_inference_event_id uuid REFERENCES public.ai_inference_events(id) ON DELETE SET NULL,
    species text NOT NULL,
    breed text,
    active_diagnoses text[] NOT NULL DEFAULT ARRAY[]::text[],
    last_symptoms text[] NOT NULL DEFAULT ARRAY[]::text[],
    last_biomarkers jsonb,
    last_treatment text,
    last_outcome text,
    deterioration_risk double precision,
    causal_risk_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
    similar_patient_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_updated_at timestamptz NOT NULL DEFAULT now(),
    inference_count integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_causal_obs_species_diagnosis
    ON public.causal_observations (species, confirmed_diagnosis);

CREATE INDEX IF NOT EXISTS idx_causal_obs_treatment_outcome
    ON public.causal_observations (treatment_applied, outcome_status);

CREATE INDEX IF NOT EXISTS idx_causal_obs_tenant_created
    ON public.causal_observations (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_causal_obs_inference_event
    ON public.causal_observations (inference_event_id)
    WHERE inference_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_causal_obs_treatment_event
    ON public.causal_observations (treatment_event_id)
    WHERE treatment_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_causal_dag_edges_from
    ON public.causal_dag_edges (from_node_key);

CREATE INDEX IF NOT EXISTS idx_causal_dag_edges_to
    ON public.causal_dag_edges (to_node_key);

CREATE INDEX IF NOT EXISTS idx_causal_dag_edges_confidence
    ON public.causal_dag_edges (confidence DESC, support_count DESC);

CREATE INDEX IF NOT EXISTS idx_counterfactual_diagnosis
    ON public.counterfactual_records (confirmed_diagnosis, treatment_actual, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_counterfactual_tenant_created
    ON public.counterfactual_records (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_living_case_tenant_patient
    ON public.living_case_nodes (tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_living_case_species_diagnosis
    ON public.living_case_nodes USING gin (active_diagnoses);

ALTER TABLE public.causal_dag_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.causal_dag_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.causal_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterfactual_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.living_case_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_causal_dag_nodes"
    ON public.causal_dag_nodes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_causal_dag_edges"
    ON public.causal_dag_edges FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "tenant_causal_observations"
    ON public.causal_observations FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true) OR auth.role() = 'service_role')
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR auth.role() = 'service_role');

CREATE POLICY "tenant_counterfactual_records"
    ON public.counterfactual_records FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true) OR auth.role() = 'service_role')
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR auth.role() = 'service_role');

CREATE POLICY "tenant_living_case_nodes"
    ON public.living_case_nodes FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true) OR auth.role() = 'service_role')
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.touch_causal_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS causal_dag_nodes_touch_updated_at ON public.causal_dag_nodes;
CREATE TRIGGER causal_dag_nodes_touch_updated_at
    BEFORE UPDATE ON public.causal_dag_nodes
    FOR EACH ROW EXECUTE FUNCTION public.touch_causal_updated_at();

DROP TRIGGER IF EXISTS causal_dag_edges_touch_updated_at ON public.causal_dag_edges;
CREATE TRIGGER causal_dag_edges_touch_updated_at
    BEFORE UPDATE ON public.causal_dag_edges
    FOR EACH ROW EXECUTE FUNCTION public.touch_causal_updated_at();

CREATE OR REPLACE FUNCTION public.increment_causal_node_count(p_node_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.causal_dag_nodes
    SET observation_count = observation_count + 1,
        updated_at = now()
    WHERE node_key = p_node_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_living_node_inference_count(
    p_tenant_id text,
    p_patient_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.living_case_nodes
    SET inference_count = inference_count + 1,
        last_updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND patient_id = p_patient_id;
END;
$$;

COMMENT ON TABLE public.causal_dag_nodes IS 'Tier 1 Causal Clinical Memory: variables in the clinical causal graph.';
COMMENT ON TABLE public.causal_dag_edges IS 'Tier 1 Causal Clinical Memory: directed causal relationships with observational effect estimates.';
COMMENT ON TABLE public.causal_observations IS 'Tier 1 Causal Clinical Memory: confirmed patient observations feeding causal estimation.';
COMMENT ON TABLE public.counterfactual_records IS 'Tier 1 Causal Clinical Memory: persisted treatment counterfactual estimates.';
COMMENT ON TABLE public.living_case_nodes IS 'Tier 1 Causal Clinical Memory: persistent live patient nodes updated across inference and feedback.';
