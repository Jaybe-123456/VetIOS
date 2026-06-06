-- VetIOS product entitlements and clinical usage metering.
-- Additive monetization foundation for clinical, research, developer, and federation products.

create extension if not exists pgcrypto;

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

create table if not exists public.product_plan_limits (
    plan_key text primary key,
    display_name text not null,
    description text not null,
    monthly_diagnosis_limit integer,
    monthly_price_usd numeric(10, 2),
    features jsonb not null default '{}'::jsonb,
    is_public boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint product_plan_limits_plan_key_check
        check (plan_key in ('free', 'clinic', 'practice', 'research', 'developer', 'federation', 'enterprise')),
    constraint product_plan_limits_limit_check
        check (monthly_diagnosis_limit is null or monthly_diagnosis_limit >= 0)
);

drop trigger if exists set_updated_at_product_plan_limits on public.product_plan_limits;
create trigger set_updated_at_product_plan_limits
    before update on public.product_plan_limits
    for each row execute function public.trigger_set_updated_at();

insert into public.product_plan_limits
    (plan_key, display_name, description, monthly_diagnosis_limit, monthly_price_usd, features, is_public, sort_order)
values
    (
        'free',
        'Free',
        'Clinical trial workspace for individual veterinarians.',
        30,
        0,
        '{"clinical_cases":true,"voice_capture":false,"soap_notes":false,"ask_vetios":true,"console":false,"api":false,"federation":false}'::jsonb,
        true,
        10
    ),
    (
        'clinic',
        'Clinic',
        'Core workflow for one active clinic.',
        300,
        49,
        '{"clinical_cases":true,"voice_capture":true,"soap_notes":true,"ask_vetios":true,"console":false,"api":false,"federation":false}'::jsonb,
        true,
        20
    ),
    (
        'practice',
        'Practice',
        'Unlimited clinical workspace for multi-vet practices.',
        null,
        149,
        '{"clinical_cases":true,"voice_capture":true,"soap_notes":true,"ask_vetios":true,"patient_records":true,"petpass":true,"console":false,"api":false,"federation":false}'::jsonb,
        true,
        30
    ),
    (
        'research',
        'Research',
        'Validation, cohort review, datasets, and clinical intelligence analytics.',
        null,
        499,
        '{"clinical_cases":true,"voice_capture":true,"soap_notes":true,"ask_vetios":true,"datasets":true,"model_trust":true,"console":true,"api":false,"federation":false}'::jsonb,
        true,
        40
    ),
    (
        'developer',
        'Developer',
        'API access, webhooks, SDK usage, sandbox credentials, and rate limits.',
        null,
        149,
        '{"clinical_cases":true,"voice_capture":true,"soap_notes":true,"ask_vetios":true,"console":true,"api":true,"webhooks":true,"developer_portal":true,"federation":false}'::jsonb,
        true,
        50
    ),
    (
        'federation',
        'Federation Partner',
        'Shared learning networks for schools, NGOs, governments, and surveillance groups.',
        null,
        null,
        '{"clinical_cases":true,"voice_capture":true,"soap_notes":true,"ask_vetios":true,"console":true,"api":true,"federation":true,"edge_box":true,"network_learning":true}'::jsonb,
        true,
        60
    ),
    (
        'enterprise',
        'Enterprise',
        'Custom infrastructure, private deployment, governance, and SLA terms.',
        null,
        null,
        '{"clinical_cases":true,"voice_capture":true,"soap_notes":true,"ask_vetios":true,"console":true,"api":true,"federation":true,"custom_sla":true}'::jsonb,
        true,
        70
    )
on conflict (plan_key) do update set
    display_name = excluded.display_name,
    description = excluded.description,
    monthly_diagnosis_limit = excluded.monthly_diagnosis_limit,
    monthly_price_usd = excluded.monthly_price_usd,
    features = excluded.features,
    is_public = excluded.is_public,
    sort_order = excluded.sort_order;

create table if not exists public.account_entitlements (
    tenant_id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    plan_key text not null default 'free'
        references public.product_plan_limits(plan_key) on update cascade,
    status text not null default 'active'
        check (status in ('active', 'trialing', 'past_due', 'cancelled', 'suspended')),
    billing_provider text
        check (billing_provider is null or billing_provider in ('stripe', 'manual', 'grant', 'internal')),
    stripe_customer_id text,
    stripe_subscription_id text,
    current_period_start timestamptz,
    current_period_end timestamptz,
    onboarding_completed_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at_account_entitlements on public.account_entitlements;
create trigger set_updated_at_account_entitlements
    before update on public.account_entitlements
    for each row execute function public.trigger_set_updated_at();

create index if not exists idx_account_entitlements_user
    on public.account_entitlements (user_id);

create index if not exists idx_account_entitlements_subscription
    on public.account_entitlements (stripe_subscription_id)
    where stripe_subscription_id is not null;

create index if not exists idx_account_entitlements_customer
    on public.account_entitlements (stripe_customer_id)
    where stripe_customer_id is not null;

create table if not exists public.product_usage_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    user_id uuid references auth.users(id) on delete set null,
    event_type text not null
        check (event_type in ('diagnosis', 'voice_extract', 'ask_vetios', 'api_request', 'outcome_confirmation')),
    source text not null
        check (source in ('clinical_case', 'inference_api', 'inference_console', 'ask_vetios', 'voice_mode', 'developer_api', 'outcome_api')),
    request_id text not null,
    quantity integer not null default 1 check (quantity > 0),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint product_usage_events_idempotency unique (tenant_id, event_type, source, request_id)
);

create index if not exists idx_product_usage_events_tenant_month
    on public.product_usage_events (tenant_id, event_type, created_at desc);

create index if not exists idx_product_usage_events_user
    on public.product_usage_events (user_id, created_at desc);

create or replace function public.prevent_product_usage_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'product usage table % is append-only; UPDATE and DELETE are not allowed', tg_table_name
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_product_usage_events on public.product_usage_events;
create trigger enforce_immutability_product_usage_events
    before update or delete on public.product_usage_events
    for each row execute function public.prevent_product_usage_mutation();

create or replace function public.consume_product_usage_event(
    p_tenant_id uuid,
    p_user_id uuid,
    p_event_type text,
    p_source text,
    p_request_id text,
    p_quantity integer default 1,
    p_metadata jsonb default '{}'::jsonb
)
returns table(inserted boolean, current_month_quantity integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_inserted boolean := false;
    v_rows integer := 0;
    v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
    v_month_end timestamptz := v_month_start + interval '1 month';
begin
    insert into public.product_usage_events (
        tenant_id,
        user_id,
        event_type,
        source,
        request_id,
        quantity,
        metadata
    )
    values (
        p_tenant_id,
        p_user_id,
        p_event_type,
        p_source,
        p_request_id,
        greatest(1, coalesce(p_quantity, 1)),
        coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (tenant_id, event_type, source, request_id) do nothing;

    get diagnostics v_rows = row_count;
    v_inserted := v_rows > 0;

    return query
    select
        v_inserted,
        coalesce(sum(quantity), 0)::integer
    from public.product_usage_events
    where tenant_id = p_tenant_id
      and event_type = p_event_type
      and created_at >= v_month_start
      and created_at < v_month_end;
end;
$$;

create or replace view public.product_monthly_usage
with (security_invoker = true) as
select
    tenant_id,
    event_type,
    date_trunc('month', timezone('utc', created_at))::date as usage_month,
    sum(quantity)::integer as quantity,
    max(created_at) as last_event_at
from public.product_usage_events
group by tenant_id, event_type, date_trunc('month', timezone('utc', created_at))::date;

alter table public.product_plan_limits enable row level security;
alter table public.account_entitlements enable row level security;
alter table public.product_usage_events enable row level security;

drop policy if exists product_plan_limits_read_public on public.product_plan_limits;
create policy product_plan_limits_read_public
    on public.product_plan_limits
    for select using (is_public = true);

drop policy if exists account_entitlements_select_own on public.account_entitlements;
create policy account_entitlements_select_own
    on public.account_entitlements
    for select using (tenant_id = auth.uid() or user_id = auth.uid());

drop policy if exists account_entitlements_insert_own on public.account_entitlements;
create policy account_entitlements_insert_own
    on public.account_entitlements
    for insert with check (
        tenant_id = auth.uid()
        and user_id = auth.uid()
        and plan_key = 'free'
        and status = 'active'
        and (billing_provider is null or billing_provider = 'internal')
        and stripe_customer_id is null
        and stripe_subscription_id is null
    );

drop policy if exists account_entitlements_update_own on public.account_entitlements;
create policy account_entitlements_update_own
    on public.account_entitlements
    for update
    using (tenant_id = auth.uid() and user_id = auth.uid())
    with check (
        tenant_id = auth.uid()
        and user_id = auth.uid()
        and plan_key = 'free'
        and status = 'active'
        and (billing_provider is null or billing_provider = 'internal')
        and stripe_customer_id is null
        and stripe_subscription_id is null
    );

drop policy if exists product_usage_events_select_own on public.product_usage_events;
create policy product_usage_events_select_own
    on public.product_usage_events
    for select using (tenant_id = auth.uid() or user_id = auth.uid());

drop policy if exists product_usage_events_insert_own on public.product_usage_events;
create policy product_usage_events_insert_own
    on public.product_usage_events
    for insert with check (tenant_id = auth.uid() and (user_id is null or user_id = auth.uid()));

notify pgrst, 'reload schema';
