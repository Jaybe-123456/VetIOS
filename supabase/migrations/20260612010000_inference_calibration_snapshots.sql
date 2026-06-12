-- VetIOS inference calibration snapshot ledger
-- Append-only confidence, reliability, and outcome-calibration evidence per inference.

create extension if not exists pgcrypto;

create table if not exists public.inference_calibration_snapshots (
    id                              uuid primary key default gen_random_uuid(),
    tenant_id                       uuid not null,
    inference_event_id              uuid not null references public.ai_inference_events(id) on delete cascade,
    request_id                      text,
    case_id                         uuid,

    model_name                      text,
    model_version                   text,
    schema_version                  text,
    source_module                   text,
    ranker                          text,

    top_label                       text,
    top_confidence                  double precision not null default 0,
    phi_hat                         double precision not null default 0,
    contradiction_score             double precision not null default 0,
    differential_count              integer not null default 0,
    differential_entropy            double precision not null default 0,
    margin_top2                     double precision not null default 0,

    calibration_bucket              text not null,
    calibration_status              text not null,
    historical_sample_count         integer not null default 0,
    historical_mean_delta           double precision,
    expected_calibration_error      double precision,
    calibration_reliability_score   double precision not null default 0,
    reliability_badge               text not null,
    recommended_action              text not null,

    snapshot                        jsonb not null default '{}'::jsonb,
    created_at                      timestamptz not null default now(),

    constraint inference_calibration_top_confidence_check
        check (top_confidence >= 0 and top_confidence <= 1),
    constraint inference_calibration_phi_hat_check
        check (phi_hat >= 0 and phi_hat <= 1),
    constraint inference_calibration_contradiction_check
        check (contradiction_score >= 0 and contradiction_score <= 1),
    constraint inference_calibration_margin_check
        check (margin_top2 >= 0 and margin_top2 <= 1),
    constraint inference_calibration_reliability_check
        check (calibration_reliability_score >= 0 and calibration_reliability_score <= 1),
    constraint inference_calibration_status_check
        check (calibration_status in ('needs_outcome', 'calibrated', 'underconfident', 'overconfident', 'indeterminate')),
    constraint inference_calibration_badge_check
        check (reliability_badge in ('HIGH', 'REVIEW', 'CAUTION', 'SUPPRESSED'))
);

create or replace function public.prevent_inference_calibration_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'inference calibration snapshots are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_inference_calibration_snapshots
    on public.inference_calibration_snapshots;

create trigger enforce_immutability_inference_calibration_snapshots
    before update or delete on public.inference_calibration_snapshots
    for each row execute function public.prevent_inference_calibration_snapshot_mutation();

create index if not exists inference_calibration_tenant_event_created_idx
    on public.inference_calibration_snapshots (tenant_id, inference_event_id, created_at desc);

create index if not exists inference_calibration_tenant_status_created_idx
    on public.inference_calibration_snapshots (tenant_id, calibration_status, reliability_badge, created_at desc);

create index if not exists inference_calibration_tenant_label_created_idx
    on public.inference_calibration_snapshots (tenant_id, top_label, created_at desc)
    where top_label is not null;

alter table public.inference_calibration_snapshots enable row level security;

drop policy if exists "service_role_inference_calibration_snapshots"
    on public.inference_calibration_snapshots;
create policy "service_role_inference_calibration_snapshots"
    on public.inference_calibration_snapshots
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.inference_calibration_snapshots to service_role;
revoke update, delete on public.inference_calibration_snapshots from anon, authenticated;

notify pgrst, 'reload schema';
