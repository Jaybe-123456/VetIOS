create table if not exists public.accuracy_metrics (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    window_id text not null,
    model_version text,
    top1_accuracy double precision,
    top3_accuracy double precision,
    calibration_gap double precision,
    overconfidence_rate double precision,
    abstention_rate double precision,
    sample_size integer not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    computed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint accuracy_metrics_tenant_window_unique unique (tenant_id, window_id)
);

create table if not exists public.disease_performance (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    window_id text not null,
    disease_name text not null,
    precision double precision,
    recall double precision,
    false_positive_rate double precision,
    false_negative_rate double precision,
    top1_accuracy double precision,
    top3_recall double precision,
    support_n integer not null default 0,
    misclassification_patterns jsonb not null default '[]'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    computed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint disease_performance_tenant_window_disease_unique unique (tenant_id, window_id, disease_name)
);

create table if not exists public.failure_events (
    id uuid primary key default gen_random_uuid(),
    event_id text not null unique,
    tenant_id text not null,
    inference_event_id text,
    outcome_event_id text,
    evaluation_event_id text,
    model_version text,
    predicted text,
    actual text,
    error_type text not null check (error_type in ('wrong_top1', 'near_miss', 'abstention_trigger')),
    severity text not null check (severity in ('info', 'warning', 'critical')),
    failure_classification text not null check (failure_classification in ('diagnostic_error', 'feature_weighting_error', 'ontology_violation', 'data_sparsity_issue', 'abstention')),
    confidence double precision,
    contradiction_score double precision,
    actual_in_top3 boolean not null default false,
    abstained boolean not null default false,
    payload_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.memory_metrics (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    metric_timestamp timestamptz not null default now(),
    memory_usage double precision,
    rss_mb double precision,
    heap_used_mb double precision,
    heap_total_mb double precision,
    external_mb double precision,
    buffer_size integer not null default 0,
    log_queue_depth integer not null default 0,
    retention_tier text not null default 'hot' check (retention_tier in ('hot', 'warm', 'cold')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_accuracy_metrics_tenant_window_computed
    on public.accuracy_metrics (tenant_id, window_id, computed_at desc);

create index if not exists idx_disease_performance_tenant_window_support
    on public.disease_performance (tenant_id, window_id, support_n desc, computed_at desc);

create index if not exists idx_failure_events_tenant_created
    on public.failure_events (tenant_id, created_at desc);

create index if not exists idx_failure_events_tenant_error_created
    on public.failure_events (tenant_id, error_type, created_at desc);

create index if not exists idx_memory_metrics_tenant_timestamp
    on public.memory_metrics (tenant_id, metric_timestamp desc);

alter table public.accuracy_metrics enable row level security;
alter table public.disease_performance enable row level security;
alter table public.failure_events enable row level security;
alter table public.memory_metrics enable row level security;

drop policy if exists accuracy_metrics_select_own on public.accuracy_metrics;
drop policy if exists accuracy_metrics_insert_own on public.accuracy_metrics;
drop policy if exists accuracy_metrics_update_own on public.accuracy_metrics;

create policy accuracy_metrics_select_own
    on public.accuracy_metrics
    for select using (tenant_id = public.current_tenant_id()::text);

create policy accuracy_metrics_insert_own
    on public.accuracy_metrics
    for insert with check (tenant_id = public.current_tenant_id()::text);

create policy accuracy_metrics_update_own
    on public.accuracy_metrics
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists disease_performance_select_own on public.disease_performance;
drop policy if exists disease_performance_insert_own on public.disease_performance;
drop policy if exists disease_performance_update_own on public.disease_performance;

create policy disease_performance_select_own
    on public.disease_performance
    for select using (tenant_id = public.current_tenant_id()::text);

create policy disease_performance_insert_own
    on public.disease_performance
    for insert with check (tenant_id = public.current_tenant_id()::text);

create policy disease_performance_update_own
    on public.disease_performance
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists failure_events_select_own on public.failure_events;
drop policy if exists failure_events_insert_own on public.failure_events;
drop policy if exists failure_events_update_own on public.failure_events;

create policy failure_events_select_own
    on public.failure_events
    for select using (tenant_id = public.current_tenant_id()::text);

create policy failure_events_insert_own
    on public.failure_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

create policy failure_events_update_own
    on public.failure_events
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists memory_metrics_select_own on public.memory_metrics;
drop policy if exists memory_metrics_insert_own on public.memory_metrics;
drop policy if exists memory_metrics_update_own on public.memory_metrics;

create policy memory_metrics_select_own
    on public.memory_metrics
    for select using (tenant_id = public.current_tenant_id()::text);

create policy memory_metrics_insert_own
    on public.memory_metrics
    for insert with check (tenant_id = public.current_tenant_id()::text);

create policy memory_metrics_update_own
    on public.memory_metrics
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);
