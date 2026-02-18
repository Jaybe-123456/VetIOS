-- ============================================================================
-- 011 — Workflow Snapshots
--
-- Captures the cognitive substrate of clinical operations.
-- Each snapshot encodes HOW decisions flow through a clinic —
-- the state graphs, actor sequences, and decision points that
-- become the workflow lock-in.
--
-- Competitors must retrain humans, retrain AI, AND replicate
-- these workflows — exponentially expensive.
-- ============================================================================

-- ─── Enum: Workflow Types ────────────────────────────────────────────────────

CREATE TYPE workflow_type AS ENUM (
    'decision_encoding',      -- How clinical decisions are structured
    'protocol_execution',     -- Step-by-step protocol following
    'triage_routing',         -- Patient routing / prioritization logic
    'treatment_pathway'       -- End-to-end treatment decision chains
);

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE workflow_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),

    -- Classification
    workflow_type       workflow_type NOT NULL,

    -- Source context
    encounter_id        UUID NOT NULL REFERENCES encounters(id),
    triggered_by        UUID NOT NULL REFERENCES users(id),

    -- Workflow structure (the lock-in data)
    state_graph         JSONB NOT NULL,        -- DAG of state transitions
    actor_sequence      JSONB NOT NULL,        -- Ordered [{ actor_type, actor_id, action }]
    decision_points     JSONB NOT NULL,        -- [{ node_id, ai_attribution, human_attribution, choice }]

    -- Moat measurement
    replication_cost_score  DOUBLE PRECISION NOT NULL DEFAULT 0.0,

    -- Metadata
    snapshot_version    INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_ws_tenant        ON workflow_snapshots(tenant_id);
CREATE INDEX idx_ws_type          ON workflow_snapshots(workflow_type);
CREATE INDEX idx_ws_encounter     ON workflow_snapshots(encounter_id);
CREATE INDEX idx_ws_created       ON workflow_snapshots(created_at DESC);

-- GIN index for querying inside the workflow structure
CREATE INDEX idx_ws_state_graph   ON workflow_snapshots USING GIN (state_graph);
CREATE INDEX idx_ws_decision_pts  ON workflow_snapshots USING GIN (decision_points);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE workflow_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON workflow_snapshots
    USING (tenant_id::text = current_setting('app.tenant_id', true));
