create extension if not exists pgcrypto;

create table if not exists public.federated_model_evaluation_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    federation_round_id uuid not null references public.federation_rounds(id) on delete cascade,
    federated_model_promotion_event_id uuid references public.federated_model_promotion_events(id) on delete set null,
    model_registry_entry_id uuid references public.model_registry_entries(id) on delete set null,
    external_validation_event_id uuid references public.external_validation_events(id) on delete set null,
    federation_key text not null,
    round_key text not null,
    task_type text not null,
    candidate_model_version text not null,
    baseline_model_version text,
    evaluation_stage text not null default 'preflight',
    evaluation_status text not null default 'blocked',
    validation_status text not null default 'not_started',
    gating_decision text not null default 'hold',
    participant_count integer not null default 0,
    eligible_node_count integer not null default 0,
    accepted_update_submissions integer not null default 0,
    quarantined_update_submissions integer not null default 0,
    outcome_confirmed_rows integer not null default 0,
    externally_validated_rows integer not null default 0,
    minimum_participants integer not null default 3,
    minimum_outcome_confirmed_rows integer not null default 100,
    minimum_external_validations integer not null default 1,
    candidate_accuracy numeric(7, 6),
    baseline_accuracy numeric(7, 6),
    accuracy_delta numeric(7, 6),
    candidate_triage_sensitivity numeric(7, 6),
    baseline_triage_sensitivity numeric(7, 6),
    triage_sensitivity_delta numeric(7, 6),
    false_negative_rate numeric(7, 6),
    hallucination_rate numeric(7, 6),
    citation_grounding_rate numeric(7, 6),
    calibration_ece numeric(7, 6),
    brier_score numeric(7, 6),
    calibration_delta numeric(7, 6),
    amr_signal_quality_score numeric(5, 4) not null default 0,
    safety_regression_score numeric(5, 4) not null default 0,
    distribution_drift_score numeric(5, 4) not null default 0,
    promotion_score numeric(5, 4) not null default 0,
    rollback_risk_score numeric(5, 4) not null default 0,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    metric_summary jsonb not null default '{}'::jsonb,
    evaluation_packet jsonb not null default '{}'::jsonb,
    source_hash_bundle jsonb not null default '{}'::jsonb,
    evaluation_digest text,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federated_model_evaluation_events_tenant_request_key
        unique (tenant_id, request_id),
    constraint federated_model_evaluation_events_task_type_check
        check (task_type in ('diagnosis', 'severity', 'hybrid')),
    constraint federated_model_evaluation_events_stage_check
        check (evaluation_stage in (
            'preflight',
            'shadow_benchmark',
            'outcome_validation',
            'safety_review',
            'promotion_review',
            'post_promotion'
        )),
    constraint federated_model_evaluation_events_status_check
        check (evaluation_status in ('blocked', 'failed', 'passed', 'needs_review', 'approved')),
    constraint federated_model_evaluation_events_validation_status_check
        check (validation_status in (
            'not_started',
            'internal_validated',
            'externally_validated',
            'insufficient'
        )),
    constraint federated_model_evaluation_events_decision_check
        check (gating_decision in (
            'hold',
            'eligible_for_promotion',
            'reject',
            'rollback_required'
        )),
    constraint federated_model_evaluation_events_counts_check
        check (
            participant_count >= 0
            and eligible_node_count >= 0
            and accepted_update_submissions >= 0
            and quarantined_update_submissions >= 0
            and outcome_confirmed_rows >= 0
            and externally_validated_rows >= 0
            and minimum_participants >= 0
            and minimum_outcome_confirmed_rows >= 0
            and minimum_external_validations >= 0
        ),
    constraint federated_model_evaluation_events_score_check
        check (
            amr_signal_quality_score >= 0 and amr_signal_quality_score <= 1
            and safety_regression_score >= 0 and safety_regression_score <= 1
            and distribution_drift_score >= 0 and distribution_drift_score <= 1
            and promotion_score >= 0 and promotion_score <= 1
            and rollback_risk_score >= 0 and rollback_risk_score <= 1
        ),
    constraint federated_model_evaluation_events_metric_bounds_check
        check (
            (candidate_accuracy is null or (candidate_accuracy >= 0 and candidate_accuracy <= 1))
            and (baseline_accuracy is null or (baseline_accuracy >= 0 and baseline_accuracy <= 1))
            and (candidate_triage_sensitivity is null or (candidate_triage_sensitivity >= 0 and candidate_triage_sensitivity <= 1))
            and (baseline_triage_sensitivity is null or (baseline_triage_sensitivity >= 0 and baseline_triage_sensitivity <= 1))
            and (false_negative_rate is null or (false_negative_rate >= 0 and false_negative_rate <= 1))
            and (hallucination_rate is null or (hallucination_rate >= 0 and hallucination_rate <= 1))
            and (citation_grounding_rate is null or (citation_grounding_rate >= 0 and citation_grounding_rate <= 1))
            and (calibration_ece is null or (calibration_ece >= 0 and calibration_ece <= 1))
            and (brier_score is null or (brier_score >= 0 and brier_score <= 1))
        ),
    constraint federated_model_evaluation_events_digest_check
        check (evaluation_digest is null or evaluation_digest ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_federated_model_evaluation_tenant_created
    on public.federated_model_evaluation_events (tenant_id, created_at desc);

create index if not exists idx_federated_model_evaluation_round
    on public.federated_model_evaluation_events
        (federation_round_id, task_type, observed_at desc);

create index if not exists idx_federated_model_evaluation_candidate
    on public.federated_model_evaluation_events
        (tenant_id, candidate_model_version, gating_decision, observed_at desc);

create index if not exists idx_federated_model_evaluation_gate
    on public.federated_model_evaluation_events
        (federation_key, evaluation_status, validation_status, gating_decision, observed_at desc);

create index if not exists idx_federated_model_evaluation_blockers_gin
    on public.federated_model_evaluation_events using gin (blockers);

create index if not exists idx_federated_model_evaluation_packet_gin
    on public.federated_model_evaluation_events using gin (evaluation_packet);

create index if not exists idx_federated_model_evaluation_hash_bundle_gin
    on public.federated_model_evaluation_events using gin (source_hash_bundle);

create table if not exists public.federated_model_promotion_decision_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    federation_round_id uuid not null references public.federation_rounds(id) on delete cascade,
    federated_model_promotion_event_id uuid references public.federated_model_promotion_events(id) on delete set null,
    evaluation_event_id uuid references public.federated_model_evaluation_events(id) on delete set null,
    candidate_model_registry_entry_id uuid references public.model_registry_entries(id) on delete set null,
    previous_champion_model_registry_entry_id uuid references public.model_registry_entries(id) on delete set null,
    external_validation_event_id uuid references public.external_validation_events(id) on delete set null,
    federation_key text not null,
    round_key text not null,
    task_type text not null,
    candidate_model_version text not null,
    previous_champion_model_version text,
    decision_stage text not null default 'governance_review',
    decision_status text not null default 'pending',
    approval_status text not null default 'not_reviewed',
    deployment_scope text not null default 'none',
    rollout_status text not null default 'not_started',
    required_approvals integer not null default 2,
    received_approvals integer not null default 0,
    canary_percentage numeric(5, 4) not null default 0,
    promotion_score numeric(5, 4) not null default 0,
    minimum_promotion_score numeric(5, 4) not null default 0.8500,
    rollback_risk_score numeric(5, 4) not null default 1,
    maximum_rollback_risk_score numeric(5, 4) not null default 0.1500,
    promotion_artifact_hash text,
    model_card_hash text,
    approval_packet_hash text,
    signed_payload_hash text,
    signature_algorithm text,
    signature_hash text,
    signing_key_fingerprint text,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    approvals jsonb not null default '[]'::jsonb,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federated_model_promotion_decision_tenant_request_key
        unique (tenant_id, request_id),
    constraint federated_model_promotion_decision_task_type_check
        check (task_type in ('diagnosis', 'severity', 'hybrid')),
    constraint federated_model_promotion_decision_stage_check
        check (decision_stage in (
            'governance_review',
            'canary_authorized',
            'champion_promoted',
            'promotion_rejected',
            'rollback_authorized'
        )),
    constraint federated_model_promotion_decision_status_check
        check (decision_status in ('pending', 'approved', 'rejected', 'promoted', 'rolled_back', 'expired')),
    constraint federated_model_promotion_decision_approval_check
        check (approval_status in (
            'not_reviewed',
            'clinician_reviewed',
            'model_risk_approved',
            'external_validation_required',
            'approved',
            'rejected'
        )),
    constraint federated_model_promotion_decision_scope_check
        check (deployment_scope in ('none', 'shadow', 'canary', 'single_tenant', 'federation', 'global')),
    constraint federated_model_promotion_decision_rollout_check
        check (rollout_status in ('not_started', 'authorized', 'in_progress', 'paused', 'completed', 'rolled_back')),
    constraint federated_model_promotion_decision_counts_check
        check (
            required_approvals >= 0
            and received_approvals >= 0
        ),
    constraint federated_model_promotion_decision_score_check
        check (
            canary_percentage >= 0 and canary_percentage <= 1
            and promotion_score >= 0 and promotion_score <= 1
            and minimum_promotion_score >= 0 and minimum_promotion_score <= 1
            and rollback_risk_score >= 0 and rollback_risk_score <= 1
            and maximum_rollback_risk_score >= 0 and maximum_rollback_risk_score <= 1
        ),
    constraint federated_model_promotion_decision_hash_check
        check (
            (promotion_artifact_hash is null or promotion_artifact_hash ~ '^[a-f0-9]{64}$')
            and (model_card_hash is null or model_card_hash ~ '^[a-f0-9]{64}$')
            and (approval_packet_hash is null or approval_packet_hash ~ '^[a-f0-9]{64}$')
            and (signed_payload_hash is null or signed_payload_hash ~ '^[a-f0-9]{64}$')
            and (signature_hash is null or signature_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_federated_model_promotion_decision_tenant_created
    on public.federated_model_promotion_decision_events (tenant_id, created_at desc);

create index if not exists idx_federated_model_promotion_decision_round
    on public.federated_model_promotion_decision_events
        (federation_round_id, decision_status, observed_at desc);

create index if not exists idx_federated_model_promotion_decision_candidate
    on public.federated_model_promotion_decision_events
        (tenant_id, candidate_model_version, decision_stage, decision_status, observed_at desc);

create index if not exists idx_federated_model_promotion_decision_blockers_gin
    on public.federated_model_promotion_decision_events using gin (blockers);

create index if not exists idx_federated_model_promotion_decision_approvals_gin
    on public.federated_model_promotion_decision_events using gin (approvals);

create index if not exists idx_federated_model_promotion_decision_evidence_gin
    on public.federated_model_promotion_decision_events using gin (evidence);

create table if not exists public.federated_model_rollout_monitoring_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    promotion_decision_event_id uuid references public.federated_model_promotion_decision_events(id) on delete set null,
    candidate_model_registry_entry_id uuid references public.model_registry_entries(id) on delete set null,
    previous_champion_model_registry_entry_id uuid references public.model_registry_entries(id) on delete set null,
    federation_key text not null,
    task_type text not null,
    model_version text not null,
    rollout_stage text not null default 'shadow',
    monitoring_status text not null default 'observing',
    observation_window_start timestamptz,
    observation_window_end timestamptz not null default now(),
    inference_count integer not null default 0,
    outcome_confirmed_rows integer not null default 0,
    clinician_override_count integer not null default 0,
    abstention_count integer not null default 0,
    safety_incident_count integer not null default 0,
    hallucination_incident_count integer not null default 0,
    false_negative_incident_count integer not null default 0,
    accuracy numeric(7, 6),
    triage_sensitivity numeric(7, 6),
    false_negative_rate numeric(7, 6),
    override_rate numeric(7, 6),
    abstention_rate numeric(7, 6),
    calibration_ece numeric(7, 6),
    brier_score numeric(7, 6),
    distribution_drift_score numeric(5, 4) not null default 0,
    rollback_metric_score numeric(5, 4) not null default 0,
    maximum_rollback_metric_score numeric(5, 4) not null default 0.1500,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    monitoring_packet jsonb not null default '{}'::jsonb,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federated_model_rollout_monitoring_tenant_request_key
        unique (tenant_id, request_id),
    constraint federated_model_rollout_monitoring_task_type_check
        check (task_type in ('diagnosis', 'severity', 'hybrid')),
    constraint federated_model_rollout_monitoring_stage_check
        check (rollout_stage in ('shadow', 'canary', 'single_tenant', 'federation', 'global')),
    constraint federated_model_rollout_monitoring_status_check
        check (monitoring_status in (
            'observing',
            'healthy',
            'degraded',
            'rollback_recommended',
            'rolled_back',
            'paused'
        )),
    constraint federated_model_rollout_monitoring_counts_check
        check (
            inference_count >= 0
            and outcome_confirmed_rows >= 0
            and clinician_override_count >= 0
            and abstention_count >= 0
            and safety_incident_count >= 0
            and hallucination_incident_count >= 0
            and false_negative_incident_count >= 0
        ),
    constraint federated_model_rollout_monitoring_score_check
        check (
            distribution_drift_score >= 0 and distribution_drift_score <= 1
            and rollback_metric_score >= 0 and rollback_metric_score <= 1
            and maximum_rollback_metric_score >= 0 and maximum_rollback_metric_score <= 1
        ),
    constraint federated_model_rollout_monitoring_metric_bounds_check
        check (
            (accuracy is null or (accuracy >= 0 and accuracy <= 1))
            and (triage_sensitivity is null or (triage_sensitivity >= 0 and triage_sensitivity <= 1))
            and (false_negative_rate is null or (false_negative_rate >= 0 and false_negative_rate <= 1))
            and (override_rate is null or (override_rate >= 0 and override_rate <= 1))
            and (abstention_rate is null or (abstention_rate >= 0 and abstention_rate <= 1))
            and (calibration_ece is null or (calibration_ece >= 0 and calibration_ece <= 1))
            and (brier_score is null or (brier_score >= 0 and brier_score <= 1))
        )
);

create index if not exists idx_federated_model_rollout_monitoring_tenant_created
    on public.federated_model_rollout_monitoring_events (tenant_id, created_at desc);

create index if not exists idx_federated_model_rollout_monitoring_promotion
    on public.federated_model_rollout_monitoring_events
        (promotion_decision_event_id, monitoring_status, observed_at desc)
    where promotion_decision_event_id is not null;

create index if not exists idx_federated_model_rollout_monitoring_model
    on public.federated_model_rollout_monitoring_events
        (tenant_id, model_version, rollout_stage, monitoring_status, observed_at desc);

create index if not exists idx_federated_model_rollout_monitoring_blockers_gin
    on public.federated_model_rollout_monitoring_events using gin (blockers);

create index if not exists idx_federated_model_rollout_monitoring_packet_gin
    on public.federated_model_rollout_monitoring_events using gin (monitoring_packet);

create or replace function public.prevent_federated_model_evaluation_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federated_model_evaluation_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federated_model_evaluation_events
    on public.federated_model_evaluation_events;
create trigger enforce_immutability_federated_model_evaluation_events
    before update or delete on public.federated_model_evaluation_events
    for each row execute function public.prevent_federated_model_evaluation_event_mutation();

create or replace function public.prevent_federated_model_promotion_decision_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federated_model_promotion_decision_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federated_model_promotion_decision_events
    on public.federated_model_promotion_decision_events;
create trigger enforce_immutability_federated_model_promotion_decision_events
    before update or delete on public.federated_model_promotion_decision_events
    for each row execute function public.prevent_federated_model_promotion_decision_event_mutation();

create or replace function public.prevent_federated_model_rollout_monitoring_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federated_model_rollout_monitoring_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federated_model_rollout_monitoring_events
    on public.federated_model_rollout_monitoring_events;
create trigger enforce_immutability_federated_model_rollout_monitoring_events
    before update or delete on public.federated_model_rollout_monitoring_events
    for each row execute function public.prevent_federated_model_rollout_monitoring_event_mutation();

alter table public.federated_model_evaluation_events enable row level security;
alter table public.federated_model_promotion_decision_events enable row level security;
alter table public.federated_model_rollout_monitoring_events enable row level security;

drop policy if exists federated_model_evaluation_events_select_tenant
    on public.federated_model_evaluation_events;
create policy federated_model_evaluation_events_select_tenant
    on public.federated_model_evaluation_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federated_model_evaluation_events_insert_tenant
    on public.federated_model_evaluation_events;
create policy federated_model_evaluation_events_insert_tenant
    on public.federated_model_evaluation_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federated_model_evaluation_events"
    on public.federated_model_evaluation_events;
create policy "service_role_federated_model_evaluation_events"
    on public.federated_model_evaluation_events for all to service_role using (true) with check (true);

drop policy if exists federated_model_promotion_decision_events_select_tenant
    on public.federated_model_promotion_decision_events;
create policy federated_model_promotion_decision_events_select_tenant
    on public.federated_model_promotion_decision_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federated_model_promotion_decision_events_insert_tenant
    on public.federated_model_promotion_decision_events;
create policy federated_model_promotion_decision_events_insert_tenant
    on public.federated_model_promotion_decision_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federated_model_promotion_decision_events"
    on public.federated_model_promotion_decision_events;
create policy "service_role_federated_model_promotion_decision_events"
    on public.federated_model_promotion_decision_events for all to service_role using (true) with check (true);

drop policy if exists federated_model_rollout_monitoring_events_select_tenant
    on public.federated_model_rollout_monitoring_events;
create policy federated_model_rollout_monitoring_events_select_tenant
    on public.federated_model_rollout_monitoring_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federated_model_rollout_monitoring_events_insert_tenant
    on public.federated_model_rollout_monitoring_events;
create policy federated_model_rollout_monitoring_events_insert_tenant
    on public.federated_model_rollout_monitoring_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federated_model_rollout_monitoring_events"
    on public.federated_model_rollout_monitoring_events;
create policy "service_role_federated_model_rollout_monitoring_events"
    on public.federated_model_rollout_monitoring_events for all to service_role using (true) with check (true);

comment on table public.federated_model_evaluation_events is
    'Append-only evaluation gate for federated model candidates. Records outcome-confirmed performance, calibration, safety, drift, AMR signal quality, external validation, hashes, and promotion blockers before champion promotion.';

comment on table public.federated_model_promotion_decision_events is
    'Append-only governance decision ledger for federated model promotion, canary authorization, champion promotion, rejection, and rollback authorization.';

comment on table public.federated_model_rollout_monitoring_events is
    'Append-only post-promotion monitoring ledger for shadow/canary/federation rollout health, outcome-confirmed production metrics, regression signals, and rollback triggers.';

comment on column public.federated_model_evaluation_events.evaluation_packet is
    'De-identified promotion evaluation packet. Store aggregate metrics, hash manifests, validation refs, limitations, and reviewer notes only; no raw clinical records or unmasked model deltas.';

comment on column public.federated_model_promotion_decision_events.approvals is
    'Structured approval metadata for governance review. Store role, scope, decision, timestamps, and hashes; do not store personal identifiers or secrets.';

comment on column public.federated_model_rollout_monitoring_events.monitoring_packet is
    'De-identified rollout monitoring packet with aggregate production metrics, outcome confirmation counts, drift summaries, incident counts, and rollback evidence.';

notify pgrst, 'reload schema';
