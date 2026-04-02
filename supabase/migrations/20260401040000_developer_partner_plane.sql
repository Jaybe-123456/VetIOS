-- Migration: Developer Partner Plane
-- Description: Adds partner organizations, published API products,
-- onboarding requests, and partner-service-account links.

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

create table if not exists public.partner_organizations (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    legal_name text not null,
    display_name text not null,
    website_url text,
    contact_name text,
    contact_email text,
    status text not null default 'prospect' check (status in ('prospect', 'active', 'suspended')),
    partner_tier text not null default 'sandbox' check (partner_tier in ('sandbox', 'production', 'strategic')),
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.partner_api_products (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    product_key text not null,
    title text not null,
    summary text not null,
    access_tier text not null default 'sandbox' check (access_tier in ('sandbox', 'production', 'strategic')),
    status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
    documentation_url text,
    default_scopes text[] not null default '{}'::text[],
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint partner_api_products_key unique (tenant_id, product_key)
);

create table if not exists public.partner_onboarding_requests (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    partner_organization_id uuid references public.partner_organizations(id) on delete set null,
    company_name text not null,
    contact_name text not null,
    contact_email text not null,
    use_case text not null,
    requested_products text[] not null default '{}'::text[],
    requested_scopes text[] not null default '{}'::text[],
    status text not null default 'requested' check (status in ('requested', 'reviewing', 'approved', 'rejected')),
    notes text,
    reviewed_by text,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.partner_service_account_links (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    partner_organization_id uuid not null references public.partner_organizations(id) on delete cascade,
    service_account_id uuid not null references public.service_accounts(id) on delete cascade,
    onboarding_request_id uuid references public.partner_onboarding_requests(id) on delete set null,
    environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
    created_by text,
    created_at timestamptz not null default now(),
    constraint partner_service_account_links_unique unique (tenant_id, partner_organization_id, service_account_id, environment)
);

create index if not exists idx_partner_organizations_tenant_status
    on public.partner_organizations (tenant_id, status, updated_at desc);

create index if not exists idx_partner_api_products_tenant_status
    on public.partner_api_products (tenant_id, status, updated_at desc);

create index if not exists idx_partner_onboarding_requests_tenant_status
    on public.partner_onboarding_requests (tenant_id, status, created_at desc);

create index if not exists idx_partner_service_account_links_tenant
    on public.partner_service_account_links (tenant_id, partner_organization_id, created_at desc);

drop trigger if exists set_updated_at_partner_organizations on public.partner_organizations;
create trigger set_updated_at_partner_organizations
    before update on public.partner_organizations
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_partner_api_products on public.partner_api_products;
create trigger set_updated_at_partner_api_products
    before update on public.partner_api_products
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_partner_onboarding_requests on public.partner_onboarding_requests;
create trigger set_updated_at_partner_onboarding_requests
    before update on public.partner_onboarding_requests
    for each row execute function public.trigger_set_updated_at();

alter table public.partner_organizations enable row level security;
alter table public.partner_api_products enable row level security;
alter table public.partner_onboarding_requests enable row level security;
alter table public.partner_service_account_links enable row level security;

drop policy if exists partner_organizations_select_own on public.partner_organizations;
create policy partner_organizations_select_own
    on public.partner_organizations
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_organizations_insert_own on public.partner_organizations;
create policy partner_organizations_insert_own
    on public.partner_organizations
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_organizations_update_own on public.partner_organizations;
create policy partner_organizations_update_own
    on public.partner_organizations
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_api_products_select_own on public.partner_api_products;
create policy partner_api_products_select_own
    on public.partner_api_products
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_api_products_insert_own on public.partner_api_products;
create policy partner_api_products_insert_own
    on public.partner_api_products
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_api_products_update_own on public.partner_api_products;
create policy partner_api_products_update_own
    on public.partner_api_products
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_onboarding_requests_select_own on public.partner_onboarding_requests;
create policy partner_onboarding_requests_select_own
    on public.partner_onboarding_requests
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_onboarding_requests_insert_own on public.partner_onboarding_requests;
create policy partner_onboarding_requests_insert_own
    on public.partner_onboarding_requests
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_onboarding_requests_update_own on public.partner_onboarding_requests;
create policy partner_onboarding_requests_update_own
    on public.partner_onboarding_requests
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_service_account_links_select_own on public.partner_service_account_links;
create policy partner_service_account_links_select_own
    on public.partner_service_account_links
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists partner_service_account_links_insert_own on public.partner_service_account_links;
create policy partner_service_account_links_insert_own
    on public.partner_service_account_links
    for insert with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
