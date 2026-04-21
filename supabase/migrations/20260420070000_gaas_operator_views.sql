-- =============================================================================
-- VetIOS GaaS — Migration 008: Operator Dashboard Views & Health RPCs
-- Timestamp: 20260420070000
-- Description: Creates summary views and health RPCs that power the GaaS
--   operator control plane dashboard — run stats, agent health, HITL queue
--   depth, memory store stats, and system-wide observability.
--
-- Prerequisites: All prior GaaS migrations (20260420000000–20260420060000)
-- =============================================================================

-- =============================================================================
-- 1. Agent Run Summary View
--    Powers the "Agent Runs" tab in the operator dashboard.
-- =============================================================================

CREATE OR REPLACE VIEW public.gaas_run_summary AS
SELECT
    r.tenant_id,
    r.agent_role::TEXT,
    r.status::TEXT,
    COUNT(*)                                              AS total_runs,
    COUNT(*) FILTER (WHERE r.status = 'completed')        AS completed,
    COUNT(*) FILTER (WHERE r.status = 'running')          AS active,
    COUNT(*) FILTER (WHERE r.status = 'awaiting_human')   AS awaiting_human,
    COUNT(*) FILTER (WHERE r.status = 'failed')           AS failed,
    ROUND(AVG(
        EXTRACT(EPOCH FROM (r.completed_at - r.started_at))
    ) FILTER (WHERE r.completed_at IS NOT NULL))           AS avg_duration_secs,
    MAX(r.started_at)                                     AS last_run_at
FROM public.gaas_agent_runs r
GROUP BY r.tenant_id, r.agent_role, r.status;

-- =============================================================================
-- 2. HITL Queue Depth View
--    Shows how many interrupts are pending per tenant and per agent role.
-- =============================================================================

CREATE OR REPLACE VIEW public.gaas_hitl_queue_depth AS
SELECT
    tenant_id,
    agent_role::TEXT,
    COUNT(*)                AS pending_count,
    MIN(created_at)         AS oldest_pending_at,
    MAX(created_at)         AS newest_pending_at,
    ROUND(AVG(
        EXTRACT(EPOCH FROM (NOW() - created_at)) / 60
    ))                      AS avg_wait_minutes
FROM public.gaas_hitl_interrupts
WHERE resolved_at IS NULL
GROUP BY tenant_id, agent_role;

-- =============================================================================
-- 3. Memory Store Stats View
--    Shows memory growth per patient and per tenant.
-- =============================================================================

CREATE OR REPLACE VIEW public.gaas_memory_stats AS
SELECT
    tenant_id,
    patient_id,
    type::TEXT              AS memory_type,
    COUNT(*)                AS entry_count,
    MIN(created_at)         AS first_entry_at,
    MAX(created_at)         AS latest_entry_at,
    COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_count,
    COUNT(*) FILTER (WHERE embedding IS NULL)     AS pending_embedding_count
FROM public.gaas_patient_memory
GROUP BY tenant_id, patient_id, type;

-- =============================================================================
-- 4. System Health RPC
--    Single call returns a full health snapshot for a tenant.
--    Called by the operator dashboard on load.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_system_health(
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_active_runs         BIGINT;
    v_pending_hitl        BIGINT;
    v_total_memory        BIGINT;
    v_unembedded_memory   BIGINT;
    v_runs_today          BIGINT;
    v_failed_today        BIGINT;
    v_tool_calls_today    BIGINT;
    v_p95_latency         NUMERIC;
BEGIN
    SELECT COUNT(*) INTO v_active_runs
    FROM public.gaas_agent_runs
    WHERE tenant_id = p_tenant_id AND status = 'running';

    SELECT COUNT(*) INTO v_pending_hitl
    FROM public.gaas_hitl_interrupts
    WHERE tenant_id = p_tenant_id AND resolved_at IS NULL;

    SELECT COUNT(*) INTO v_total_memory
    FROM public.gaas_patient_memory
    WHERE tenant_id = p_tenant_id;

    SELECT COUNT(*) INTO v_unembedded_memory
    FROM public.gaas_patient_memory
    WHERE tenant_id = p_tenant_id AND embedding IS NULL;

    SELECT COUNT(*) INTO v_runs_today
    FROM public.gaas_agent_runs
    WHERE tenant_id = p_tenant_id
      AND started_at >= CURRENT_DATE::TIMESTAMPTZ;

    SELECT COUNT(*) INTO v_failed_today
    FROM public.gaas_agent_runs
    WHERE tenant_id = p_tenant_id
      AND status = 'failed'
      AND started_at >= CURRENT_DATE::TIMESTAMPTZ;

    SELECT COUNT(*) INTO v_tool_calls_today
    FROM public.gaas_tool_calls
    WHERE tenant_id = p_tenant_id
      AND created_at >= CURRENT_DATE::TIMESTAMPTZ;

    SELECT ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))
    INTO v_p95_latency
    FROM public.gaas_tool_calls
    WHERE tenant_id  = p_tenant_id
      AND tool       = 'run_inference'
      AND status     = 'success'
      AND created_at >= NOW() - INTERVAL '24 hours';

    RETURN jsonb_build_object(
        'tenant_id',             p_tenant_id,
        'snapshot_at',           NOW(),
        'active_runs',           v_active_runs,
        'pending_hitl',          v_pending_hitl,
        'total_memory_entries',  v_total_memory,
        'unembedded_memory',     v_unembedded_memory,
        'runs_today',            v_runs_today,
        'failed_today',          v_failed_today,
        'tool_calls_today',      v_tool_calls_today,
        'inference_p95_ms',      v_p95_latency,
        'health_status',
            CASE
                WHEN v_pending_hitl > 10 THEN 'degraded'
                WHEN v_failed_today > 5  THEN 'warning'
                ELSE 'nominal'
            END
    );
END;
$$;

-- =============================================================================
-- 5. Recent Activity RPC
--    Returns the last N events across all GaaS tables for the activity feed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_recent_activity(
    p_tenant_id UUID,
    p_limit     INT DEFAULT 20
)
RETURNS TABLE (
    event_time  TIMESTAMPTZ,
    event_type  TEXT,
    description TEXT,
    patient_id  TEXT,
    run_id      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    -- Agent runs started
    SELECT started_at, 'agent_run_started',
           'Agent ' || agent_role::TEXT || ' started for patient ' || patient_id,
           patient_id, run_id
    FROM public.gaas_agent_runs
    WHERE tenant_id = p_tenant_id

    UNION ALL

    -- HITL interrupts raised
    SELECT created_at, 'hitl_raised',
           'HITL interrupt raised: ' || LEFT(reason, 80),
           patient_id, agent_run_id
    FROM public.gaas_hitl_interrupts
    WHERE tenant_id = p_tenant_id

    UNION ALL

    -- HITL interrupts resolved
    SELECT resolved_at, 'hitl_resolved',
           'HITL resolved as ' || resolution::TEXT || ' by ' || COALESCE(resolved_by, 'unknown'),
           patient_id, agent_run_id
    FROM public.gaas_hitl_interrupts
    WHERE tenant_id   = p_tenant_id
      AND resolved_at IS NOT NULL

    UNION ALL

    -- Tool calls
    SELECT created_at, 'tool_call',
           'Tool ' || tool::TEXT || ' → ' || status::TEXT
           || COALESCE(' (' || latency_ms::TEXT || 'ms)', ''),
           patient_id, run_id
    FROM public.gaas_tool_calls
    WHERE tenant_id = p_tenant_id

    ORDER BY event_time DESC
    LIMIT p_limit;
$$;

COMMENT ON VIEW public.gaas_run_summary IS
    'Per-tenant, per-role, per-status aggregation of agent runs. Powers the runs tab in the operator dashboard.';

COMMENT ON VIEW public.gaas_hitl_queue_depth IS
    'Pending HITL interrupt counts and wait times per tenant and agent role.';

COMMENT ON FUNCTION public.gaas_system_health IS
    'Single-call system health snapshot for a tenant. Returns active runs, pending HITL, memory stats, and inference latency.';

COMMENT ON FUNCTION public.gaas_recent_activity IS
    'Unified activity feed across agent runs, tool calls, and HITL events for the operator dashboard.';
