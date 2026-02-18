-- 001_tenants.sql
-- Tenants table: represents clinics, hospitals, or veterinary networks.

CREATE TABLE public.tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper function: sets tenant context for RLS policies
CREATE OR REPLACE FUNCTION public.set_tenant_context(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.tenant_id', tenant_id::TEXT, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: retrieves current tenant context
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- RLS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Tenants are readable by authenticated users who belong to them (verified via users table join).
-- Direct tenant management is restricted to service role.
CREATE POLICY "tenants_select_own"
  ON public.tenants FOR SELECT
  USING (
    id = public.current_tenant_id()
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
