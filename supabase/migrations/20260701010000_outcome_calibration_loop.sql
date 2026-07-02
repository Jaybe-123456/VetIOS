-- VetIOS outcome calibration loop
-- Converts confirmed outcomes into stratified, auditable calibration buckets.

create extension if not exists pgcrypto;

create table if not exists public.outcome_calibration_runs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id text,
    run_kind text not null default 'manual_recompute',
    model_version text,
    source_window_start timestamptz,
    source_window_end timestamptz,
    source_event_count integer not null default 0,
    eligible_rows integer not null default 0,
    synthetic_rows_excluded integer not null default 0,
    bucket_count integer not null default 0,
    minimum_required_outcomes integer not null default 5,
    run_status text not null default 'insufficient_evidence',
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    source_digest text not null,
    run_packet jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),

    constraint outcome_calibration_runs_kind_check
        check (run_kind in ('outcome_write', 'scheduled', 'manual_recompute', 'backfill')),
    constraint outcome_calibration_runs_status_check
        check (run_status in ('completed', 'insufficient_evidence', 'failed')),
    constraint outcome_calibration_runs_counts_check
        check (
            source_event_count >= 0
            and eligible_rows >= 0
            and synthetic_rows_excluded >= 0
            and bucket_count >= 0
            and minimum_required_outcomes >= 0
        ),
    constraint outcome_calibration_runs_digest_check
        check (source_digest ~ '^[a-f0-9]{64}$')
);

create table if not exists public.outcome_calibration_buckets (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    calibration_run_id uuid references public.outcome_calibration_runs(id) on delete cascade,
    bucket_key text not null,
    label text not null,
    normalized_label text not null,
    species text,
    model_version text,
    evidence_type text not null default 'mixed',
    severity text not null default 'mixed',
    care_environment text not null default 'unknown',
    region text not null default 'unknown',
    confidence_bucket text not null default 'unknown',
    outcome_label_count integer not null default 0,
    top1_accuracy double precision,
    top3_recall double precision,
    brier_score double precision,
    expected_calibration_error double precision,
    false_negative_critical_rate double precision,
    overconfidence_rate double precision,
    abstain_rate double precision,
    mean_confidence double precision,
    mean_delta double precision,
    calibration_status text not null default 'needs_outcome',
    minimum_required_outcomes integer not null default 5,
    synthetic_rows_excluded integer not null default 0,
    source_event_count integer not null default 0,
    source_hash text not null,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    evidence jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),

    constraint outcome_calibration_buckets_status_check
        check (calibration_status in ('needs_outcome', 'calibrated', 'underconfident', 'overconfident', 'indeterminate')),
    constraint outcome_calibration_buckets_counts_check
        check (
            outcome_label_count >= 0
            and minimum_required_outcomes >= 0
            and synthetic_rows_excluded >= 0
            and source_event_count >= 0
        ),
    constraint outcome_calibration_buckets_metric_bounds_check
        check (
            (top1_accuracy is null or (top1_accuracy >= 0 and top1_accuracy <= 1))
            and (top3_recall is null or (top3_recall >= 0 and top3_recall <= 1))
            and (brier_score is null or (brier_score >= 0 and brier_score <= 1))
            and (expected_calibration_error is null or (expected_calibration_error >= 0 and expected_calibration_error <= 1))
            and (false_negative_critical_rate is null or (false_negative_critical_rate >= 0 and false_negative_critical_rate <= 1))
            and (overconfidence_rate is null or (overconfidence_rate >= 0 and overconfidence_rate <= 1))
            and (abstain_rate is null or (abstain_rate >= 0 and abstain_rate <= 1))
            and (mean_confidence is null or (mean_confidence >= 0 and mean_confidence <= 1))
        ),
    constraint outcome_calibration_buckets_source_hash_check
        check (source_hash ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_outcome_calibration_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'outcome calibration tables are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_outcome_calibration_runs
    on public.outcome_calibration_runs;
create trigger enforce_immutability_outcome_calibration_runs
    before update or delete on public.outcome_calibration_runs
    for each row execute function public.prevent_outcome_calibration_mutation();

drop trigger if exists enforce_immutability_outcome_calibration_buckets
    on public.outcome_calibration_buckets;
create trigger enforce_immutability_outcome_calibration_buckets
    before update or delete on public.outcome_calibration_buckets
    for each row execute function public.prevent_outcome_calibration_mutation();

create index if not exists outcome_calibration_runs_tenant_created_idx
    on public.outcome_calibration_runs (tenant_id, created_at desc);

create index if not exists outcome_calibration_runs_tenant_kind_created_idx
    on public.outcome_calibration_runs (tenant_id, run_kind, run_status, created_at desc);

create index if not exists outcome_calibration_runs_blockers_gin_idx
    on public.outcome_calibration_runs using gin (blockers);

create index if not exists outcome_calibration_runs_packet_gin_idx
    on public.outcome_calibration_runs using gin (run_packet);

create index if not exists outcome_calibration_buckets_tenant_label_created_idx
    on public.outcome_calibration_buckets (tenant_id, normalized_label, created_at desc);

create index if not exists outcome_calibration_buckets_tenant_model_label_created_idx
    on public.outcome_calibration_buckets (tenant_id, model_version, normalized_label, created_at desc)
    where model_version is not null;

create index if not exists outcome_calibration_buckets_tenant_status_created_idx
    on public.outcome_calibration_buckets (tenant_id, calibration_status, severity, created_at desc);

create index if not exists outcome_calibration_buckets_run_idx
    on public.outcome_calibration_buckets (calibration_run_id, created_at desc)
    where calibration_run_id is not null;

create index if not exists outcome_calibration_buckets_blockers_gin_idx
    on public.outcome_calibration_buckets using gin (blockers);

create index if not exists outcome_calibration_buckets_evidence_gin_idx
    on public.outcome_calibration_buckets using gin (evidence);

alter table public.outcome_calibration_runs enable row level security;
alter table public.outcome_calibration_buckets enable row level security;

drop policy if exists "service_role_outcome_calibration_runs"
    on public.outcome_calibration_runs;
create policy "service_role_outcome_calibration_runs"
    on public.outcome_calibration_runs
    for all to service_role
    using (true)
    with check (true);

drop policy if exists "service_role_outcome_calibration_buckets"
    on public.outcome_calibration_buckets;
create policy "service_role_outcome_calibration_buckets"
    on public.outcome_calibration_buckets
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.outcome_calibration_runs to service_role;
grant select, insert on public.outcome_calibration_buckets to service_role;
revoke update, delete on public.outcome_calibration_runs from anon, authenticated;
revoke update, delete on public.outcome_calibration_buckets from anon, authenticated;

comment on table public.outcome_calibration_runs is
    'Append-only outcome calibration recompute ledger. Records which confirmed outcomes were used, how many synthetic rows were excluded, source digests, and aggregate run evidence.';

comment on table public.outcome_calibration_buckets is
    'Append-only stratified calibration bucket ledger by label, species, model version, evidence type, severity, care setting, region, and confidence band. Stores aggregate metrics and hashes only.';

comment on column public.outcome_calibration_buckets.evidence is
    'Sanitized aggregate evidence and source event references for calibration. No raw clinical notes, owner identifiers, raw documents, raw lab reports, images, or full model outputs.';

notify pgrst, 'reload schema';
