-- Migration: Machine API Auth
-- Description: Adds service accounts, scoped API credentials,
-- and connector installation auth for non-human VetIOS integrations.

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

create table if not exists public.service_accounts (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    name text not null,
    description text,
    status text not null default 'active' check (status in ('active', 'disabled', 'revoked')),
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    last_used_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.connector_installations (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    installation_name text not null,
    connector_type text not null,
    vendor_name text,
    vendor_account_ref text,
    status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    last_used_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.api_credentials (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    principal_type text not null check (principal_type in ('service_account', 'connector_installation')),
    service_account_id uuid references public.service_accounts(id) on delete cascade,
    connector_installation_id uuid references public.connector_installations(id) on delete cascade,
    label text not null,
    key_prefix text not null,
    key_hash text not null,
    scopes text[] not null default '{}'::text[],
    status text not null default 'active' check (status in ('active', 'revoked')),
    expires_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    revoked_by text,
    last_used_at timestamptz,
    created_at timestamptz not null default now(),
    revoked_at timestamptz,
    constraint api_credentials_key_hash_key unique (key_hash),
    constraint api_credentials_single_principal check (
        (
            principal_type = 'service_account'
            and service_account_id is not null
            and connector_installation_id is null
        )
        or (
            principal_type = 'connector_installation'
            and connector_installation_id is not null
            and service_account_id is null
        )
    )
);

create index if not exists idx_service_accounts_tenant_status
    on public.service_accounts (tenant_id, status, created_at desc);

create index if not exists idx_connector_installations_tenant_status
    on public.connector_installations (tenant_id, connector_type, status, created_at desc);

create unique index if not exists idx_connector_installations_tenant_vendor_ref
    on public.connector_installations (tenant_id, connector_type, coalesce(vendor_name, ''), coalesce(vendor_account_ref, ''));

create index if not exists idx_api_credentials_tenant_status
    on public.api_credentials (tenant_id, principal_type, status, created_at desc);

create index if not exists idx_api_credentials_service_account
    on public.api_credentials (service_account_id, status, created_at desc)
    where service_account_id is not null;

create index if not exists idx_api_credentials_connector_installation
    on public.api_credentials (connector_installation_id, status, created_at desc)
    where connector_installation_id is not null;

drop trigger if exists set_updated_at_service_accounts on public.service_accounts;
create trigger set_updated_at_service_accounts
    before update on public.service_accounts
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_connector_installations on public.connector_installations;
create trigger set_updated_at_connector_installations
    before update on public.connector_installations
    for each row execute function public.trigger_set_updated_at();

alter table public.service_accounts enable row level security;
alter table public.connector_installations enable row level security;
alter table public.api_credentials enable row level security;

drop policy if exists service_accounts_select_own on public.service_accounts;
create policy service_accounts_select_own
    on public.service_accounts
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists service_accounts_insert_own on public.service_accounts;
create policy service_accounts_insert_own
    on public.service_accounts
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists service_accounts_update_own on public.service_accounts;
create policy service_accounts_update_own
    on public.service_accounts
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists connector_installations_select_own on public.connector_installations;
create policy connector_installations_select_own
    on public.connector_installations
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists connector_installations_insert_own on public.connector_installations;
create policy connector_installations_insert_own
    on public.connector_installations
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists connector_installations_update_own on public.connector_installations;
create policy connector_installations_update_own
    on public.connector_installations
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists api_credentials_select_own on public.api_credentials;
create policy api_credentials_select_own
    on public.api_credentials
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists api_credentials_insert_own on public.api_credentials;
create policy api_credentials_insert_own
    on public.api_credentials
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists api_credentials_update_own on public.api_credentials;
create policy api_credentials_update_own
    on public.api_credentials
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
