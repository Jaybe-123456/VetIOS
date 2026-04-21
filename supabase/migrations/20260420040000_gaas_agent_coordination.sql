-- =============================================================================
-- VetIOS GaaS — Migration 005: Multi-Agent Coordination
-- Timestamp: 20260420040000
-- Description: Creates the agent_messages table — the durable message bus
--   for inter-agent coordination. Handoffs, consultations, alerts, and results
--   between specialist agents are recorded here with full lineage.
--
-- Prerequisites: gaas_agent_runs (20260420010000)
-- =============================================================================

-- =============================================================================
-- 1. Message Type Enum
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'gaas_message_type'
        AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.gaas_message_type AS ENUM (
            'handoff',
            'consultation',
            'alert',
            'result'
        );
    END IF;
END $$;

-- =============================================================================
-- 2. Agent Messages Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_agent_messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id    TEXT NOT NULL UNIQUE,              -- app-layer ID: msg_TIMESTAMP_ROLE
    from_agent    public.gaas_agent_role NOT NULL,
    to_agent      public.gaas_agent_role NOT NULL,
    run_id        TEXT NOT NULL,                     -- originating agent run
    tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id    TEXT NOT NULL,
    type          public.gaas_message_type NOT NULL,
    payload       JSONB NOT NULL DEFAULT '{}'::JSONB,
    acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Prevent impossible self-messages on same role for handoffs
    CONSTRAINT gaas_message_handoff_roles
        CHECK (type != 'handoff' OR from_agent != to_agent)
);

-- Hot path: unacknowledged messages for a target agent
CREATE INDEX IF NOT EXISTS idx_gaas_agent_messages_inbox
    ON public.gaas_agent_messages (tenant_id, to_agent, acknowledged, created_at DESC)
    WHERE acknowledged = FALSE;

CREATE INDEX IF NOT EXISTS idx_gaas_agent_messages_run_id
    ON public.gaas_agent_messages (run_id);

CREATE INDEX IF NOT EXISTS idx_gaas_agent_messages_patient_id
    ON public.gaas_agent_messages (patient_id);

CREATE INDEX IF NOT EXISTS idx_gaas_agent_messages_tenant_id
    ON public.gaas_agent_messages (tenant_id);

CREATE INDEX IF NOT EXISTS idx_gaas_agent_messages_created_at
    ON public.gaas_agent_messages (created_at DESC);

-- =============================================================================
-- 3. Acknowledge Message RPC
--    Atomically marks a message acknowledged and sets acknowledged_at.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_acknowledge_message(
    p_message_id TEXT
)
RETURNS public.gaas_agent_messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row public.gaas_agent_messages;
BEGIN
    UPDATE public.gaas_agent_messages
    SET
        acknowledged    = TRUE,
        acknowledged_at = NOW()
    WHERE message_id    = p_message_id
      AND acknowledged  = FALSE
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Message % not found or already acknowledged', p_message_id;
    END IF;

    RETURN v_row;
END;
$$;

-- =============================================================================
-- 4. Agent Workflow Graph View
--    Materialises the legal handoff paths as queryable rows.
--    Useful for validation and dashboard visualisation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_agent_workflow_graph (
    from_role public.gaas_agent_role NOT NULL,
    to_role   public.gaas_agent_role NOT NULL,
    PRIMARY KEY (from_role, to_role)
);

-- Seed the legal handoff graph (matches AGENT_WORKFLOW_GRAPH in coordination.ts)
INSERT INTO public.gaas_agent_workflow_graph (from_role, to_role)
VALUES
    ('triage',     'diagnostic'),
    ('triage',     'compliance'),
    ('diagnostic', 'treatment'),
    ('diagnostic', 'compliance'),
    ('diagnostic', 'followup'),
    ('treatment',  'compliance'),
    ('treatment',  'followup'),
    ('treatment',  'billing'),
    ('followup',   'billing')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 5. Row Level Security
-- =============================================================================

ALTER TABLE public.gaas_agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gaas_agent_messages_service_all"
    ON public.gaas_agent_messages
    USING (TRUE)
    WITH CHECK (TRUE);

CREATE POLICY "gaas_agent_messages_tenant_read"
    ON public.gaas_agent_messages
    FOR SELECT
    USING (tenant_id::TEXT = current_setting('app.tenant_id', TRUE));

COMMENT ON TABLE public.gaas_agent_messages IS
    'Durable inter-agent message bus. Records all handoffs, consultations, alerts, and results between specialist agents.';

COMMENT ON TABLE public.gaas_agent_workflow_graph IS
    'Legal handoff paths between agent roles. Acts as a constraint reference for the coordinator.';
