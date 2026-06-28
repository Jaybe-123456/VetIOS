create extension if not exists pgcrypto;

create table if not exists public.regulatory_claim_approval_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    claim_request_id text not null,
    claim_review_event_id uuid references public.regulatory_claim_review_events(id) on delete set null,
    ask_vetios_query_id uuid references public.ask_vetios_queries(id) on delete set null,
    external_validation_event_id uuid references public.external_validation_events(id) on delete set null,
    action_type text not null,
    action_status text not null,
    reviewer_role text not null,
    reviewer_ref_hash text,
    artifact_type text,
    artifact_hash text,
    approval_packet_hash text not null,
    signed_payload_hash text,
    signature_algorithm text,
    signature_hash text,
    signing_key_fingerprint text,
    review_note_hash text,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    next_actions text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint regulatory_claim_approval_events_request_key unique (request_id),
    constraint regulatory_claim_approval_events_action_type_check
        check (action_type in (
            'cds_evidence_pack_review',
            'model_card_review',
            'ifu_review',
            'clinical_signoff',
            'legal_signoff',
            'external_attestation',
            'claim_rejection'
        )),
    constraint regulatory_claim_approval_events_status_check
        check (action_status in (
            'drafted',
            'approved',
            'rejected',
            'changes_requested',
            'attested',
            'superseded'
        )),
    constraint regulatory_claim_approval_events_reviewer_role_check
        check (reviewer_role in (
            'clinician',
            'legal',
            'regulatory',
            'model_risk',
            'external_attestor',
            'admin'
        )),
    constraint regulatory_claim_approval_events_artifact_type_check
        check (
            artifact_type is null
            or artifact_type in (
                'cds_evidence_pack',
                'model_card',
                'ifu',
                'approval_packet',
                'external_attestation'
            )
        ),
    constraint regulatory_claim_approval_events_hash_check
        check (
            approval_packet_hash ~ '^[a-f0-9]{64}$'
            and (reviewer_ref_hash is null or reviewer_ref_hash ~ '^[a-f0-9]{64}$')
            and (artifact_hash is null or artifact_hash ~ '^[a-f0-9]{64}$')
            and (signed_payload_hash is null or signed_payload_hash ~ '^[a-f0-9]{64}$')
            and (signature_hash is null or signature_hash ~ '^[a-f0-9]{64}$')
            and (review_note_hash is null or review_note_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_regulatory_claim_approval_tenant_created
    on public.regulatory_claim_approval_events (tenant_id, created_at desc)
    where tenant_id is not null;

create index if not exists idx_regulatory_claim_approval_claim_request
    on public.regulatory_claim_approval_events
        (claim_request_id, action_type, observed_at desc);

create index if not exists idx_regulatory_claim_approval_review_event
    on public.regulatory_claim_approval_events (claim_review_event_id, observed_at desc)
    where claim_review_event_id is not null;

create index if not exists idx_regulatory_claim_approval_status
    on public.regulatory_claim_approval_events
        (action_type, action_status, reviewer_role, observed_at desc);

create index if not exists idx_regulatory_claim_approval_blockers_gin
    on public.regulatory_claim_approval_events using gin (blockers);

create index if not exists idx_regulatory_claim_approval_evidence_gin
    on public.regulatory_claim_approval_events using gin (evidence);

create or replace function public.prevent_regulatory_claim_approval_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'regulatory_claim_approval_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_regulatory_claim_approval_events
    on public.regulatory_claim_approval_events;
create trigger enforce_immutability_regulatory_claim_approval_events
    before update or delete on public.regulatory_claim_approval_events
    for each row execute function public.prevent_regulatory_claim_approval_event_mutation();

alter table public.regulatory_claim_approval_events enable row level security;

drop policy if exists regulatory_claim_approval_events_select_tenant
    on public.regulatory_claim_approval_events;
create policy regulatory_claim_approval_events_select_tenant
    on public.regulatory_claim_approval_events
    for select using (tenant_id = auth.uid());

drop policy if exists regulatory_claim_approval_events_insert_tenant
    on public.regulatory_claim_approval_events;
create policy regulatory_claim_approval_events_insert_tenant
    on public.regulatory_claim_approval_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_regulatory_claim_approval_events"
    on public.regulatory_claim_approval_events;
create policy "service_role_regulatory_claim_approval_events"
    on public.regulatory_claim_approval_events for all to service_role using (true) with check (true);

comment on table public.regulatory_claim_approval_events is
    'Append-only regulatory approval, model-card, IFU, clinical signoff, legal signoff, and external-attestation ledger for Ask VetIOS claim-review workflow.';

comment on column public.regulatory_claim_approval_events.review_note_hash is
    'SHA-256 digest of reviewer notes. Store review-note hashes only in this ledger, not raw legal advice, raw clinical notes, prompts, or model outputs.';

comment on column public.regulatory_claim_approval_events.evidence is
    'De-identified approval evidence metadata: artifact refs, hashes, roles, and review workflow facts only.';

notify pgrst, 'reload schema';
