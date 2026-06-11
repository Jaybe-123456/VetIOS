-- VetIOS clinical dataset governance ledgers.
-- Adds append-only tenant learning consent events and async-ready real-case
-- import job tracking.

create extension if not exists pgcrypto;

create or replace function public.prevent_dataset_governance_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'dataset governance event table % is append-only; UPDATE and DELETE are not allowed', tg_table_name
        using errcode = '55000';
end;
$$;

create table if not exists public.tenant_learning_consent_events (
    id                uuid primary key default gen_random_uuid(),
    tenant_id         uuid not null references public.tenants(id) on delete cascade,
    consent_id        uuid references public.tenant_learning_consents(id) on delete set null,
    consent_scope     text not null check (
        consent_scope in ('deidentified_training', 'network_learning', 'population_signal')
    ),
    status            text not null check (status in ('granted', 'revoked')),
    previous_status   text check (previous_status in ('granted', 'revoked')),
    consent_version   text not null default 'vetios_learning_consent_v1',
    actor_user_id     uuid,
    actor_mode        text,
    event_source      text not null default 'clinical_dataset_network_learning_panel',
    request_id        text,
    policy_snapshot   jsonb not null default '{}'::jsonb,
    created_at        timestamptz not null default now()
);

create index if not exists idx_tenant_learning_consent_events_tenant_scope
    on public.tenant_learning_consent_events (tenant_id, consent_scope, created_at desc);

create index if not exists idx_tenant_learning_consent_events_request
    on public.tenant_learning_consent_events (request_id)
    where request_id is not null;

drop trigger if exists enforce_immutability_tenant_learning_consent_events
    on public.tenant_learning_consent_events;
create trigger enforce_immutability_tenant_learning_consent_events
    before update or delete on public.tenant_learning_consent_events
    for each row execute function public.prevent_dataset_governance_event_mutation();

create table if not exists public.clinical_case_import_jobs (
    id                          uuid primary key default gen_random_uuid(),
    tenant_id                   uuid not null references public.tenants(id) on delete cascade,
    user_id                     uuid,
    clinic_id                   uuid,
    source_name                 text,
    dry_run                     boolean not null default false,
    status                      text not null check (
        status in ('queued', 'validating', 'validated', 'importing', 'completed', 'failed')
    ),
    payload_hash                text not null,
    requested_cases             integer not null default 0 check (requested_cases >= 0),
    accepted_count              integer not null default 0 check (accepted_count >= 0),
    rejected_count              integer not null default 0 check (rejected_count >= 0),
    learning_ready_count        integer not null default 0 check (learning_ready_count >= 0),
    consent_required_rejections integer not null default 0 check (consent_required_rejections >= 0),
    phi_rejections              integer not null default 0 check (phi_rejections >= 0),
    report                      jsonb not null default '{}'::jsonb,
    error_message               text,
    created_at                  timestamptz not null default now(),
    started_at                  timestamptz,
    completed_at                timestamptz,
    updated_at                  timestamptz not null default now()
);

create index if not exists idx_clinical_case_import_jobs_tenant_created
    on public.clinical_case_import_jobs (tenant_id, created_at desc);

create index if not exists idx_clinical_case_import_jobs_status
    on public.clinical_case_import_jobs (tenant_id, status, updated_at desc);

create index if not exists idx_clinical_case_import_jobs_payload_hash
    on public.clinical_case_import_jobs (tenant_id, payload_hash, created_at desc);

drop trigger if exists set_updated_at_clinical_case_import_jobs
    on public.clinical_case_import_jobs;
create trigger set_updated_at_clinical_case_import_jobs
    before update on public.clinical_case_import_jobs
    for each row execute function public.trigger_set_updated_at();

create table if not exists public.clinical_case_import_job_events (
    id             uuid primary key default gen_random_uuid(),
    tenant_id      uuid not null references public.tenants(id) on delete cascade,
    import_job_id  uuid references public.clinical_case_import_jobs(id) on delete cascade,
    event_type     text not null,
    event_payload  jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now()
);

create index if not exists idx_clinical_case_import_job_events_job
    on public.clinical_case_import_job_events (import_job_id, created_at desc);

create index if not exists idx_clinical_case_import_job_events_tenant
    on public.clinical_case_import_job_events (tenant_id, created_at desc);

drop trigger if exists enforce_immutability_clinical_case_import_job_events
    on public.clinical_case_import_job_events;
create trigger enforce_immutability_clinical_case_import_job_events
    before update or delete on public.clinical_case_import_job_events
    for each row execute function public.prevent_dataset_governance_event_mutation();

alter table public.tenant_learning_consent_events enable row level security;
alter table public.clinical_case_import_jobs enable row level security;
alter table public.clinical_case_import_job_events enable row level security;

drop policy if exists tenant_learning_consent_events_tenant_scope
    on public.tenant_learning_consent_events;
create policy tenant_learning_consent_events_tenant_scope
    on public.tenant_learning_consent_events
    for all
    using (
        tenant_id = public.current_tenant_id()
        or auth.role() = 'service_role'
    )
    with check (
        tenant_id = public.current_tenant_id()
        or auth.role() = 'service_role'
    );

drop policy if exists clinical_case_import_jobs_tenant_scope
    on public.clinical_case_import_jobs;
create policy clinical_case_import_jobs_tenant_scope
    on public.clinical_case_import_jobs
    for all
    using (
        tenant_id = public.current_tenant_id()
        or auth.role() = 'service_role'
    )
    with check (
        tenant_id = public.current_tenant_id()
        or auth.role() = 'service_role'
    );

drop policy if exists clinical_case_import_job_events_tenant_scope
    on public.clinical_case_import_job_events;
create policy clinical_case_import_job_events_tenant_scope
    on public.clinical_case_import_job_events
    for all
    using (
        tenant_id = public.current_tenant_id()
        or auth.role() = 'service_role'
    )
    with check (
        tenant_id = public.current_tenant_id()
        or auth.role() = 'service_role'
    );

grant select, insert on public.tenant_learning_consent_events to authenticated, service_role;
grant select, insert, update on public.clinical_case_import_jobs to authenticated, service_role;
grant select, insert on public.clinical_case_import_job_events to authenticated, service_role;

notify pgrst, 'reload schema';
