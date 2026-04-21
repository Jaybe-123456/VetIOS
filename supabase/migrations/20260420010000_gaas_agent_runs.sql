-- =============================================================================
-- VetIOS GaaS — Migration 002: Agent Runs
-- Timestamp: 20260420010000
-- Description: Creates the agent_runs table which tracks every autonomous
--   agent execution — goal, policy, patient context, steps, status, and result.
--   This is the core audit table for the agent runtime engine.
--
-- Prerequisites: gaas_tenant_config (20260420000000)
-- =============================================================================

-- =============================================================================
-- 1. Agent Role Enum
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'gaas_agent_role'
        AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.gaas_agent_role AS ENUM (
            'triage',
            'diagnostic',
            'treatment',
            'compliance',
            'followup',
            'billing'
        );
    END IF;
END $$;

-- =============================================================================
-- 2. Agent Run Status Enum
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'gaas_run_status'
        AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.gaas_run_status AS ENUM (
            'idle',
            'running',
            'awaiting_human',
            'completed',
            'failed',
            'escalated'
        );
    END IF;
END $$;

-- =============================================================================
-- 3. Agent Runs Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_agent_runs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           TEXT NOT NULL UNIQUE,           -- app-layer correlation ID (run_XXXXX)
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    agent_role       public.gaas_agent_role NOT NULL,
    goal             JSONB NOT NULL DEFAULT '{}'::JSONB,
    policy           JSONB NOT NULL DEFAULT '{}'::JSONB,
    patient_context  JSONB NOT NULL DEFAULT '{}'::JSONB,
    patient_id       TEXT NOT NULL,                  -- denormalised for fast queries
    status           public.gaas_run_status NOT NULL DEFAULT 'running',
    steps            JSONB NOT NULL DEFAULT '[]'::JSONB,
    memory_context   JSONB NOT NULL DEFAULT '[]'::JSONB,
    result           JSONB,
    total_tokens     INTEGER,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gaas_agent_runs_tenant_id
    ON public.gaas_agent_runs (tenant_id);

CREATE INDEX IF NOT EXISTS idx_gaas_agent_runs_status
    ON public.gaas_agent_runs (status);

CREATE INDEX IF NOT EXISTS idx_gaas_agent_runs_patient_id
    ON public.gaas_agent_runs (patient_id);

CREATE INDEX IF NOT EXISTS idx_gaas_agent_runs_agent_role
    ON public.gaas_agent_runs (agent_role);

CREATE INDEX IF NOT EXISTS idx_gaas_agent_runs_started_at
    ON public.gaas_agent_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_gaas_agent_runs_tenant_status
    ON public.gaas_agent_runs (tenant_id, status);

-- Updated_at trigger
DROP TRIGGER IF EXISTS gaas_agent_runs_updated_at ON public.gaas_agent_runs;
CREATE TRIGGER gaas_agent_runs_updated_at
    BEFORE UPDATE ON public.gaas_agent_runs
    FOR EACH ROW EXECUTE FUNCTION public.gaas_set_updated_at();

-- =============================================================================
-- 4. Row Level Security
-- =============================================================================

ALTER TABLE public.gaas_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gaas_agent_runs_service_all"
    ON public.gaas_agent_runs
    USING (TRUE)
    WITH CHECK (TRUE);

CREATE POLICY "gaas_agent_runs_tenant_read"
    ON public.gaas_agent_runs
    FOR SELECT
    USING (tenant_id::TEXT = current_setting('app.tenant_id', TRUE));

COMMENT ON TABLE public.gaas_agent_runs IS
    'Full audit log of every agent execution including steps, goal, policy, and result.';

COMMENT ON COLUMN public.gaas_agent_runs.run_id IS
    'App-layer correlation ID in the format run_TIMESTAMP_RANDOM. Used by the agent runtime for in-flight tracking.';

COMMENT ON COLUMN public.gaas_agent_runs.steps IS
    'Ordered JSON array of AgentStep objects — each containing reasoning, tool_call, observation, and safety_check.';

COMMENT ON COLUMN public.gaas_agent_runs.patient_context IS
    'Snapshot of the patient context at the time the run was started. Immutable after creation.';
