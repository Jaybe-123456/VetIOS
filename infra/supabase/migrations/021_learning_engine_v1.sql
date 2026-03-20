-- =============================================================================
-- Migration 021: VetIOS Learning Engine v1
--
-- Adds durable storage for dataset versioning, learning cycles, benchmark and
-- calibration reports, model registry promotion state, scheduler jobs,
-- rollback events, and audit logging.
-- =============================================================================

create table if not exists public.learning_dataset_versions (
    id                     uuid primary key default gen_random_uuid(),
    tenant_id              uuid not null references public.tenants(id) on delete cascade,
    dataset_version        text not null,
    dataset_kind           text not null check (dataset_kind in (
        'diagnosis_training_set',
        'severity_training_set',
        'calibration_eval_set',
        'adversarial_benchmark_set',
        'quarantine_set'
    )),
    feature_schema_version text not null,
    label_policy_version   text not null,
    row_count              integer not null default 0,
    case_ids               text[] not null default '{}'::text[],
    filters                jsonb not null default '{}'::jsonb,
    summary                jsonb not null default '{}'::jsonb,
    dataset_rows           jsonb not null default '[]'::jsonb,
    created_at             timestamptz not null default now()
);

create unique index if not exists idx_learning_dataset_versions_unique
    on public.learning_dataset_versions (tenant_id, dataset_version, dataset_kind);

create index if not exists idx_learning_dataset_versions_created
    on public.learning_dataset_versions (tenant_id, created_at desc);

create table if not exists public.learning_cycles (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    cycle_type      text not null check (cycle_type in (
        'daily_dataset_refresh',
        'daily_calibration_update',
        'weekly_candidate_training',
        'weekly_benchmark_run',
        'manual_review',
        'rollback_review'
    )),
    trigger_mode    text not null check (trigger_mode in ('scheduled', 'manual', 'dry_run')),
    status          text not null check (status in ('pending', 'running', 'completed', 'failed', 'rolled_back')),
    request_payload jsonb not null default '{}'::jsonb,
    summary         jsonb not null default '{}'::jsonb,
    started_at      timestamptz not null default now(),
    completed_at    timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_learning_cycles_created
    on public.learning_cycles (tenant_id, created_at desc);

create table if not exists public.model_registry_entries (
    id                       uuid primary key default gen_random_uuid(),
    tenant_id                uuid not null references public.tenants(id) on delete cascade,
    model_name               text not null,
    model_version            text not null,
    task_type                text not null check (task_type in ('diagnosis', 'severity', 'hybrid')),
    training_dataset_version text not null,
    feature_schema_version   text not null,
    label_policy_version     text not null,
    artifact_payload         jsonb not null default '{}'::jsonb,
    benchmark_scorecard      jsonb not null default '{}'::jsonb,
    calibration_report_id    uuid,
    promotion_status         text not null check (promotion_status in (
        'candidate',
        'champion',
        'challenger',
        'hold',
        'rejected',
        'rolled_back',
        'archived'
    )),
    is_champion              boolean not null default false,
    latency_profile          jsonb,
    resource_profile         jsonb,
    parent_model_version     text,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

create unique index if not exists idx_model_registry_entries_unique
    on public.model_registry_entries (tenant_id, task_type, model_version);

create index if not exists idx_model_registry_entries_status
    on public.model_registry_entries (tenant_id, promotion_status, updated_at desc);

create table if not exists public.learning_calibration_reports (
    id                uuid primary key default gen_random_uuid(),
    tenant_id         uuid not null references public.tenants(id) on delete cascade,
    learning_cycle_id uuid references public.learning_cycles(id) on delete set null,
    model_registry_id uuid references public.model_registry_entries(id) on delete set null,
    task_type         text not null,
    report_payload    jsonb not null default '{}'::jsonb,
    brier_score       double precision,
    ece_score         double precision,
    created_at        timestamptz not null default now()
);

create index if not exists idx_learning_calibration_reports_created
    on public.learning_calibration_reports (tenant_id, created_at desc);

alter table public.model_registry_entries
    drop constraint if exists model_registry_entries_calibration_report_id_fkey;

alter table public.model_registry_entries
    add constraint model_registry_entries_calibration_report_id_fkey
    foreign key (calibration_report_id)
    references public.learning_calibration_reports(id)
    on delete set null;

create table if not exists public.learning_benchmark_reports (
    id                uuid primary key default gen_random_uuid(),
    tenant_id         uuid not null references public.tenants(id) on delete cascade,
    learning_cycle_id uuid references public.learning_cycles(id) on delete set null,
    model_registry_id uuid references public.model_registry_entries(id) on delete set null,
    benchmark_family  text not null,
    task_type         text not null,
    report_payload    jsonb not null default '{}'::jsonb,
    summary_score     double precision,
    pass_status       text not null,
    created_at        timestamptz not null default now()
);

create index if not exists idx_learning_benchmark_reports_created
    on public.learning_benchmark_reports (tenant_id, created_at desc);

create table if not exists public.learning_scheduler_jobs (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    job_name        text not null,
    cron_expression text not null,
    job_type        text not null,
    enabled         boolean not null default true,
    job_config      jsonb not null default '{}'::jsonb,
    last_run_at     timestamptz,
    next_run_at     timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create unique index if not exists idx_learning_scheduler_jobs_unique
    on public.learning_scheduler_jobs (tenant_id, job_name);

create index if not exists idx_learning_scheduler_jobs_next_run
    on public.learning_scheduler_jobs (tenant_id, next_run_at asc);

create table if not exists public.learning_rollback_events (
    id                         uuid primary key default gen_random_uuid(),
    tenant_id                  uuid not null references public.tenants(id) on delete cascade,
    learning_cycle_id          uuid references public.learning_cycles(id) on delete set null,
    previous_model_registry_id uuid references public.model_registry_entries(id) on delete set null,
    restored_model_registry_id uuid references public.model_registry_entries(id) on delete set null,
    trigger_reason             text not null,
    trigger_payload            jsonb not null default '{}'::jsonb,
    created_at                 timestamptz not null default now()
);

create index if not exists idx_learning_rollback_events_created
    on public.learning_rollback_events (tenant_id, created_at desc);

create table if not exists public.learning_audit_events (
    id                uuid primary key default gen_random_uuid(),
    tenant_id         uuid not null references public.tenants(id) on delete cascade,
    learning_cycle_id uuid references public.learning_cycles(id) on delete set null,
    event_type        text not null,
    event_payload     jsonb not null default '{}'::jsonb,
    created_at        timestamptz not null default now()
);

create index if not exists idx_learning_audit_events_created
    on public.learning_audit_events (tenant_id, created_at desc);

drop trigger if exists set_updated_at_learning_cycles on public.learning_cycles;
create trigger set_updated_at_learning_cycles
    before update on public.learning_cycles
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_model_registry_entries on public.model_registry_entries;
create trigger set_updated_at_model_registry_entries
    before update on public.model_registry_entries
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_learning_scheduler_jobs on public.learning_scheduler_jobs;
create trigger set_updated_at_learning_scheduler_jobs
    before update on public.learning_scheduler_jobs
    for each row execute function public.trigger_set_updated_at();

alter table public.learning_dataset_versions enable row level security;
alter table public.learning_cycles enable row level security;
alter table public.model_registry_entries enable row level security;
alter table public.learning_calibration_reports enable row level security;
alter table public.learning_benchmark_reports enable row level security;
alter table public.learning_scheduler_jobs enable row level security;
alter table public.learning_rollback_events enable row level security;
alter table public.learning_audit_events enable row level security;

drop policy if exists learning_dataset_versions_select_own on public.learning_dataset_versions;
create policy learning_dataset_versions_select_own
    on public.learning_dataset_versions
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists learning_dataset_versions_insert_own on public.learning_dataset_versions;
create policy learning_dataset_versions_insert_own
    on public.learning_dataset_versions
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists learning_cycles_select_own on public.learning_cycles;
create policy learning_cycles_select_own
    on public.learning_cycles
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists learning_cycles_insert_own on public.learning_cycles;
create policy learning_cycles_insert_own
    on public.learning_cycles
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists learning_cycles_update_own on public.learning_cycles;
create policy learning_cycles_update_own
    on public.learning_cycles
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists model_registry_entries_select_own on public.model_registry_entries;
create policy model_registry_entries_select_own
    on public.model_registry_entries
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists model_registry_entries_insert_own on public.model_registry_entries;
create policy model_registry_entries_insert_own
    on public.model_registry_entries
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists model_registry_entries_update_own on public.model_registry_entries;
create policy model_registry_entries_update_own
    on public.model_registry_entries
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists learning_calibration_reports_select_own on public.learning_calibration_reports;
create policy learning_calibration_reports_select_own
    on public.learning_calibration_reports
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists learning_calibration_reports_insert_own on public.learning_calibration_reports;
create policy learning_calibration_reports_insert_own
    on public.learning_calibration_reports
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists learning_benchmark_reports_select_own on public.learning_benchmark_reports;
create policy learning_benchmark_reports_select_own
    on public.learning_benchmark_reports
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists learning_benchmark_reports_insert_own on public.learning_benchmark_reports;
create policy learning_benchmark_reports_insert_own
    on public.learning_benchmark_reports
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists learning_scheduler_jobs_select_own on public.learning_scheduler_jobs;
create policy learning_scheduler_jobs_select_own
    on public.learning_scheduler_jobs
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists learning_scheduler_jobs_insert_own on public.learning_scheduler_jobs;
create policy learning_scheduler_jobs_insert_own
    on public.learning_scheduler_jobs
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists learning_scheduler_jobs_update_own on public.learning_scheduler_jobs;
create policy learning_scheduler_jobs_update_own
    on public.learning_scheduler_jobs
    for update
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());

drop policy if exists learning_rollback_events_select_own on public.learning_rollback_events;
create policy learning_rollback_events_select_own
    on public.learning_rollback_events
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists learning_rollback_events_insert_own on public.learning_rollback_events;
create policy learning_rollback_events_insert_own
    on public.learning_rollback_events
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists learning_audit_events_select_own on public.learning_audit_events;
create policy learning_audit_events_select_own
    on public.learning_audit_events
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists learning_audit_events_insert_own on public.learning_audit_events;
create policy learning_audit_events_insert_own
    on public.learning_audit_events
    for insert with check (tenant_id = public.current_tenant_id());

notify pgrst, 'reload schema';
