-- Passive Signal native vendor adapter control plane
-- Adds tenant-scoped native vendor connections and sync run ledgers.
-- Raw OAuth codes, access tokens, refresh tokens, and API keys are never stored.

create extension if not exists pgcrypto;

create table if not exists public.passive_native_vendor_connections (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    adapter_key text not null,
    connector_installation_id uuid references public.connector_installations(id) on delete set null,
    vendor_name text not null,
    vendor_account_ref text,
    auth_protocol text not null check (auth_protocol in ('oauth2_pkce', 'oauth2_client_credentials', 'api_key', 'sftp_drop')),
    status text not null default 'authorization_required' check (status in ('authorization_required', 'active', 'paused', 'revoked', 'error')),
    authorization_state_hash text,
    credential_ref_hash text,
    requested_scopes text[] not null default '{}',
    adapter_runtime_url text,
    supported_connector_types text[] not null default '{}',
    sync_mode text not null default 'scheduled_pull' check (sync_mode in ('webhook_push', 'scheduled_pull', 'manual_file_drop')),
    interval_hours integer check (interval_hours is null or interval_hours > 0),
    next_sync_at timestamptz,
    last_authorized_at timestamptz,
    last_sync_at timestamptz,
    last_sync_status text,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.passive_native_vendor_sync_runs (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    native_connection_id uuid not null references public.passive_native_vendor_connections(id) on delete cascade,
    connector_installation_id uuid references public.connector_installations(id) on delete set null,
    adapter_key text not null,
    run_reason text not null check (run_reason in ('manual', 'scheduled', 'authorization_callback', 'backfill')),
    status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
    requested_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz,
    events_ingested integer not null default 0 check (events_ingested >= 0),
    outbox_event_id uuid references public.outbox_events(id) on delete set null,
    error_message text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_passive_native_connections_tenant_status
    on public.passive_native_vendor_connections (tenant_id, status, updated_at desc);

create unique index if not exists idx_passive_native_connections_unique
    on public.passive_native_vendor_connections (tenant_id, adapter_key, coalesce(vendor_account_ref, ''));

create index if not exists idx_passive_native_connections_adapter
    on public.passive_native_vendor_connections (adapter_key, status, next_sync_at);

create index if not exists idx_passive_native_connections_state_hash
    on public.passive_native_vendor_connections (authorization_state_hash)
    where authorization_state_hash is not null;

create index if not exists idx_passive_native_sync_runs_connection
    on public.passive_native_vendor_sync_runs (tenant_id, native_connection_id, requested_at desc);

create index if not exists idx_passive_native_sync_runs_due
    on public.passive_native_vendor_sync_runs (tenant_id, status, requested_at desc);

drop trigger if exists set_updated_at_passive_native_vendor_connections on public.passive_native_vendor_connections;
create trigger set_updated_at_passive_native_vendor_connections
    before update on public.passive_native_vendor_connections
    for each row execute function public.trigger_set_updated_at();

alter table public.passive_native_vendor_connections enable row level security;
alter table public.passive_native_vendor_sync_runs enable row level security;

drop policy if exists passive_native_vendor_connections_select_own on public.passive_native_vendor_connections;
create policy passive_native_vendor_connections_select_own
    on public.passive_native_vendor_connections
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists passive_native_vendor_connections_insert_own on public.passive_native_vendor_connections;
create policy passive_native_vendor_connections_insert_own
    on public.passive_native_vendor_connections
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists passive_native_vendor_connections_update_own on public.passive_native_vendor_connections;
create policy passive_native_vendor_connections_update_own
    on public.passive_native_vendor_connections
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists passive_native_vendor_sync_runs_select_own on public.passive_native_vendor_sync_runs;
create policy passive_native_vendor_sync_runs_select_own
    on public.passive_native_vendor_sync_runs
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists passive_native_vendor_sync_runs_insert_own on public.passive_native_vendor_sync_runs;
create policy passive_native_vendor_sync_runs_insert_own
    on public.passive_native_vendor_sync_runs
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists passive_native_vendor_sync_runs_update_own on public.passive_native_vendor_sync_runs;
create policy passive_native_vendor_sync_runs_update_own
    on public.passive_native_vendor_sync_runs
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
