create extension if not exists pgcrypto;

create table if not exists public.oauth_clients (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    client_id text not null,
    client_secret_hash text not null,
    client_name text not null,
    status text not null default 'active',
    allowed_scopes text[] not null default '{}',
    token_ttl_seconds integer not null default 900,
    allowed_origins text[] not null default '{}',
    allowed_ip_cidrs text[] not null default '{}',
    jwks jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    revoked_by text,
    last_used_at timestamptz,
    rotated_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint oauth_clients_client_id_key unique (client_id),
    constraint oauth_clients_status_check
        check (status in ('active', 'disabled', 'revoked')),
    constraint oauth_clients_ttl_check
        check (token_ttl_seconds between 60 and 3600),
    constraint oauth_clients_secret_hash_check
        check (client_secret_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_oauth_clients_tenant_status
    on public.oauth_clients (tenant_id, status, created_at desc);

create index if not exists idx_oauth_clients_scopes_gin
    on public.oauth_clients using gin (allowed_scopes);

create table if not exists public.oauth_access_tokens (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    oauth_client_id uuid not null references public.oauth_clients(id) on delete cascade,
    token_hash text not null,
    token_prefix text not null,
    scopes text[] not null default '{}',
    audience text,
    status text not null default 'active',
    issued_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    last_introspected_at timestamptz,
    ip_hash text,
    user_agent_hash text,
    evidence jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint oauth_access_tokens_hash_key unique (token_hash),
    constraint oauth_access_tokens_status_check
        check (status in ('active', 'revoked', 'expired')),
    constraint oauth_access_tokens_hash_check
        check (
            token_hash ~ '^[a-f0-9]{64}$'
            and (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$')
            and (user_agent_hash is null or user_agent_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_oauth_access_tokens_client_status
    on public.oauth_access_tokens (oauth_client_id, status, expires_at desc);

create index if not exists idx_oauth_access_tokens_tenant_created
    on public.oauth_access_tokens (tenant_id, created_at desc);

create index if not exists idx_oauth_access_tokens_scopes_gin
    on public.oauth_access_tokens using gin (scopes);

create table if not exists public.oauth_client_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    oauth_client_id uuid references public.oauth_clients(id) on delete set null,
    client_id text,
    actor_user_id uuid,
    lifecycle_event text not null,
    status text not null default 'active',
    allowed_scopes text[] not null default '{}',
    token_ttl_seconds integer,
    risk_level text not null default 'medium',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint oauth_client_events_lifecycle_check
        check (lifecycle_event in (
            'registered',
            'secret_rotated',
            'disabled',
            'revoked',
            'scope_changed',
            'anomaly_detected'
        )),
    constraint oauth_client_events_status_check
        check (status in ('active', 'disabled', 'revoked')),
    constraint oauth_client_events_risk_check
        check (risk_level in ('low', 'medium', 'high', 'critical'))
);

create index if not exists idx_oauth_client_events_tenant_created
    on public.oauth_client_events (tenant_id, created_at desc);

create index if not exists idx_oauth_client_events_client
    on public.oauth_client_events (oauth_client_id, observed_at desc)
    where oauth_client_id is not null;

create index if not exists idx_oauth_client_events_evidence_gin
    on public.oauth_client_events using gin (evidence);

create table if not exists public.oauth_token_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    oauth_client_id uuid references public.oauth_clients(id) on delete set null,
    oauth_access_token_id uuid references public.oauth_access_tokens(id) on delete set null,
    token_prefix text,
    lifecycle_event text not null,
    token_status text not null default 'active',
    scopes text[] not null default '{}',
    audience text,
    expires_at timestamptz,
    ip_hash text,
    user_agent_hash text,
    risk_level text not null default 'low',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint oauth_token_events_lifecycle_check
        check (lifecycle_event in (
            'issued',
            'introspected',
            'revoked',
            'expired',
            'rejected',
            'anomaly_detected'
        )),
    constraint oauth_token_events_status_check
        check (token_status in ('active', 'revoked', 'expired', 'rejected')),
    constraint oauth_token_events_risk_check
        check (risk_level in ('low', 'medium', 'high', 'critical')),
    constraint oauth_token_events_hash_check
        check (
            (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$')
            and (user_agent_hash is null or user_agent_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_oauth_token_events_tenant_created
    on public.oauth_token_events (tenant_id, created_at desc);

create index if not exists idx_oauth_token_events_client
    on public.oauth_token_events (oauth_client_id, lifecycle_event, observed_at desc)
    where oauth_client_id is not null;

create index if not exists idx_oauth_token_events_token
    on public.oauth_token_events (oauth_access_token_id, observed_at desc)
    where oauth_access_token_id is not null;

create index if not exists idx_oauth_token_events_evidence_gin
    on public.oauth_token_events using gin (evidence);

drop trigger if exists set_updated_at_oauth_clients on public.oauth_clients;
create trigger set_updated_at_oauth_clients
    before update on public.oauth_clients
    for each row execute function public.trigger_set_updated_at();

create or replace function public.prevent_oauth_trust_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'oauth trust event ledgers are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_oauth_client_events
    on public.oauth_client_events;
create trigger enforce_immutability_oauth_client_events
    before update or delete on public.oauth_client_events
    for each row execute function public.prevent_oauth_trust_event_mutation();

drop trigger if exists enforce_immutability_oauth_token_events
    on public.oauth_token_events;
create trigger enforce_immutability_oauth_token_events
    before update or delete on public.oauth_token_events
    for each row execute function public.prevent_oauth_trust_event_mutation();

alter table public.oauth_clients enable row level security;
alter table public.oauth_access_tokens enable row level security;
alter table public.oauth_client_events enable row level security;
alter table public.oauth_token_events enable row level security;

drop policy if exists oauth_clients_select_tenant on public.oauth_clients;
create policy oauth_clients_select_tenant
    on public.oauth_clients
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists oauth_clients_insert_tenant on public.oauth_clients;
create policy oauth_clients_insert_tenant
    on public.oauth_clients
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists oauth_clients_update_tenant on public.oauth_clients;
create policy oauth_clients_update_tenant
    on public.oauth_clients
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_oauth_clients" on public.oauth_clients;
create policy "service_role_oauth_clients"
    on public.oauth_clients for all to service_role using (true) with check (true);

drop policy if exists oauth_access_tokens_select_tenant on public.oauth_access_tokens;
create policy oauth_access_tokens_select_tenant
    on public.oauth_access_tokens
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists oauth_access_tokens_insert_tenant on public.oauth_access_tokens;
create policy oauth_access_tokens_insert_tenant
    on public.oauth_access_tokens
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists oauth_access_tokens_update_tenant on public.oauth_access_tokens;
create policy oauth_access_tokens_update_tenant
    on public.oauth_access_tokens
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_oauth_access_tokens" on public.oauth_access_tokens;
create policy "service_role_oauth_access_tokens"
    on public.oauth_access_tokens for all to service_role using (true) with check (true);

drop policy if exists oauth_client_events_select_tenant on public.oauth_client_events;
create policy oauth_client_events_select_tenant
    on public.oauth_client_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists oauth_client_events_insert_tenant on public.oauth_client_events;
create policy oauth_client_events_insert_tenant
    on public.oauth_client_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_oauth_client_events" on public.oauth_client_events;
create policy "service_role_oauth_client_events"
    on public.oauth_client_events for all to service_role using (true) with check (true);

drop policy if exists oauth_token_events_select_tenant on public.oauth_token_events;
create policy oauth_token_events_select_tenant
    on public.oauth_token_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists oauth_token_events_insert_tenant on public.oauth_token_events;
create policy oauth_token_events_insert_tenant
    on public.oauth_token_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_oauth_token_events" on public.oauth_token_events;
create policy "service_role_oauth_token_events"
    on public.oauth_token_events for all to service_role using (true) with check (true);

comment on table public.oauth_clients is
    'Tenant-scoped OAuth client-credentials registry for short-lived scoped machine access to VetIOS APIs.';

comment on table public.oauth_access_tokens is
    'Hashed short-lived OAuth access token registry for client-credentials flows. Stores token hashes and prefixes only, never raw bearer tokens.';

comment on table public.oauth_client_events is
    'Append-only OAuth client lifecycle ledger for registration, rotation, revocation, scope changes, and anomaly evidence.';

comment on table public.oauth_token_events is
    'Append-only OAuth token lifecycle ledger for issuance, introspection, revocation, expiry, rejection, and anomaly evidence.';

notify pgrst, 'reload schema';
