create extension if not exists pgcrypto;

create table if not exists public.regulatory_claim_review_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    ask_vetios_query_id uuid references public.ask_vetios_queries(id) on delete set null,
    external_validation_event_id uuid references public.external_validation_events(id) on delete set null,
    review_queue text not null default 'none',
    claim_review_status text not null default 'not_required',
    approval_status text not null default 'not_reviewed',
    cds_evidence_pack_status text not null default 'not_required',
    model_card_status text not null default 'not_required',
    ifu_status text not null default 'not_required',
    clinical_signoff_status text not null default 'not_required',
    legal_signoff_status text not null default 'not_required',
    regulatory_claims_status text not null,
    regulatory_risk_level text not null default 'low',
    diagnosis_or_treatment_claim_present boolean not null default false,
    treatment_or_prescribing_claim_present boolean not null default false,
    professional_review_required boolean not null default false,
    independent_review_basis_available boolean not null default false,
    citations_present boolean not null default false,
    rationale_present boolean not null default false,
    diagnostic_alternatives_present boolean not null default false,
    outcome_confirmation_required boolean not null default false,
    evidence_pack_hash text not null,
    model_card_hash text,
    ifu_hash text,
    approval_packet_hash text not null,
    review_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    next_actions text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint regulatory_claim_review_events_request_key unique (request_id),
    constraint regulatory_claim_review_events_queue_check
        check (review_queue in (
            'none',
            'clinical_cds_review',
            'clinical_claims_review',
            'legal_clinical_claims_review',
            'external_attestation'
        )),
    constraint regulatory_claim_review_events_claim_status_check
        check (claim_review_status in (
            'not_required',
            'ready_for_review',
            'pending',
            'blocked',
            'approved',
            'rejected'
        )),
    constraint regulatory_claim_review_events_approval_status_check
        check (approval_status in (
            'not_reviewed',
            'clinical_review_required',
            'legal_review_required',
            'external_attestation_required',
            'approved',
            'rejected'
        )),
    constraint regulatory_claim_review_events_artifact_status_check
        check (
            cds_evidence_pack_status in ('not_required', 'incomplete', 'complete')
            and model_card_status in ('not_required', 'draft_required', 'drafted', 'approved')
            and ifu_status in ('not_required', 'draft_required', 'drafted', 'approved')
        ),
    constraint regulatory_claim_review_events_signoff_status_check
        check (
            clinical_signoff_status in ('not_required', 'pending', 'approved', 'rejected')
            and legal_signoff_status in ('not_required', 'pending', 'approved', 'rejected')
        ),
    constraint regulatory_claim_review_events_status_check
        check (regulatory_claims_status in (
            'non_clinical',
            'cds_reviewable',
            'claims_review_required',
            'restricted_claims'
        )),
    constraint regulatory_claim_review_events_risk_check
        check (regulatory_risk_level in ('low', 'medium', 'high')),
    constraint regulatory_claim_review_events_hash_check
        check (
            evidence_pack_hash ~ '^[a-f0-9]{64}$'
            and approval_packet_hash ~ '^[a-f0-9]{64}$'
            and (model_card_hash is null or model_card_hash ~ '^[a-f0-9]{64}$')
            and (ifu_hash is null or ifu_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_regulatory_claim_review_tenant_created
    on public.regulatory_claim_review_events (tenant_id, created_at desc)
    where tenant_id is not null;

create index if not exists idx_regulatory_claim_review_request
    on public.regulatory_claim_review_events (request_id, created_at desc);

create index if not exists idx_regulatory_claim_review_status
    on public.regulatory_claim_review_events
        (review_queue, claim_review_status, approval_status, observed_at desc);

create index if not exists idx_regulatory_claim_review_query
    on public.regulatory_claim_review_events (ask_vetios_query_id)
    where ask_vetios_query_id is not null;

create index if not exists idx_regulatory_claim_review_blockers_gin
    on public.regulatory_claim_review_events using gin (blockers);

create index if not exists idx_regulatory_claim_review_packet_gin
    on public.regulatory_claim_review_events using gin (review_packet);

create or replace function public.prevent_regulatory_claim_review_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'regulatory_claim_review_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_regulatory_claim_review_events
    on public.regulatory_claim_review_events;
create trigger enforce_immutability_regulatory_claim_review_events
    before update or delete on public.regulatory_claim_review_events
    for each row execute function public.prevent_regulatory_claim_review_event_mutation();

alter table public.regulatory_claim_review_events enable row level security;

drop policy if exists regulatory_claim_review_events_select_tenant
    on public.regulatory_claim_review_events;
create policy regulatory_claim_review_events_select_tenant
    on public.regulatory_claim_review_events
    for select using (tenant_id = auth.uid());

drop policy if exists regulatory_claim_review_events_insert_tenant
    on public.regulatory_claim_review_events;
create policy regulatory_claim_review_events_insert_tenant
    on public.regulatory_claim_review_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_regulatory_claim_review_events"
    on public.regulatory_claim_review_events;
create policy "service_role_regulatory_claim_review_events"
    on public.regulatory_claim_review_events for all to service_role using (true) with check (true);

comment on table public.regulatory_claim_review_events is
    'Append-only regulatory and claims-discipline review queue for Ask VetIOS CDS outputs, evidence-pack completeness, model-card/IFU readiness, and clinical/legal signoff.';

comment on column public.regulatory_claim_review_events.review_packet is
    'De-identified regulatory review packet. Store claim posture, reviewability flags, artifact hashes, blockers, and approval metadata only; no raw clinical text, prompts, owner data, or legal advice.';

comment on column public.regulatory_claim_review_events.evidence_pack_hash is
    'SHA-256 digest over the CDS reviewability evidence packet for this Ask VetIOS output.';

notify pgrst, 'reload schema';
