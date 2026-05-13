-- Outcome flywheel hardening.
-- Makes confirmed clinician outcomes first-class labels for model calibration,
-- canonical clinical cases, and de-identified network learning consent.

alter table public.ai_inference_events
    add column if not exists outcome_confirmed boolean not null default false,
    add column if not exists outcome_confirmed_at timestamptz,
    add column if not exists confirmed_diagnosis text,
    add column if not exists prediction_correct boolean,
    add column if not exists calibration_delta double precision,
    add column if not exists outcome_resolved boolean not null default false;

create index if not exists idx_ai_inference_events_outcome_confirmed_tenant
    on public.ai_inference_events (tenant_id, outcome_confirmed, created_at desc);

create index if not exists idx_ai_inference_events_confirmed_diagnosis
    on public.ai_inference_events (tenant_id, confirmed_diagnosis)
    where confirmed_diagnosis is not null;

create index if not exists idx_clinical_cases_confirmed_learning_ready
    on public.clinical_cases (tenant_id, confirmed_diagnosis, updated_at desc)
    where confirmed_diagnosis is not null
      and prediction_correct is not null;

create table if not exists public.tenant_learning_consents (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    consent_scope text not null check (
        consent_scope in ('deidentified_training', 'network_learning', 'population_signal')
    ),
    status text not null check (status in ('granted', 'revoked')),
    consent_version text not null,
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

drop policy if exists tenant_learning_consents_tenant_isolation on public.tenant_learning_consents;
create policy tenant_learning_consents_tenant_isolation
    on public.tenant_learning_consents
    for all
    using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        or auth.role() = 'service_role'
    )
    with check (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        or auth.role() = 'service_role'
    );

notify pgrst, 'reload schema';
