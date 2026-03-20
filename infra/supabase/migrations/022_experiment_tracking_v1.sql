-- =============================================================================
-- Migration 022: Experiment Tracking v1
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

create table if not exists public.experiment_runs (
    id                     uuid primary key default gen_random_uuid(),
    tenant_id              uuid not null,
    run_id                 text not null,
    experiment_group_id    text,
    sweep_id               text,
    parent_run_id          text,
    baseline_run_id        text,
    task_type              text not null,
    modality               text not null,
    target_type            text,
    model_arch             text not null,
    model_size             text,
    model_version          text,
    dataset_name           text not null,
    dataset_version        text,
    feature_schema_version text,
    label_policy_version   text,
    epochs_planned         integer,
    epochs_completed       integer not null default 0,
    metric_primary_name    text,
    metric_primary_value   double precision,
    status                 text not null,
    status_reason          text,
    progress_percent       double precision not null default 0,
    summary_only           boolean not null default false,
    created_by             uuid,
    hyperparameters        jsonb not null default '{}'::jsonb,
    dataset_lineage        jsonb not null default '{}'::jsonb,
    config_snapshot        jsonb not null default '{}'::jsonb,
    safety_metrics         jsonb not null default '{}'::jsonb,
    resource_usage         jsonb not null default '{}'::jsonb,
    registry_context       jsonb not null default '{}'::jsonb,
    last_heartbeat_at      timestamptz,
    started_at             timestamptz,
    ended_at               timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint experiment_runs_tenant_run_id_key unique (tenant_id, run_id),
    constraint experiment_runs_status_check check (status in (
        'queued',
        'initializing',
        'training',
        'validating',
        'checkpointing',
        'completed',
        'failed',
        'aborted',
        'promoted',
        'rolled_back'
    )),
    constraint experiment_runs_task_type_check check (task_type in (
        'clinical_diagnosis',
        'severity_prediction',
        'vision_classification',
        'multimodal_fusion',
        'calibration_model'
    )),
    constraint experiment_runs_modality_check check (modality in (
        'tabular_clinical',
        'imaging',
        'multimodal',
        'text_structured'
    ))
);

create index if not exists idx_experiment_runs_tenant_updated
    on public.experiment_runs (tenant_id, updated_at desc);

create index if not exists idx_experiment_runs_status
    on public.experiment_runs (tenant_id, status, last_heartbeat_at desc);

create table if not exists public.experiment_metrics (
    id                      uuid primary key default gen_random_uuid(),
    tenant_id               uuid not null,
    run_id                  text not null,
    epoch                   integer,
    global_step             integer,
    train_loss              double precision,
    val_loss                double precision,
    train_accuracy          double precision,
    val_accuracy            double precision,
    learning_rate           double precision,
    gradient_norm           double precision,
    macro_f1                double precision,
    recall_critical         double precision,
    calibration_error       double precision,
    adversarial_score       double precision,
    wall_clock_time_seconds double precision,
    steps_per_second        double precision,
    gpu_utilization         double precision,
    cpu_utilization         double precision,
    memory_utilization      double precision,
    metric_timestamp        timestamptz not null default now(),
    created_at              timestamptz not null default now(),
    constraint experiment_metrics_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create index if not exists idx_experiment_metrics_run_timestamp
    on public.experiment_metrics (tenant_id, run_id, metric_timestamp asc);

create table if not exists public.experiment_artifacts (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null,
    run_id      text not null,
    artifact_type text not null,
    label       text,
    uri         text,
    metadata    jsonb not null default '{}'::jsonb,
    is_primary  boolean not null default false,
    created_at  timestamptz not null default now(),
    constraint experiment_artifacts_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create index if not exists idx_experiment_artifacts_run
    on public.experiment_artifacts (tenant_id, run_id, created_at asc);

create table if not exists public.experiment_failures (
    id                           uuid primary key default gen_random_uuid(),
    tenant_id                    uuid not null,
    run_id                       text not null,
    failure_reason               text not null,
    failure_epoch                integer,
    failure_step                 integer,
    last_train_loss              double precision,
    last_val_loss                double precision,
    last_learning_rate           double precision,
    last_gradient_norm           double precision,
    nan_detected                 boolean not null default false,
    checkpoint_recovery_attempted boolean not null default false,
    stack_trace_excerpt          text,
    error_summary                text,
    created_at                   timestamptz not null default now(),
    updated_at                   timestamptz not null default now(),
    constraint experiment_failures_tenant_run_key unique (tenant_id, run_id),
    constraint experiment_failures_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create table if not exists public.experiment_benchmarks (
    id             uuid primary key default gen_random_uuid(),
    tenant_id      uuid not null,
    run_id         text not null,
    benchmark_family text not null,
    task_type      text not null,
    summary_score  double precision,
    pass_status    text not null,
    report_payload jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now(),
    constraint experiment_benchmarks_tenant_run_family_key unique (tenant_id, run_id, benchmark_family),
    constraint experiment_benchmarks_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create index if not exists idx_experiment_benchmarks_run
    on public.experiment_benchmarks (tenant_id, run_id, created_at desc);

create table if not exists public.experiment_registry_links (
    id                    uuid primary key default gen_random_uuid(),
    tenant_id             uuid not null,
    run_id                text not null,
    model_registry_entry_id uuid,
    registry_candidate_id text,
    champion_or_challenger text,
    promotion_status      text,
    calibration_status    text,
    adversarial_gate_status text,
    deployment_eligibility text,
    linked_at             timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    constraint experiment_registry_links_tenant_run_key unique (tenant_id, run_id),
    constraint experiment_registry_links_run_fkey
        foreign key (tenant_id, run_id)
        references public.experiment_runs (tenant_id, run_id)
        on delete cascade
);

create index if not exists idx_experiment_registry_links_run
    on public.experiment_registry_links (tenant_id, run_id);

drop trigger if exists set_updated_at_experiment_runs on public.experiment_runs;
create trigger set_updated_at_experiment_runs
    before update on public.experiment_runs
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_experiment_failures on public.experiment_failures;
create trigger set_updated_at_experiment_failures
    before update on public.experiment_failures
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_experiment_registry_links on public.experiment_registry_links;
create trigger set_updated_at_experiment_registry_links
    before update on public.experiment_registry_links
    for each row execute function public.trigger_set_updated_at();

alter table public.experiment_runs enable row level security;
alter table public.experiment_metrics enable row level security;
alter table public.experiment_artifacts enable row level security;
alter table public.experiment_failures enable row level security;
alter table public.experiment_benchmarks enable row level security;
alter table public.experiment_registry_links enable row level security;

drop policy if exists experiment_runs_select_own on public.experiment_runs;
create policy experiment_runs_select_own
    on public.experiment_runs
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists experiment_runs_insert_own on public.experiment_runs;
create policy experiment_runs_insert_own
    on public.experiment_runs
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_runs_update_own on public.experiment_runs;
create policy experiment_runs_update_own
    on public.experiment_runs
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_metrics_select_own on public.experiment_metrics;
create policy experiment_metrics_select_own
    on public.experiment_metrics
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists experiment_metrics_insert_own on public.experiment_metrics;
create policy experiment_metrics_insert_own
    on public.experiment_metrics
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_artifacts_select_own on public.experiment_artifacts;
create policy experiment_artifacts_select_own
    on public.experiment_artifacts
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists experiment_artifacts_insert_own on public.experiment_artifacts;
create policy experiment_artifacts_insert_own
    on public.experiment_artifacts
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_artifacts_update_own on public.experiment_artifacts;
create policy experiment_artifacts_update_own
    on public.experiment_artifacts
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_failures_select_own on public.experiment_failures;
create policy experiment_failures_select_own
    on public.experiment_failures
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists experiment_failures_insert_own on public.experiment_failures;
create policy experiment_failures_insert_own
    on public.experiment_failures
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_failures_update_own on public.experiment_failures;
create policy experiment_failures_update_own
    on public.experiment_failures
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_benchmarks_select_own on public.experiment_benchmarks;
create policy experiment_benchmarks_select_own
    on public.experiment_benchmarks
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists experiment_benchmarks_insert_own on public.experiment_benchmarks;
create policy experiment_benchmarks_insert_own
    on public.experiment_benchmarks
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_benchmarks_update_own on public.experiment_benchmarks;
create policy experiment_benchmarks_update_own
    on public.experiment_benchmarks
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_registry_links_select_own on public.experiment_registry_links;
create policy experiment_registry_links_select_own
    on public.experiment_registry_links
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists experiment_registry_links_insert_own on public.experiment_registry_links;
create policy experiment_registry_links_insert_own
    on public.experiment_registry_links
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists experiment_registry_links_update_own on public.experiment_registry_links;
create policy experiment_registry_links_update_own
    on public.experiment_registry_links
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

with registry_backfill as (
    select
        mre.tenant_id,
        'run_' || left(regexp_replace(lower(mre.model_version), '[^a-z0-9]+', '_', 'g'), 56) as run_id,
        case
            when mre.task_type = 'severity' then 'severity_prediction'
            when mre.task_type = 'hybrid' then 'multimodal_fusion'
            else 'clinical_diagnosis'
        end as task_type,
        case
            when mre.task_type = 'hybrid' then 'multimodal'
            else 'tabular_clinical'
        end as modality,
        mre.task_type as target_type,
        coalesce(mre.artifact_payload ->> 'model_name', mre.model_name) as model_arch,
        coalesce(mre.artifact_payload ->> 'model_size', mre.artifact_payload -> 'training_summary' ->> 'parameter_scale') as model_size,
        mre.model_version,
        mre.training_dataset_version as dataset_name,
        mre.training_dataset_version as dataset_version,
        mre.feature_schema_version,
        mre.label_policy_version,
        coalesce((mre.artifact_payload -> 'training_summary' ->> 'epochs_planned')::integer, (mre.artifact_payload -> 'training_summary' ->> 'epochs')::integer) as epochs_planned,
        coalesce((mre.artifact_payload -> 'training_summary' ->> 'epochs_completed')::integer, (mre.artifact_payload -> 'training_summary' ->> 'epochs')::integer, 0) as epochs_completed,
        case
            when mre.task_type = 'severity' and (mre.benchmark_scorecard ->> 'severity_critical_recall') is not null then 'severity_critical_recall'
            when (mre.benchmark_scorecard ->> 'diagnosis_macro_f1') is not null then 'diagnosis_macro_f1'
            when (mre.benchmark_scorecard ->> 'diagnosis_accuracy') is not null then 'diagnosis_accuracy'
            when (mre.benchmark_scorecard ->> 'calibration_ece') is not null then 'calibration_ece'
            else null
        end as metric_primary_name,
        coalesce(
            (mre.benchmark_scorecard ->> 'severity_critical_recall')::double precision,
            (mre.benchmark_scorecard ->> 'diagnosis_macro_f1')::double precision,
            (mre.benchmark_scorecard ->> 'diagnosis_accuracy')::double precision,
            (mre.benchmark_scorecard ->> 'calibration_ece')::double precision
        ) as metric_primary_value,
        case
            when mre.promotion_status = 'rolled_back' then 'rolled_back'
            when mre.is_champion = true then 'promoted'
            else 'completed'
        end as status,
        'summary_only_backfill' as status_reason,
        100::double precision as progress_percent,
        true as summary_only,
        coalesce(mre.artifact_payload -> 'hyperparameters', '{}'::jsonb) as hyperparameters,
        coalesce(mre.artifact_payload, '{}'::jsonb) as config_snapshot,
        coalesce(mre.resource_profile, '{}'::jsonb) as resource_usage,
        jsonb_build_object(
            'promotion_status', mre.promotion_status,
            'champion_or_challenger', case when mre.is_champion then 'champion' else coalesce(mre.promotion_status, 'candidate') end,
            'calibration_report_id', mre.calibration_report_id,
            'parent_model_version', mre.parent_model_version
        ) as registry_context,
        mre.created_at as started_at,
        mre.updated_at as ended_at,
        mre.updated_at as last_heartbeat_at,
        ldv.summary as dataset_summary,
        ldv.row_count as dataset_row_count
    from public.model_registry_entries mre
    left join public.learning_dataset_versions ldv
        on ldv.tenant_id = mre.tenant_id
       and ldv.dataset_version = mre.training_dataset_version
       and ldv.dataset_kind = case when mre.task_type = 'severity' then 'severity_training_set' else 'diagnosis_training_set' end
)
insert into public.experiment_runs (
    tenant_id,
    run_id,
    experiment_group_id,
    sweep_id,
    parent_run_id,
    baseline_run_id,
    task_type,
    modality,
    target_type,
    model_arch,
    model_size,
    model_version,
    dataset_name,
    dataset_version,
    feature_schema_version,
    label_policy_version,
    epochs_planned,
    epochs_completed,
    metric_primary_name,
    metric_primary_value,
    status,
    status_reason,
    progress_percent,
    summary_only,
    hyperparameters,
    dataset_lineage,
    config_snapshot,
    safety_metrics,
    resource_usage,
    registry_context,
    last_heartbeat_at,
    started_at,
    ended_at
)
select
    tenant_id,
    run_id,
    task_type || '_registry_backfill',
    null,
    null,
    null,
    task_type,
    modality,
    target_type,
    coalesce(model_arch, 'unknown_model'),
    model_size,
    model_version,
    dataset_name,
    dataset_version,
    feature_schema_version,
    label_policy_version,
    epochs_planned,
    epochs_completed,
    metric_primary_name,
    metric_primary_value,
    status,
    status_reason,
    progress_percent,
    summary_only,
    hyperparameters,
    jsonb_build_object(
        'dataset_version', dataset_version,
        'total_cases', coalesce((dataset_summary ->> 'total_cases')::integer, dataset_row_count, 0),
        'clean_labeled_count', coalesce(dataset_row_count, 0),
        'severity_ready_count', coalesce((dataset_summary ->> 'severity_training_cases')::integer, 0),
        'contradiction_ready_count', coalesce((dataset_summary ->> 'adversarial_cases')::integer, 0),
        'adversarial_count', coalesce((dataset_summary ->> 'adversarial_cases')::integer, 0),
        'quarantined_excluded_count', coalesce((dataset_summary ->> 'quarantined_cases')::integer, 0),
        'train_val_test_split_policy', coalesce(dataset_summary ->> 'split_policy', 'holdout_or_resubstitution'),
        'label_composition', coalesce(dataset_summary -> 'label_composition', '{}'::jsonb)
    ),
    config_snapshot,
    jsonb_build_object(
        'macro_f1', null,
        'recall_critical', null,
        'calibration_ece', null
    ),
    resource_usage,
    registry_context,
    last_heartbeat_at,
    started_at,
    ended_at
from registry_backfill
on conflict (tenant_id, run_id) do nothing;

insert into public.experiment_registry_links (
    tenant_id,
    run_id,
    model_registry_entry_id,
    registry_candidate_id,
    champion_or_challenger,
    promotion_status,
    calibration_status,
    adversarial_gate_status,
    deployment_eligibility
)
select
    mre.tenant_id,
    'run_' || left(regexp_replace(lower(mre.model_version), '[^a-z0-9]+', '_', 'g'), 56) as run_id,
    mre.id,
    mre.id::text,
    case when mre.is_champion then 'champion' else coalesce(mre.promotion_status, 'candidate') end,
    mre.promotion_status,
    case
        when lcr.report_payload -> 'recommendation' ->> 'status' = 'pass' then 'passed'
        when lcr.report_payload -> 'recommendation' ->> 'status' = 'needs_recalibration' then 'fail'
        else 'pending'
    end,
    coalesce(lbr.pass_status, 'pending'),
    case
        when mre.promotion_status = 'rejected' then 'blocked'
        when lcr.report_payload -> 'recommendation' ->> 'status' = 'needs_recalibration' then 'blocked'
        when lbr.pass_status = 'fail' then 'blocked'
        else 'eligible_review'
    end
from public.model_registry_entries mre
left join public.learning_calibration_reports lcr
    on lcr.id = mre.calibration_report_id
left join lateral (
    select pass_status
    from public.learning_benchmark_reports lbr
    where lbr.tenant_id = mre.tenant_id
      and lbr.model_registry_id = mre.id
    order by lbr.created_at desc
    limit 1
) lbr on true
on conflict (tenant_id, run_id) do nothing;

insert into public.experiment_benchmarks (
    tenant_id,
    run_id,
    benchmark_family,
    task_type,
    summary_score,
    pass_status,
    report_payload
)
select
    lbr.tenant_id,
    'run_' || left(regexp_replace(lower(mre.model_version), '[^a-z0-9]+', '_', 'g'), 56),
    lbr.benchmark_family,
    lbr.task_type,
    lbr.summary_score,
    lbr.pass_status,
    lbr.report_payload
from public.learning_benchmark_reports lbr
join public.model_registry_entries mre
    on mre.id = lbr.model_registry_id
on conflict (tenant_id, run_id, benchmark_family) do nothing;

notify pgrst, 'reload schema';
