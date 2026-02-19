-- =============================================================================
-- Migration 014: API Event Tables
--
-- Four append-only event tables for the VetIOS API layer.
-- These are the moat tables — every inference, outcome, simulation, and
-- network metric is captured permanently.
--
-- Indexes are designed per spec:
--   - Explicit B-tree indexes on join keys and timeline queries
--   - NO GIN indexes on jsonb columns (preserve write throughput)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ai_inference_events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_inference_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    clinic_id       uuid,
    case_id         uuid,
    model_name      text NOT NULL,
    model_version   text NOT NULL,
    input_signature jsonb NOT NULL,
    output_payload  jsonb NOT NULL,
    confidence_score double precision,
    uncertainty_metrics jsonb,
    inference_latency_ms      integer NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_inference_events IS 'Append-only log of every AI inference call. Core moat table.';

-- Indexes (per spec)
CREATE INDEX idx_ai_inference_events_tenant_time
    ON public.ai_inference_events (tenant_id, created_at DESC);

CREATE INDEX idx_ai_inference_events_case
    ON public.ai_inference_events (case_id)
    WHERE case_id IS NOT NULL;

CREATE INDEX idx_ai_inference_events_clinic_time
    ON public.ai_inference_events (clinic_id, created_at DESC)
    WHERE clinic_id IS NOT NULL;

CREATE INDEX idx_ai_inference_events_model
    ON public.ai_inference_events (model_name, model_version);

-- RLS
ALTER TABLE public.ai_inference_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on ai_inference_events"
    ON public.ai_inference_events
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. clinical_outcome_events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clinical_outcome_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    clinic_id           uuid,
    case_id             uuid,
    inference_event_id  uuid NOT NULL REFERENCES public.ai_inference_events(id),
    outcome_type        text NOT NULL,
    outcome_payload     jsonb NOT NULL,
    outcome_timestamp   timestamptz NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clinical_outcome_events IS 'Append-only outcomes linked to inference events. Never update inference logs — outcomes are separate.';

-- Indexes (per spec)
CREATE INDEX idx_clinical_outcome_events_inference
    ON public.clinical_outcome_events (inference_event_id);

CREATE INDEX idx_clinical_outcome_events_tenant_time
    ON public.clinical_outcome_events (tenant_id, created_at DESC);

CREATE INDEX idx_clinical_outcome_events_clinic_time
    ON public.clinical_outcome_events (clinic_id, created_at DESC)
    WHERE clinic_id IS NOT NULL;

CREATE INDEX idx_clinical_outcome_events_case
    ON public.clinical_outcome_events (case_id)
    WHERE case_id IS NOT NULL;

-- RLS
ALTER TABLE public.clinical_outcome_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on clinical_outcome_events"
    ON public.clinical_outcome_events
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. edge_simulation_events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.edge_simulation_events (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    simulation_type         text NOT NULL,
    simulation_parameters   jsonb NOT NULL,
    scenario                jsonb NOT NULL,
    triggered_inference_id  uuid REFERENCES public.ai_inference_events(id),
    inference_output        jsonb,
    failure_mode            text,
    created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.edge_simulation_events IS 'Append-only adversarial simulation results. Every simulation calls the real inference pipeline.';

-- Indexes (per spec)
CREATE INDEX idx_edge_simulation_events_inference
    ON public.edge_simulation_events (triggered_inference_id)
    WHERE triggered_inference_id IS NOT NULL;

CREATE INDEX idx_edge_simulation_events_type_time
    ON public.edge_simulation_events (simulation_type, created_at DESC);

CREATE INDEX idx_edge_simulation_events_time
    ON public.edge_simulation_events (created_at DESC);

CREATE INDEX idx_edge_simulation_events_failure
    ON public.edge_simulation_events (failure_mode)
    WHERE failure_mode IS NOT NULL;

-- RLS
ALTER TABLE public.edge_simulation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on edge_simulation_events"
    ON public.edge_simulation_events
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. network_intelligence_metrics
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.network_intelligence_metrics (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
    metric_name       text NOT NULL,
    metric_scope      text NOT NULL,
    aggregated_signal jsonb NOT NULL,
    model_version     text,
    computed_at       timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.network_intelligence_metrics IS 'Network-level intelligence metrics. Derived signals only — never raw clinical data.';

-- Indexes (per spec)
CREATE INDEX idx_network_intelligence_metrics_lookup
    ON public.network_intelligence_metrics (metric_name, metric_scope);

CREATE INDEX idx_network_intelligence_metrics_time
    ON public.network_intelligence_metrics (computed_at DESC);

CREATE INDEX idx_network_intelligence_metrics_model
    ON public.network_intelligence_metrics (model_version)
    WHERE model_version IS NOT NULL;

-- RLS
ALTER TABLE public.network_intelligence_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on network_intelligence_metrics"
    ON public.network_intelligence_metrics
    FOR ALL
    USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );
