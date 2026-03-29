-- Migration: Outcome Network Foundation
-- Description: Adds passive signal intake, longitudinal episode state,
-- benchmark scaffolding, protocol execution, and trust artifacts.

ALTER TABLE clinical_cases
    ADD COLUMN IF NOT EXISTS patient_id UUID,
    ADD COLUMN IF NOT EXISTS encounter_id UUID,
    ADD COLUMN IF NOT EXISTS episode_id UUID,
    ADD COLUMN IF NOT EXISTS episode_status TEXT,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS signal_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    clinic_id UUID,
    source_type TEXT NOT NULL,
    vendor_name TEXT,
    vendor_account_ref TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error', 'disabled')),
    cursor_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    clinic_id UUID,
    patient_id UUID NOT NULL REFERENCES patients(id),
    primary_condition_class TEXT,
    episode_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'monitoring', 'resolved', 'closed', 'archived')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    latest_case_id UUID REFERENCES clinical_cases(id),
    latest_encounter_id UUID REFERENCES encounters(id),
    outcome_state TEXT NOT NULL DEFAULT 'unknown',
    outcome_confidence DOUBLE PRECISION,
    severity_peak DOUBLE PRECISION,
    recurrence_count INTEGER NOT NULL DEFAULT 0,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, episode_key)
);

CREATE TABLE IF NOT EXISTS passive_signal_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    clinic_id UUID,
    patient_id UUID REFERENCES patients(id),
    encounter_id UUID REFERENCES encounters(id),
    case_id UUID REFERENCES clinical_cases(id),
    episode_id UUID REFERENCES patient_episodes(id),
    source_id UUID REFERENCES signal_sources(id),
    signal_type TEXT NOT NULL,
    signal_subtype TEXT,
    observed_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    normalized_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence DOUBLE PRECISION,
    dedupe_key TEXT,
    ingestion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (ingestion_status IN ('pending', 'normalized', 'attached', 'discarded', 'error')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS episode_event_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    episode_id UUID NOT NULL REFERENCES patient_episodes(id),
    event_table TEXT NOT NULL,
    event_id UUID NOT NULL,
    event_kind TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    sequence_no INTEGER NOT NULL DEFAULT 0,
    state_transition TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outcome_inferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    clinic_id UUID,
    episode_id UUID NOT NULL REFERENCES patient_episodes(id),
    case_id UUID REFERENCES clinical_cases(id),
    inference_type TEXT NOT NULL,
    inferred_state TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_event_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'accepted', 'rejected', 'superseded')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS benchmark_cohorts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    scope TEXT NOT NULL DEFAULT 'tenant' CHECK (scope IN ('tenant', 'network')),
    cohort_key TEXT NOT NULL,
    species TEXT,
    condition_class TEXT,
    acuity_band TEXT,
    clinic_type TEXT,
    geography_region TEXT,
    matching_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    min_support INTEGER NOT NULL DEFAULT 25,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, cohort_key)
);

CREATE TABLE IF NOT EXISTS benchmark_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    clinic_id UUID,
    cohort_id UUID NOT NULL REFERENCES benchmark_cohorts(id),
    metric_name TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    support_n INTEGER NOT NULL DEFAULT 0,
    observed_value DOUBLE PRECISION,
    expected_value DOUBLE PRECISION,
    risk_adjusted_value DOUBLE PRECISION,
    oe_ratio DOUBLE PRECISION,
    confidence_interval JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, clinic_id, cohort_id, metric_name, window_end)
);

CREATE TABLE IF NOT EXISTS protocol_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    protocol_key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    condition_class TEXT,
    trigger_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    writeback_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, protocol_key, version)
);

CREATE TABLE IF NOT EXISTS protocol_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    clinic_id UUID,
    patient_id UUID REFERENCES patients(id),
    encounter_id UUID REFERENCES encounters(id),
    episode_id UUID REFERENCES patient_episodes(id),
    case_id UUID REFERENCES clinical_cases(id),
    template_id UUID NOT NULL REFERENCES protocol_templates(id),
    trigger_source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'recommended'
        CHECK (status IN ('recommended', 'accepted', 'completed', 'dismissed', 'expired')),
    recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    accepted_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evidence_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    subject_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT,
    lineage JSONB NOT NULL DEFAULT '{}'::jsonb,
    support_n INTEGER NOT NULL DEFAULT 0,
    model_versions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'clinical_cases_patient_id_fkey'
    ) THEN
        ALTER TABLE clinical_cases
            ADD CONSTRAINT clinical_cases_patient_id_fkey
            FOREIGN KEY (patient_id) REFERENCES patients(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'clinical_cases_encounter_id_fkey'
    ) THEN
        ALTER TABLE clinical_cases
            ADD CONSTRAINT clinical_cases_encounter_id_fkey
            FOREIGN KEY (encounter_id) REFERENCES encounters(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'clinical_cases_episode_id_fkey'
    ) THEN
        ALTER TABLE clinical_cases
            ADD CONSTRAINT clinical_cases_episode_id_fkey
            FOREIGN KEY (episode_id) REFERENCES patient_episodes(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS clinical_cases_patient_id_idx
    ON clinical_cases (tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS clinical_cases_episode_id_idx
    ON clinical_cases (tenant_id, episode_id);

CREATE INDEX IF NOT EXISTS signal_sources_tenant_status_idx
    ON signal_sources (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS passive_signal_events_patient_idx
    ON passive_signal_events (tenant_id, patient_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS passive_signal_events_episode_idx
    ON passive_signal_events (tenant_id, episode_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS passive_signal_events_dedupe_key_idx
    ON passive_signal_events (tenant_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS patient_episodes_patient_status_idx
    ON patient_episodes (tenant_id, patient_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS episode_event_links_episode_idx
    ON episode_event_links (tenant_id, episode_id, observed_at DESC, sequence_no DESC);

CREATE INDEX IF NOT EXISTS outcome_inferences_episode_idx
    ON outcome_inferences (tenant_id, episode_id, created_at DESC);

CREATE INDEX IF NOT EXISTS benchmark_snapshots_lookup_idx
    ON benchmark_snapshots (tenant_id, clinic_id, cohort_id, metric_name, window_end DESC);

CREATE INDEX IF NOT EXISTS protocol_executions_episode_status_idx
    ON protocol_executions (tenant_id, episode_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS evidence_cards_subject_idx
    ON evidence_cards (tenant_id, subject_type, subject_id, created_at DESC);
