-- Developer API partner runtime
-- Promotes partner billing, quota counters, usage analytics, and versioned
-- contract metadata from the manual bundle into the normal migration chain.

create extension if not exists pgcrypto;

create table if not exists public.api_partner_plans (
    id uuid primary key default gen_random_uuid(),
    name text not null unique check (name in ('sandbox', 'clinic', 'research', 'enterprise')),
    display_name text not null,
    requests_per_minute integer not null check (requests_per_minute >= 0),
    requests_per_month integer not null check (requests_per_month >= 0),
    burst_allowance integer not null default 0 check (burst_allowance >= 0),
    price_per_1k_requests numeric(10, 4),
    flat_monthly_usd numeric(10, 2),
    stripe_price_id text,
    features jsonb not null default '{}'::jsonb,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.api_partners (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    org_type text,
    plan_id uuid references public.api_partner_plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    billing_email text not null,
    status text not null default 'active' check (status in ('active', 'suspended', 'trial', 'cancelled')),
    trial_ends_at timestamptz,
    current_period_start timestamptz,
    current_period_end timestamptz,
    created_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.api_usage_events (
    id uuid primary key default gen_random_uuid(),
    partner_id uuid references public.api_partners(id) on delete set null,
    credential_id uuid references public.api_credentials(id) on delete set null,
    endpoint text not null,
    method text not null,
    status_code integer not null,
    response_time_ms integer,
    request_size_bytes integer,
    response_size_bytes integer,
    region text,
    aggregate_type text,
    is_billable boolean not null default true,
    billed_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.api_quota_counters (
    partner_id uuid not null references public.api_partners(id) on delete cascade,
    window_type text not null check (window_type in ('minute', 'month')),
    window_start timestamptz not null,
    count integer not null default 0 check (count >= 0),
    primary key (partner_id, window_type, window_start)
);

create table if not exists public.api_changelog (
    id uuid primary key default gen_random_uuid(),
    version text not null,
    released_at timestamptz not null,
    breaking boolean not null default false,
    summary text not null,
    changes jsonb not null,
    sunset_version text,
    sunset_date timestamptz
);

create table if not exists public.api_contract_versions (
    id uuid primary key default gen_random_uuid(),
    contract_key text not null default 'vetios-partner-api',
    version text not null,
    status text not null default 'published' check (status in ('draft', 'published', 'deprecated', 'retired')),
    base_url text not null default 'https://www.vetios.tech',
    openapi_url text not null default 'https://www.vetios.tech/api-spec/openapi-v1.yaml',
    json_contract_url text not null default 'https://www.vetios.tech/api/public/developer-contract',
    version_headers jsonb not null default '{}'::jsonb,
    quota_headers jsonb not null default '{}'::jsonb,
    changelog jsonb not null default '[]'::jsonb,
    released_at timestamptz not null default now(),
    deprecated_at timestamptz,
    retired_at timestamptz,
    created_at timestamptz not null default now(),
    constraint api_contract_versions_key unique (contract_key, version)
);

alter table public.api_credentials
    add column if not exists partner_id uuid references public.api_partners(id) on delete cascade,
    add column if not exists is_active boolean not null default true;

update public.api_credentials
set is_active = case
    when revoked_at is not null then false
    when status is distinct from 'active' then false
    else true
end
where is_active is distinct from case
    when revoked_at is not null then false
    when status is distinct from 'active' then false
    else true
end;

insert into public.api_partner_plans (
    name,
    display_name,
    requests_per_minute,
    requests_per_month,
    burst_allowance,
    price_per_1k_requests,
    flat_monthly_usd,
    features
)
values
    (
        'sandbox',
        'Sandbox',
        10,
        500,
        5,
        0,
        0,
        '{"inference":true,"outcomes":false,"dataset":false,"petpass":false,"simulation":false}'::jsonb
    ),
    (
        'clinic',
        'Clinic Integration',
        60,
        10000,
        20,
        0,
        149,
        '{"inference":true,"outcomes":true,"dataset":false,"petpass":true,"simulation":false}'::jsonb
    ),
    (
        'research',
        'Research & Academic',
        120,
        50000,
        50,
        0,
        1000,
        '{"inference":true,"outcomes":true,"dataset":true,"petpass":true,"simulation":true}'::jsonb
    ),
    (
        'enterprise',
        'Enterprise',
        1000,
        5000000,
        200,
        0.50,
        0,
        '{"inference":true,"outcomes":true,"dataset":true,"petpass":true,"simulation":true}'::jsonb
    )
on conflict (name) do update
set
    display_name = excluded.display_name,
    requests_per_minute = excluded.requests_per_minute,
    requests_per_month = excluded.requests_per_month,
    burst_allowance = excluded.burst_allowance,
    price_per_1k_requests = excluded.price_per_1k_requests,
    flat_monthly_usd = excluded.flat_monthly_usd,
    features = excluded.features,
    is_active = true;

insert into public.api_partners (
    id,
    name,
    org_type,
    plan_id,
    billing_email,
    status,
    trial_ends_at,
    created_at,
    metadata
)
select
    partner.id,
    partner.display_name,
    coalesce(nullif(partner.metadata ->> 'org_type', ''), 'pims_vendor'),
    plan.id,
    coalesce(nullif(partner.contact_email, ''), 'billing+' || partner.id::text || '@vetios.tech'),
    case
        when partner.status = 'active' then 'active'
        when partner.status = 'suspended' then 'suspended'
        else 'trial'
    end,
    case
        when partner.status = 'prospect' then now() + interval '30 days'
        else null
    end,
    coalesce(partner.created_at, now()),
    jsonb_strip_nulls(
        coalesce(partner.metadata, '{}'::jsonb)
        || jsonb_build_object(
            'owner_tenant_id', partner.tenant_id,
            'source_partner_organization_id', partner.id,
            'website_url', partner.website_url,
            'contact_name', partner.contact_name,
            'contact_email', partner.contact_email
        )
    )
from public.partner_organizations partner
join public.api_partner_plans plan
    on plan.name = case
        when partner.partner_tier = 'sandbox' then 'sandbox'
        when partner.partner_tier = 'strategic' then 'enterprise'
        else 'clinic'
    end
on conflict (id) do update
set
    name = excluded.name,
    org_type = excluded.org_type,
    plan_id = excluded.plan_id,
    billing_email = excluded.billing_email,
    status = excluded.status,
    trial_ends_at = excluded.trial_ends_at,
    metadata = coalesce(public.api_partners.metadata, '{}'::jsonb) || excluded.metadata;

update public.api_credentials credential
set partner_id = link.partner_organization_id
from public.partner_service_account_links link
where credential.service_account_id = link.service_account_id
  and credential.partner_id is null;

update public.api_credentials
set scopes = (
    select array(
        select distinct scope_value
        from unnest(
            coalesce(api_credentials.scopes, '{}'::text[])
            || case when coalesce(api_credentials.scopes, '{}'::text[]) && array['inference:write'] then array['inference'] else array[]::text[] end
            || case when coalesce(api_credentials.scopes, '{}'::text[]) && array['outcome:write'] then array['outcomes'] else array[]::text[] end
            || case when coalesce(api_credentials.scopes, '{}'::text[]) && array['simulation:write'] then array['simulation'] else array[]::text[] end
            || case when coalesce(api_credentials.scopes, '{}'::text[]) && array['evaluation:read', 'evaluation:write'] then array['dataset'] else array[]::text[] end
            || case when coalesce(api_credentials.scopes, '{}'::text[]) && array['signals:connect', 'signals:ingest'] then array['petpass'] else array[]::text[] end
        ) as scope_value
    )
)
where scopes is not null;

do $$
begin
    if not exists (
        select 1
        from public.api_changelog
        where version = '1.0.0'
    ) then
        insert into public.api_changelog (
            version,
            released_at,
            breaking,
            summary,
            changes
        )
        values (
            '1.0.0',
            now(),
            false,
            'Initial public release of VetIOS Clinical Intelligence API',
            '[
              {"type":"added","description":"POST /v1/inference/differential - ranked clinical differential diagnosis"},
              {"type":"added","description":"POST /v1/inference/drug-check - species-specific drug interaction and dosing"},
              {"type":"added","description":"POST /v1/inference/adversarial - adversarial simulation for edge cases"},
              {"type":"added","description":"POST /v1/outcomes/contribute - federated outcome contribution"},
              {"type":"added","description":"GET /v1/dataset/prevalence - regional disease prevalence queries"},
              {"type":"added","description":"GET /v1/models/card - live model performance metrics"},
              {"type":"added","description":"POST /v1/petpass/sync - push visit record to PetPass"},
              {"type":"added","description":"GET /v1/petpass/history/{pet_id} - retrieve pet health history"},
              {"type":"added","description":"GET /v1/usage/quota and /v1/usage/analytics - partner quota and lifecycle analytics"}
            ]'::jsonb
        );
    end if;
end $$;

insert into public.api_contract_versions (
    contract_key,
    version,
    status,
    version_headers,
    quota_headers,
    changelog
)
values (
    'vetios-partner-api',
    '1.0.0',
    'published',
    '{
        "API-Version":"1.0.0",
        "API-Supported-Versions":"1.0.0",
        "API-Deprecation-Policy":"https://www.vetios.tech/developer/versioning"
    }'::jsonb,
    '{
        "X-RateLimit-Limit":"requests per minute",
        "X-RateLimit-Remaining":"remaining requests in the minute window",
        "X-Quota-Limit":"requests per month",
        "X-Quota-Remaining":"remaining requests in the monthly window",
        "X-Partner-Plan":"active API partner plan"
    }'::jsonb,
    '[
      {"type":"added","description":"Partner billing plans, quota counters, usage events, and versioned contract metadata are now in the normal migration chain."}
    ]'::jsonb
)
on conflict (contract_key, version) do update
set
    status = excluded.status,
    version_headers = excluded.version_headers,
    quota_headers = excluded.quota_headers,
    changelog = excluded.changelog;

create index if not exists idx_api_partners_status_plan
    on public.api_partners (status, plan_id, created_at desc);

create index if not exists idx_api_partners_owner_tenant
    on public.api_partners ((metadata ->> 'owner_tenant_id'));

create index if not exists idx_api_usage_events_partner_created_at
    on public.api_usage_events (partner_id, created_at desc);

create index if not exists idx_api_usage_events_endpoint_created_at
    on public.api_usage_events (endpoint, created_at desc);

create index if not exists idx_api_usage_events_partner_billable
    on public.api_usage_events (partner_id, is_billable, billed_at);

create index if not exists idx_api_quota_counters_lookup
    on public.api_quota_counters (partner_id, window_type, window_start);

create index if not exists idx_api_contract_versions_status
    on public.api_contract_versions (contract_key, status, released_at desc);

create index if not exists idx_api_credentials_partner_status
    on public.api_credentials (partner_id, status, created_at desc)
    where partner_id is not null;

create or replace function public.increment_api_quota_counters(
    p_partner_id uuid,
    p_minute_window_start timestamptz,
    p_month_window_start timestamptz
)
returns table (
    minute_count integer,
    month_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.api_quota_counters (partner_id, window_type, window_start, count)
    values (p_partner_id, 'minute', p_minute_window_start, 1)
    on conflict (partner_id, window_type, window_start)
    do update set count = public.api_quota_counters.count + 1;

    insert into public.api_quota_counters (partner_id, window_type, window_start, count)
    values (p_partner_id, 'month', p_month_window_start, 1)
    on conflict (partner_id, window_type, window_start)
    do update set count = public.api_quota_counters.count + 1;

    return query
    select
        coalesce((
            select count
            from public.api_quota_counters
            where partner_id = p_partner_id
              and window_type = 'minute'
              and window_start = p_minute_window_start
        ), 0),
        coalesce((
            select count
            from public.api_quota_counters
            where partner_id = p_partner_id
              and window_type = 'month'
              and window_start = p_month_window_start
        ), 0);
end;
$$;

create or replace function public.api_usage_timeseries(
    p_partner_id uuid,
    p_days integer default 30,
    p_endpoint text default null,
    p_granularity text default 'day'
)
returns table (
    window_start timestamptz,
    count bigint,
    avg_ms numeric
)
language sql
stable
set search_path = public
as $$
    select
        date_trunc(case when p_granularity = 'hour' then 'hour' else 'day' end, created_at) as window_start,
        count(*) as count,
        avg(response_time_ms)::numeric as avg_ms
    from public.api_usage_events
    where partner_id = p_partner_id
      and created_at >= now() - make_interval(days => greatest(1, p_days))
      and (p_endpoint is null or endpoint = p_endpoint)
    group by 1
    order by 1 asc;
$$;

alter table public.api_partner_plans enable row level security;
alter table public.api_partners enable row level security;
alter table public.api_usage_events enable row level security;
alter table public.api_quota_counters enable row level security;
alter table public.api_changelog enable row level security;
alter table public.api_contract_versions enable row level security;

revoke all on public.api_partner_plans from public, anon, authenticated;
revoke all on public.api_partners from public, anon, authenticated;
revoke all on public.api_usage_events from public, anon, authenticated;
revoke all on public.api_quota_counters from public, anon, authenticated;
revoke all on public.api_changelog from public, anon, authenticated;
revoke all on public.api_contract_versions from public, anon, authenticated;

grant all on public.api_partner_plans to service_role;
grant all on public.api_partners to service_role;
grant all on public.api_usage_events to service_role;
grant all on public.api_quota_counters to service_role;
grant all on public.api_changelog to service_role;
grant all on public.api_contract_versions to service_role;

revoke all on function public.increment_api_quota_counters(uuid, timestamptz, timestamptz)
    from public, anon, authenticated;
revoke all on function public.api_usage_timeseries(uuid, integer, text, text)
    from public, anon, authenticated;

grant execute on function public.increment_api_quota_counters(uuid, timestamptz, timestamptz)
    to service_role;
grant execute on function public.api_usage_timeseries(uuid, integer, text, text)
    to service_role;

notify pgrst, 'reload schema';
