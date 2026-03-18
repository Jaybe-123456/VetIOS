-- =============================================================================
-- Migration 016: VetIOS Inference Engine v2
--
-- Adds computed columns and indexes for the new inference output fields:
--   emergency_level, abstain, contradiction_score, schema_version
--
-- BACKWARD COMPATIBLE:
--   - No existing columns are dropped or renamed
--   - output_payload jsonb structure is extended, not replaced
--   - All existing inference_event_id references remain valid
--   - outcome injection via clinical_outcome_events is unchanged
--   - adversarial simulation via edge_simulation_events is unchanged
--
-- Strategy:
--   - Generated columns extract new fields from output_payload jsonb
--   - These are STORED (not virtual) for query performance
--   - Partial index on emergency_level for triage dashboard queries
--   - Partial index on abstain for flagged-cases queries
-- =============================================================================

-- ─── Computed columns on ai_inference_events ─────────────────────────────────
-- Extract emergency_level from v2 output_payload.
-- Falls back to NULL for v1 records (schema_version not set).

ALTER TABLE public.ai_inference_events
    ADD COLUMN IF NOT EXISTS inferred_emergency_level text
        GENERATED ALWAYS AS (
            output_payload ->> 'emergency_level'
        ) STORED;

ALTER TABLE public.ai_inference_events
    ADD COLUMN IF NOT EXISTS inferred_abstain boolean
        GENERATED ALWAYS AS (
            CASE
                WHEN (output_payload ->> 'abstain') IS NOT NULL
                THEN (output_payload ->> 'abstain')::boolean
                ELSE NULL
            END
        ) STORED;

ALTER TABLE public.ai_inference_events
    ADD COLUMN IF NOT EXISTS inferred_contradiction_score double precision
        GENERATED ALWAYS AS (
            CASE
                WHEN (output_payload ->> 'contradiction_score') IS NOT NULL
                THEN (output_payload ->> 'contradiction_score')::double precision
                ELSE NULL
            END
        ) STORED;

ALTER TABLE public.ai_inference_events
    ADD COLUMN IF NOT EXISTS inference_schema_version text
        GENERATED ALWAYS AS (
            output_payload ->> 'schema_version'
        ) STORED;

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Triage dashboard: fetch all CRITICAL cases for a tenant
CREATE INDEX IF NOT EXISTS idx_ai_inference_events_emergency_level
    ON public.ai_inference_events (tenant_id, inferred_emergency_level, created_at DESC)
    WHERE inferred_emergency_level IS NOT NULL;

-- Flagged cases: fetch all abstain=true cases for review
CREATE INDEX IF NOT EXISTS idx_ai_inference_events_abstain
    ON public.ai_inference_events (tenant_id, created_at DESC)
    WHERE inferred_abstain = true;

-- Contradiction monitoring: high-contradiction cases
CREATE INDEX IF NOT EXISTS idx_ai_inference_events_contradiction
    ON public.ai_inference_events (tenant_id, inferred_contradiction_score DESC)
    WHERE inferred_contradiction_score > 0.3;

-- Override telemetry: join with network_intelligence_metrics
CREATE INDEX IF NOT EXISTS idx_ai_inference_events_schema_version
    ON public.ai_inference_events (inference_schema_version);

-- ─── Telemetry view ──────────────────────────────────────────────────────────
-- Convenience view for the telemetry dashboard.
-- Exposes pre-extracted fields without requiring jsonb operators in queries.

CREATE OR REPLACE VIEW public.v_inference_telemetry AS
SELECT
    ie.id                            AS inference_event_id,
    ie.tenant_id,
    ie.clinic_id,
    ie.case_id,
    ie.model_name,
    ie.model_version,
    ie.confidence_score,
    ie.inference_latency_ms,
    ie.inference_schema_version,
    ie.inferred_emergency_level,
    ie.inferred_abstain,
    ie.inferred_contradiction_score,
    -- Extract override telemetry
    (ie.output_payload -> 'telemetry' ->> 'override_fired')::boolean   AS override_fired,
    ie.output_payload -> 'telemetry' ->> 'override_pattern_id'         AS override_pattern_id,
    (ie.output_payload -> 'telemetry' ->> 'confidence_penalty_applied')::boolean
                                                                        AS confidence_penalty_applied,
    (ie.output_payload -> 'telemetry' ->> 'confidence_penalty_amount')::double precision
                                                                        AS confidence_penalty_amount,
    (ie.output_payload -> 'telemetry' ->> 'pipeline_latency_ms')::integer
                                                                        AS pipeline_latency_ms,
    -- Extract primary condition class
    ie.output_payload -> 'diagnosis' ->> 'primary_condition_class'     AS primary_condition_class,
    ie.created_at
FROM public.ai_inference_events ie;

COMMENT ON VIEW public.v_inference_telemetry IS
    'Pre-extracted inference telemetry fields. Read-only. Updates automatically as output_payload changes.';

-- ─── Triage summary view ──────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_triage_summary AS
SELECT
    tenant_id,
    DATE_TRUNC('hour', created_at)                                  AS hour,
    COUNT(*)                                                        AS total_inferences,
    COUNT(*) FILTER (WHERE inferred_emergency_level = 'CRITICAL')   AS critical_count,
    COUNT(*) FILTER (WHERE inferred_emergency_level = 'HIGH')       AS high_count,
    COUNT(*) FILTER (WHERE inferred_emergency_level = 'MODERATE')   AS moderate_count,
    COUNT(*) FILTER (WHERE inferred_emergency_level = 'LOW')        AS low_count,
    COUNT(*) FILTER (WHERE inferred_abstain = true)                 AS abstain_count,
    COUNT(*) FILTER (WHERE
        (output_payload -> 'telemetry' ->> 'override_fired')::boolean = true
    )                                                               AS override_count,
    AVG(inferred_contradiction_score)                               AS avg_contradiction_score,
    AVG(confidence_score)                                           AS avg_confidence
FROM public.ai_inference_events
WHERE inference_schema_version = '2.0'
GROUP BY tenant_id, DATE_TRUNC('hour', created_at);

COMMENT ON VIEW public.v_triage_summary IS
    'Hourly triage summary for the telemetry dashboard. v2 inferences only.';
