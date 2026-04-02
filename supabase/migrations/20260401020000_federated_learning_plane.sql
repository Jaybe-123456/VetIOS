-- Migration: Federated Learning Plane
-- Description: Adds tenant federation memberships, site snapshots,
-- aggregation rounds, and federated model-delta artifacts.

create extension if not exists pgcrypto;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'current_tenant_id'
    ) then
        execute $fn$
            create function public.current_tenant_id()
            returns uuid
            language sql
            stable
            as $inner$
                select coalesce(
                    nullif(current_setting('app.tenant_id', true), '')::uuid,
                    auth.uid()
                )
            $inner$;
        $fn$;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'trigger_set_updated_at'
    ) then
        execute $fn$
            create function public.trigger_set_updated_at()
            returns trigger
            language plpgsql
            as $inner$
            begin
                new.updated_at = now();
                return new;
            end;
            $inner$;
        $fn$;
    end if;
end $$;

create table if not exists public.federation_memberships (
    id uuid primary key default gen_random_uuid(),
    federation_key text not null,
    tenant_id text not null,
    coordinator_tenant_id text not null,
    status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
    participation_mode text not null default 'full' check (participation_mode in ('full', 'shadow')),
    weight double precision not null default 1 check (weight > 0),
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    last_snapshot_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint federation_memberships_key unique (federation_key, tenant_id)
);

create table if not exists public.federated_site_snapshots (
    id uuid primary key default gen_random_uuid(),
    federation_key text not null,
    tenant_id text not null,
    coordinator_tenant_id text not null,
    snapshot_window_start timestamptz,
    snapshot_window_end timestamptz not null,
    dataset_version text,
    dataset_versions integer not null default 0 check (dataset_versions >= 0),
    total_dataset_rows integer not null default 0 check (total_dataset_rows >= 0),
    benchmark_reports integer not null default 0 check (benchmark_reports >= 0),
    calibration_reports integer not null default 0 check (calibration_reports >= 0),
    audit_events integer not null default 0 check (audit_events >= 0),
    champion_models integer not null default 0 check (champion_models >= 0),
    support_summary jsonb not null default '{}'::jsonb,
    quality_summary jsonb not null default '{}'::jsonb,
    snapshot_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.federation_rounds (
    id uuid primary key default gen_random_uuid(),
    federation_key text not null,
    coordinator_tenant_id text not null,
    round_key text not null,
    status text not null default 'collecting' check (status in ('collecting', 'aggregating', 'completed', 'failed')),
    aggregation_strategy text not null default 'weighted_mean_v1',
    snapshot_cutoff_at timestamptz,
    participant_count integer not null default 0 check (participant_count >= 0),
    aggregate_payload jsonb not null default '{}'::jsonb,
    candidate_artifact_payload jsonb not null default '{}'::jsonb,
    notes text,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint federation_rounds_key unique (federation_key, round_key)
);

create table if not exists public.model_delta_artifacts (
    id uuid primary key default gen_random_uuid(),
    federation_round_id uuid not null references public.federation_rounds(id) on delete cascade,
    federation_key text not null,
    coordinator_tenant_id text not null,
    tenant_id text,
    artifact_role text not null check (artifact_role in ('site_delta', 'aggregate_candidate')),
    task_type text not null,
    model_version text,
    dataset_version text,
    artifact_payload jsonb not null default '{}'::jsonb,
    summary jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_federation_memberships_tenant
    on public.federation_memberships (tenant_id, status, updated_at desc);

create index if not exists idx_federation_memberships_coordinator
    on public.federation_memberships (coordinator_tenant_id, status, updated_at desc);

create index if not exists idx_federated_site_snapshots_lookup
    on public.federated_site_snapshots (federation_key, tenant_id, created_at desc);

create index if not exists idx_federation_rounds_lookup
    on public.federation_rounds (federation_key, started_at desc);

create index if not exists idx_model_delta_artifacts_round
    on public.model_delta_artifacts (federation_round_id, artifact_role, created_at desc);

drop trigger if exists set_updated_at_federation_memberships on public.federation_memberships;
create trigger set_updated_at_federation_memberships
    before update on public.federation_memberships
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_federation_rounds on public.federation_rounds;
create trigger set_updated_at_federation_rounds
    before update on public.federation_rounds
    for each row execute function public.trigger_set_updated_at();

alter table public.federation_memberships enable row level security;
alter table public.federated_site_snapshots enable row level security;
alter table public.federation_rounds enable row level security;
alter table public.model_delta_artifacts enable row level security;

drop policy if exists federation_memberships_select_participant on public.federation_memberships;
create policy federation_memberships_select_participant
    on public.federation_memberships
    for select using (
        tenant_id = public.current_tenant_id()::text
        or coordinator_tenant_id = public.current_tenant_id()::text
    );

drop policy if exists federation_memberships_insert_own on public.federation_memberships;
create policy federation_memberships_insert_own
    on public.federation_memberships
    for insert with check (
        tenant_id = public.current_tenant_id()::text
        or coordinator_tenant_id = public.current_tenant_id()::text
    );

drop policy if exists federation_memberships_update_participant on public.federation_memberships;
create policy federation_memberships_update_participant
    on public.federation_memberships
    for update
    using (
        tenant_id = public.current_tenant_id()::text
        or coordinator_tenant_id = public.current_tenant_id()::text
    )
    with check (
        tenant_id = public.current_tenant_id()::text
        or coordinator_tenant_id = public.current_tenant_id()::text
    );

drop policy if exists federated_site_snapshots_select_participant on public.federated_site_snapshots;
create policy federated_site_snapshots_select_participant
    on public.federated_site_snapshots
    for select using (
        tenant_id = public.current_tenant_id()::text
        or coordinator_tenant_id = public.current_tenant_id()::text
    );

drop policy if exists federated_site_snapshots_insert_participant on public.federated_site_snapshots;
create policy federated_site_snapshots_insert_participant
    on public.federated_site_snapshots
    for insert with check (
        tenant_id = public.current_tenant_id()::text
        or coordinator_tenant_id = public.current_tenant_id()::text
    );

drop policy if exists federation_rounds_select_participant on public.federation_rounds;
create policy federation_rounds_select_participant
    on public.federation_rounds
    for select using (coordinator_tenant_id = public.current_tenant_id()::text);

drop policy if exists federation_rounds_insert_coordinator on public.federation_rounds;
create policy federation_rounds_insert_coordinator
    on public.federation_rounds
    for insert with check (coordinator_tenant_id = public.current_tenant_id()::text);

drop policy if exists federation_rounds_update_coordinator on public.federation_rounds;
create policy federation_rounds_update_coordinator
    on public.federation_rounds
    for update
    using (coordinator_tenant_id = public.current_tenant_id()::text)
    with check (coordinator_tenant_id = public.current_tenant_id()::text);

drop policy if exists model_delta_artifacts_select_participant on public.model_delta_artifacts;
create policy model_delta_artifacts_select_participant
    on public.model_delta_artifacts
    for select using (
        coordinator_tenant_id = public.current_tenant_id()::text
        or tenant_id = public.current_tenant_id()::text
    );

drop policy if exists model_delta_artifacts_insert_participant on public.model_delta_artifacts;
create policy model_delta_artifacts_insert_participant
    on public.model_delta_artifacts
    for insert with check (
        coordinator_tenant_id = public.current_tenant_id()::text
        or tenant_id = public.current_tenant_id()::text
    );

notify pgrst, 'reload schema';
