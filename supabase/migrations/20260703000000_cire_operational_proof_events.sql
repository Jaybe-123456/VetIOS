create extension if not exists pgcrypto;

create table if not exists public.cire_operational_proof_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    proof_kind text not null,
    proof_target text not null,
    proof_status text not null default 'observed',
    runtime_environment text not null default 'unknown',
    deployment_ref text,
    git_sha text,
    cron_job_name text,
    cron_schedule text,
    cron_authorized_by text,
    started_at timestamptz,
    completed_at timestamptz,
    latency_ms integer not null default 0,
    records_processed integer not null default 0,
    schema_targets text[] not null default '{}',
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    proof_digest text not null,
    proof_packet jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint cire_operational_proof_events_tenant_request_kind_target_key
        unique (tenant_id, request_id, proof_kind, proof_target),
    constraint cire_operational_proof_events_kind_check
        check (proof_kind in (
            'cron_execution',
            'migration_application',
            'registry_population',
            'calibration_execution'
        )),
    constraint cire_operational_proof_events_status_check
        check (proof_status in ('observed', 'succeeded', 'failed', 'degraded', 'missing')),
    constraint cire_operational_proof_events_environment_check
        check (runtime_environment in ('unknown', 'local', 'preview', 'production', 'test')),
    constraint cire_operational_proof_events_counts_check
        check (latency_ms >= 0 and records_processed >= 0),
    constraint cire_operational_proof_events_digest_check
        check (proof_digest ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_cire_operational_proof_tenant_created
    on public.cire_operational_proof_events (tenant_id, created_at desc);

create index if not exists idx_cire_operational_proof_target_status
    on public.cire_operational_proof_events
        (proof_kind, proof_target, proof_status, observed_at desc);

create index if not exists idx_cire_operational_proof_cron_job
    on public.cire_operational_proof_events
        (cron_job_name, proof_status, observed_at desc)
    where cron_job_name is not null;

create index if not exists idx_cire_operational_proof_schema_targets_gin
    on public.cire_operational_proof_events using gin (schema_targets);

create index if not exists idx_cire_operational_proof_packet_gin
    on public.cire_operational_proof_events using gin (proof_packet);

create or replace function public.prevent_cire_operational_proof_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'cire_operational_proof_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_cire_operational_proof_events
    on public.cire_operational_proof_events;
create trigger enforce_immutability_cire_operational_proof_events
    before update or delete on public.cire_operational_proof_events
    for each row execute function public.prevent_cire_operational_proof_event_mutation();

alter table public.cire_operational_proof_events enable row level security;

drop policy if exists cire_operational_proof_events_select_tenant
    on public.cire_operational_proof_events;
create policy cire_operational_proof_events_select_tenant
    on public.cire_operational_proof_events
    for select using (tenant_id = auth.uid()::text);

drop policy if exists cire_operational_proof_events_insert_tenant
    on public.cire_operational_proof_events;
create policy cire_operational_proof_events_insert_tenant
    on public.cire_operational_proof_events
    for insert with check (tenant_id = auth.uid()::text);

drop policy if exists "service_role_cire_operational_proof_events"
    on public.cire_operational_proof_events;
create policy "service_role_cire_operational_proof_events"
    on public.cire_operational_proof_events for all to service_role using (true) with check (true);

comment on table public.cire_operational_proof_events is
    'Append-only CIRE operational proof ledger for cron execution, migration application, registry population, and calibration execution evidence.';

comment on column public.cire_operational_proof_events.proof_packet is
    'Sanitized, hash-stable operational proof packet. Store aggregate execution metadata, schema targets, warnings, and digests only; do not store credentials, PHI, owner data, raw clinical records, or raw model outputs.';

comment on column public.cire_operational_proof_events.proof_digest is
    'SHA-256 digest over stable sanitized proof inputs for external audit comparison.';

notify pgrst, 'reload schema';
