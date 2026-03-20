-- =============================================================================
-- Migration 024: Experiment Governance v1
-- Compatibility version for projects without public.tenants
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

alter table public.experiment_runs
    add column if not exists registry_id text;

alter table public.experiment_metrics
    add column if not exists false_negative_critical_rate double precision,
    add column if not exists dangerous_false_reassurance_rate double precision,
    add column if not exists abstain_accuracy double precision,
    add column if not exists contradiction_detection_rate double precision;

create table if not exists public.model_registry (
    registry_id  text primary key,
    tenant_id    uuid not null,
    run_id       text not null,
    model_version text not null,
    artifact_path text,
    status       text not null check (status in ('candidate', 'staging', 'production', 'archived')),
    role         text not null check (role in ('champion', 'challenger', 'experimental')),
    created_at   timestamptz not null default now(),
    created_by   text,
    updated_at   timestamptz not null default now(),
    constraint model_registry_tenant_run_key unique (tenant_id, run_id),
    constraint model_registry_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create table if not exists public.calibration_metrics (
    id               uuid primary key default gen_random_uuid(),
    tenant_id        uuid not null,
    run_id           text not null,
    ece              double precision,
    brier_score      double precision,
    reliability_bins jsonb not null default '[]'::jsonb,
    calibration_pass boolean,
    calibration_notes text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint calibration_metrics_tenant_run_key unique (tenant_id, run_id),
    constraint calibration_metrics_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create table if not exists public.adversarial_metrics (
    id                        uuid primary key default gen_random_uuid(),
    tenant_id                 uuid not null,
    run_id                    text not null,
    degradation_score         double precision,
    contradiction_robustness  double precision,
    critical_case_recall      double precision,
    false_reassurance_rate    double precision,
    adversarial_pass          boolean,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    constraint adversarial_metrics_tenant_run_key unique (tenant_id, run_id),
    constraint adversarial_metrics_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create table if not exists public.audit_log (
    event_id    text primary key,
    tenant_id   uuid not null,
    run_id      text,
    event_type  text not null,
    actor       text,
    metadata    jsonb not null default '{}'::jsonb,
    "timestamp" timestamptz not null default now(),
    created_at  timestamptz not null default now()
);

create table if not exists public.deployment_decisions (
    id               uuid primary key default gen_random_uuid(),
    tenant_id        uuid not null,
    run_id           text not null,
    decision         text not null check (decision in ('approved', 'rejected', 'pending')),
    reason           text,
    calibration_pass boolean,
    adversarial_pass boolean,
    safety_pass      boolean,
    approved_by      text,
    "timestamp"      timestamptz not null default now(),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint deployment_decisions_tenant_run_key unique (tenant_id, run_id),
    constraint deployment_decisions_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create table if not exists public.subgroup_metrics (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null,
    run_id      text not null,
    "group"     text not null,
    group_value text not null,
    metric      text not null,
    value       double precision not null,
    created_at  timestamptz not null default now(),
    constraint subgroup_metrics_tenant_run_key unique (tenant_id, run_id, "group", group_value, metric),
    constraint subgroup_metrics_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create index if not exists idx_model_registry_tenant_status
    on public.model_registry (tenant_id, status, updated_at desc);

create index if not exists idx_calibration_metrics_tenant_run
    on public.calibration_metrics (tenant_id, run_id);

create index if not exists idx_adversarial_metrics_tenant_run
    on public.adversarial_metrics (tenant_id, run_id);

create index if not exists idx_audit_log_tenant_timestamp
    on public.audit_log (tenant_id, "timestamp" desc);

create index if not exists idx_deployment_decisions_tenant_run
    on public.deployment_decisions (tenant_id, run_id);

create index if not exists idx_subgroup_metrics_tenant_run
    on public.subgroup_metrics (tenant_id, run_id, "group");

drop trigger if exists set_updated_at_model_registry on public.model_registry;
create trigger set_updated_at_model_registry
    before update on public.model_registry
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_calibration_metrics on public.calibration_metrics;
create trigger set_updated_at_calibration_metrics
    before update on public.calibration_metrics
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_adversarial_metrics on public.adversarial_metrics;
create trigger set_updated_at_adversarial_metrics
    before update on public.adversarial_metrics
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_deployment_decisions on public.deployment_decisions;
create trigger set_updated_at_deployment_decisions
    before update on public.deployment_decisions
    for each row execute function public.trigger_set_updated_at();

alter table public.model_registry enable row level security;
alter table public.calibration_metrics enable row level security;
alter table public.adversarial_metrics enable row level security;
alter table public.audit_log enable row level security;
alter table public.deployment_decisions enable row level security;
alter table public.subgroup_metrics enable row level security;

drop policy if exists model_registry_select_own on public.model_registry;
create policy model_registry_select_own
    on public.model_registry
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists model_registry_insert_own on public.model_registry;
create policy model_registry_insert_own
    on public.model_registry
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists model_registry_update_own on public.model_registry;
create policy model_registry_update_own
    on public.model_registry
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists calibration_metrics_select_own on public.calibration_metrics;
create policy calibration_metrics_select_own
    on public.calibration_metrics
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists calibration_metrics_insert_own on public.calibration_metrics;
create policy calibration_metrics_insert_own
    on public.calibration_metrics
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists calibration_metrics_update_own on public.calibration_metrics;
create policy calibration_metrics_update_own
    on public.calibration_metrics
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists adversarial_metrics_select_own on public.adversarial_metrics;
create policy adversarial_metrics_select_own
    on public.adversarial_metrics
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists adversarial_metrics_insert_own on public.adversarial_metrics;
create policy adversarial_metrics_insert_own
    on public.adversarial_metrics
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists adversarial_metrics_update_own on public.adversarial_metrics;
create policy adversarial_metrics_update_own
    on public.adversarial_metrics
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists audit_log_select_own on public.audit_log;
create policy audit_log_select_own
    on public.audit_log
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists audit_log_insert_own on public.audit_log;
create policy audit_log_insert_own
    on public.audit_log
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists deployment_decisions_select_own on public.deployment_decisions;
create policy deployment_decisions_select_own
    on public.deployment_decisions
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists deployment_decisions_insert_own on public.deployment_decisions;
create policy deployment_decisions_insert_own
    on public.deployment_decisions
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists deployment_decisions_update_own on public.deployment_decisions;
create policy deployment_decisions_update_own
    on public.deployment_decisions
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists subgroup_metrics_select_own on public.subgroup_metrics;
create policy subgroup_metrics_select_own
    on public.subgroup_metrics
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists subgroup_metrics_insert_own on public.subgroup_metrics;
create policy subgroup_metrics_insert_own
    on public.subgroup_metrics
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists subgroup_metrics_update_own on public.subgroup_metrics;
create policy subgroup_metrics_update_own
    on public.subgroup_metrics
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

insert into public.model_registry (
    registry_id,
    tenant_id,
    run_id,
    model_version,
    artifact_path,
    status,
    role,
    created_at,
    created_by
)
select
    'reg_' || left(regexp_replace(lower(er.run_id), '[^a-z0-9]+', '_', 'g'), 56),
    er.tenant_id,
    er.run_id,
    coalesce(er.model_version, er.run_id),
    (
        select ea.uri
        from public.experiment_artifacts ea
        where ea.tenant_id = er.tenant_id
          and ea.run_id = er.run_id
        order by ea.is_primary desc, ea.created_at asc
        limit 1
    ),
    case
        when er.status = 'promoted' then 'production'
        when er.status = 'rolled_back' then 'archived'
        else 'candidate'
    end,
    case
        when er.status = 'promoted' then 'champion'
        when er.summary_only = true then 'challenger'
        else 'experimental'
    end,
    coalesce(er.started_at, er.created_at),
    er.created_by
from public.experiment_runs er
where er.status in ('completed', 'promoted', 'rolled_back')
on conflict (registry_id) do nothing;

update public.experiment_runs er
set registry_id = mr.registry_id
from public.model_registry mr
where mr.tenant_id = er.tenant_id
  and mr.run_id = er.run_id
  and (er.registry_id is null or er.registry_id <> mr.registry_id);

insert into public.calibration_metrics (
    tenant_id,
    run_id,
    ece,
    brier_score,
    reliability_bins,
    calibration_pass,
    calibration_notes
)
select
    er.tenant_id,
    er.run_id,
    nullif(er.safety_metrics ->> 'calibration_ece', '')::double precision,
    nullif(er.safety_metrics ->> 'calibration_brier', '')::double precision,
    '[]'::jsonb,
    case
        when nullif(er.safety_metrics ->> 'calibration_ece', '')::double precision is not null
         and nullif(er.safety_metrics ->> 'calibration_brier', '')::double precision is not null
         and nullif(er.safety_metrics ->> 'calibration_ece', '')::double precision < 0.08
         and nullif(er.safety_metrics ->> 'calibration_brier', '')::double precision < 0.12
            then true
        when nullif(er.safety_metrics ->> 'calibration_ece', '')::double precision is not null
            then false
        else null
    end,
    case
        when er.safety_metrics ? 'calibration_ece' then 'Backfilled from experiment safety metrics.'
        else null
    end
from public.experiment_runs er
where er.status in ('completed', 'promoted', 'rolled_back')
  and er.safety_metrics ? 'calibration_ece'
on conflict (tenant_id, run_id) do nothing;

insert into public.adversarial_metrics (
    tenant_id,
    run_id,
    degradation_score,
    contradiction_robustness,
    critical_case_recall,
    false_reassurance_rate,
    adversarial_pass
)
select
    er.tenant_id,
    er.run_id,
    nullif(eb.report_payload ->> 'degradation_score', '')::double precision,
    nullif(eb.report_payload ->> 'contradiction_robustness', '')::double precision,
    coalesce(
        nullif(eb.report_payload ->> 'critical_case_recall', '')::double precision,
        nullif(er.safety_metrics ->> 'recall_critical', '')::double precision
    ),
    coalesce(
        nullif(eb.report_payload ->> 'false_reassurance_rate', '')::double precision,
        nullif(er.safety_metrics ->> 'dangerous_false_reassurance_rate', '')::double precision
    ),
    case
        when nullif(eb.report_payload ->> 'degradation_score', '')::double precision is not null
         and coalesce(
                nullif(eb.report_payload ->> 'critical_case_recall', '')::double precision,
                nullif(er.safety_metrics ->> 'recall_critical', '')::double precision
            ) is not null
         and nullif(eb.report_payload ->> 'degradation_score', '')::double precision < 0.25
         and coalesce(
                nullif(eb.report_payload ->> 'critical_case_recall', '')::double precision,
                nullif(er.safety_metrics ->> 'recall_critical', '')::double precision
            ) > 0.85
            then true
        when nullif(eb.report_payload ->> 'degradation_score', '')::double precision is not null
            then false
        else null
    end
from public.experiment_runs er
join public.experiment_benchmarks eb
  on eb.tenant_id = er.tenant_id
 and eb.run_id = er.run_id
where lower(eb.benchmark_family) like '%adversarial%'
   or lower(eb.benchmark_family) like '%safety%'
on conflict (tenant_id, run_id) do nothing;

insert into public.audit_log (
    event_id,
    tenant_id,
    run_id,
    event_type,
    actor,
    metadata,
    "timestamp"
)
select
    'evt_' || left(regexp_replace(lower(er.run_id || '_created'), '[^a-z0-9]+', '_', 'g'), 100),
    er.tenant_id,
    er.run_id,
    'created',
    er.created_by,
    jsonb_build_object('status', er.status, 'model_version', er.model_version),
    coalesce(er.created_at, now())
from public.experiment_runs er
on conflict (event_id) do nothing;

insert into public.audit_log (
    event_id,
    tenant_id,
    run_id,
    event_type,
    actor,
    metadata,
    "timestamp"
)
select
    'evt_' || left(regexp_replace(lower(ef.run_id || '_failed'), '[^a-z0-9]+', '_', 'g'), 100),
    ef.tenant_id,
    ef.run_id,
    'failed',
    null,
    jsonb_build_object(
        'reason', ef.failure_reason,
        'failure_epoch', ef.failure_epoch,
        'failure_step', ef.failure_step
    ),
    ef.created_at
from public.experiment_failures ef
on conflict (event_id) do nothing;

insert into public.deployment_decisions (
    tenant_id,
    run_id,
    decision,
    reason,
    calibration_pass,
    adversarial_pass,
    safety_pass,
    approved_by,
    "timestamp"
)
select
    er.tenant_id,
    er.run_id,
    case
        when er.status = 'failed' then 'rejected'
        when cm.calibration_pass = true
         and am.adversarial_pass = true
         and coalesce(nullif(er.safety_metrics ->> 'recall_critical', '')::double precision, 0) >= 0.85
            then 'approved'
        else 'pending'
    end,
    case
        when er.status = 'failed' then 'Run failed before deployment review.'
        when cm.calibration_pass = true and am.adversarial_pass = true then 'Backfilled governance decision from calibration and adversarial gates.'
        else 'Governance review pending richer evaluation signals.'
    end,
    cm.calibration_pass,
    am.adversarial_pass,
    case
        when coalesce(nullif(er.safety_metrics ->> 'recall_critical', '')::double precision, 0) >= 0.85 then true
        when er.safety_metrics ? 'recall_critical' then false
        else null
    end,
    null,
    now()
from public.experiment_runs er
left join public.calibration_metrics cm
  on cm.tenant_id = er.tenant_id
 and cm.run_id = er.run_id
left join public.adversarial_metrics am
  on am.tenant_id = er.tenant_id
 and am.run_id = er.run_id
where er.status in ('completed', 'promoted', 'rolled_back', 'failed')
on conflict (tenant_id, run_id) do nothing;

notify pgrst, 'reload schema';
