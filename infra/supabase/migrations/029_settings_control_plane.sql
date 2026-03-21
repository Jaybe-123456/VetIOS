-- =============================================================================
-- Migration 029: VetIOS Settings Control Plane
-- Centralized config, API keys, and control-action audit storage for /settings
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

create table if not exists public.control_plane_configs (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    latency_threshold_ms integer not null default 900 check (latency_threshold_ms between 50 and 10000),
    drift_threshold double precision not null default 0.2 check (drift_threshold between 0 and 1),
    confidence_threshold double precision not null default 0.65 check (confidence_threshold between 0 and 1),
    alert_sensitivity text not null default 'balanced' check (alert_sensitivity in ('low', 'balanced', 'high')),
    simulation_enabled boolean not null default false,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint control_plane_configs_tenant_key unique (tenant_id)
);

create table if not exists public.control_plane_api_keys (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    label text not null,
    key_prefix text not null,
    key_hash text not null,
    scopes text[] not null default '{}'::text[],
    status text not null default 'active' check (status in ('active', 'revoked')),
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    revoked_by text,
    last_used_at timestamptz,
    created_at timestamptz not null default now(),
    revoked_at timestamptz,
    constraint control_plane_api_keys_key_hash_key unique (key_hash)
);

create table if not exists public.control_plane_action_log (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    actor text,
    action_type text not null,
    target_type text,
    target_id text,
    status text not null default 'completed' check (status in ('requested', 'completed', 'failed')),
    requires_confirmation boolean not null default false,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_control_plane_api_keys_tenant_status
    on public.control_plane_api_keys (tenant_id, status, created_at desc);

create index if not exists idx_control_plane_action_log_tenant_created
    on public.control_plane_action_log (tenant_id, created_at desc);

create index if not exists idx_control_plane_action_log_tenant_action
    on public.control_plane_action_log (tenant_id, action_type, created_at desc);

drop trigger if exists set_updated_at_control_plane_configs on public.control_plane_configs;
create trigger set_updated_at_control_plane_configs
    before update on public.control_plane_configs
    for each row execute function public.trigger_set_updated_at();

alter table public.control_plane_configs enable row level security;
alter table public.control_plane_api_keys enable row level security;
alter table public.control_plane_action_log enable row level security;

drop policy if exists control_plane_configs_select_own on public.control_plane_configs;
create policy control_plane_configs_select_own
    on public.control_plane_configs
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists control_plane_configs_insert_own on public.control_plane_configs;
create policy control_plane_configs_insert_own
    on public.control_plane_configs
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists control_plane_configs_update_own on public.control_plane_configs;
create policy control_plane_configs_update_own
    on public.control_plane_configs
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists control_plane_api_keys_select_own on public.control_plane_api_keys;
create policy control_plane_api_keys_select_own
    on public.control_plane_api_keys
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists control_plane_api_keys_insert_own on public.control_plane_api_keys;
create policy control_plane_api_keys_insert_own
    on public.control_plane_api_keys
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists control_plane_api_keys_update_own on public.control_plane_api_keys;
create policy control_plane_api_keys_update_own
    on public.control_plane_api_keys
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists control_plane_action_log_select_own on public.control_plane_action_log;
create policy control_plane_action_log_select_own
    on public.control_plane_action_log
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists control_plane_action_log_insert_own on public.control_plane_action_log;
create policy control_plane_action_log_insert_own
    on public.control_plane_action_log
    for insert with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
