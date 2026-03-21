-- =============================================================================
-- Migration 031: Multi-Model Routing Engine
-- Dynamic per-case model routing profiles and routing decision feedback loop.
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

create table if not exists public.model_router_profiles (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    model_id text not null,
    model_family text not null,
    model_type text not null,
    provider_model text not null,
    model_name text not null,
    model_version text not null,
    registry_id text references public.model_registry(registry_id) on delete set null,
    approval_status text not null default 'approved',
    active boolean not null default true,
    expected_latency_ms double precision not null default 400,
    base_accuracy double precision not null default 0.75,
    base_cost double precision not null default 0.2,
    robustness_score double precision not null default 0.6,
    recall_score double precision not null default 0.75,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint model_router_profiles_tenant_model_key unique (tenant_id, model_id),
    constraint model_router_profiles_family_check check (model_family in ('diagnostics', 'vision', 'therapeutics')),
    constraint model_router_profiles_type_check check (model_type in ('fast', 'deep_reasoning', 'adversarial_resistant', 'high_recall')),
    constraint model_router_profiles_approval_status_check check (approval_status in ('approved', 'pending', 'blocked')),
    constraint model_router_profiles_accuracy_check check (base_accuracy between 0 and 1),
    constraint model_router_profiles_cost_check check (base_cost between 0 and 1),
    constraint model_router_profiles_robustness_check check (robustness_score between 0 and 1),
    constraint model_router_profiles_recall_check check (recall_score between 0 and 1)
);

create table if not exists public.model_routing_decisions (
    routing_decision_id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    outcome_event_id uuid references public.clinical_outcome_events(id) on delete set null,
    evaluation_event_id uuid references public.model_evaluation_events(evaluation_event_id) on delete set null,
    requested_model_name text not null,
    requested_model_version text not null,
    selected_model_id text not null,
    selected_provider_model text not null,
    selected_model_version text not null,
    selected_registry_id text references public.model_registry(registry_id) on delete set null,
    model_family text not null,
    route_mode text not null,
    execution_status text not null default 'planned',
    trigger_reason text not null,
    analysis jsonb not null default '{}'::jsonb,
    candidates jsonb not null default '[]'::jsonb,
    fallback_chain jsonb not null default '[]'::jsonb,
    consensus_payload jsonb,
    actual_latency_ms double precision,
    prediction text,
    prediction_confidence double precision,
    outcome_correct boolean,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint model_routing_decisions_family_check check (model_family in ('diagnostics', 'vision', 'therapeutics')),
    constraint model_routing_decisions_route_mode_check check (route_mode in ('single', 'ensemble', 'manual_override')),
    constraint model_routing_decisions_execution_status_check check (execution_status in ('planned', 'executed', 'fallback_executed', 'failed'))
);

create unique index if not exists idx_model_routing_decisions_inference_event_unique
    on public.model_routing_decisions (inference_event_id)
    where inference_event_id is not null;

create index if not exists idx_model_router_profiles_family_active
    on public.model_router_profiles (tenant_id, model_family, active, approval_status, updated_at desc);

create index if not exists idx_model_routing_decisions_tenant_created
    on public.model_routing_decisions (tenant_id, created_at desc);

create index if not exists idx_model_routing_decisions_model_created
    on public.model_routing_decisions (tenant_id, selected_model_id, created_at desc);

create index if not exists idx_model_routing_decisions_family_created
    on public.model_routing_decisions (tenant_id, model_family, created_at desc);

drop trigger if exists set_updated_at_model_router_profiles on public.model_router_profiles;
create trigger set_updated_at_model_router_profiles
    before update on public.model_router_profiles
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_model_routing_decisions on public.model_routing_decisions;
create trigger set_updated_at_model_routing_decisions
    before update on public.model_routing_decisions
    for each row execute function public.trigger_set_updated_at();

alter table public.model_router_profiles enable row level security;
alter table public.model_routing_decisions enable row level security;

drop policy if exists model_router_profiles_select_own on public.model_router_profiles;
create policy model_router_profiles_select_own
    on public.model_router_profiles
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_router_profiles_insert_own on public.model_router_profiles;
create policy model_router_profiles_insert_own
    on public.model_router_profiles
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_router_profiles_update_own on public.model_router_profiles;
create policy model_router_profiles_update_own
    on public.model_router_profiles
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_routing_decisions_select_own on public.model_routing_decisions;
create policy model_routing_decisions_select_own
    on public.model_routing_decisions
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_routing_decisions_insert_own on public.model_routing_decisions;
create policy model_routing_decisions_insert_own
    on public.model_routing_decisions
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_routing_decisions_update_own on public.model_routing_decisions;
create policy model_routing_decisions_update_own
    on public.model_routing_decisions
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
