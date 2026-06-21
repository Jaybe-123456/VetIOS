create extension if not exists pgcrypto;

create table if not exists public.federated_model_promotion_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    federation_round_id uuid not null references public.federation_rounds(id) on delete cascade,
    model_registry_entry_id uuid references public.model_registry_entries(id) on delete set null,
    federation_key text not null,
    round_key text not null,
    task_type text not null,
    candidate_model_version text not null,
    candidate_dataset_version text,
    promotion_stage text not null default 'candidate_registration',
    promotion_status text not null default 'blocked',
    participant_count integer not null default 0,
    accepted_update_submissions integer not null default 0,
    eligible_outcome_snapshots integer not null default 0,
    outcome_confirmed_rows integer not null default 0,
    provenance_verified_rows integer not null default 0,
    trust_scored_rows integer not null default 0,
    average_trust_score numeric(5, 4) not null default 0,
    secure_aggregation_status text not null default 'missing',
    source_artifact_hash text,
    aggregate_payload_hash text,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federated_model_promotion_events_tenant_request_key
        unique (tenant_id, request_id),
    constraint federated_model_promotion_events_task_type_check
        check (task_type in ('diagnosis', 'severity', 'hybrid')),
    constraint federated_model_promotion_events_stage_check
        check (promotion_stage in (
            'candidate_registration',
            'benchmark_gate',
            'champion_promotion'
        )),
    constraint federated_model_promotion_events_status_check
        check (promotion_status in (
            'blocked',
            'candidate_registered',
            'already_registered',
            'promotion_gate_required',
            'rejected'
        )),
    constraint federated_model_promotion_events_counts_check
        check (
            participant_count >= 0
            and accepted_update_submissions >= 0
            and eligible_outcome_snapshots >= 0
            and outcome_confirmed_rows >= 0
            and provenance_verified_rows >= 0
            and trust_scored_rows >= 0
        ),
    constraint federated_model_promotion_events_score_check
        check (average_trust_score >= 0 and average_trust_score <= 1),
    constraint federated_model_promotion_events_source_hash_check
        check (source_artifact_hash is null or source_artifact_hash ~ '^[a-f0-9]{64}$'),
    constraint federated_model_promotion_events_payload_hash_check
        check (aggregate_payload_hash is null or aggregate_payload_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_federated_model_promotion_tenant_created
    on public.federated_model_promotion_events (tenant_id, created_at desc);

create index if not exists idx_federated_model_promotion_round
    on public.federated_model_promotion_events
        (federation_round_id, task_type, created_at desc);

create index if not exists idx_federated_model_promotion_candidate
    on public.federated_model_promotion_events
        (tenant_id, candidate_model_version, promotion_status, created_at desc);

create index if not exists idx_federated_model_promotion_blockers_gin
    on public.federated_model_promotion_events using gin (blockers);

create index if not exists idx_federated_model_promotion_evidence_gin
    on public.federated_model_promotion_events using gin (evidence);

create or replace function public.prevent_federated_model_promotion_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federated_model_promotion_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federated_model_promotion_events
    on public.federated_model_promotion_events;
create trigger enforce_immutability_federated_model_promotion_events
    before update or delete on public.federated_model_promotion_events
    for each row execute function public.prevent_federated_model_promotion_event_mutation();

alter table public.federated_model_promotion_events enable row level security;

drop policy if exists federated_model_promotion_events_select_tenant
    on public.federated_model_promotion_events;
create policy federated_model_promotion_events_select_tenant
    on public.federated_model_promotion_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federated_model_promotion_events_insert_tenant
    on public.federated_model_promotion_events;
create policy federated_model_promotion_events_insert_tenant
    on public.federated_model_promotion_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federated_model_promotion_events"
    on public.federated_model_promotion_events;
create policy "service_role_federated_model_promotion_events"
    on public.federated_model_promotion_events for all to service_role using (true) with check (true);

comment on table public.federated_model_promotion_events is
    'Append-only bridge from outcome-confirmed live federation rounds into candidate model registry entries. This ledger records blockers, hashes, accepted node update evidence, outcome eligibility, and candidate registration decisions.';

comment on column public.federated_model_promotion_events.promotion_status is
    'Candidate registration decision: blocked, candidate_registered, already_registered, promotion_gate_required, or rejected. Champion promotion remains gated by benchmark, calibration, adversarial, and regression evidence.';

comment on column public.federated_model_promotion_events.evidence is
    'De-identified promotion evidence manifest. Store hashes, counts, round IDs, task IDs, eligibility IDs, and review metadata only; no raw model deltas or clinical records.';

notify pgrst, 'reload schema';
