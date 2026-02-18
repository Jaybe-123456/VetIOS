-- 003_clients_patients.sql
-- Clients (animal owners) and Patients (animals).

CREATE TABLE public.clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  contact     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_tenant ON public.clients(tenant_id);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select_own_tenant"
  ON public.clients FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "clients_insert_own_tenant"
  ON public.clients FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "clients_update_own_tenant"
  ON public.clients FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());


CREATE TABLE public.patients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  species         TEXT NOT NULL,
  breed           TEXT,
  weight_kg       NUMERIC(8,2),
  date_of_birth   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patients_tenant ON public.patients(tenant_id);
CREATE INDEX idx_patients_client ON public.patients(client_id);

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients_select_own_tenant"
  ON public.patients FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "patients_insert_own_tenant"
  ON public.patients FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "patients_update_own_tenant"
  ON public.patients FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER set_patients_updated_at
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
