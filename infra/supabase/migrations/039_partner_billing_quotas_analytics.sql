create extension if not exists pgcrypto;

create table if not exists public.api_partner_plans (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    display_name text not null,
    requests_per_minute integer not null,
    requests_per_month integer not null,
    burst_allowance integer not null,
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
    status text not null default 'active',
    trial_ends_at timestamptz,
    current_period_start timestamptz,
    current_period_end timestamptz,
    created_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.api_usage_events (
    id uuid primary key default gen_random_uuid(),
    partner_id uuid references public.api_partners(id),
    credential_id uuid references public.api_credentials(id),
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
    partner_id uuid references public.api_partners(id),
    window_type text not null,
    window_start timestamptz not null,
    count integer not null default 0,
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
        'Clinic Integration - $149/mo',
        60,
        10000,
        20,
        0,
        149,
        '{"inference":true,"outcomes":true,"dataset":false,"petpass":true,"simulation":false}'::jsonb
    ),
    (
        'research',
        'Research & Academic - $1,000/mo',
        120,
        50000,
        50,
        0,
        1000,
        '{"inference":true,"outcomes":true,"dataset":true,"petpass":true,"simulation":true}'::jsonb
    ),
    (
        'enterprise',
        'Enterprise - custom pricing',
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
      {"type":"added","description":"GET /v1/petpass/history/{pet_id} - retrieve pet health history"}
    ]'::jsonb
)
on conflict do nothing;

create index if not exists idx_api_usage_events_partner_created_at
    on public.api_usage_events (partner_id, created_at desc);

create index if not exists idx_api_usage_events_endpoint_created_at
    on public.api_usage_events (endpoint, created_at desc);

create index if not exists idx_api_usage_events_partner_billable
    on public.api_usage_events (partner_id, is_billable, billed_at);

create index if not exists idx_api_quota_counters_lookup
    on public.api_quota_counters (partner_id, window_type, window_start);

do $$
begin
    if not exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'api_credentials'
          and indexname = 'idx_api_credentials_key_hash'
    ) then
        create index idx_api_credentials_key_hash on public.api_credentials (key_hash);
    end if;
end $$;

create unique index if not exists idx_api_changelog_version
    on public.api_changelog (version);

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

grant execute on function public.increment_api_quota_counters(uuid, timestamptz, timestamptz)
    to anon, authenticated, service_role;
grant execute on function public.api_usage_timeseries(uuid, integer, text, text)
    to anon, authenticated, service_role;

notify pgrst, 'reload schema';
