-- =============================================================================
-- VetIOS GaaS — Migration 001: Foundation
-- Timestamp: 20260420000000
-- Description: Enables pgvector, creates the gaas_tenant_config table which
--   extends the existing tenants table with GaaS-specific agent settings,
--   active agent roster, and per-role policy overrides.
--
-- Prerequisites: tenants table must exist (from base schema).
-- =============================================================================

-- Enable pgvector for semantic memory search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pgcrypto for gen_random_uuid() if not already present
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. GaaS Tenant Config
--    Extends the existing `tenants` table with GaaS-specific configuration.
--    Uses tenant_id as a FK to tenants.id so every GaaS config is anchored
--    to an existing VetIOS tenant.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.gaas_tenant_config (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    active_agents     TEXT[] NOT NULL DEFAULT ARRAY['triage', 'diagnostic']::TEXT[],
    default_policies  JSONB NOT NULL DEFAULT '{}'::JSONB,
    webhook_url       TEXT,
    alert_email       TEXT,
    plan              TEXT NOT NULL DEFAULT 'starter'
                      CHECK (plan IN ('starter', 'growth', 'enterprise')),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT gaas_tenant_config_tenant_unique UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_gaas_tenant_config_tenant_id
    ON public.gaas_tenant_config (tenant_id);

CREATE INDEX IF NOT EXISTS idx_gaas_tenant_config_active
    ON public.gaas_tenant_config (is_active)
    WHERE is_active = TRUE;

-- =============================================================================
-- 2. updated_at trigger for gaas_tenant_config
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gaas_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gaas_tenant_config_updated_at ON public.gaas_tenant_config;
CREATE TRIGGER gaas_tenant_config_updated_at
    BEFORE UPDATE ON public.gaas_tenant_config
    FOR EACH ROW EXECUTE FUNCTION public.gaas_set_updated_at();

-- =============================================================================
-- 3. Row Level Security
-- =============================================================================

ALTER TABLE public.gaas_tenant_config ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by backend API workers)
CREATE POLICY "gaas_tenant_config_service_all"
    ON public.gaas_tenant_config
    USING (TRUE)
    WITH CHECK (TRUE);

-- Tenant-scoped read: users can only read their own tenant config
CREATE POLICY "gaas_tenant_config_tenant_read"
    ON public.gaas_tenant_config
    FOR SELECT
    USING (tenant_id::TEXT = current_setting('app.tenant_id', TRUE));

COMMENT ON TABLE public.gaas_tenant_config IS
    'GaaS-specific configuration per tenant. Extends tenants with active agent roster and per-role policy overrides.';
