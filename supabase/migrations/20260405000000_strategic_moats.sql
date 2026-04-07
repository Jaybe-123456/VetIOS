-- Migration: Strategic moat foundation
-- Description: Adds the platform orchestration, governance, telemetry, webhook,
-- and simulation primitives required for the VetIOS moat surfaces.

create extension if not exists pgcrypto;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'current_tenant_text'
    ) then
        execute $fn$
            create function public.current_tenant_text()
            returns text
            language sql
            stable
            as $inner$
                select coalesce(
                    nullif(current_setting('app.tenant_id', true), ''),
                    auth.uid()::text
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
          and p.proname = 'is_system_admin'
    ) then
        execute $fn$
            create function public.is_system_admin()
            returns boolean
            language sql
            stable
            as $inner$
                select coalesce(nullif(current_setting('app.role', true), ''), 'tenant_user') = 'system_admin'
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

create or replace function public.enforce_tenant_isolation()
returns trigger
language plpgsql
as $$
declare
    session_tenant text := nullif(current_setting('app.tenant_id', true), '');
    session_role text := coalesce(nullif(current_setting('app.role', true), ''), 'tenant_user');
begin
    if session_role = 'system_admin' then
        return coalesce(new, old);
    end if;

    if session_tenant is null then
        raise exception 'Tenant context is missing for %', tg_table_name;
    end if;

    if tg_op = 'DELETE' then
        if old.tenant_id::text is distinct from session_tenant then
            raise exception 'Tenant isolation violation on delete for %', tg_table_name;
        end if;
        return old;
    end if;

    if new.tenant_id::text is distinct from session_tenant then
        raise exception 'Tenant isolation violation on write for %', tg_table_name;
    end if;

    if tg_op = 'UPDATE' and old.tenant_id::text is distinct from session_tenant then
        raise exception 'Tenant isolation violation on update for %', tg_table_name;
    end if;

    return new;
end;
$$;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'audit_log is append-only';
end;
$$;

alter table public.ai_inference_events
    add column if not exists blocked boolean not null default false,
    add column if not exists flagged boolean not null default false,
    add column if not exists flag_reason text,
    add column if not exists blocked_reason text,
    add column if not exists governance_policy_id uuid,
    add column if not exists orphaned boolean not null default false,
    add column if not exists orphaned_at timestamptz;

create table if not exists public.outcomes (
    id uuid primary key default gen_random_uuid(),
    inference_event_id uuid not null references public.ai_inference_events(id) on delete cascade,
    tenant_id text not null,
    status text not null default 'pending' check (status in ('pending', 'scored', 'failed')),
    raw_output text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.dataset_snapshots (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    version integer not null,
    row_count integer not null check (row_count >= 0),
    trigger text not null check (trigger in ('backfill', 'manual', 'evaluation')),
    snapshot_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.evaluations (
    id uuid primary key default gen_random_uuid(),
    outcome_id uuid not null references public.outcomes(id) on delete cascade,
    inference_event_id uuid not null references public.ai_inference_events(id) on delete cascade,
    tenant_id text not null,
    model_version text not null,
    score double precision not null check (score >= 0 and score <= 1),
    scorer text not null default 'auto' check (scorer in ('auto', 'human')),
    dataset_version integer,
    evaluated_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.orphan_event_counters (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null unique,
    count integer not null default 0 check (count >= 0),
    last_orphan_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.governance_policies (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    name text not null default 'Tenant policy',
    status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
    rules jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    activated_at timestamptz,
    archived_at timestamptz,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.audit_log (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    event_type text not null check (event_type in ('policy_updated', 'policy_applied', 'request_blocked', 'request_flagged', 'model_version_changed', 'governance_override')),
    actor text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.platform_telemetry (
    id uuid primary key default gen_random_uuid(),
    telemetry_key text not null unique,
    inference_event_id uuid references public.ai_inference_events(id) on delete cascade,
    tenant_id text not null,
    pipeline_id text not null,
    model_version text not null,
    latency_ms integer not null default 0 check (latency_ms >= 0),
    token_count_input integer not null default 0 check (token_count_input >= 0),
    token_count_output integer not null default 0 check (token_count_output >= 0),
    outcome_linked boolean not null default false,
    evaluation_score double precision,
    flagged boolean not null default false,
    blocked boolean not null default false,
    timestamp timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.drift_snapshots (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    model_version text not null,
    current_mean double precision,
    baseline_mean double precision,
    baseline_stddev double precision,
    delta double precision,
    drift_detected boolean not null default false,
    snapshot_window_start timestamptz not null,
    snapshot_window_end timestamptz not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.tenant_rate_limits (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null unique,
    inference_requests_per_minute integer not null default 60 check (inference_requests_per_minute > 0),
    evaluation_requests_per_minute integer not null default 120 check (evaluation_requests_per_minute > 0),
    simulate_requests_per_minute integer not null default 10 check (simulate_requests_per_minute > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.webhook_subscriptions (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    url text not null,
    events text[] not null default '{}'::text[],
    secret text not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
    id uuid primary key default gen_random_uuid(),
    subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
    tenant_id text not null,
    event_type text not null,
    attempt_no integer not null check (attempt_no > 0),
    status_code integer,
    success boolean not null default false,
    request_payload jsonb not null default '{}'::jsonb,
    response_payload jsonb not null default '{}'::jsonb,
    error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.simulations (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    scenario_name text not null,
    mode text not null check (mode in ('scenario_load', 'adversarial', 'regression')),
    status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
    config jsonb not null default '{}'::jsonb,
    summary jsonb not null default '{}'::jsonb,
    completed integer not null default 0 check (completed >= 0),
    total integer not null default 0 check (total >= 0),
    candidate_model_version text,
    error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.adversarial_prompts (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    category text not null check (category in ('jailbreak', 'injection', 'gibberish', 'extreme_length', 'multilingual', 'sensitive_topic')),
    prompt text not null,
    expected_behavior text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists idx_outcomes_inference_unique
    on public.outcomes (tenant_id, inference_event_id);

create unique index if not exists idx_evaluations_outcome_unique
    on public.evaluations (tenant_id, outcome_id);

create unique index if not exists idx_dataset_snapshots_version
    on public.dataset_snapshots (tenant_id, version);

create unique index if not exists idx_governance_policies_single_active
    on public.governance_policies (tenant_id)
    where status = 'active';

create unique index if not exists idx_drift_snapshots_hourly
    on public.drift_snapshots (tenant_id, model_version, snapshot_window_start);

create index if not exists idx_outcomes_tenant_created
    on public.outcomes (tenant_id, created_at desc);

create index if not exists idx_evaluations_tenant_created
    on public.evaluations (tenant_id, created_at desc);

create index if not exists idx_dataset_snapshots_tenant_created
    on public.dataset_snapshots (tenant_id, created_at desc);

create index if not exists idx_audit_log_tenant_created
    on public.audit_log (tenant_id, created_at desc);

create index if not exists idx_platform_telemetry_tenant_created
    on public.platform_telemetry (tenant_id, created_at desc);

create index if not exists idx_platform_telemetry_inference
    on public.platform_telemetry (tenant_id, inference_event_id, timestamp desc);

create index if not exists idx_drift_snapshots_tenant_created
    on public.drift_snapshots (tenant_id, created_at desc);

create index if not exists idx_webhook_subscriptions_tenant_created
    on public.webhook_subscriptions (tenant_id, created_at desc);

create index if not exists idx_webhook_deliveries_tenant_created
    on public.webhook_deliveries (tenant_id, created_at desc);

create index if not exists idx_simulations_tenant_created
    on public.simulations (tenant_id, created_at desc);

create index if not exists idx_adversarial_prompts_tenant_created
    on public.adversarial_prompts (tenant_id, created_at desc);

create unique index if not exists idx_adversarial_prompts_unique
    on public.adversarial_prompts (tenant_id, prompt);

create index if not exists idx_governance_policies_tenant_created
    on public.governance_policies (tenant_id, created_at desc);

create index if not exists idx_rate_limits_tenant_created
    on public.tenant_rate_limits (tenant_id, created_at desc);

drop trigger if exists set_updated_at_outcomes on public.outcomes;
create trigger set_updated_at_outcomes
    before update on public.outcomes
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_dataset_snapshots on public.dataset_snapshots;
create trigger set_updated_at_dataset_snapshots
    before update on public.dataset_snapshots
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_evaluations on public.evaluations;
create trigger set_updated_at_evaluations
    before update on public.evaluations
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_orphan_event_counters on public.orphan_event_counters;
create trigger set_updated_at_orphan_event_counters
    before update on public.orphan_event_counters
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_governance_policies on public.governance_policies;
create trigger set_updated_at_governance_policies
    before update on public.governance_policies
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_platform_telemetry on public.platform_telemetry;
create trigger set_updated_at_platform_telemetry
    before update on public.platform_telemetry
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_drift_snapshots on public.drift_snapshots;
create trigger set_updated_at_drift_snapshots
    before update on public.drift_snapshots
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_tenant_rate_limits on public.tenant_rate_limits;
create trigger set_updated_at_tenant_rate_limits
    before update on public.tenant_rate_limits
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_webhook_subscriptions on public.webhook_subscriptions;
create trigger set_updated_at_webhook_subscriptions
    before update on public.webhook_subscriptions
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_webhook_deliveries on public.webhook_deliveries;
create trigger set_updated_at_webhook_deliveries
    before update on public.webhook_deliveries
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_simulations on public.simulations;
create trigger set_updated_at_simulations
    before update on public.simulations
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_adversarial_prompts on public.adversarial_prompts;
create trigger set_updated_at_adversarial_prompts
    before update on public.adversarial_prompts
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists append_only_audit_log_no_update on public.audit_log;
create trigger append_only_audit_log_no_update
    before update on public.audit_log
    for each row execute function public.prevent_audit_log_mutation();

drop trigger if exists append_only_audit_log_no_delete on public.audit_log;
create trigger append_only_audit_log_no_delete
    before delete on public.audit_log
    for each row execute function public.prevent_audit_log_mutation();

drop trigger if exists tenant_isolation_ai_inference_events on public.ai_inference_events;
create trigger tenant_isolation_ai_inference_events
    before insert or update or delete on public.ai_inference_events
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_outcomes on public.outcomes;
create trigger tenant_isolation_outcomes
    before insert or update or delete on public.outcomes
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_dataset_snapshots on public.dataset_snapshots;
create trigger tenant_isolation_dataset_snapshots
    before insert or update or delete on public.dataset_snapshots
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_evaluations on public.evaluations;
create trigger tenant_isolation_evaluations
    before insert or update or delete on public.evaluations
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_orphan_event_counters on public.orphan_event_counters;
create trigger tenant_isolation_orphan_event_counters
    before insert or update or delete on public.orphan_event_counters
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_governance_policies on public.governance_policies;
create trigger tenant_isolation_governance_policies
    before insert or update or delete on public.governance_policies
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_platform_telemetry on public.platform_telemetry;
create trigger tenant_isolation_platform_telemetry
    before insert or update or delete on public.platform_telemetry
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_drift_snapshots on public.drift_snapshots;
create trigger tenant_isolation_drift_snapshots
    before insert or update or delete on public.drift_snapshots
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_tenant_rate_limits on public.tenant_rate_limits;
create trigger tenant_isolation_tenant_rate_limits
    before insert or update or delete on public.tenant_rate_limits
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_webhook_subscriptions on public.webhook_subscriptions;
create trigger tenant_isolation_webhook_subscriptions
    before insert or update or delete on public.webhook_subscriptions
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_webhook_deliveries on public.webhook_deliveries;
create trigger tenant_isolation_webhook_deliveries
    before insert or update or delete on public.webhook_deliveries
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_simulations on public.simulations;
create trigger tenant_isolation_simulations
    before insert or update or delete on public.simulations
    for each row execute function public.enforce_tenant_isolation();

drop trigger if exists tenant_isolation_adversarial_prompts on public.adversarial_prompts;
create trigger tenant_isolation_adversarial_prompts
    before insert or update or delete on public.adversarial_prompts
    for each row execute function public.enforce_tenant_isolation();

alter table public.outcomes enable row level security;
alter table public.dataset_snapshots enable row level security;
alter table public.evaluations enable row level security;
alter table public.orphan_event_counters enable row level security;
alter table public.governance_policies enable row level security;
alter table public.audit_log enable row level security;
alter table public.platform_telemetry enable row level security;
alter table public.drift_snapshots enable row level security;
alter table public.tenant_rate_limits enable row level security;
alter table public.webhook_subscriptions enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.simulations enable row level security;
alter table public.adversarial_prompts enable row level security;

drop policy if exists outcomes_select_scope on public.outcomes;
create policy outcomes_select_scope
    on public.outcomes
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists outcomes_insert_scope on public.outcomes;
create policy outcomes_insert_scope
    on public.outcomes
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists outcomes_update_scope on public.outcomes;
create policy outcomes_update_scope
    on public.outcomes
    for update using (public.is_system_admin() or tenant_id::text = public.current_tenant_text())
    with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists dataset_snapshots_select_scope on public.dataset_snapshots;
create policy dataset_snapshots_select_scope
    on public.dataset_snapshots
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists dataset_snapshots_insert_scope on public.dataset_snapshots;
create policy dataset_snapshots_insert_scope
    on public.dataset_snapshots
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists evaluations_select_scope on public.evaluations;
create policy evaluations_select_scope
    on public.evaluations
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists evaluations_insert_scope on public.evaluations;
create policy evaluations_insert_scope
    on public.evaluations
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists evaluations_update_scope on public.evaluations;
create policy evaluations_update_scope
    on public.evaluations
    for update using (public.is_system_admin() or tenant_id::text = public.current_tenant_text())
    with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists orphan_event_counters_select_scope on public.orphan_event_counters;
create policy orphan_event_counters_select_scope
    on public.orphan_event_counters
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists orphan_event_counters_insert_scope on public.orphan_event_counters;
create policy orphan_event_counters_insert_scope
    on public.orphan_event_counters
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists orphan_event_counters_update_scope on public.orphan_event_counters;
create policy orphan_event_counters_update_scope
    on public.orphan_event_counters
    for update using (public.is_system_admin() or tenant_id::text = public.current_tenant_text())
    with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists governance_policies_select_scope on public.governance_policies;
create policy governance_policies_select_scope
    on public.governance_policies
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists governance_policies_insert_scope on public.governance_policies;
create policy governance_policies_insert_scope
    on public.governance_policies
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists governance_policies_update_scope on public.governance_policies;
create policy governance_policies_update_scope
    on public.governance_policies
    for update using (public.is_system_admin() or tenant_id::text = public.current_tenant_text())
    with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists audit_log_select_scope on public.audit_log;
create policy audit_log_select_scope
    on public.audit_log
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists audit_log_insert_scope on public.audit_log;
create policy audit_log_insert_scope
    on public.audit_log
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists platform_telemetry_select_scope on public.platform_telemetry;
create policy platform_telemetry_select_scope
    on public.platform_telemetry
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists platform_telemetry_insert_scope on public.platform_telemetry;
create policy platform_telemetry_insert_scope
    on public.platform_telemetry
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists drift_snapshots_select_scope on public.drift_snapshots;
create policy drift_snapshots_select_scope
    on public.drift_snapshots
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists drift_snapshots_insert_scope on public.drift_snapshots;
create policy drift_snapshots_insert_scope
    on public.drift_snapshots
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists tenant_rate_limits_select_scope on public.tenant_rate_limits;
create policy tenant_rate_limits_select_scope
    on public.tenant_rate_limits
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists tenant_rate_limits_insert_scope on public.tenant_rate_limits;
create policy tenant_rate_limits_insert_scope
    on public.tenant_rate_limits
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists tenant_rate_limits_update_scope on public.tenant_rate_limits;
create policy tenant_rate_limits_update_scope
    on public.tenant_rate_limits
    for update using (public.is_system_admin() or tenant_id::text = public.current_tenant_text())
    with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists webhook_subscriptions_select_scope on public.webhook_subscriptions;
create policy webhook_subscriptions_select_scope
    on public.webhook_subscriptions
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists webhook_subscriptions_insert_scope on public.webhook_subscriptions;
create policy webhook_subscriptions_insert_scope
    on public.webhook_subscriptions
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists webhook_subscriptions_update_scope on public.webhook_subscriptions;
create policy webhook_subscriptions_update_scope
    on public.webhook_subscriptions
    for update using (public.is_system_admin() or tenant_id::text = public.current_tenant_text())
    with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists webhook_deliveries_select_scope on public.webhook_deliveries;
create policy webhook_deliveries_select_scope
    on public.webhook_deliveries
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists webhook_deliveries_insert_scope on public.webhook_deliveries;
create policy webhook_deliveries_insert_scope
    on public.webhook_deliveries
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists simulations_select_scope on public.simulations;
create policy simulations_select_scope
    on public.simulations
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists simulations_insert_scope on public.simulations;
create policy simulations_insert_scope
    on public.simulations
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists simulations_update_scope on public.simulations;
create policy simulations_update_scope
    on public.simulations
    for update using (public.is_system_admin() or tenant_id::text = public.current_tenant_text())
    with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists adversarial_prompts_select_scope on public.adversarial_prompts;
create policy adversarial_prompts_select_scope
    on public.adversarial_prompts
    for select using (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists adversarial_prompts_insert_scope on public.adversarial_prompts;
create policy adversarial_prompts_insert_scope
    on public.adversarial_prompts
    for insert with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

drop policy if exists adversarial_prompts_update_scope on public.adversarial_prompts;
create policy adversarial_prompts_update_scope
    on public.adversarial_prompts
    for update using (public.is_system_admin() or tenant_id::text = public.current_tenant_text())
    with check (public.is_system_admin() or tenant_id::text = public.current_tenant_text());

notify pgrst, 'reload schema';
