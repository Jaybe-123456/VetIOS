-- VetIOS inference post-market monitoring
-- Windowed lifecycle surveillance for inference reliability, drift, safety, latency, and rollback readiness.

create extension if not exists pgcrypto;

create table if not exists public.inference_postmarket_monitoring_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id text,
    model_version text,
    species text,
    top_label text,
    monitoring_window_start timestamptz,
    monitoring_window_end timestamptz,
    inference_count integer not null default 0,
    outcome_confirmed_count integer not null default 0,
    trusted_count integer not null default 0,
    review_count integer not null default 0,
    hold_count integer not null default 0,
    suppress_count integer not null default 0,
    critical_count integer not null default 0,
    training_eligible_count integer not null default 0,
    high_confidence_uncalibrated_count integer not null default 0,
    security_boundary_failed_count integer not null default 0,
    synthetic_rows_excluded integer not null default 0,
    mean_confidence double precision,
    mean_latency_ms double precision,
    latency_p95_ms double precision,
    outcome_confirmation_rate double precision not null default 0,
    review_rate double precision not null default 0,
    hold_rate double precision not null default 0,
    suppress_rate double precision not null default 0,
    critical_hold_rate double precision not null default 0,
    security_block_rate double precision not null default 0,
    label_distribution_shift double precision,
    reliability_regression_score double precision not null default 0,
    monitoring_status text not null default 'insufficient_evidence',
    rollback_recommended boolean not null default false,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    packet_digest text not null,
    monitoring_packet jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),

    constraint inference_postmarket_monitoring_status_check
        check (monitoring_status in ('insufficient_evidence', 'healthy', 'degraded', 'rollback_recommended')),
    constraint inference_postmarket_monitoring_counts_check
        check (
            inference_count >= 0
            and outcome_confirmed_count >= 0
            and trusted_count >= 0
            and review_count >= 0
            and hold_count >= 0
            and suppress_count >= 0
            and critical_count >= 0
            and training_eligible_count >= 0
            and high_confidence_uncalibrated_count >= 0
            and security_boundary_failed_count >= 0
            and synthetic_rows_excluded >= 0
        ),
    constraint inference_postmarket_monitoring_metric_bounds_check
        check (
            (mean_confidence is null or (mean_confidence >= 0 and mean_confidence <= 1))
            and (mean_latency_ms is null or mean_latency_ms >= 0)
            and (latency_p95_ms is null or latency_p95_ms >= 0)
            and outcome_confirmation_rate >= 0 and outcome_confirmation_rate <= 1
            and review_rate >= 0 and review_rate <= 1
            and hold_rate >= 0 and hold_rate <= 1
            and suppress_rate >= 0 and suppress_rate <= 1
            and critical_hold_rate >= 0 and critical_hold_rate <= 1
            and security_block_rate >= 0 and security_block_rate <= 1
            and (label_distribution_shift is null or (label_distribution_shift >= 0 and label_distribution_shift <= 1))
            and reliability_regression_score >= 0 and reliability_regression_score <= 1
        ),
    constraint inference_postmarket_monitoring_digest_check
        check (packet_digest ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_inference_postmarket_monitoring_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'inference_postmarket_monitoring_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_inference_postmarket_monitoring_events
    on public.inference_postmarket_monitoring_events;
create trigger enforce_immutability_inference_postmarket_monitoring_events
    before update or delete on public.inference_postmarket_monitoring_events
    for each row execute function public.prevent_inference_postmarket_monitoring_mutation();

create index if not exists inference_postmarket_monitoring_tenant_created_idx
    on public.inference_postmarket_monitoring_events (tenant_id, created_at desc);

create index if not exists inference_postmarket_monitoring_model_created_idx
    on public.inference_postmarket_monitoring_events (tenant_id, model_version, created_at desc)
    where model_version is not null;

create index if not exists inference_postmarket_monitoring_status_created_idx
    on public.inference_postmarket_monitoring_events (tenant_id, monitoring_status, rollback_recommended, created_at desc);

create index if not exists inference_postmarket_monitoring_label_created_idx
    on public.inference_postmarket_monitoring_events (tenant_id, top_label, created_at desc)
    where top_label is not null;

create index if not exists inference_postmarket_monitoring_blockers_gin_idx
    on public.inference_postmarket_monitoring_events using gin (blockers);

create index if not exists inference_postmarket_monitoring_packet_gin_idx
    on public.inference_postmarket_monitoring_events using gin (monitoring_packet);

alter table public.inference_postmarket_monitoring_events enable row level security;

drop policy if exists "service_role_inference_postmarket_monitoring_events"
    on public.inference_postmarket_monitoring_events;
create policy "service_role_inference_postmarket_monitoring_events"
    on public.inference_postmarket_monitoring_events
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.inference_postmarket_monitoring_events to service_role;
revoke update, delete on public.inference_postmarket_monitoring_events from anon, authenticated;

comment on table public.inference_postmarket_monitoring_events is
    'Append-only post-market monitoring ledger for VetIOS inference reliability, safety, label distribution shift, latency, outcome confirmation, rollback recommendations, and lifecycle surveillance.';

comment on column public.inference_postmarket_monitoring_events.monitoring_packet is
    'Sanitized aggregate monitoring packet. Stores rates, thresholds, event references, and hashable evidence only; no raw clinical notes, owner identifiers, retrieved source text, raw reports, or full model outputs.';

notify pgrst, 'reload schema';
