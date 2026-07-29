-- Outcome Calibration Materializer v1.
--
-- Converts real, evidence-grade inference/outcome pairs into immutable,
-- reproducible calibration evidence. Synthetic and weak-authority outcomes are
-- recorded as blocked evidence rather than silently entering calibration.

create extension if not exists pgcrypto;

create table if not exists public.outcome_calibration_materialization_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    request_id text not null,
    inference_event_id uuid not null references public.ai_inference_events(id) on delete cascade,
    outcome_event_id uuid not null references public.clinical_outcome_events(id) on delete cascade,
    algorithm_version text not null,
    materialization_status text not null,
    authority_type text,
    canonical_label text,
    predicted_label text,
    top_label_confidence double precision,
    top_label_correct boolean,
    top_label_brier_score double precision,
    top_label_log_loss double precision,
    absolute_confidence_error double precision,
    confirmed_label_probability double precision,
    top_three_contains_confirmed boolean,
    distribution_scope text not null default 'unavailable',
    multiclass_brier_score double precision,
    multiclass_log_loss double precision,
    is_canonical_at_materialization boolean not null default false,
    blocker_codes text[] not null default array[]::text[],
    warning_codes text[] not null default array[]::text[],
    source_digest text not null,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null,
    created_at timestamptz not null default now(),

    constraint outcome_calibration_materialization_status_check
        check (materialization_status in ('materialized', 'blocked')),
    constraint outcome_calibration_materialization_distribution_check
        check (distribution_scope in ('unavailable', 'top_label_only', 'complete_multiclass')),
    constraint outcome_calibration_materialization_algorithm_check
        check (length(btrim(algorithm_version)) > 0),
    constraint outcome_calibration_materialization_digest_check
        check (source_digest ~ '^[a-f0-9]{64}$'),
    constraint outcome_calibration_materialization_metric_bounds_check
        check (
            (top_label_confidence is null or (top_label_confidence >= 0 and top_label_confidence <= 1))
            and (top_label_brier_score is null or (top_label_brier_score >= 0 and top_label_brier_score <= 1))
            and (absolute_confidence_error is null or (absolute_confidence_error >= 0 and absolute_confidence_error <= 1))
            and (confirmed_label_probability is null or (confirmed_label_probability >= 0 and confirmed_label_probability <= 1))
            and (multiclass_brier_score is null or (multiclass_brier_score >= 0 and multiclass_brier_score <= 2))
            and (top_label_log_loss is null or top_label_log_loss >= 0)
            and (multiclass_log_loss is null or multiclass_log_loss >= 0)
        ),
    constraint outcome_calibration_materialization_state_check
        check (
            (
                materialization_status = 'materialized'
                and cardinality(blocker_codes) = 0
                and canonical_label is not null
                and predicted_label is not null
                and top_label_confidence is not null
                and top_label_correct is not null
                and top_label_brier_score is not null
                and top_label_log_loss is not null
                and absolute_confidence_error is not null
            )
            or (
                materialization_status = 'blocked'
                and cardinality(blocker_codes) > 0
            )
        ),
    constraint outcome_calibration_materialization_idempotency
        unique (tenant_id, inference_event_id, outcome_event_id, algorithm_version)
);

create index if not exists outcome_calibration_materialization_tenant_created_idx
    on public.outcome_calibration_materialization_events (tenant_id, created_at desc);

create index if not exists outcome_calibration_materialization_tenant_status_idx
    on public.outcome_calibration_materialization_events (
        tenant_id,
        algorithm_version,
        materialization_status,
        created_at desc
    );

create index if not exists outcome_calibration_materialization_inference_idx
    on public.outcome_calibration_materialization_events (
        tenant_id,
        inference_event_id,
        created_at desc
    );

create index if not exists outcome_calibration_materialization_outcome_idx
    on public.outcome_calibration_materialization_events (outcome_event_id);

create index if not exists outcome_calibration_materialization_blockers_gin_idx
    on public.outcome_calibration_materialization_events using gin (blocker_codes);

create or replace function public.prevent_outcome_calibration_materialization_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'outcome calibration materialization events are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_outcome_calibration_materialization
    on public.outcome_calibration_materialization_events;
create trigger enforce_immutability_outcome_calibration_materialization
    before update or delete on public.outcome_calibration_materialization_events
    for each row execute function public.prevent_outcome_calibration_materialization_mutation();

alter table public.outcome_calibration_materialization_events enable row level security;

drop policy if exists "service_role_outcome_calibration_materialization"
    on public.outcome_calibration_materialization_events;
create policy "service_role_outcome_calibration_materialization"
    on public.outcome_calibration_materialization_events
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.outcome_calibration_materialization_events to service_role;
revoke all on public.outcome_calibration_materialization_events from anon, authenticated;

comment on table public.outcome_calibration_materialization_events is
    'Append-only, versioned event ledger for deterministic outcome calibration evidence. Every linked pair is either materialized or blocked with explicit reasons.';

comment on column public.outcome_calibration_materialization_events.top_label_brier_score is
    'Binary Brier score for the event that the top-ranked label is correct. This is not a multiclass Brier score.';

comment on column public.outcome_calibration_materialization_events.absolute_confidence_error is
    'Per-event absolute confidence error. It must not be described as expected calibration error (ECE).';

comment on column public.outcome_calibration_materialization_events.evidence is
    'Sanitized lineage and metric-contract metadata only. Raw notes, owner identifiers, lab documents, images, and full clinical payloads are prohibited.';

create or replace view public.outcome_value_metrics_v2
as
with latest_pair_evidence as (
    select distinct on (
        materialization.tenant_id,
        materialization.inference_event_id,
        materialization.outcome_event_id
    )
        materialization.tenant_id,
        materialization.inference_event_id,
        materialization.materialization_status
    from public.outcome_calibration_materialization_events materialization
    order by
        materialization.tenant_id,
        materialization.inference_event_id,
        materialization.outcome_event_id,
        materialization.created_at desc,
        materialization.id desc
),
materialized_by_tenant as (
    select
        tenant_id,
        count(distinct inference_event_id) filter (
            where materialization_status = 'materialized'
        )::bigint as calibration_ready_outcomes
    from latest_pair_evidence
    group by tenant_id
)
select
    metric.tenant_id,
    metric.inference_events,
    metric.real_inference_events,
    metric.synthetic_inferences_excluded,
    metric.outcome_linked_inferences,
    metric.synthetic_outcome_inferences_excluded,
    metric.outcome_confirmed_inferences,
    metric.expert_reviewed_inferences,
    metric.lab_confirmed_inferences,
    coalesce(materialized.calibration_ready_outcomes, 0::bigint) as calibration_ready_outcomes,
    metric.outcome_confirmation_rate,
    metric.latest_outcome_confirmed_at,
    'outcome_value_v2'::text as metric_version
from public.outcome_value_metrics_v1 metric
left join materialized_by_tenant materialized
    on materialized.tenant_id = metric.tenant_id;

comment on view public.outcome_value_metrics_v2 is
    'Outcome value metrics whose calibration-ready count requires successful, versioned materialization rather than a legacy calibration_delta field.';

revoke all on public.outcome_value_metrics_v2 from anon, authenticated;
grant select on public.outcome_value_metrics_v2 to service_role;

notify pgrst, 'reload schema';
