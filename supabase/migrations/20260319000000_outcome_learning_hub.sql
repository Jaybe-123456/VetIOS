-- Migration: Outcome Learning Hub Refactor
-- Description: Creates the calibration, reinforcement, audit, and error clustering tables.

-- Adding label_type to clinical_outcome_events to support safe learning rules
ALTER TABLE clinical_outcome_events ADD COLUMN IF NOT EXISTS label_type TEXT DEFAULT 'synthetic';

-- 1. outcome_calibrations
CREATE TABLE IF NOT EXISTS outcome_calibrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    inference_event_id UUID NOT NULL,
    outcome_event_id UUID NOT NULL,
    predicted_confidence DOUBLE PRECISION,
    actual_correctness DOUBLE PRECISION,
    calibration_error DOUBLE PRECISION,
    brier_score DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. learning_reinforcements
CREATE TABLE IF NOT EXISTS learning_reinforcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    inference_event_id UUID NOT NULL,
    diagnosis_label TEXT,
    condition_class TEXT,
    severity_label TEXT,
    features JSONB NOT NULL DEFAULT '{}',
    reinforcement_type TEXT NOT NULL, -- 'Diagnosis' | 'Severity' | 'Calibration'
    impact_delta DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. model_improvement_audits
CREATE TABLE IF NOT EXISTS model_improvement_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    inference_event_id UUID NOT NULL,
    pre_update_prediction JSONB,
    post_update_prediction JSONB,
    pre_confidence DOUBLE PRECISION,
    post_confidence DOUBLE PRECISION,
    improvement_delta DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. error_clusters
CREATE TABLE IF NOT EXISTS error_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    cluster_signature TEXT NOT NULL,
    misclassification_type TEXT,
    severity_error DOUBLE PRECISION,
    contradiction_presence BOOLEAN,
    frequency INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, cluster_signature)
);
