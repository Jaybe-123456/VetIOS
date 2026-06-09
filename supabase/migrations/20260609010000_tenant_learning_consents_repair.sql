-- Repair migration for the Clinical Dataset network-learning consent workspace.
-- This table is required by /dataset, /api/clinical/learning-consent, and /api/dataset/case-import.

create table if not exists public.tenant_learning_consents (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    consent_scope text not null check (
        consent_scope in ('deidentified_training', 'network_learning', 'population_signal')
    ),
    status text not null check (status in ('granted', 'revoked')),
    consent_version text not null default 'vetios_learning_consent_v1',
    granted_by uuid references public.users(id) on delete set null,
    revoked_by uuid references public.users(id) on delete set null,
    policy_snapshot jsonb not null default '{}'::jsonb,
    granted_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, consent_scope, consent_version)
);

create index if not exists idx_tenant_learning_consents_active
    on public.tenant_learning_consents (tenant_id, consent_scope, status, updated_at desc);

alter table public.tenant_learning_consents enable row level security;

drop policy if exists tenant_learning_consents_tenant_isolation
    on public.tenant_learning_consents;

create policy tenant_learning_consents_tenant_isolation
    on public.tenant_learning_consents
    for all
    using (
        tenant_id = auth.uid()
        or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        or auth.role() = 'service_role'
    )
    with check (
        tenant_id = auth.uid()
        or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        or auth.role() = 'service_role'
    );

grant select, insert, update on public.tenant_learning_consents to authenticated, service_role;

notify pgrst, 'reload schema';
