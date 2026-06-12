-- VetIOS counterfactual stability hardening
-- Repairs Tier 4 counterfactual diagnostic tables into append-only moat ledgers.

create extension if not exists pgcrypto;

create table if not exists public.counterfactual_diagnostic_sessions (
    id                          uuid primary key default gen_random_uuid(),
    tenant_id                   uuid not null,
    case_id                     text not null,
    inference_event_id          uuid references public.ai_inference_events(id) on delete set null,
    session_id                  text not null,
    species                     text,
    breed                       text,
    age_years                   double precision,
    baseline_primary            text not null,
    baseline_confidence         double precision not null default 0,
    baseline_differential_count integer not null default 0,
    findings_challenged         integer not null default 0,
    diagnoses_tested            integer not null default 0,
    stability_verdict           text not null,
    stability_score             double precision not null default 0,
    top_load_bearing_finding    text,
    reasoning_trace             text[] not null default array[]::text[],
    latency_ms                  integer not null default 0,
    computed_at                 timestamptz not null default now(),
    created_at                  timestamptz not null default now(),

    constraint counterfactual_sessions_stability_verdict_check
        check (stability_verdict in ('stable', 'fragile', 'unstable', 'indeterminate')),
    constraint counterfactual_sessions_stability_score_check
        check (stability_score >= 0 and stability_score <= 1),
    constraint counterfactual_sessions_latency_check
        check (latency_ms >= 0)
);

create table if not exists public.cpg_finding_scores (
    id                              uuid primary key default gen_random_uuid(),
    session_id                      uuid not null references public.counterfactual_diagnostic_sessions(id) on delete cascade,
    tenant_id                       uuid not null,
    finding                         text not null,
    finding_type                    text not null,
    diagnosis                       text not null,
    diagnosis_rank_baseline         integer not null,
    probability_baseline            double precision not null,
    probability_counterfactual      double precision not null,
    cpg                             double precision not null,
    rank_after_removal              integer,
    rank_delta                      integer,
    diagnosis_dropped_out           boolean not null default false,
    created_at                      timestamptz not null default now(),

    constraint cpg_finding_scores_finding_type_check
        check (finding_type in ('presenting_sign', 'diagnostic_test', 'physical_exam', 'history')),
    constraint cpg_finding_scores_probability_baseline_check
        check (probability_baseline >= 0 and probability_baseline <= 1),
    constraint cpg_finding_scores_probability_counterfactual_check
        check (probability_counterfactual >= 0 and probability_counterfactual <= 1)
);

create or replace function public.prevent_counterfactual_stability_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'counterfactual stability tables are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_counterfactual_diagnostic_sessions
    on public.counterfactual_diagnostic_sessions;

create trigger enforce_immutability_counterfactual_diagnostic_sessions
    before update or delete on public.counterfactual_diagnostic_sessions
    for each row execute function public.prevent_counterfactual_stability_mutation();

drop trigger if exists enforce_immutability_cpg_finding_scores
    on public.cpg_finding_scores;

create trigger enforce_immutability_cpg_finding_scores
    before update or delete on public.cpg_finding_scores
    for each row execute function public.prevent_counterfactual_stability_mutation();

create index if not exists cf_sessions_tenant_inference_created_idx
    on public.counterfactual_diagnostic_sessions (tenant_id, inference_event_id, created_at desc)
    where inference_event_id is not null;

create index if not exists cf_sessions_tenant_stability_created_idx
    on public.counterfactual_diagnostic_sessions (tenant_id, stability_verdict, stability_score, created_at desc);

create index if not exists cpg_scores_session_cpg_idx
    on public.cpg_finding_scores (session_id, (abs(cpg)) desc);

alter table public.counterfactual_diagnostic_sessions enable row level security;
alter table public.cpg_finding_scores enable row level security;

drop policy if exists "service_role_cf_sessions"
    on public.counterfactual_diagnostic_sessions;
create policy "service_role_cf_sessions"
    on public.counterfactual_diagnostic_sessions
    for all to service_role
    using (true)
    with check (true);

drop policy if exists "service_role_cpg_scores"
    on public.cpg_finding_scores;
create policy "service_role_cpg_scores"
    on public.cpg_finding_scores
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.counterfactual_diagnostic_sessions to service_role;
grant select, insert on public.cpg_finding_scores to service_role;
revoke update, delete on public.counterfactual_diagnostic_sessions from anon, authenticated;
revoke update, delete on public.cpg_finding_scores from anon, authenticated;

notify pgrst, 'reload schema';
