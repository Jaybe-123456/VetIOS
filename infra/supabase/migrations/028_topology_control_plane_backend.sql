-- =============================================================================
-- Migration 028: Topology Control Plane Backend
-- Canonical evaluation events, unified telemetry, alert persistence, and backfill
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

create or replace function public.safe_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
declare
    parsed uuid;
begin
    if p_value is null or btrim(p_value) = '' then
        return null;
    end if;

    parsed := p_value::uuid;
    return parsed;
exception
    when others then
        return null;
end;
$$;

create table if not exists public.model_evaluation_events (
    id uuid primary key default gen_random_uuid(),
    evaluation_event_id uuid not null unique default gen_random_uuid(),
    tenant_id text not null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    outcome_event_id uuid references public.clinical_outcome_events(id) on delete set null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    trigger_type text not null check (trigger_type in ('inference', 'outcome', 'simulation')),
    model_name text not null default 'unknown',
    model_version text not null default 'unknown',
    prediction text,
    prediction_confidence double precision,
    ground_truth text,
    prediction_correct boolean,
    condition_class_pred text,
    condition_class_true text,
    severity_pred text,
    severity_true text,
    contradiction_score double precision,
    adversarial_case boolean not null default false,
    calibration_error double precision,
    drift_score double precision,
    outcome_alignment_delta double precision,
    simulation_degradation double precision,
    calibrated_confidence double precision,
    epistemic_uncertainty double precision,
    aleatoric_uncertainty double precision,
    evaluation_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.model_evaluation_events
    add column if not exists evaluation_event_id uuid,
    add column if not exists case_id uuid,
    add column if not exists prediction text,
    add column if not exists prediction_confidence double precision,
    add column if not exists ground_truth text,
    add column if not exists prediction_correct boolean,
    add column if not exists condition_class_pred text,
    add column if not exists condition_class_true text,
    add column if not exists severity_pred text,
    add column if not exists severity_true text,
    add column if not exists contradiction_score double precision,
    add column if not exists adversarial_case boolean not null default false;

update public.model_evaluation_events
set evaluation_event_id = coalesce(evaluation_event_id, id, gen_random_uuid())
where evaluation_event_id is null;

alter table public.model_evaluation_events
    alter column evaluation_event_id set default gen_random_uuid();

alter table public.model_evaluation_events
    alter column evaluation_event_id set not null;

create unique index if not exists idx_model_evaluation_events_event_id
    on public.model_evaluation_events (evaluation_event_id);

create unique index if not exists idx_model_evaluation_events_outcome_unique
    on public.model_evaluation_events (outcome_event_id)
    where outcome_event_id is not null;

create index if not exists idx_model_evaluation_events_model_created
    on public.model_evaluation_events (tenant_id, model_version, created_at desc);

create index if not exists idx_model_evaluation_events_case_created
    on public.model_evaluation_events (tenant_id, case_id, created_at desc)
    where case_id is not null;

create table if not exists public.telemetry_events (
    event_id text primary key,
    tenant_id text not null,
    linked_event_id text references public.telemetry_events(event_id) on delete set null,
    source_id uuid,
    source_table text,
    event_type text not null check (event_type in ('inference', 'outcome', 'evaluation', 'simulation', 'system', 'training')),
    "timestamp" timestamptz not null default now(),
    model_version text not null default 'unknown',
    run_id text not null default 'unknown',
    metrics jsonb not null default '{}'::jsonb,
    system jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

do $$
declare
    pol record;
begin
    for pol in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = 'telemetry_events'
    loop
        execute format('drop policy if exists %I on public.telemetry_events', pol.policyname);
    end loop;
end $$;

do $$
begin
    if exists (
        select 1
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'telemetry_events'
          and constraint_name = 'telemetry_events_tenant_id_fkey'
    ) then
        alter table public.telemetry_events
            drop constraint telemetry_events_tenant_id_fkey;
    end if;
exception
    when undefined_table then
        null;
end $$;

alter table public.telemetry_events
    add column if not exists source_id uuid,
    add column if not exists source_table text;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'telemetry_events'
          and column_name = 'tenant_id'
          and data_type = 'uuid'
    ) then
        alter table public.telemetry_events
            alter column tenant_id type text using tenant_id::text;
    end if;
exception
    when undefined_table then
        null;
end $$;

alter table public.telemetry_events
    alter column model_version set default 'unknown',
    alter column run_id set default 'unknown';

update public.telemetry_events
set
    model_version = coalesce(nullif(model_version, ''), 'unknown'),
    run_id = coalesce(nullif(run_id, ''), 'unknown')
where model_version is null
   or run_id is null
   or btrim(model_version) = ''
   or btrim(run_id) = '';

alter table public.telemetry_events
    alter column model_version set not null,
    alter column run_id set not null;

alter table public.telemetry_events
    drop constraint if exists telemetry_events_event_type_check;

alter table public.telemetry_events
    add constraint telemetry_events_event_type_check
    check (event_type in ('inference', 'outcome', 'evaluation', 'simulation', 'system', 'training'));

create index if not exists idx_telemetry_events_tenant_timestamp
    on public.telemetry_events (tenant_id, "timestamp" desc);

create index if not exists idx_telemetry_events_tenant_type_timestamp
    on public.telemetry_events (tenant_id, event_type, "timestamp" desc);

create index if not exists idx_telemetry_events_source_id
    on public.telemetry_events (tenant_id, source_id, "timestamp" desc)
    where source_id is not null;

create index if not exists idx_telemetry_events_linked
    on public.telemetry_events (tenant_id, linked_event_id)
    where linked_event_id is not null;

create index if not exists idx_telemetry_events_model_version
    on public.telemetry_events (tenant_id, model_version, "timestamp" desc);

create table if not exists public.control_plane_alerts (
    id uuid primary key default gen_random_uuid(),
    alert_key text not null,
    tenant_id text not null,
    severity text not null check (severity in ('info', 'warning', 'critical')),
    title text not null,
    message text not null,
    node_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved boolean not null default false,
    resolved_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    constraint control_plane_alerts_tenant_alert_key unique (tenant_id, alert_key)
);

create index if not exists idx_control_plane_alerts_tenant_created
    on public.control_plane_alerts (tenant_id, created_at desc);

create index if not exists idx_control_plane_alerts_tenant_resolved
    on public.control_plane_alerts (tenant_id, resolved, updated_at desc);

drop trigger if exists set_updated_at_control_plane_alerts on public.control_plane_alerts;
create trigger set_updated_at_control_plane_alerts
    before update on public.control_plane_alerts
    for each row execute function public.trigger_set_updated_at();

alter table public.model_evaluation_events enable row level security;
alter table public.telemetry_events enable row level security;
alter table public.control_plane_alerts enable row level security;

drop policy if exists tenant_insert_eval on public.model_evaluation_events;
drop policy if exists tenant_select_eval on public.model_evaluation_events;
drop policy if exists tenant_insert_eval_current on public.model_evaluation_events;
drop policy if exists tenant_select_eval_current on public.model_evaluation_events;

create policy tenant_insert_eval_current
    on public.model_evaluation_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

create policy tenant_select_eval_current
    on public.model_evaluation_events
    for select using (tenant_id = public.current_tenant_id()::text);

create policy telemetry_events_select_own
    on public.telemetry_events
    for select using (tenant_id = public.current_tenant_id()::text);

create policy telemetry_events_insert_own
    on public.telemetry_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

create policy telemetry_events_update_own
    on public.telemetry_events
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists control_plane_alerts_select_own on public.control_plane_alerts;
drop policy if exists control_plane_alerts_insert_own on public.control_plane_alerts;
drop policy if exists control_plane_alerts_update_own on public.control_plane_alerts;

create policy control_plane_alerts_select_own
    on public.control_plane_alerts
    for select using (tenant_id = public.current_tenant_id()::text);

create policy control_plane_alerts_insert_own
    on public.control_plane_alerts
    for insert with check (tenant_id = public.current_tenant_id()::text);

create policy control_plane_alerts_update_own
    on public.control_plane_alerts
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

insert into public.model_evaluation_events (
    evaluation_event_id,
    tenant_id,
    inference_event_id,
    outcome_event_id,
    case_id,
    trigger_type,
    model_name,
    model_version,
    prediction,
    prediction_confidence,
    ground_truth,
    prediction_correct,
    condition_class_pred,
    condition_class_true,
    severity_pred,
    severity_true,
    contradiction_score,
    adversarial_case,
    calibration_error,
    drift_score,
    outcome_alignment_delta,
    calibrated_confidence,
    evaluation_payload,
    created_at
)
select
    gen_random_uuid(),
    coalesce(aie.tenant_id, coe.tenant_id),
    aie.id,
    coe.id,
    coalesce(coe.case_id, aie.case_id),
    'outcome',
    coalesce(nullif(aie.model_name, ''), 'unknown'),
    coalesce(nullif(aie.model_version, ''), 'unknown'),
    coalesce(
        aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
        aie.output_payload -> 'diagnosis' ->> 'primary_condition_class',
        aie.output_payload ->> 'prediction'
    ),
    aie.confidence_score,
    coalesce(
        nullif(coe.outcome_payload ->> 'confirmed_diagnosis', ''),
        nullif(coe.outcome_payload ->> 'final_diagnosis', ''),
        nullif(coe.outcome_payload ->> 'diagnosis', '')
    ),
    case
        when coalesce(
            nullif(aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name', ''),
            nullif(aie.output_payload -> 'diagnosis' ->> 'primary_condition_class', ''),
            nullif(aie.output_payload ->> 'prediction', '')
        ) is null then null
        when coalesce(
            nullif(coe.outcome_payload ->> 'confirmed_diagnosis', ''),
            nullif(coe.outcome_payload ->> 'final_diagnosis', ''),
            nullif(coe.outcome_payload ->> 'diagnosis', '')
        ) is null then null
        else lower(btrim(coalesce(
            aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
            aie.output_payload -> 'diagnosis' ->> 'primary_condition_class',
            aie.output_payload ->> 'prediction'
        ))) = lower(btrim(coalesce(
            coe.outcome_payload ->> 'confirmed_diagnosis',
            coe.outcome_payload ->> 'final_diagnosis',
            coe.outcome_payload ->> 'diagnosis'
        )))
    end,
    coalesce(
        nullif(aie.output_payload -> 'diagnosis' ->> 'primary_condition_class', ''),
        nullif(aie.output_payload ->> 'condition_class', '')
    ),
    coalesce(
        nullif(coe.outcome_payload ->> 'primary_condition_class', ''),
        nullif(coe.outcome_payload ->> 'condition_class', '')
    ),
    coalesce(
        nullif(aie.output_payload -> 'risk_assessment' ->> 'emergency_level', ''),
        nullif(aie.output_payload -> 'risk_assessment' ->> 'severity_score', '')
    ),
    coalesce(
        nullif(coe.outcome_payload ->> 'emergency_level', ''),
        nullif(coe.outcome_payload ->> 'severity_score', '')
    ),
    coalesce(
        nullif(aie.output_payload -> 'contradiction_analysis' ->> 'contradiction_score', '')::double precision,
        cc.contradiction_score
    ),
    coalesce(cc.adversarial_case, false),
    case
        when aie.confidence_score is null then null
        when coalesce(
            nullif(coe.outcome_payload ->> 'confirmed_diagnosis', ''),
            nullif(coe.outcome_payload ->> 'final_diagnosis', ''),
            nullif(coe.outcome_payload ->> 'diagnosis', '')
        ) is null then null
        when coalesce(
            nullif(aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name', ''),
            nullif(aie.output_payload -> 'diagnosis' ->> 'primary_condition_class', ''),
            nullif(aie.output_payload ->> 'prediction', '')
        ) is null then null
        else abs(
            greatest(0, least(1, aie.confidence_score))
            - case
                when lower(btrim(coalesce(
                    aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
                    aie.output_payload -> 'diagnosis' ->> 'primary_condition_class',
                    aie.output_payload ->> 'prediction'
                ))) = lower(btrim(coalesce(
                    coe.outcome_payload ->> 'confirmed_diagnosis',
                    coe.outcome_payload ->> 'final_diagnosis',
                    coe.outcome_payload ->> 'diagnosis'
                ))) then 1
                else 0
            end
        )
    end,
    null,
    case
        when coalesce(
            nullif(aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name', ''),
            nullif(aie.output_payload -> 'diagnosis' ->> 'primary_condition_class', ''),
            nullif(aie.output_payload ->> 'prediction', '')
        ) is null then null
        when coalesce(
            nullif(coe.outcome_payload ->> 'confirmed_diagnosis', ''),
            nullif(coe.outcome_payload ->> 'final_diagnosis', ''),
            nullif(coe.outcome_payload ->> 'diagnosis', '')
        ) is null then null
        when lower(btrim(coalesce(
            aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
            aie.output_payload -> 'diagnosis' ->> 'primary_condition_class',
            aie.output_payload ->> 'prediction'
        ))) = lower(btrim(coalesce(
            coe.outcome_payload ->> 'confirmed_diagnosis',
            coe.outcome_payload ->> 'final_diagnosis',
            coe.outcome_payload ->> 'diagnosis'
        ))) then 0
        else 1
    end,
    aie.confidence_score,
    jsonb_strip_nulls(jsonb_build_object(
        'backfilled', true,
        'source', '028_topology_control_plane_backend',
        'condition_class_pred', coalesce(
            nullif(aie.output_payload -> 'diagnosis' ->> 'primary_condition_class', ''),
            nullif(aie.output_payload ->> 'condition_class', '')
        ),
        'condition_class_true', coalesce(
            nullif(coe.outcome_payload ->> 'primary_condition_class', ''),
            nullif(coe.outcome_payload ->> 'condition_class', '')
        )
    )),
    coalesce(coe.outcome_timestamp, coe.created_at, aie.created_at)
from public.clinical_outcome_events coe
join public.ai_inference_events aie
  on aie.id = coe.inference_event_id
left join public.clinical_cases cc
  on cc.id = coalesce(coe.case_id, aie.case_id)
where not exists (
    select 1
    from public.model_evaluation_events existing
    where existing.outcome_event_id = coe.id
);

insert into public.telemetry_events (
    event_id,
    tenant_id,
    linked_event_id,
    source_id,
    source_table,
    event_type,
    "timestamp",
    model_version,
    run_id,
    metrics,
    system,
    metadata
)
select
    'evt_inference_' || aie.id::text,
    aie.tenant_id::text,
    null,
    aie.id,
    'ai_inference_events',
    'inference',
    coalesce(aie.created_at, now()),
    coalesce(nullif(aie.model_version, ''), 'unknown'),
    coalesce(
        nullif(aie.output_payload -> 'telemetry' ->> 'run_id', ''),
        nullif(aie.model_version, ''),
        'unknown'
    ),
    jsonb_strip_nulls(jsonb_build_object(
        'latency_ms', aie.inference_latency_ms,
        'confidence', aie.confidence_score,
        'prediction', coalesce(
            aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
            aie.output_payload -> 'diagnosis' ->> 'primary_condition_class',
            aie.output_payload ->> 'prediction'
        )
    )),
    jsonb_strip_nulls(jsonb_build_object(
        'cpu', case
            when jsonb_typeof(aie.compute_profile -> 'cpu') = 'number'
                then (aie.compute_profile ->> 'cpu')::double precision
            when jsonb_typeof(aie.compute_profile -> 'cpu_utilization') = 'number'
                then (aie.compute_profile ->> 'cpu_utilization')::double precision
            else null
        end,
        'gpu', case
            when jsonb_typeof(aie.compute_profile -> 'gpu') = 'number'
                then (aie.compute_profile ->> 'gpu')::double precision
            when jsonb_typeof(aie.compute_profile -> 'gpu_utilization') = 'number'
                then (aie.compute_profile ->> 'gpu_utilization')::double precision
            else null
        end,
        'memory', case
            when jsonb_typeof(aie.compute_profile -> 'memory') = 'number'
                then (aie.compute_profile ->> 'memory')::double precision
            when jsonb_typeof(aie.compute_profile -> 'memory_utilization') = 'number'
                then (aie.compute_profile ->> 'memory_utilization')::double precision
            else null
        end
    )),
    jsonb_strip_nulls(jsonb_build_object(
        'source_module', coalesce(aie.source_module, 'inference_backfill'),
        'inference_event_id', aie.id,
        'case_id', aie.case_id,
        'backfilled', true
    ))
from public.ai_inference_events aie
where not exists (
    select 1
    from public.telemetry_events existing
    where existing.event_id = 'evt_inference_' || aie.id::text
);

insert into public.telemetry_events (
    event_id,
    tenant_id,
    linked_event_id,
    source_id,
    source_table,
    event_type,
    "timestamp",
    model_version,
    run_id,
    metrics,
    metadata
)
select
    'evt_outcome_' || coe.id::text,
    coalesce(coe.tenant_id::text, aie.tenant_id::text),
    ti.event_id,
    coe.id,
    'clinical_outcome_events',
    'outcome',
    coalesce(coe.outcome_timestamp, coe.created_at),
    coalesce(nullif(aie.model_version, ''), 'unknown'),
    coalesce(
        nullif(aie.output_payload -> 'telemetry' ->> 'run_id', ''),
        nullif(aie.model_version, ''),
        'unknown'
    ),
    jsonb_strip_nulls(jsonb_build_object(
        'ground_truth', coalesce(
            nullif(coe.outcome_payload ->> 'confirmed_diagnosis', ''),
            nullif(coe.outcome_payload ->> 'final_diagnosis', ''),
            nullif(coe.outcome_payload ->> 'diagnosis', '')
        ),
        'correct', case
            when coalesce(
                nullif(aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name', ''),
                nullif(aie.output_payload -> 'diagnosis' ->> 'primary_condition_class', ''),
                nullif(aie.output_payload ->> 'prediction', '')
            ) is null then null
            when coalesce(
                nullif(coe.outcome_payload ->> 'confirmed_diagnosis', ''),
                nullif(coe.outcome_payload ->> 'final_diagnosis', ''),
                nullif(coe.outcome_payload ->> 'diagnosis', '')
            ) is null then null
            else lower(btrim(coalesce(
                aie.output_payload -> 'diagnosis' -> 'top_differentials' -> 0 ->> 'name',
                aie.output_payload -> 'diagnosis' ->> 'primary_condition_class',
                aie.output_payload ->> 'prediction'
            ))) = lower(btrim(coalesce(
                coe.outcome_payload ->> 'confirmed_diagnosis',
                coe.outcome_payload ->> 'final_diagnosis',
                coe.outcome_payload ->> 'diagnosis'
            )))
        end
    )),
    jsonb_build_object(
        'source_module', coalesce(coe.source_module, 'outcome_learning'),
        'inference_event_id', aie.id,
        'outcome_event_id', coe.id,
        'backfilled', true
    )
from public.clinical_outcome_events coe
join public.ai_inference_events aie
  on aie.id = coe.inference_event_id
left join public.telemetry_events ti
  on ti.event_id = 'evt_inference_' || aie.id::text
where ti.event_id is not null
  and not exists (
      select 1
      from public.telemetry_events existing
      where existing.event_id = 'evt_outcome_' || coe.id::text
  );

insert into public.telemetry_events (
    event_id,
    tenant_id,
    linked_event_id,
    source_id,
    source_table,
    event_type,
    "timestamp",
    model_version,
    run_id,
    metrics,
    metadata
)
select
    'evt_evaluation_' || coalesce(mee.evaluation_event_id::text, mee.id::text),
    mee.tenant_id::text,
    case
        when mee.inference_event_id is not null then ti.event_id
        else null
    end,
    coalesce(mee.evaluation_event_id, mee.id),
    'model_evaluation_events',
    'evaluation',
    mee.created_at,
    coalesce(nullif(mee.model_version, ''), 'unknown'),
    coalesce(
        nullif(aie.output_payload -> 'telemetry' ->> 'run_id', ''),
        nullif(mee.model_version, ''),
        'unknown'
    ),
    jsonb_strip_nulls(jsonb_build_object(
        'confidence', mee.prediction_confidence,
        'prediction', mee.prediction,
        'ground_truth', mee.ground_truth,
        'correct', mee.prediction_correct,
        'drift_score', mee.drift_score,
        'contradiction_score', mee.contradiction_score
    )),
    jsonb_strip_nulls(jsonb_build_object(
        'source', 'evaluation_backfill',
        'trigger_type', mee.trigger_type,
        'case_id', mee.case_id,
        'outcome_event_id', mee.outcome_event_id,
        'condition_class_pred', mee.condition_class_pred,
        'condition_class_true', mee.condition_class_true,
        'severity_pred', mee.severity_pred,
        'severity_true', mee.severity_true,
        'adversarial_case', mee.adversarial_case,
        'backfilled', true
    ))
from public.model_evaluation_events mee
left join public.ai_inference_events aie
  on aie.id = mee.inference_event_id
left join public.telemetry_events ti
  on mee.inference_event_id is not null
 and ti.event_id = 'evt_inference_' || mee.inference_event_id::text
where mee.prediction is not null
  and mee.ground_truth is not null
  and (mee.inference_event_id is null or ti.event_id is not null)
  and not exists (
      select 1
      from public.telemetry_events existing
      where existing.event_id = 'evt_evaluation_' || coalesce(mee.evaluation_event_id::text, mee.id::text)
  );

notify pgrst, 'reload schema';
