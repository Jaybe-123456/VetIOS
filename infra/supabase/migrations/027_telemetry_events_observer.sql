-- =============================================================================
-- Migration 027: Telemetry Events Observer
-- Unified event pipeline for ingestion, aggregation, streaming, and UI state.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.telemetry_events (
    event_id text primary key,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    linked_event_id text references public.telemetry_events(event_id) on delete set null,
    event_type text not null check (event_type in ('inference', 'outcome', 'system', 'training')),
    "timestamp" timestamptz not null default now(),
    model_version text not null,
    run_id text not null,
    metrics jsonb not null default '{}'::jsonb,
    system jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_telemetry_events_tenant_timestamp
    on public.telemetry_events (tenant_id, "timestamp" desc);

create index if not exists idx_telemetry_events_tenant_type_timestamp
    on public.telemetry_events (tenant_id, event_type, "timestamp" desc);

create index if not exists idx_telemetry_events_linked
    on public.telemetry_events (tenant_id, linked_event_id)
    where linked_event_id is not null;

create index if not exists idx_telemetry_events_model_version
    on public.telemetry_events (tenant_id, model_version, "timestamp" desc);

alter table public.telemetry_events enable row level security;

drop policy if exists telemetry_events_select_own on public.telemetry_events;
create policy telemetry_events_select_own
    on public.telemetry_events
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists telemetry_events_insert_own on public.telemetry_events;
create policy telemetry_events_insert_own
    on public.telemetry_events
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists telemetry_events_update_own on public.telemetry_events;
create policy telemetry_events_update_own
    on public.telemetry_events
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

notify pgrst, 'reload schema';
