-- ============================================================================
-- 013 — Edge Simulations
--
-- Records adversarial / edge-case simulations for safety-critical AI.
-- The Edge Simulator generates clinical scenarios designed to probe
-- model boundaries, then records outcomes for the safety database.
--
-- This is the research platform substrate — controlled experiments
-- for agents, models, and workflows.
-- ============================================================================

-- ─── Enum: Simulation Types ──────────────────────────────────────────────────

CREATE TYPE simulation_type AS ENUM (
    'adversarial_scenario',    -- Designed to break the model
    'boundary_probe',          -- Tests decision boundaries
    'intervention_test',       -- Simulates clinical interventions
    'model_stress_test'        -- High-load / degenerate input testing
);

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE edge_simulations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),

    -- Classification
    simulation_type     simulation_type NOT NULL,

    -- Simulation definition
    scenario_config     JSONB NOT NULL,          -- Input parameters for the simulation
    scenario_name       TEXT NOT NULL,            -- Human-readable name

    -- Results
    expected_outcome    JSONB NOT NULL,           -- What the system should produce
    actual_outcome      JSONB,                    -- What it actually produced (null if not yet run)
    failure_mode        TEXT,                     -- Classified failure type (null if passed)

    -- Scores
    safety_score        DOUBLE PRECISION,         -- 0–1 safety confidence
    model_version       TEXT,                     -- Which model was tested

    -- Pipeline linkage (full integration test)
    pipeline_trace_id   TEXT,                     -- Links to the pipeline execution trace
    pipeline_decision_id UUID REFERENCES ai_decision_logs(id),

    -- Lifecycle
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'passed', 'failed', 'error')),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_es_tenant        ON edge_simulations(tenant_id);
CREATE INDEX idx_es_type          ON edge_simulations(simulation_type);
CREATE INDEX idx_es_status        ON edge_simulations(status);
CREATE INDEX idx_es_safety        ON edge_simulations(safety_score) WHERE safety_score IS NOT NULL;
CREATE INDEX idx_es_failure       ON edge_simulations(failure_mode) WHERE failure_mode IS NOT NULL;
CREATE INDEX idx_es_trace         ON edge_simulations(pipeline_trace_id) WHERE pipeline_trace_id IS NOT NULL;
CREATE INDEX idx_es_created       ON edge_simulations(created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE edge_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON edge_simulations
    USING (tenant_id::text = current_setting('app.tenant_id', true));
