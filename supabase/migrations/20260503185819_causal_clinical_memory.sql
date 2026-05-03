CREATE TABLE IF NOT EXISTS causal_dag_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key        TEXT NOT NULL UNIQUE,
  node_type       TEXT NOT NULL,
  label           TEXT NOT NULL,
  species_scope   TEXT[],
  observation_count INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS causal_dag_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_key   TEXT NOT NULL REFERENCES causal_dag_nodes(node_key) ON DELETE CASCADE,
  to_node_key     TEXT NOT NULL REFERENCES causal_dag_nodes(node_key) ON DELETE CASCADE,
  edge_type       TEXT NOT NULL DEFAULT 'causes',
  ate             FLOAT,
  ate_lower       FLOAT,
  ate_upper       FLOAT,
  support_count   INTEGER NOT NULL DEFAULT 0,
  confidence      FLOAT NOT NULL DEFAULT 0.0,
  species_scope   TEXT[],
  last_computed   TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (from_node_key, to_node_key, edge_type)
);

CREATE TABLE IF NOT EXISTS causal_observations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  inference_event_id    UUID REFERENCES ai_inference_events(id) ON DELETE SET NULL,
  treatment_event_id    UUID,
  rlhf_feedback_id      TEXT,
  species               TEXT NOT NULL,
  breed                 TEXT,
  age_years             FLOAT,
  weight_kg             FLOAT,
  treatment_applied     TEXT NOT NULL,
  clinician_override    BOOLEAN DEFAULT FALSE,
  predicted_diagnosis   TEXT,
  confirmed_diagnosis   TEXT NOT NULL,
  outcome_status        TEXT NOT NULL,
  recovery_time_days    FLOAT,
  had_complications     BOOLEAN DEFAULT FALSE,
  outcome_horizon       TEXT NOT NULL,
  observed_at           TIMESTAMPTZ NOT NULL,
  symptom_vector        TEXT[],
  biomarker_snapshot    JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS counterfactual_records (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  inference_event_id      UUID REFERENCES ai_inference_events(id) ON DELETE SET NULL,
  species                 TEXT NOT NULL,
  breed                   TEXT,
  age_years               FLOAT,
  confirmed_diagnosis     TEXT NOT NULL,
  treatment_actual        TEXT NOT NULL,
  treatment_counterfactual TEXT NOT NULL,
  estimated_outcome       TEXT NOT NULL,
  estimated_recovery_days FLOAT,
  confidence              FLOAT NOT NULL,
  supporting_case_count   INTEGER NOT NULL DEFAULT 0,
  causal_path             JSONB,
  computed_at             TIMESTAMPTZ DEFAULT NOW(),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS living_case_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  patient_id          TEXT NOT NULL,
  species             TEXT NOT NULL,
  breed               TEXT,
  active_diagnoses    TEXT[],
  last_symptoms       TEXT[],
  last_biomarkers     JSONB,
  last_treatment      TEXT,
  last_outcome        TEXT,
  deterioration_risk  FLOAT,
  causal_risk_factors JSONB,
  similar_patient_ids TEXT[],
  first_seen_at       TIMESTAMPTZ NOT NULL,
  last_updated_at     TIMESTAMPTZ NOT NULL,
  inference_count     INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, patient_id)
);

CREATE INDEX IF NOT EXISTS causal_obs_species_diagnosis_idx ON causal_observations(species, confirmed_diagnosis);
CREATE INDEX IF NOT EXISTS causal_obs_treatment_idx ON causal_observations(treatment_applied, outcome_status);
CREATE INDEX IF NOT EXISTS causal_obs_inference_event_idx ON causal_observations(inference_event_id);
CREATE INDEX IF NOT EXISTS causal_dag_edges_from_idx ON causal_dag_edges(from_node_key);
CREATE INDEX IF NOT EXISTS causal_dag_edges_to_idx ON causal_dag_edges(to_node_key);
CREATE INDEX IF NOT EXISTS counterfactual_diagnosis_idx ON counterfactual_records(confirmed_diagnosis, treatment_actual);
CREATE INDEX IF NOT EXISTS living_case_tenant_patient_idx ON living_case_nodes(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS living_case_species_idx ON living_case_nodes(species, active_diagnoses);

ALTER TABLE causal_dag_nodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE causal_dag_edges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE causal_observations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterfactual_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE living_case_nodes     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_causal_dag_nodes"      ON causal_dag_nodes      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_causal_dag_edges"      ON causal_dag_edges      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_causal_observations"   ON causal_observations   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_counterfactual_records" ON counterfactual_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_living_case_nodes"     ON living_case_nodes     FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE causal_dag_nodes      IS 'Tier 1 — variables in the clinical causal graph';
COMMENT ON TABLE causal_dag_edges      IS 'Tier 1 — directed causal relationships with ATE estimates';
COMMENT ON TABLE causal_observations   IS 'Tier 1 — confirmed cases feeding the causal estimator';
COMMENT ON TABLE counterfactual_records IS 'Tier 1 — what-if treatment comparisons';
COMMENT ON TABLE living_case_nodes     IS 'Tier 1 — persistent live patient nodes that never close';
