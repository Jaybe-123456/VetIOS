-- =============================================================================
-- Migration 030: Self-Healing Decision Engine
-- Persistent node-state sync, autonomous decision records, execution audit, and
-- control-plane configuration for self-healing behaviors.
-- =============================================================================

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

alter table public.control_plane_configs
    add column if not exists decision_mode text not null default 'observe',
    add column if not exists safe_mode_enabled boolean not null default false,
    add column if not exists abstain_threshold double precision not null default 0.8,
    add column if not exists auto_execute_confidence_threshold double precision not null default 0.9;

alter table public.control_plane_configs
    drop constraint if exists control_plane_configs_decision_mode_check;

alter table public.control_plane_configs
    add constraint control_plane_configs_decision_mode_check
    check (decision_mode in ('observe', 'assist', 'autonomous'));

alter table public.control_plane_configs
    drop constraint if exists control_plane_configs_abstain_threshold_check;

alter table public.control_plane_configs
    add constraint control_plane_configs_abstain_threshold_check
    check (abstain_threshold between 0 and 1);

alter table public.control_plane_configs
    drop constraint if exists control_plane_configs_auto_execute_confidence_threshold_check;

alter table public.control_plane_configs
    add constraint control_plane_configs_auto_execute_confidence_threshold_check
    check (auto_execute_confidence_threshold between 0 and 1);

update public.control_plane_configs
set
    decision_mode = coalesce(nullif(decision_mode, ''), 'observe'),
    safe_mode_enabled = coalesce(safe_mode_enabled, false),
    abstain_threshold = coalesce(abstain_threshold, 0.8),
    auto_execute_confidence_threshold = coalesce(auto_execute_confidence_threshold, 0.9);

alter table public.model_registry
    drop constraint if exists model_registry_role_check;

alter table public.model_registry
    drop constraint if exists model_registry_registry_role_check;

alter table public.model_registry
    add constraint model_registry_role_check
    check (role in ('champion', 'challenger', 'experimental', 'rollback_target', 'at_risk'));

alter table public.model_registry
    add constraint model_registry_registry_role_check
    check (registry_role in ('champion', 'challenger', 'experimental', 'rollback_target', 'at_risk'));

create table if not exists public.topology_node_states (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    node_id text not null,
    node_type text not null,
    status text not null,
    latency double precision,
    throughput double precision,
    error_rate double precision,
    drift_score double precision,
    confidence_avg double precision,
    last_updated timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint topology_node_states_tenant_node_key unique (tenant_id, node_id),
    constraint topology_node_states_node_type_check
        check (node_type in ('model', 'clinic', 'dataset', 'simulation_cluster', 'master', 'control', 'registry', 'telemetry', 'data', 'decision', 'outcome', 'simulation')),
    constraint topology_node_states_status_check
        check (status in ('healthy', 'degraded', 'critical', 'offline'))
);

create table if not exists public.decision_engine (
    decision_id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    decision_key text not null,
    trigger_event text not null,
    condition text not null,
    action text not null,
    confidence double precision not null,
    mode text not null default 'observe',
    source_node_id text,
    source_node_type text,
    model_family text,
    registry_id text,
    run_id text,
    timestamp timestamptz not null default now(),
    status text not null default 'pending',
    requires_approval boolean not null default false,
    blocked_reason text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint decision_engine_tenant_decision_key_key unique (tenant_id, decision_key),
    constraint decision_engine_mode_check check (mode in ('observe', 'assist', 'autonomous')),
    constraint decision_engine_status_check check (status in ('pending', 'executed', 'blocked')),
    constraint decision_engine_confidence_check check (confidence between 0 and 1)
);

create table if not exists public.decision_audit_log (
    id uuid primary key default gen_random_uuid(),
    decision_id uuid not null references public.decision_engine(decision_id) on delete cascade,
    tenant_id text not null,
    trigger text not null,
    action text not null,
    executed_at timestamptz not null default now(),
    result text not null,
    actor text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint decision_audit_log_result_check check (result in ('success', 'failed')),
    constraint decision_audit_log_actor_check check (actor in ('system', 'user'))
);

create index if not exists idx_topology_node_states_tenant_updated
    on public.topology_node_states (tenant_id, updated_at desc);

create index if not exists idx_decision_engine_tenant_timestamp
    on public.decision_engine (tenant_id, timestamp desc);

create index if not exists idx_decision_engine_tenant_status
    on public.decision_engine (tenant_id, status, updated_at desc);

create index if not exists idx_decision_audit_log_tenant_executed
    on public.decision_audit_log (tenant_id, executed_at desc);

drop trigger if exists set_updated_at_topology_node_states on public.topology_node_states;
create trigger set_updated_at_topology_node_states
    before update on public.topology_node_states
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_decision_engine on public.decision_engine;
create trigger set_updated_at_decision_engine
    before update on public.decision_engine
    for each row execute function public.trigger_set_updated_at();

alter table public.topology_node_states enable row level security;
alter table public.decision_engine enable row level security;
alter table public.decision_audit_log enable row level security;

drop policy if exists topology_node_states_select_own on public.topology_node_states;
create policy topology_node_states_select_own
    on public.topology_node_states
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists topology_node_states_insert_own on public.topology_node_states;
create policy topology_node_states_insert_own
    on public.topology_node_states
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists topology_node_states_update_own on public.topology_node_states;
create policy topology_node_states_update_own
    on public.topology_node_states
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists decision_engine_select_own on public.decision_engine;
create policy decision_engine_select_own
    on public.decision_engine
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists decision_engine_insert_own on public.decision_engine;
create policy decision_engine_insert_own
    on public.decision_engine
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists decision_engine_update_own on public.decision_engine;
create policy decision_engine_update_own
    on public.decision_engine
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists decision_audit_log_select_own on public.decision_audit_log;
create policy decision_audit_log_select_own
    on public.decision_audit_log
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists decision_audit_log_insert_own on public.decision_audit_log;
create policy decision_audit_log_insert_own
    on public.decision_audit_log
    for insert with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
