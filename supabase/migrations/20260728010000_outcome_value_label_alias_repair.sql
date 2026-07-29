-- Outcome Value Metrics v1 label alias repair.
--
-- Historical outcome payloads used actual_diagnosis and final_diagnosis before
-- the canonical actual_label/confirmed_diagnosis keys were introduced. Accept
-- those label aliases without weakening the expert/laboratory authority gate.

create or replace view public.outcome_value_metrics_v1
with (security_invoker = true)
as
with outcome_by_inference as (
    select
        inference_event.tenant_id,
        inference_event.id as inference_event_id,
        (
            coalesce(inference_event.is_synthetic, false)
            or inference_event.simulation_id is not null
        ) as inference_is_synthetic,
        count(outcome_event.id) > 0 as outcome_linked,
        coalesce(
            bool_or(
                coalesce(outcome_event.is_synthetic, false)
                or outcome_event.simulation_id is not null
                or lower(coalesce(outcome_event.label_type, outcome_event.outcome_payload ->> 'label_type', '')) in (
                    'synthetic',
                    'simulation'
                )
                or lower(coalesce(outcome_event.source_module, '')) like '%simulation%'
            ) filter (where outcome_event.id is not null),
            false
        ) as synthetic_outcome_present,
        coalesce(
            bool_or(
                lower(coalesce(outcome_event.label_type, outcome_event.outcome_payload ->> 'label_type', ''))
                    = 'expert_reviewed'
                and nullif(
                    btrim(coalesce(
                        outcome_event.actual_label,
                        outcome_event.outcome_payload ->> 'actual_label',
                        outcome_event.outcome_payload ->> 'confirmed_diagnosis',
                        outcome_event.outcome_payload ->> 'actual_diagnosis',
                        outcome_event.outcome_payload ->> 'label',
                        outcome_event.outcome_payload ->> 'final_diagnosis'
                    )),
                    ''
                ) is not null
            ) filter (where outcome_event.id is not null),
            false
        ) as expert_reviewed,
        coalesce(
            bool_or(
                lower(coalesce(outcome_event.label_type, outcome_event.outcome_payload ->> 'label_type', ''))
                    = 'lab_confirmed'
                and nullif(
                    btrim(coalesce(
                        outcome_event.actual_label,
                        outcome_event.outcome_payload ->> 'actual_label',
                        outcome_event.outcome_payload ->> 'confirmed_diagnosis',
                        outcome_event.outcome_payload ->> 'actual_diagnosis',
                        outcome_event.outcome_payload ->> 'label',
                        outcome_event.outcome_payload ->> 'final_diagnosis'
                    )),
                    ''
                ) is not null
            ) filter (where outcome_event.id is not null),
            false
        ) as lab_confirmed,
        coalesce(
            bool_or(
                outcome_event.calibration_delta is not null
                or nullif(outcome_event.outcome_payload ->> 'calibration_delta', '') is not null
            ) filter (where outcome_event.id is not null),
            false
        ) as calibration_delta_present,
        max(outcome_event.outcome_timestamp) filter (
            where lower(coalesce(outcome_event.label_type, outcome_event.outcome_payload ->> 'label_type', ''))
                in ('expert_reviewed', 'lab_confirmed')
        ) as latest_confirmed_at
    from public.ai_inference_events inference_event
    left join public.clinical_outcome_events outcome_event
        on outcome_event.tenant_id = inference_event.tenant_id
       and outcome_event.inference_event_id = inference_event.id
    group by
        inference_event.tenant_id,
        inference_event.id,
        inference_event.is_synthetic,
        inference_event.simulation_id
),
tenant_metrics as (
    select
        tenant_id,
        count(*)::bigint as inference_events,
        count(*) filter (where not inference_is_synthetic)::bigint as real_inference_events,
        count(*) filter (where inference_is_synthetic)::bigint as synthetic_inferences_excluded,
        count(*) filter (
            where outcome_linked
              and not inference_is_synthetic
              and not synthetic_outcome_present
        )::bigint as outcome_linked_inferences,
        count(*) filter (
            where outcome_linked
              and (inference_is_synthetic or synthetic_outcome_present)
        )::bigint as synthetic_outcome_inferences_excluded,
        count(*) filter (
            where not inference_is_synthetic
              and not synthetic_outcome_present
              and (expert_reviewed or lab_confirmed)
        )::bigint as outcome_confirmed_inferences,
        count(*) filter (
            where not inference_is_synthetic
              and not synthetic_outcome_present
              and expert_reviewed
        )::bigint as expert_reviewed_inferences,
        count(*) filter (
            where not inference_is_synthetic
              and not synthetic_outcome_present
              and lab_confirmed
        )::bigint as lab_confirmed_inferences,
        count(*) filter (
            where not inference_is_synthetic
              and not synthetic_outcome_present
              and (expert_reviewed or lab_confirmed)
              and calibration_delta_present
        )::bigint as calibration_ready_outcomes,
        max(latest_confirmed_at) filter (
            where not inference_is_synthetic
              and not synthetic_outcome_present
              and (expert_reviewed or lab_confirmed)
        ) as latest_outcome_confirmed_at
    from outcome_by_inference
    group by tenant_id
)
select
    tenant_id,
    inference_events,
    real_inference_events,
    synthetic_inferences_excluded,
    outcome_linked_inferences,
    synthetic_outcome_inferences_excluded,
    outcome_confirmed_inferences,
    expert_reviewed_inferences,
    lab_confirmed_inferences,
    calibration_ready_outcomes,
    case
        when real_inference_events = 0 then 0::numeric
        else round(outcome_confirmed_inferences::numeric / real_inference_events::numeric, 6)
    end as outcome_confirmation_rate,
    latest_outcome_confirmed_at,
    'outcome_value_v1'::text as metric_version
from tenant_metrics;

comment on view public.outcome_value_metrics_v1 is
    'Tenant-level, privacy-preserving outcome value metrics. Distinct inferences only; synthetic provenance and inferred-only labels are excluded from confirmation counts. Historical actual_diagnosis and final_diagnosis payload keys are normalized as label aliases.';

revoke all on public.outcome_value_metrics_v1 from anon;
grant select on public.outcome_value_metrics_v1 to authenticated, service_role;

notify pgrst, 'reload schema';
