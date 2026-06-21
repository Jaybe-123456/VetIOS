create extension if not exists pgcrypto;

create table if not exists public.clinical_learning_record_eligibility_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    clinical_outcome_id uuid references public.clinical_outcome_events(id) on delete set null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    external_validation_event_id uuid references public.external_validation_events(id) on delete set null,
    consent_scope text not null default 'network_learning',
    consent_status text not null default 'unknown',
    label_type text,
    outcome_confirmation_status text not null default 'unconfirmed',
    provenance_status text not null default 'not_verified',
    trust_score numeric(5, 4) not null default 0,
    trust_score_components jsonb not null default '{}'::jsonb,
    record_hash text not null,
    eligible_for_federation boolean not null default false,
    exclusion_reasons text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint clinical_learning_record_eligibility_tenant_request_key
        unique (tenant_id, request_id),
    constraint clinical_learning_record_eligibility_consent_scope_check
        check (consent_scope in (
            'deidentified_training',
            'network_learning',
            'population_signal',
            'federated_round'
        )),
    constraint clinical_learning_record_eligibility_consent_status_check
        check (consent_status in ('unknown', 'granted', 'denied', 'revoked', 'not_required')),
    constraint clinical_learning_record_eligibility_outcome_status_check
        check (outcome_confirmation_status in (
            'unconfirmed',
            'clinician_confirmed',
            'expert_reviewed',
            'lab_confirmed',
            'outcome_linked'
        )),
    constraint clinical_learning_record_eligibility_provenance_status_check
        check (provenance_status in (
            'not_verified',
            'source_attested',
            'hash_verified',
            'reviewer_verified',
            'externally_verified'
        )),
    constraint clinical_learning_record_eligibility_trust_score_check
        check (trust_score >= 0 and trust_score <= 1),
    constraint clinical_learning_record_eligibility_record_hash_check
        check (record_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_clinical_learning_record_eligibility_tenant_created
    on public.clinical_learning_record_eligibility_events (tenant_id, created_at desc);

create index if not exists idx_clinical_learning_record_eligibility_federation
    on public.clinical_learning_record_eligibility_events
        (tenant_id, eligible_for_federation, observed_at desc);

create index if not exists idx_clinical_learning_record_eligibility_case
    on public.clinical_learning_record_eligibility_events (case_id)
    where case_id is not null;

create index if not exists idx_clinical_learning_record_eligibility_outcome
    on public.clinical_learning_record_eligibility_events (clinical_outcome_id)
    where clinical_outcome_id is not null;

create index if not exists idx_clinical_learning_record_eligibility_exclusion_gin
    on public.clinical_learning_record_eligibility_events using gin (exclusion_reasons);

create index if not exists idx_clinical_learning_record_eligibility_evidence_gin
    on public.clinical_learning_record_eligibility_events using gin (evidence);

create table if not exists public.federated_outcome_eligibility_snapshots (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    federation_key text not null,
    partner_ref text,
    membership_id uuid references public.federation_memberships(id) on delete set null,
    evidence_window_start timestamptz,
    evidence_window_end timestamptz not null default now(),
    outcome_confirmed_rows integer not null default 0,
    lab_confirmed_rows integer not null default 0,
    expert_reviewed_rows integer not null default 0,
    synthetic_rows_excluded integer not null default 0,
    consented_network_learning_rows integer not null default 0,
    provenance_verified_rows integer not null default 0,
    trust_scored_rows integer not null default 0,
    amr_outcome_linked_rows integer not null default 0,
    external_validation_events integer not null default 0,
    minimum_required_rows integer not null default 20,
    minimum_provenance_rows integer not null default 20,
    minimum_trust_scored_rows integer not null default 20,
    minimum_external_validations integer not null default 0,
    minimum_trust_score numeric(5, 4) not null default 0.7000,
    average_trust_score numeric(5, 4) not null default 0,
    eligibility_status text not null default 'insufficient_evidence',
    blockers text[] not null default '{}',
    source_hash_bundle jsonb not null default '{}'::jsonb,
    source_table_counts jsonb not null default '{}'::jsonb,
    source_record_digest text,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federated_outcome_eligibility_tenant_request_key
        unique (tenant_id, request_id),
    constraint federated_outcome_eligibility_status_check
        check (eligibility_status in (
            'eligible',
            'insufficient_evidence',
            'blocked',
            'expired'
        )),
    constraint federated_outcome_eligibility_nonnegative_counts_check
        check (
            outcome_confirmed_rows >= 0
            and lab_confirmed_rows >= 0
            and expert_reviewed_rows >= 0
            and synthetic_rows_excluded >= 0
            and consented_network_learning_rows >= 0
            and provenance_verified_rows >= 0
            and trust_scored_rows >= 0
            and amr_outcome_linked_rows >= 0
            and external_validation_events >= 0
            and minimum_required_rows >= 0
            and minimum_provenance_rows >= 0
            and minimum_trust_scored_rows >= 0
            and minimum_external_validations >= 0
        ),
    constraint federated_outcome_eligibility_score_check
        check (
            minimum_trust_score >= 0
            and minimum_trust_score <= 1
            and average_trust_score >= 0
            and average_trust_score <= 1
        ),
    constraint federated_outcome_eligibility_digest_check
        check (source_record_digest is null or source_record_digest ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_federated_outcome_eligibility_tenant_created
    on public.federated_outcome_eligibility_snapshots (tenant_id, created_at desc);

create index if not exists idx_federated_outcome_eligibility_lookup
    on public.federated_outcome_eligibility_snapshots
        (federation_key, tenant_id, observed_at desc);

create index if not exists idx_federated_outcome_eligibility_status
    on public.federated_outcome_eligibility_snapshots
        (federation_key, eligibility_status, observed_at desc);

create index if not exists idx_federated_outcome_eligibility_blockers_gin
    on public.federated_outcome_eligibility_snapshots using gin (blockers);

create index if not exists idx_federated_outcome_eligibility_hash_bundle_gin
    on public.federated_outcome_eligibility_snapshots using gin (source_hash_bundle);

create index if not exists idx_federated_outcome_eligibility_evidence_gin
    on public.federated_outcome_eligibility_snapshots using gin (evidence);

create or replace function public.prevent_clinical_learning_record_eligibility_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'clinical_learning_record_eligibility_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_clinical_learning_record_eligibility_events
    on public.clinical_learning_record_eligibility_events;
create trigger enforce_immutability_clinical_learning_record_eligibility_events
    before update or delete on public.clinical_learning_record_eligibility_events
    for each row execute function public.prevent_clinical_learning_record_eligibility_event_mutation();

create or replace function public.prevent_federated_outcome_eligibility_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federated_outcome_eligibility_snapshots is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federated_outcome_eligibility_snapshots
    on public.federated_outcome_eligibility_snapshots;
create trigger enforce_immutability_federated_outcome_eligibility_snapshots
    before update or delete on public.federated_outcome_eligibility_snapshots
    for each row execute function public.prevent_federated_outcome_eligibility_snapshot_mutation();

alter table public.clinical_learning_record_eligibility_events enable row level security;
alter table public.federated_outcome_eligibility_snapshots enable row level security;

drop policy if exists clinical_learning_record_eligibility_select_tenant
    on public.clinical_learning_record_eligibility_events;
create policy clinical_learning_record_eligibility_select_tenant
    on public.clinical_learning_record_eligibility_events
    for select using (tenant_id = auth.uid());

drop policy if exists clinical_learning_record_eligibility_insert_tenant
    on public.clinical_learning_record_eligibility_events;
create policy clinical_learning_record_eligibility_insert_tenant
    on public.clinical_learning_record_eligibility_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_clinical_learning_record_eligibility_events"
    on public.clinical_learning_record_eligibility_events;
create policy "service_role_clinical_learning_record_eligibility_events"
    on public.clinical_learning_record_eligibility_events for all to service_role using (true) with check (true);

drop policy if exists federated_outcome_eligibility_select_tenant
    on public.federated_outcome_eligibility_snapshots;
create policy federated_outcome_eligibility_select_tenant
    on public.federated_outcome_eligibility_snapshots
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federated_outcome_eligibility_insert_tenant
    on public.federated_outcome_eligibility_snapshots;
create policy federated_outcome_eligibility_insert_tenant
    on public.federated_outcome_eligibility_snapshots
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federated_outcome_eligibility_snapshots"
    on public.federated_outcome_eligibility_snapshots;
create policy "service_role_federated_outcome_eligibility_snapshots"
    on public.federated_outcome_eligibility_snapshots for all to service_role using (true) with check (true);

comment on table public.clinical_learning_record_eligibility_events is
    'Append-only per-record eligibility ledger for deciding whether outcome-linked clinical evidence may enter de-identified training or federated learning.';

comment on column public.clinical_learning_record_eligibility_events.record_hash is
    'SHA-256 digest over stable de-identified record inputs. Do not store raw notes, owner data, or raw documents here.';

comment on table public.federated_outcome_eligibility_snapshots is
    'Append-only site-level evidence snapshot proving a federation participant has outcome-confirmed, consented, provenance-verified, trust-scored records before joining a federated round.';

comment on column public.federated_outcome_eligibility_snapshots.source_hash_bundle is
    'Hash-only source manifest for eligible record sets, consent events, outcome events, AMR evidence, and external validations. No raw clinical data.';

comment on column public.federated_outcome_eligibility_snapshots.eligibility_status is
    'Federated outcome-learning eligibility state: eligible, insufficient_evidence, blocked, or expired.';

notify pgrst, 'reload schema';
