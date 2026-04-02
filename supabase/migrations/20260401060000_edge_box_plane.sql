-- Migration: Edge Box Plane
-- Description: Adds offline edge node registry, sync jobs,
-- and artifact staging metadata.

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

create table if not exists public.edge_boxes (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    node_name text not null,
    site_label text not null,
    hardware_class text,
    status text not null default 'provisioning' check (status in ('provisioning', 'online', 'degraded', 'offline', 'retired')),
    software_version text,
    last_heartbeat_at timestamptz,
    last_sync_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint edge_boxes_node_unique unique (tenant_id, node_name)
);

create table if not exists public.edge_sync_jobs (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    edge_box_id uuid not null references public.edge_boxes(id) on delete cascade,
    job_type text not null check (job_type in ('telemetry_flush', 'model_bundle', 'dataset_delta', 'config_sync')),
    direction text not null check (direction in ('cloud_to_edge', 'edge_to_cloud')),
    status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
    payload jsonb not null default '{}'::jsonb,
    scheduled_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    error_message text,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.edge_sync_artifacts (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    edge_box_id uuid references public.edge_boxes(id) on delete cascade,
    artifact_type text not null check (artifact_type in ('model_bundle', 'dataset_delta', 'config_bundle', 'telemetry_archive')),
    artifact_ref text not null,
    content_hash text not null,
    size_bytes bigint not null default 0 check (size_bytes >= 0),
    status text not null default 'staged' check (status in ('staged', 'synced', 'failed', 'expired')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    synced_at timestamptz,
    updated_at timestamptz not null default now()
);

create index if not exists idx_edge_boxes_tenant_status
    on public.edge_boxes (tenant_id, status, updated_at desc);

create index if not exists idx_edge_sync_jobs_tenant_status
    on public.edge_sync_jobs (tenant_id, status, scheduled_at desc);

create index if not exists idx_edge_sync_artifacts_tenant_status
    on public.edge_sync_artifacts (tenant_id, status, created_at desc);

drop trigger if exists set_updated_at_edge_boxes on public.edge_boxes;
create trigger set_updated_at_edge_boxes
    before update on public.edge_boxes
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_edge_sync_jobs on public.edge_sync_jobs;
create trigger set_updated_at_edge_sync_jobs
    before update on public.edge_sync_jobs
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_edge_sync_artifacts on public.edge_sync_artifacts;
create trigger set_updated_at_edge_sync_artifacts
    before update on public.edge_sync_artifacts
    for each row execute function public.trigger_set_updated_at();

alter table public.edge_boxes enable row level security;
alter table public.edge_sync_jobs enable row level security;
alter table public.edge_sync_artifacts enable row level security;

drop policy if exists edge_boxes_select_own on public.edge_boxes;
create policy edge_boxes_select_own
    on public.edge_boxes
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_boxes_insert_own on public.edge_boxes;
create policy edge_boxes_insert_own
    on public.edge_boxes
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_boxes_update_own on public.edge_boxes;
create policy edge_boxes_update_own
    on public.edge_boxes
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_sync_jobs_select_own on public.edge_sync_jobs;
create policy edge_sync_jobs_select_own
    on public.edge_sync_jobs
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_sync_jobs_insert_own on public.edge_sync_jobs;
create policy edge_sync_jobs_insert_own
    on public.edge_sync_jobs
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_sync_jobs_update_own on public.edge_sync_jobs;
create policy edge_sync_jobs_update_own
    on public.edge_sync_jobs
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_sync_artifacts_select_own on public.edge_sync_artifacts;
create policy edge_sync_artifacts_select_own
    on public.edge_sync_artifacts
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_sync_artifacts_insert_own on public.edge_sync_artifacts;
create policy edge_sync_artifacts_insert_own
    on public.edge_sync_artifacts
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_sync_artifacts_update_own on public.edge_sync_artifacts;
create policy edge_sync_artifacts_update_own
    on public.edge_sync_artifacts
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
