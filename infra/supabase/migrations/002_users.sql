-- 002_users.sql
-- Users table: veterinarians, technicians, and administrators.

CREATE TYPE public.user_role AS ENUM ('vet', 'tech', 'admin');

CREATE TABLE public.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  auth_user_id  UUID UNIQUE,  -- Links to Supabase Auth user
  email         TEXT NOT NULL,
  role          public.user_role NOT NULL DEFAULT 'vet',
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_tenant ON public.users(tenant_id);
CREATE INDEX idx_users_auth ON public.users(auth_user_id);

-- RLS: users can only see members of their own tenant
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_tenant"
  ON public.users FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "users_insert_own_tenant"
  ON public.users FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "users_update_own_tenant"
  ON public.users FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
