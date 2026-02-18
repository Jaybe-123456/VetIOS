-- ============================================================================
-- 010 — Data Generation Events
-- 
-- Tracks every unique data event the system produces.
-- This is the raw material of the VetIOS data moat — longitudinal records,
-- AI-diagnostic outcomes, failure maps, multi-clinic embeddings, and
-- real-world intervention logs.
--
-- Every day the system runs, this table grows with data that competitors
-- cannot replicate without equivalent time + clinics + AI-in-the-loop.
-- ============================================================================

-- ─── Enum: Data Event Categories ─────────────────────────────────────────────

CREATE TYPE data_event_category AS ENUM (
    'longitudinal_record',        -- Multi-year animal health trajectories
    'ai_diagnostic_outcome',      -- Correlated AI-human diagnostic decisions
    'failure_mapping',            -- Adversarial / edge-case failure records
    'multi_clinic_embedding',     -- Cross-clinic aggregated patterns
    'intervention_log'            -- Real-world structured intervention data
);

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE data_generation_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),

    -- Classification
    event_category  data_event_category NOT NULL,

    -- Provenance: what produced this data
    source_encounter_id UUID REFERENCES encounters(id),
    source_decision_id  UUID REFERENCES ai_decision_logs(id),

    -- Uniqueness proof
    data_fingerprint    TEXT NOT NULL,
    data_payload        JSONB NOT NULL DEFAULT '{}',

    -- Moat measurement
    compounding_score   DOUBLE PRECISION NOT NULL DEFAULT 0.0,

    -- Metadata
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_dge_tenant          ON data_generation_events(tenant_id);
CREATE INDEX idx_dge_category        ON data_generation_events(event_category);
CREATE INDEX idx_dge_encounter       ON data_generation_events(source_encounter_id) WHERE source_encounter_id IS NOT NULL;
CREATE INDEX idx_dge_decision        ON data_generation_events(source_decision_id) WHERE source_decision_id IS NOT NULL;
CREATE UNIQUE INDEX idx_dge_fingerprint ON data_generation_events(tenant_id, data_fingerprint);
CREATE INDEX idx_dge_created         ON data_generation_events(created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE data_generation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON data_generation_events
    USING (tenant_id::text = current_setting('app.tenant_id', true));
