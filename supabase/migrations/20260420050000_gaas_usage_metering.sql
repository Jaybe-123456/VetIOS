-- =============================================================================
-- VetIOS GaaS — Migration 006: Usage Metering
-- Timestamp: 20260420050000
-- Description: Creates usage_events for GaaS billing metering, plus
--   aggregated usage snapshots per tenant per day for efficient billing queries.
--
-- Prerequisites: gaas_tenant_config (20260420000000)
-- =============================================================================

-- =============================================================================
-- 1. Usage Event Type Enum
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'gaas_usage_event_type'
        AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.gaas_usage_event_type AS ENUM (
            'agent_run',
            'tool_call',
            'hitl_interrupt',
            'memory_read',
            'memory_write',
            'agent_message'
        );
    END IF;
END $$;

-- =============================================================================
-- 2. Usage Events Table (append-only metering log)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_usage_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    event_type   public.gaas_usage_event_type NOT NULL,
    agent_role   public.gaas_agent_role,
    run_id       TEXT,
    patient_id   TEXT,
    metadata     JSONB NOT NULL DEFAULT '{}'::JSONB,
    billed_units INTEGER NOT NULL DEFAULT 1,         -- configurable unit weight per event type
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: this table is append-only
);

CREATE INDEX IF NOT EXISTS idx_gaas_usage_events_tenant_created
    ON public.gaas_usage_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gaas_usage_events_type
    ON public.gaas_usage_events (event_type);

CREATE INDEX IF NOT EXISTS idx_gaas_usage_events_run_id
    ON public.gaas_usage_events (run_id)
    WHERE run_id IS NOT NULL;

-- =============================================================================
-- 3. Daily Usage Snapshots (materialised aggregation for billing)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_usage_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    snapshot_date   DATE NOT NULL,
    agent_runs      INTEGER NOT NULL DEFAULT 0,
    tool_calls      INTEGER NOT NULL DEFAULT 0,
    hitl_interrupts INTEGER NOT NULL DEFAULT 0,
    memory_reads    INTEGER NOT NULL DEFAULT 0,
    memory_writes   INTEGER NOT NULL DEFAULT 0,
    agent_messages  INTEGER NOT NULL DEFAULT 0,
    total_units     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT gaas_usage_snapshot_unique UNIQUE (tenant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_gaas_usage_snapshots_tenant_date
    ON public.gaas_usage_snapshots (tenant_id, snapshot_date DESC);

DROP TRIGGER IF EXISTS gaas_usage_snapshots_updated_at ON public.gaas_usage_snapshots;
CREATE TRIGGER gaas_usage_snapshots_updated_at
    BEFORE UPDATE ON public.gaas_usage_snapshots
    FOR EACH ROW EXECUTE FUNCTION public.gaas_set_updated_at();

-- =============================================================================
-- 4. Usage Aggregation RPC
--    Rolls up raw events into the daily snapshot. Called by the metering worker
--    at end-of-day or on-demand for billing queries.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_aggregate_usage(
    p_tenant_id   UUID,
    p_date        DATE DEFAULT CURRENT_DATE
)
RETURNS public.gaas_usage_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row public.gaas_usage_snapshots;
BEGIN
    INSERT INTO public.gaas_usage_snapshots (
        tenant_id,
        snapshot_date,
        agent_runs,
        tool_calls,
        hitl_interrupts,
        memory_reads,
        memory_writes,
        agent_messages,
        total_units
    )
    SELECT
        p_tenant_id,
        p_date,
        COALESCE(SUM(CASE WHEN event_type = 'agent_run'       THEN billed_units ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN event_type = 'tool_call'       THEN billed_units ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN event_type = 'hitl_interrupt'  THEN billed_units ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN event_type = 'memory_read'     THEN billed_units ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN event_type = 'memory_write'    THEN billed_units ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN event_type = 'agent_message'   THEN billed_units ELSE 0 END), 0),
        COALESCE(SUM(billed_units), 0)
    FROM public.gaas_usage_events
    WHERE tenant_id  = p_tenant_id
      AND created_at >= p_date::TIMESTAMPTZ
      AND created_at  < (p_date + INTERVAL '1 day')::TIMESTAMPTZ
    ON CONFLICT (tenant_id, snapshot_date)
    DO UPDATE SET
        agent_runs      = EXCLUDED.agent_runs,
        tool_calls      = EXCLUDED.tool_calls,
        hitl_interrupts = EXCLUDED.hitl_interrupts,
        memory_reads    = EXCLUDED.memory_reads,
        memory_writes   = EXCLUDED.memory_writes,
        agent_messages  = EXCLUDED.agent_messages,
        total_units     = EXCLUDED.total_units,
        updated_at      = NOW()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

-- =============================================================================
-- 5. Current Month Usage RPC
--    Returns the running total for the current billing month.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_current_month_usage(
    p_tenant_id UUID
)
RETURNS TABLE (
    event_type   TEXT,
    total_units  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        event_type::TEXT,
        SUM(billed_units) AS total_units
    FROM public.gaas_usage_events
    WHERE tenant_id  = p_tenant_id
      AND created_at >= DATE_TRUNC('month', NOW())
    GROUP BY event_type
    ORDER BY total_units DESC;
$$;

-- =============================================================================
-- 6. Row Level Security
-- =============================================================================

ALTER TABLE public.gaas_usage_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaas_usage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gaas_usage_events_service_all"
    ON public.gaas_usage_events
    USING (TRUE)
    WITH CHECK (TRUE);

CREATE POLICY "gaas_usage_events_tenant_read"
    ON public.gaas_usage_events
    FOR SELECT
    USING (tenant_id::TEXT = current_setting('app.tenant_id', TRUE));

CREATE POLICY "gaas_usage_snapshots_service_all"
    ON public.gaas_usage_snapshots
    USING (TRUE)
    WITH CHECK (TRUE);

CREATE POLICY "gaas_usage_snapshots_tenant_read"
    ON public.gaas_usage_snapshots
    FOR SELECT
    USING (tenant_id::TEXT = current_setting('app.tenant_id', TRUE));

COMMENT ON TABLE public.gaas_usage_events IS
    'Append-only metering log for GaaS billing. Every agent action emits an event here.';

COMMENT ON TABLE public.gaas_usage_snapshots IS
    'Pre-aggregated daily usage per tenant. Populated by gaas_aggregate_usage() RPC.';
