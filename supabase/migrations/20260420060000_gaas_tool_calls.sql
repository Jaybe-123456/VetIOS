-- =============================================================================
-- VetIOS GaaS — Migration 007: Tool Call Audit Log
-- Timestamp: 20260420060000
-- Description: Creates gaas_tool_calls — a dedicated audit log for every
--   tool invocation made by agents. Captures input, output, latency, approval
--   status, and links back to the originating agent run and step.
--   Provides the full traceability required for clinical compliance.
--
-- Prerequisites: gaas_agent_runs (20260420010000)
-- =============================================================================

-- =============================================================================
-- 1. Tool Name Enum
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'gaas_tool_name'
        AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.gaas_tool_name AS ENUM (
            'run_inference',
            'record_outcome',
            'run_simulation',
            'query_drug_db',
            'order_lab',
            'write_ehr',
            'send_alert',
            'schedule_followup',
            'fetch_patient_history'
        );
    END IF;
END $$;

-- =============================================================================
-- 2. Tool Call Status Enum
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'gaas_tool_status'
        AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.gaas_tool_status AS ENUM (
            'pending',
            'success',
            'failed'
        );
    END IF;
END $$;

-- =============================================================================
-- 3. Tool Calls Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_tool_calls (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id           TEXT NOT NULL UNIQUE,          -- app-layer ID: tc_TIMESTAMP
    run_id            TEXT NOT NULL,                 -- links to gaas_agent_runs.run_id
    step_number       INTEGER NOT NULL,
    tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id        TEXT NOT NULL,
    tool              public.gaas_tool_name NOT NULL,
    input             JSONB NOT NULL DEFAULT '{}'::JSONB,
    output            JSONB,
    status            public.gaas_tool_status NOT NULL DEFAULT 'pending',
    latency_ms        INTEGER,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by       TEXT,
    approved_at       TIMESTAMPTZ,
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gaas_tool_calls_run_id
    ON public.gaas_tool_calls (run_id);

CREATE INDEX IF NOT EXISTS idx_gaas_tool_calls_tenant_id
    ON public.gaas_tool_calls (tenant_id);

CREATE INDEX IF NOT EXISTS idx_gaas_tool_calls_patient_id
    ON public.gaas_tool_calls (patient_id);

CREATE INDEX IF NOT EXISTS idx_gaas_tool_calls_tool
    ON public.gaas_tool_calls (tool);

CREATE INDEX IF NOT EXISTS idx_gaas_tool_calls_status
    ON public.gaas_tool_calls (status);

CREATE INDEX IF NOT EXISTS idx_gaas_tool_calls_created_at
    ON public.gaas_tool_calls (created_at DESC);

-- Pending approvals — used by HITL manager to surface awaiting tool calls
CREATE INDEX IF NOT EXISTS idx_gaas_tool_calls_pending_approval
    ON public.gaas_tool_calls (tenant_id, created_at DESC)
    WHERE requires_approval = TRUE AND approved_at IS NULL AND status = 'pending';

DROP TRIGGER IF EXISTS gaas_tool_calls_updated_at ON public.gaas_tool_calls;
CREATE TRIGGER gaas_tool_calls_updated_at
    BEFORE UPDATE ON public.gaas_tool_calls
    FOR EACH ROW EXECUTE FUNCTION public.gaas_set_updated_at();

-- =============================================================================
-- 4. Tool Performance View
--    Aggregate latency and success rates per tool per tenant.
--    Used by the operator dashboard for system health monitoring.
-- =============================================================================

CREATE OR REPLACE VIEW public.gaas_tool_performance AS
SELECT
    tenant_id,
    tool::TEXT                                          AS tool_name,
    COUNT(*)                                            AS total_calls,
    COUNT(*) FILTER (WHERE status = 'success')          AS successful_calls,
    COUNT(*) FILTER (WHERE status = 'failed')           AS failed_calls,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'success')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 2
    )                                                   AS success_rate_pct,
    ROUND(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL))
                                                        AS avg_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
          FILTER (WHERE latency_ms IS NOT NULL))        AS p95_latency_ms,
    MAX(created_at)                                     AS last_called_at
FROM public.gaas_tool_calls
GROUP BY tenant_id, tool;

-- =============================================================================
-- 5. Row Level Security
-- =============================================================================

ALTER TABLE public.gaas_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gaas_tool_calls_service_all"
    ON public.gaas_tool_calls
    USING (TRUE)
    WITH CHECK (TRUE);

CREATE POLICY "gaas_tool_calls_tenant_read"
    ON public.gaas_tool_calls
    FOR SELECT
    USING (tenant_id::TEXT = current_setting('app.tenant_id', TRUE));

COMMENT ON TABLE public.gaas_tool_calls IS
    'Full audit log of every tool invocation by agents. Clinical compliance record for all real-world actions.';

COMMENT ON COLUMN public.gaas_tool_calls.requires_approval IS
    'TRUE when the tool was policy-gated and required human approval before execution.';

COMMENT ON COLUMN public.gaas_tool_calls.approved_by IS
    'User ID or email of the clinician who approved the tool call. NULL for autonomous executions.';

COMMENT ON VIEW public.gaas_tool_performance IS
    'Aggregate latency, success rate, and usage counts per tool per tenant. Used by operator dashboard.';
