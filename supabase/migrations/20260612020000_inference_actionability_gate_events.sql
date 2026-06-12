-- VetIOS inference actionability gate ledger
-- Append-only clinical action/review/hold decisions derived from reliability signals.

create extension if not exists pgcrypto;

create table if not exists public.inference_actionability_gate_events (
    id                              uuid primary key default gen_random_uuid(),
    tenant_id                       uuid not null,
    inference_event_id              uuid not null references public.ai_inference_events(id) on delete cascade,
    calibration_snapshot_id         uuid references public.inference_calibration_snapshots(id) on delete set null,
    request_id                      text,
    case_id                         uuid,

    gate_version                    text not null default 'vetios_actionability_gate_v1',
    decision                        text not null,
    actionability_score             double precision not null default 0,
    recommended_next_step           text not null,

    top_label                       text,
    top_confidence                  double precision not null default 0,
    phi_hat                         double precision not null default 0,
    reliability_badge               text not null,
    calibration_status              text not null,
    historical_sample_count         integer not null default 0,
    contradiction_score             double precision not null default 0,
    margin_top2                     double precision not null default 0,
    differential_entropy            double precision not null default 0,

    abstain_recommendation          boolean not null default false,
    urgent_confirmatory_testing     boolean not null default false,
    required_confirmatory_tests     text[] not null default array[]::text[],
    blockers                        text[] not null default array[]::text[],
    warnings                        text[] not null default array[]::text[],
    policy_snapshot                 jsonb not null default '{}'::jsonb,
    created_at                      timestamptz not null default now(),

    constraint inference_actionability_decision_check
        check (decision in ('actionable_with_confirmation', 'review_before_action', 'hold_for_evidence', 'suppressed')),
    constraint inference_actionability_score_check
        check (actionability_score >= 0 and actionability_score <= 1),
    constraint inference_actionability_top_confidence_check
        check (top_confidence >= 0 and top_confidence <= 1),
    constraint inference_actionability_phi_hat_check
        check (phi_hat >= 0 and phi_hat <= 1),
    constraint inference_actionability_contradiction_check
        check (contradiction_score >= 0 and contradiction_score <= 1),
    constraint inference_actionability_margin_check
        check (margin_top2 >= 0 and margin_top2 <= 1),
    constraint inference_actionability_entropy_check
        check (differential_entropy >= 0 and differential_entropy <= 1),
    constraint inference_actionability_badge_check
        check (reliability_badge in ('HIGH', 'REVIEW', 'CAUTION', 'SUPPRESSED')),
    constraint inference_actionability_calibration_status_check
        check (calibration_status in ('needs_outcome', 'calibrated', 'underconfident', 'overconfident', 'indeterminate'))
);

create or replace function public.prevent_inference_actionability_gate_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'inference actionability gate events are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_inference_actionability_gate_events
    on public.inference_actionability_gate_events;

create trigger enforce_immutability_inference_actionability_gate_events
    before update or delete on public.inference_actionability_gate_events
    for each row execute function public.prevent_inference_actionability_gate_mutation();

create index if not exists inference_actionability_tenant_event_created_idx
    on public.inference_actionability_gate_events (tenant_id, inference_event_id, created_at desc);

create index if not exists inference_actionability_tenant_decision_created_idx
    on public.inference_actionability_gate_events (tenant_id, decision, created_at desc);

create index if not exists inference_actionability_tenant_label_created_idx
    on public.inference_actionability_gate_events (tenant_id, top_label, created_at desc)
    where top_label is not null;

alter table public.inference_actionability_gate_events enable row level security;

drop policy if exists "service_role_inference_actionability_gate_events"
    on public.inference_actionability_gate_events;
create policy "service_role_inference_actionability_gate_events"
    on public.inference_actionability_gate_events
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.inference_actionability_gate_events to service_role;
revoke update, delete on public.inference_actionability_gate_events from anon, authenticated;

notify pgrst, 'reload schema';
