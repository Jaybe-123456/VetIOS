-- =============================================================================
-- Migration 026: Model Registry Control Plane
-- Makes the experiment registry the governed source of truth for serving.
-- =============================================================================

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

create or replace function public.resolve_registry_model_family(
    p_task_type text,
    p_target_type text,
    p_model_name text
)
returns text
language plpgsql
immutable
as $$
declare
    normalized_task text := lower(coalesce(p_task_type, ''));
    normalized_target text := lower(coalesce(p_target_type, ''));
    normalized_name text := lower(coalesce(p_model_name, ''));
begin
    if normalized_task like '%vision%' or normalized_target like '%vision%' or normalized_name like '%vision%' then
        return 'vision';
    end if;

    if normalized_task like '%therapeut%'
        or normalized_target like '%therapeut%'
        or normalized_name like '%therapeut%' then
        return 'therapeutics';
    end if;

    return 'diagnostics';
end;
$$;

alter table public.model_registry
    add column if not exists model_name text,
    add column if not exists model_family text,
    add column if not exists artifact_uri text,
    add column if not exists dataset_version text,
    add column if not exists feature_schema_version text,
    add column if not exists label_policy_version text,
    add column if not exists lifecycle_status text,
    add column if not exists registry_role text,
    add column if not exists deployed_at timestamptz,
    add column if not exists archived_at timestamptz,
    add column if not exists promoted_from text,
    add column if not exists rollback_target text,
    add column if not exists clinical_metrics jsonb not null default '{}'::jsonb,
    add column if not exists lineage jsonb not null default '{}'::jsonb,
    add column if not exists rollback_metadata jsonb;

alter table public.experiment_registry_links
    add column if not exists benchmark_status text,
    add column if not exists manual_approval_status text;

alter table public.deployment_decisions
    add column if not exists benchmark_pass boolean,
    add column if not exists manual_approval boolean;

alter table public.model_registry
    drop constraint if exists model_registry_status_check;

alter table public.model_registry
    drop constraint if exists model_registry_role_check;

alter table public.model_registry
    drop constraint if exists model_registry_lifecycle_status_check;

alter table public.model_registry
    drop constraint if exists model_registry_registry_role_check;

alter table public.model_registry
    drop constraint if exists model_registry_status_sync_check;

alter table public.model_registry
    drop constraint if exists model_registry_role_sync_check;

alter table public.model_registry
    drop constraint if exists model_registry_staging_challenger_check;

alter table public.model_registry
    add constraint model_registry_status_check check (status in ('training', 'candidate', 'staging', 'production', 'archived'));

alter table public.model_registry
    add constraint model_registry_role_check check (role in ('champion', 'challenger', 'experimental', 'rollback_target'));

alter table public.model_registry
    add constraint model_registry_lifecycle_status_check check (lifecycle_status in ('training', 'candidate', 'staging', 'production', 'archived'));

alter table public.model_registry
    add constraint model_registry_registry_role_check check (registry_role in ('champion', 'challenger', 'experimental', 'rollback_target'));

alter table public.model_registry
    add constraint model_registry_status_sync_check check (status = lifecycle_status);

alter table public.model_registry
    add constraint model_registry_role_sync_check check (role = registry_role);

alter table public.model_registry
    add constraint model_registry_staging_challenger_check check (lifecycle_status <> 'staging' or registry_role = 'challenger');

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'model_registry'
          and constraint_name = 'model_registry_promoted_from_fkey'
    ) then
        alter table public.model_registry
            add constraint model_registry_promoted_from_fkey
            foreign key (promoted_from)
            references public.model_registry (registry_id)
            on delete set null;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'model_registry'
          and constraint_name = 'model_registry_rollback_target_fkey'
    ) then
        alter table public.model_registry
            add constraint model_registry_rollback_target_fkey
            foreign key (rollback_target)
            references public.model_registry (registry_id)
            on delete set null;
    end if;
end $$;

create unique index if not exists idx_model_registry_one_champion_per_family
    on public.model_registry (tenant_id, model_family)
    where lifecycle_status = 'production' and registry_role = 'champion';

create index if not exists idx_model_registry_family_lifecycle
    on public.model_registry (tenant_id, model_family, lifecycle_status, updated_at desc);

create table if not exists public.promotion_requirements (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    registry_id text not null references public.model_registry(registry_id) on delete cascade,
    run_id text not null,
    calibration_pass boolean,
    adversarial_pass boolean,
    safety_pass boolean,
    benchmark_pass boolean,
    manual_approval boolean,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint promotion_requirements_tenant_registry_key unique (tenant_id, registry_id),
    constraint promotion_requirements_tenant_run_key unique (tenant_id, run_id),
    constraint promotion_requirements_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create table if not exists public.registry_audit_log (
    event_id text primary key,
    tenant_id uuid not null,
    registry_id text not null references public.model_registry(registry_id) on delete cascade,
    run_id text,
    event_type text not null,
    actor text,
    metadata jsonb not null default '{}'::jsonb,
    "timestamp" timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create table if not exists public.model_registry_routing (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    model_family text not null check (model_family in ('diagnostics', 'vision', 'therapeutics')),
    active_registry_id text references public.model_registry(registry_id) on delete set null,
    active_run_id text,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint model_registry_routing_tenant_family_key unique (tenant_id, model_family)
);

create index if not exists idx_promotion_requirements_tenant_run
    on public.promotion_requirements (tenant_id, run_id, updated_at desc);

create index if not exists idx_registry_audit_log_registry_timestamp
    on public.registry_audit_log (tenant_id, registry_id, "timestamp" desc);

create index if not exists idx_registry_audit_log_tenant_timestamp
    on public.registry_audit_log (tenant_id, "timestamp" desc);

create index if not exists idx_model_registry_routing_tenant_family
    on public.model_registry_routing (tenant_id, model_family);

drop trigger if exists set_updated_at_promotion_requirements on public.promotion_requirements;
create trigger set_updated_at_promotion_requirements
    before update on public.promotion_requirements
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_model_registry_routing on public.model_registry_routing;
create trigger set_updated_at_model_registry_routing
    before update on public.model_registry_routing
    for each row execute function public.trigger_set_updated_at();

alter table public.promotion_requirements enable row level security;
alter table public.registry_audit_log enable row level security;
alter table public.model_registry_routing enable row level security;

drop policy if exists promotion_requirements_select_own on public.promotion_requirements;
create policy promotion_requirements_select_own
    on public.promotion_requirements
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists promotion_requirements_insert_own on public.promotion_requirements;
create policy promotion_requirements_insert_own
    on public.promotion_requirements
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists promotion_requirements_update_own on public.promotion_requirements;
create policy promotion_requirements_update_own
    on public.promotion_requirements
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists registry_audit_log_select_own on public.registry_audit_log;
create policy registry_audit_log_select_own
    on public.registry_audit_log
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists registry_audit_log_insert_own on public.registry_audit_log;
create policy registry_audit_log_insert_own
    on public.registry_audit_log
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists model_registry_routing_select_own on public.model_registry_routing;
create policy model_registry_routing_select_own
    on public.model_registry_routing
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists model_registry_routing_insert_own on public.model_registry_routing;
create policy model_registry_routing_insert_own
    on public.model_registry_routing
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists model_registry_routing_update_own on public.model_registry_routing;
create policy model_registry_routing_update_own
    on public.model_registry_routing
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

update public.model_registry mr
set
    model_name = coalesce(mr.model_name, er.model_arch, er.model_version, mr.model_version),
    model_family = coalesce(
        nullif(mr.model_family, ''),
        public.resolve_registry_model_family(er.task_type, er.target_type, er.model_arch)
    ),
    artifact_uri = coalesce(
        mr.artifact_uri,
        mr.artifact_path,
        (
            select ea.uri
            from public.experiment_artifacts ea
            where ea.tenant_id = er.tenant_id
              and ea.run_id = er.run_id
              and ea.uri is not null
            order by ea.is_primary desc, ea.created_at asc
            limit 1
        )
    ),
    dataset_version = coalesce(mr.dataset_version, er.dataset_version, er.dataset_name),
    feature_schema_version = coalesce(mr.feature_schema_version, er.feature_schema_version),
    label_policy_version = coalesce(mr.label_policy_version, er.label_policy_version),
    lifecycle_status = coalesce(
        nullif(mr.lifecycle_status, ''),
        case
            when mr.status = 'production' then 'production'
            when mr.status = 'staging' then 'staging'
            when mr.status = 'archived' then 'archived'
            when er.status in ('queued', 'initializing', 'training', 'validating', 'checkpointing') then 'training'
            else 'candidate'
        end
    ),
    registry_role = coalesce(
        nullif(mr.registry_role, ''),
        case
            when mr.role in ('champion', 'challenger', 'experimental', 'rollback_target') then mr.role
            when mr.status = 'production' then 'champion'
            when mr.status = 'staging' then 'challenger'
            else 'experimental'
        end
    ),
    deployed_at = case
        when coalesce(mr.lifecycle_status, mr.status) = 'production' then coalesce(mr.deployed_at, mr.updated_at, mr.created_at)
        else mr.deployed_at
    end,
    archived_at = case
        when coalesce(mr.lifecycle_status, mr.status) = 'archived' then coalesce(mr.archived_at, mr.updated_at, mr.created_at)
        else mr.archived_at
    end
from public.experiment_runs er
where er.tenant_id = mr.tenant_id
  and er.run_id = mr.run_id;

update public.model_registry
set
    model_name = coalesce(model_name, model_version),
    model_family = coalesce(nullif(model_family, ''), 'diagnostics'),
    artifact_uri = coalesce(artifact_uri, artifact_path),
    dataset_version = coalesce(dataset_version, model_version),
    lifecycle_status = coalesce(nullif(lifecycle_status, ''), coalesce(nullif(status, ''), 'candidate')),
    registry_role = coalesce(nullif(registry_role, ''), coalesce(nullif(role, ''), 'experimental')),
    status = coalesce(nullif(lifecycle_status, ''), coalesce(nullif(status, ''), 'candidate')),
    role = coalesce(nullif(registry_role, ''), coalesce(nullif(role, ''), 'experimental')),
    artifact_path = coalesce(artifact_uri, artifact_path);

update public.model_registry mr
set
    clinical_metrics = jsonb_strip_nulls(
        jsonb_build_object(
            'global_accuracy', (
                select em.val_accuracy
                from public.experiment_metrics em
                where em.tenant_id = mr.tenant_id
                  and em.run_id = mr.run_id
                order by em.metric_timestamp desc
                limit 1
            ),
            'macro_f1', (
                select em.macro_f1
                from public.experiment_metrics em
                where em.tenant_id = mr.tenant_id
                  and em.run_id = mr.run_id
                order by em.metric_timestamp desc
                limit 1
            ),
            'critical_recall', (
                select em.recall_critical
                from public.experiment_metrics em
                where em.tenant_id = mr.tenant_id
                  and em.run_id = mr.run_id
                order by em.metric_timestamp desc
                limit 1
            ),
            'false_reassurance_rate', (
                select am.dangerous_false_reassurance_rate
                from public.adversarial_metrics am
                where am.tenant_id = mr.tenant_id
                  and am.run_id = mr.run_id
                limit 1
            ),
            'fn_critical_rate', (
                select em.false_negative_critical_rate
                from public.experiment_metrics em
                where em.tenant_id = mr.tenant_id
                  and em.run_id = mr.run_id
                order by em.metric_timestamp desc
                limit 1
            ),
            'ece', (
                select cm.ece
                from public.calibration_metrics cm
                where cm.tenant_id = mr.tenant_id
                  and cm.run_id = mr.run_id
                limit 1
            ),
            'brier_score', (
                select cm.brier_score
                from public.calibration_metrics cm
                where cm.tenant_id = mr.tenant_id
                  and cm.run_id = mr.run_id
                limit 1
            ),
            'adversarial_degradation', (
                select am.degradation_score
                from public.adversarial_metrics am
                where am.tenant_id = mr.tenant_id
                  and am.run_id = mr.run_id
                limit 1
            ),
            'latency_p99', (
                select coalesce(
                    nullif(er.resource_usage ->> 'latency_p99', '')::double precision,
                    nullif(er.resource_usage ->> 'inference_latency_p99_ms', '')::double precision
                )
                from public.experiment_runs er
                where er.tenant_id = mr.tenant_id
                  and er.run_id = mr.run_id
                limit 1
            )
        )
    ),
    lineage = jsonb_strip_nulls(
        jsonb_build_object(
            'run_id', mr.run_id,
            'experiment_group', (
                select er.experiment_group_id
                from public.experiment_runs er
                where er.tenant_id = mr.tenant_id
                  and er.run_id = mr.run_id
                limit 1
            ),
            'dataset_version', mr.dataset_version,
            'benchmark_id', (
                select eb.id::text
                from public.experiment_benchmarks eb
                where eb.tenant_id = mr.tenant_id
                  and eb.run_id = mr.run_id
                order by eb.created_at desc
                limit 1
            ),
            'calibration_report_uri', (
                select ea.uri
                from public.experiment_artifacts ea
                where ea.tenant_id = mr.tenant_id
                  and ea.run_id = mr.run_id
                  and ea.artifact_type = 'calibration_report'
                order by ea.created_at desc
                limit 1
            ),
            'adversarial_report_uri', (
                select ea.uri
                from public.experiment_artifacts ea
                where ea.tenant_id = mr.tenant_id
                  and ea.run_id = mr.run_id
                  and ea.artifact_type = 'adversarial_report'
                order by ea.created_at desc
                limit 1
            )
        )
    );

insert into public.promotion_requirements (
    tenant_id,
    registry_id,
    run_id,
    calibration_pass,
    adversarial_pass,
    safety_pass,
    benchmark_pass,
    manual_approval
)
select
    mr.tenant_id,
    mr.registry_id,
    mr.run_id,
    cm.calibration_pass,
    am.adversarial_pass,
    dd.safety_pass,
    (
        select case
            when count(*) filter (where lower(coalesce(eb.pass_status, 'pending')) = 'fail') > 0 then false
            when count(*) > 0 then true
            else null
        end
        from public.experiment_benchmarks eb
        where eb.tenant_id = mr.tenant_id
          and eb.run_id = mr.run_id
    ),
    case
        when mr.lifecycle_status = 'production' and mr.registry_role = 'champion' then true
        else dd.manual_approval
    end
from public.model_registry mr
left join public.calibration_metrics cm
  on cm.tenant_id = mr.tenant_id
 and cm.run_id = mr.run_id
left join public.adversarial_metrics am
  on am.tenant_id = mr.tenant_id
 and am.run_id = mr.run_id
left join public.deployment_decisions dd
  on dd.tenant_id = mr.tenant_id
 and dd.run_id = mr.run_id
on conflict (tenant_id, registry_id) do update
set
    calibration_pass = excluded.calibration_pass,
    adversarial_pass = excluded.adversarial_pass,
    safety_pass = excluded.safety_pass,
    benchmark_pass = excluded.benchmark_pass,
    manual_approval = coalesce(public.promotion_requirements.manual_approval, excluded.manual_approval);

update public.deployment_decisions dd
set
    benchmark_pass = pr.benchmark_pass,
    manual_approval = pr.manual_approval
from public.promotion_requirements pr
where pr.tenant_id = dd.tenant_id
  and pr.run_id = dd.run_id
  and (dd.benchmark_pass is distinct from pr.benchmark_pass or dd.manual_approval is distinct from pr.manual_approval);

insert into public.model_registry_routing (
    tenant_id,
    model_family,
    active_registry_id,
    active_run_id,
    updated_by
)
select
    mr.tenant_id,
    mr.model_family,
    mr.registry_id,
    mr.run_id,
    mr.created_by
from public.model_registry mr
where mr.lifecycle_status = 'production'
  and mr.registry_role = 'champion'
on conflict (tenant_id, model_family) do update
set
    active_registry_id = excluded.active_registry_id,
    active_run_id = excluded.active_run_id,
    updated_by = excluded.updated_by,
    updated_at = now();

insert into public.registry_audit_log (
    event_id,
    tenant_id,
    registry_id,
    run_id,
    event_type,
    actor,
    metadata,
    "timestamp"
)
select
    'evt_registry_registered_' || left(regexp_replace(lower(mr.registry_id), '[^a-z0-9]+', '_', 'g'), 100),
    mr.tenant_id,
    mr.registry_id,
    mr.run_id,
    'registered',
    mr.created_by,
    jsonb_build_object(
        'lifecycle_status', mr.lifecycle_status,
        'registry_role', mr.registry_role,
        'model_family', mr.model_family,
        'model_version', mr.model_version
    ),
    mr.created_at
from public.model_registry mr
on conflict (event_id) do nothing;

create or replace function public.promote_registry_model_to_production(
    p_tenant_id uuid,
    p_run_id text,
    p_actor text default null
)
returns public.model_registry
language plpgsql
security definer
set search_path = public
as $$
declare
    now_ts timestamptz := now();
    target public.model_registry;
    previous_champion public.model_registry;
    promotion public.promotion_requirements;
begin
    select * into target
    from public.model_registry
    where tenant_id = p_tenant_id
      and run_id = p_run_id
    for update;

    if not found then
        raise exception 'Registry record not found for run %', p_run_id;
    end if;

    if target.lifecycle_status = 'archived' then
        raise exception 'Archived models cannot be promoted.';
    end if;

    if target.lifecycle_status <> 'staging' or target.registry_role <> 'challenger' then
        raise exception 'Only staging challenger models can be promoted to production.';
    end if;

    select * into promotion
    from public.promotion_requirements
    where tenant_id = p_tenant_id
      and registry_id = target.registry_id
    for update;

    if not found then
        raise exception 'Promotion requirements not found for registry %', target.registry_id;
    end if;

    if coalesce(promotion.calibration_pass, false) <> true
        or coalesce(promotion.adversarial_pass, false) <> true
        or coalesce(promotion.safety_pass, false) <> true
        or coalesce(promotion.benchmark_pass, false) <> true
        or coalesce(promotion.manual_approval, false) <> true then
        raise exception 'Promotion requirements are not satisfied for registry %', target.registry_id;
    end if;

    select * into previous_champion
    from public.model_registry
    where tenant_id = p_tenant_id
      and model_family = target.model_family
      and lifecycle_status = 'production'
      and registry_role = 'champion'
      and registry_id <> target.registry_id
    for update;

    if found then
        update public.model_registry
        set
            lifecycle_status = 'archived',
            registry_role = 'rollback_target',
            status = 'archived',
            role = 'rollback_target',
            archived_at = now_ts,
            rollback_metadata = null
        where registry_id = previous_champion.registry_id;

        update public.experiment_runs
        set
            registry_context = coalesce(registry_context, '{}'::jsonb)
                || jsonb_build_object(
                    'registry_id', previous_champion.registry_id,
                    'registry_link_state', 'linked',
                    'registry_status', 'archived',
                    'registry_role', 'rollback_target',
                    'champion_or_challenger', 'rollback_target',
                    'promotion_status', 'archived',
                    'rollback_target', null,
                    'model_family', previous_champion.model_family
                )
        where tenant_id = p_tenant_id
          and run_id = previous_champion.run_id;

        update public.experiment_registry_links
        set
            registry_candidate_id = previous_champion.registry_id,
            champion_or_challenger = 'rollback_target',
            promotion_status = 'archived',
            deployment_eligibility = 'blocked',
            updated_at = now_ts
        where tenant_id = p_tenant_id
          and run_id = previous_champion.run_id;

        insert into public.registry_audit_log (
            event_id,
            tenant_id,
            registry_id,
            run_id,
            event_type,
            actor,
            metadata,
            "timestamp"
        )
        values (
            'evt_registry_archived_' || left(regexp_replace(lower(previous_champion.registry_id || '_' || target.registry_id || '_' || now_ts::text), '[^a-z0-9]+', '_', 'g'), 100),
            p_tenant_id,
            previous_champion.registry_id,
            previous_champion.run_id,
            'archived',
            p_actor,
            jsonb_build_object(
                'reason', 'superseded_by_promotion',
                'replaced_by', target.registry_id,
                'model_family', previous_champion.model_family
            ),
            now_ts
        )
        on conflict (event_id) do nothing;
    end if;

    update public.model_registry
    set
        lifecycle_status = 'production',
        registry_role = 'champion',
        status = 'production',
        role = 'champion',
        deployed_at = now_ts,
        archived_at = null,
        promoted_from = coalesce(previous_champion.registry_id, promoted_from),
        rollback_target = previous_champion.registry_id,
        rollback_metadata = null,
        artifact_path = coalesce(artifact_uri, artifact_path)
    where registry_id = target.registry_id
    returning * into target;

    insert into public.model_registry_routing (
        tenant_id,
        model_family,
        active_registry_id,
        active_run_id,
        updated_by
    )
    values (
        p_tenant_id,
        target.model_family,
        target.registry_id,
        target.run_id,
        p_actor
    )
    on conflict (tenant_id, model_family) do update
    set
        active_registry_id = excluded.active_registry_id,
        active_run_id = excluded.active_run_id,
        updated_by = excluded.updated_by,
        updated_at = now();

    update public.experiment_runs
    set
        status = 'promoted',
        registry_id = target.registry_id,
        registry_context = coalesce(registry_context, '{}'::jsonb)
            || jsonb_build_object(
                'registry_id', target.registry_id,
                'registry_link_state', 'linked',
                'registry_status', 'production',
                'registry_role', 'champion',
                'champion_or_challenger', 'champion',
                'promotion_status', 'production',
                'rollback_target', previous_champion.registry_id,
                'model_family', target.model_family,
                'active_routing_registry_id', target.registry_id
            )
    where tenant_id = p_tenant_id
      and run_id = target.run_id;

    update public.experiment_registry_links
    set
        registry_candidate_id = target.registry_id,
        champion_or_challenger = 'champion',
        promotion_status = 'production',
        benchmark_status = case when coalesce(promotion.benchmark_pass, false) then 'passed' else 'failed' end,
        manual_approval_status = 'passed',
        deployment_eligibility = 'eligible_review',
        updated_at = now_ts
    where tenant_id = p_tenant_id
      and run_id = target.run_id;

    update public.deployment_decisions
    set
        decision = 'approved',
        benchmark_pass = promotion.benchmark_pass,
        manual_approval = true,
        approved_by = coalesce(p_actor, approved_by),
        "timestamp" = now_ts,
        updated_at = now_ts
    where tenant_id = p_tenant_id
      and run_id = target.run_id;

    insert into public.registry_audit_log (
        event_id,
        tenant_id,
        registry_id,
        run_id,
        event_type,
        actor,
        metadata,
        "timestamp"
    )
    values (
        'evt_registry_promoted_' || left(regexp_replace(lower(target.registry_id || '_' || now_ts::text), '[^a-z0-9]+', '_', 'g'), 100),
        p_tenant_id,
        target.registry_id,
        target.run_id,
        'promoted',
        p_actor,
        jsonb_build_object(
            'promoted_from', previous_champion.registry_id,
            'model_family', target.model_family,
            'routing_registry_id', target.registry_id
        ),
        now_ts
    )
    on conflict (event_id) do nothing;

    return target;
end;
$$;

create or replace function public.rollback_registry_model_to_target(
    p_tenant_id uuid,
    p_run_id text,
    p_actor text default null,
    p_reason text default 'clinical_safety_incident',
    p_incident_id text default null
)
returns public.model_registry
language plpgsql
security definer
set search_path = public
as $$
declare
    now_ts timestamptz := now();
    current_champion public.model_registry;
    restore_target public.model_registry;
    rollback_details jsonb;
begin
    select * into current_champion
    from public.model_registry
    where tenant_id = p_tenant_id
      and run_id = p_run_id
    for update;

    if not found then
        raise exception 'Registry record not found for run %', p_run_id;
    end if;

    if current_champion.lifecycle_status <> 'production' or current_champion.registry_role <> 'champion' then
        raise exception 'Only the active production champion can be rolled back.';
    end if;

    select * into restore_target
    from public.model_registry
    where tenant_id = p_tenant_id
      and registry_id = coalesce(
        current_champion.rollback_target,
        (
            select mr.registry_id
            from public.model_registry mr
            where mr.tenant_id = p_tenant_id
              and mr.model_family = current_champion.model_family
              and mr.registry_role = 'rollback_target'
            order by coalesce(mr.deployed_at, mr.updated_at, mr.created_at) desc
            limit 1
        )
      )
    for update;

    if not found then
        raise exception 'No rollback target exists for registry %', current_champion.registry_id;
    end if;

    rollback_details := jsonb_build_object(
        'triggered_at', now_ts,
        'triggered_by', p_actor,
        'reason', coalesce(nullif(p_reason, ''), 'clinical_safety_incident'),
        'incident_id', p_incident_id
    );

    update public.model_registry
    set
        lifecycle_status = 'archived',
        registry_role = 'experimental',
        status = 'archived',
        role = 'experimental',
        archived_at = now_ts,
        rollback_metadata = rollback_details
    where registry_id = current_champion.registry_id;

    update public.model_registry
    set
        lifecycle_status = 'production',
        registry_role = 'champion',
        status = 'production',
        role = 'champion',
        deployed_at = now_ts,
        archived_at = null,
        promoted_from = current_champion.registry_id,
        rollback_target = current_champion.registry_id,
        rollback_metadata = null,
        artifact_path = coalesce(artifact_uri, artifact_path)
    where registry_id = restore_target.registry_id
    returning * into restore_target;

    insert into public.model_registry_routing (
        tenant_id,
        model_family,
        active_registry_id,
        active_run_id,
        updated_by
    )
    values (
        p_tenant_id,
        restore_target.model_family,
        restore_target.registry_id,
        restore_target.run_id,
        p_actor
    )
    on conflict (tenant_id, model_family) do update
    set
        active_registry_id = excluded.active_registry_id,
        active_run_id = excluded.active_run_id,
        updated_by = excluded.updated_by,
        updated_at = now();

    update public.experiment_runs
    set
        status = 'rolled_back',
        registry_id = current_champion.registry_id,
        registry_context = coalesce(registry_context, '{}'::jsonb)
            || jsonb_build_object(
                'registry_id', current_champion.registry_id,
                'registry_link_state', 'linked',
                'registry_status', 'archived',
                'registry_role', 'experimental',
                'champion_or_challenger', 'experimental',
                'promotion_status', 'archived',
                'rollback_target', restore_target.registry_id,
                'model_family', current_champion.model_family
            )
    where tenant_id = p_tenant_id
      and run_id = current_champion.run_id;

    update public.experiment_runs
    set
        status = 'promoted',
        registry_id = restore_target.registry_id,
        registry_context = coalesce(registry_context, '{}'::jsonb)
            || jsonb_build_object(
                'registry_id', restore_target.registry_id,
                'registry_link_state', 'linked',
                'registry_status', 'production',
                'registry_role', 'champion',
                'champion_or_challenger', 'champion',
                'promotion_status', 'production',
                'rollback_target', current_champion.registry_id,
                'model_family', restore_target.model_family,
                'active_routing_registry_id', restore_target.registry_id
            )
    where tenant_id = p_tenant_id
      and run_id = restore_target.run_id;

    update public.experiment_registry_links
    set
        registry_candidate_id = current_champion.registry_id,
        champion_or_challenger = 'experimental',
        promotion_status = 'archived',
        deployment_eligibility = 'blocked',
        updated_at = now_ts
    where tenant_id = p_tenant_id
      and run_id = current_champion.run_id;

    update public.experiment_registry_links
    set
        registry_candidate_id = restore_target.registry_id,
        champion_or_challenger = 'champion',
        promotion_status = 'production',
        deployment_eligibility = 'eligible_review',
        updated_at = now_ts
    where tenant_id = p_tenant_id
      and run_id = restore_target.run_id;

    insert into public.registry_audit_log (
        event_id,
        tenant_id,
        registry_id,
        run_id,
        event_type,
        actor,
        metadata,
        "timestamp"
    )
    values (
        'evt_registry_rollback_' || left(regexp_replace(lower(current_champion.registry_id || '_' || restore_target.registry_id || '_' || now_ts::text), '[^a-z0-9]+', '_', 'g'), 100),
        p_tenant_id,
        restore_target.registry_id,
        restore_target.run_id,
        'rolled_back',
        p_actor,
        jsonb_build_object(
            'restored_from', current_champion.registry_id,
            'rollback_metadata', rollback_details,
            'model_family', restore_target.model_family
        ),
        now_ts
    )
    on conflict (event_id) do nothing;

    return restore_target;
end;
$$;

notify pgrst, 'reload schema';
