-- ============================================================================
-- 012 — Intelligence Metrics
--
-- Stores the self-optimization signals for the Intelligence Layer.
-- These metrics close the learning loop: predictions get better,
-- decision models self-optimize, and clinics become more productive.
--
-- Cross-tenant aggregation is OPT-IN via intelligence_sharing_opted_in.
-- Only derived signals are shared — never raw clinical data.
-- ============================================================================

-- ─── Enum: Intelligence Metric Types ─────────────────────────────────────────

CREATE TYPE intelligence_metric_type AS ENUM (
    'prediction_accuracy',     -- How accurate was the AI prediction vs outcome
    'decision_quality',        -- Composite quality score for an AI decision
    'override_rate',           -- How often humans override AI (lower = better calibration)
    'outcome_correlation',     -- Strength of decision → outcome link
    'model_drift'              -- Drift detection signal for model degradation
);

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE intelligence_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),

    -- Classification
    metric_type     intelligence_metric_type NOT NULL,

    -- Source
    decision_id     UUID REFERENCES ai_decision_logs(id),
    encounter_id    UUID REFERENCES encounters(id),

    -- Metric value
    score           DOUBLE PRECISION NOT NULL,
    feedback_signal JSONB NOT NULL DEFAULT '{}',

    -- Time window (for aggregated metrics)
    window_start    TIMESTAMPTZ,
    window_end      TIMESTAMPTZ,

    -- Network effect opt-in
    -- Only derived intelligence signals are aggregated, never raw data
    intelligence_sharing_opted_in BOOLEAN NOT NULL DEFAULT false,

    -- Metadata
    model_version   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_im_tenant        ON intelligence_metrics(tenant_id);
CREATE INDEX idx_im_type          ON intelligence_metrics(metric_type);
CREATE INDEX idx_im_decision      ON intelligence_metrics(decision_id) WHERE decision_id IS NOT NULL;
CREATE INDEX idx_im_encounter     ON intelligence_metrics(encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX idx_im_score         ON intelligence_metrics(score);
CREATE INDEX idx_im_created       ON intelligence_metrics(created_at DESC);

-- Partial index for cross-tenant intelligence queries (opt-in only)
CREATE INDEX idx_im_shared        ON intelligence_metrics(metric_type, score)
    WHERE intelligence_sharing_opted_in = true;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE intelligence_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON intelligence_metrics
    USING (tenant_id::text = current_setting('app.tenant_id', true));
