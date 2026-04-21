-- =============================================================================
-- VetIOS GaaS — Migration 004: HITL Interrupt Layer
-- Timestamp: 20260420030000
-- Description: Creates the hitl_interrupts table — the structured pause/resume
--   audit trail for Human-in-the-Loop clinical safety reviews. Every interrupt
--   raised by an agent, every clinician resolution, is recorded here with full
--   attribution and context snapshot.
--
-- Prerequisites: gaas_agent_runs (20260420010000)
-- =============================================================================

-- =============================================================================
-- 1. HITL Resolution Enum
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'gaas_hitl_resolution'
        AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.gaas_hitl_resolution AS ENUM (
            'approved',
            'rejected',
            'modified'
        );
    END IF;
END $$;

-- =============================================================================
-- 2. HITL Interrupts Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_hitl_interrupts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interrupt_id     TEXT NOT NULL UNIQUE,           -- app-layer ID: hitl_TIMESTAMP_RANDOM
    agent_run_id     TEXT NOT NULL,                  -- links to gaas_agent_runs.run_id
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id       TEXT NOT NULL,                  -- denormalised for fast queries
    agent_role       public.gaas_agent_role NOT NULL,
    reason           TEXT NOT NULL,
    pending_tool     JSONB,                          -- serialised ToolCall that triggered the interrupt
    context_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    -- Resolution fields (NULL until resolved)
    resolved_at      TIMESTAMPTZ,
    resolution       public.gaas_hitl_resolution,
    resolved_by      TEXT,                           -- user ID, email, or 'system'
    modified_input   JSONB,                          -- populated when resolution = 'modified'
    -- Metadata
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Soft constraint: resolution fields must be consistent
    CONSTRAINT gaas_hitl_resolution_consistency
        CHECK (
            (resolved_at IS NULL AND resolution IS NULL AND resolved_by IS NULL)
            OR
            (resolved_at IS NOT NULL AND resolution IS NOT NULL AND resolved_by IS NOT NULL)
        )
);

-- Partial index for pending interrupts (the hot path for the HITL queue)
CREATE INDEX IF NOT EXISTS idx_gaas_hitl_pending
    ON public.gaas_hitl_interrupts (tenant_id, created_at DESC)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gaas_hitl_run_id
    ON public.gaas_hitl_interrupts (agent_run_id);

CREATE INDEX IF NOT EXISTS idx_gaas_hitl_patient_id
    ON public.gaas_hitl_interrupts (patient_id);

CREATE INDEX IF NOT EXISTS idx_gaas_hitl_tenant_id
    ON public.gaas_hitl_interrupts (tenant_id);

CREATE INDEX IF NOT EXISTS idx_gaas_hitl_created_at
    ON public.gaas_hitl_interrupts (created_at DESC);

-- Updated_at trigger
DROP TRIGGER IF EXISTS gaas_hitl_interrupts_updated_at ON public.gaas_hitl_interrupts;
CREATE TRIGGER gaas_hitl_interrupts_updated_at
    BEFORE UPDATE ON public.gaas_hitl_interrupts
    FOR EACH ROW EXECUTE FUNCTION public.gaas_set_updated_at();

-- =============================================================================
-- 3. HITL Queue RPC
--    Returns all pending interrupts for a tenant, ordered oldest first
--    so the HITL queue works as a FIFO processing queue.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_get_pending_interrupts(
    p_tenant_id UUID
)
RETURNS SETOF public.gaas_hitl_interrupts
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT *
    FROM public.gaas_hitl_interrupts
    WHERE tenant_id  = p_tenant_id
      AND resolved_at IS NULL
    ORDER BY created_at ASC;
$$;

-- =============================================================================
-- 4. HITL Resolve RPC
--    Atomically resolves an interrupt and returns the updated row.
--    Called by POST /api/agent/interrupts/:id/resolve
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_resolve_interrupt(
    p_interrupt_id  TEXT,
    p_resolution    public.gaas_hitl_resolution,
    p_resolved_by   TEXT,
    p_modified_input JSONB DEFAULT NULL
)
RETURNS public.gaas_hitl_interrupts
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row public.gaas_hitl_interrupts;
BEGIN
    UPDATE public.gaas_hitl_interrupts
    SET
        resolved_at    = NOW(),
        resolution     = p_resolution,
        resolved_by    = p_resolved_by,
        modified_input = p_modified_input,
        updated_at     = NOW()
    WHERE interrupt_id = p_interrupt_id
      AND resolved_at  IS NULL      -- idempotency guard: only resolve once
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Interrupt % not found or already resolved', p_interrupt_id;
    END IF;

    RETURN v_row;
END;
$$;

-- =============================================================================
-- 5. Row Level Security
-- =============================================================================

ALTER TABLE public.gaas_hitl_interrupts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gaas_hitl_service_all"
    ON public.gaas_hitl_interrupts
    USING (TRUE)
    WITH CHECK (TRUE);

CREATE POLICY "gaas_hitl_tenant_read"
    ON public.gaas_hitl_interrupts
    FOR SELECT
    USING (tenant_id::TEXT = current_setting('app.tenant_id', TRUE));

COMMENT ON TABLE public.gaas_hitl_interrupts IS
    'Structured audit trail for every HITL pause/resume event. Immutable once resolved.';

COMMENT ON COLUMN public.gaas_hitl_interrupts.pending_tool IS
    'Serialised ToolCall JSON that the agent was about to execute when the interrupt was raised. Null for safety-state interrupts.';

COMMENT ON COLUMN public.gaas_hitl_interrupts.modified_input IS
    'When resolution=modified, the clinician-amended tool input that the agent should use upon resume.';
