create table if not exists public.external_validation_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    validation_target_type text not null,
    validation_target_id uuid,
    validation_target_ref text not null,
    moat_key text,
    attestor_kind text not null,
    attestor_ref text not null,
    validation_scope text not null,
    attestation_status text not null default 'submitted',
    verification_status text not null default 'unsigned',
    evidence_grade text not null default 'none',
    validation_score numeric(5, 4) not null default 0,
    source_system text,
    source_ref text,
    signed_payload_hash text,
    signature_algorithm text,
    signature_hash text,
    signing_key_fingerprint text,
    evidence jsonb not null default '{}'::jsonb,
    limitations text,
    validation_summary text,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint external_validation_events_tenant_request_key unique (tenant_id, request_id),
    constraint external_validation_events_target_type_check
        check (validation_target_type in (
            'moat_completion',
            'case_graph_promotion',
            'amr_stewardship',
            'specialist_review',
            'federation_activation',
            'clinical_outcome',
            'retrieval_corpus',
            'model_trust',
            'partner_dataset',
            'other'
        )),
    constraint external_validation_events_moat_key_check
        check (moat_key is null or moat_key ~ '^[a-z0-9][a-z0-9:_-]{2,96}$'),
    constraint external_validation_events_attestor_kind_check
        check (attestor_kind in (
            'clinic',
            'specialist',
            'reference_lab',
            'university',
            'public_health',
            'ngo',
            'government',
            'research_partner',
            'auditor',
            'internal_reviewer'
        )),
    constraint external_validation_events_scope_check
        check (validation_scope in (
            'outcome_provenance',
            'data_quality',
            'clinical_accuracy',
            'amr_signal',
            'federation_readiness',
            'security_control',
            'regulatory_claims',
            'retrieval_grounding',
            'workflow_integration',
            'general'
        )),
    constraint external_validation_events_attestation_status_check
        check (attestation_status in ('submitted', 'accepted', 'rejected', 'expired', 'revoked')),
    constraint external_validation_events_verification_status_check
        check (verification_status in (
            'unsigned',
            'signature_pending',
            'signature_verified',
            'reviewer_verified',
            'failed'
        )),
    constraint external_validation_events_evidence_grade_check
        check (evidence_grade in ('none', 'source_attested', 'reviewer_verified', 'externally_verified')),
    constraint external_validation_events_score_check
        check (validation_score >= 0 and validation_score <= 1),
    constraint external_validation_events_payload_hash_check
        check (signed_payload_hash is null or signed_payload_hash ~ '^[a-f0-9]{64}$'),
    constraint external_validation_events_signature_hash_check
        check (signature_hash is null or signature_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_external_validation_tenant_created
    on public.external_validation_events (tenant_id, created_at desc);

create index if not exists idx_external_validation_target
    on public.external_validation_events (tenant_id, validation_target_type, validation_target_ref, observed_at desc);

create index if not exists idx_external_validation_moat_grade
    on public.external_validation_events (tenant_id, moat_key, evidence_grade, observed_at desc)
    where moat_key is not null;

create index if not exists idx_external_validation_scope_status
    on public.external_validation_events (tenant_id, validation_scope, attestation_status, verification_status, observed_at desc);

create index if not exists idx_external_validation_attestor
    on public.external_validation_events (tenant_id, attestor_kind, attestor_ref, observed_at desc);

create index if not exists idx_external_validation_evidence_gin
    on public.external_validation_events using gin (evidence);

create or replace function public.prevent_external_validation_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'external_validation_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_external_validation_events on public.external_validation_events;
create trigger enforce_immutability_external_validation_events
    before update or delete on public.external_validation_events
    for each row execute function public.prevent_external_validation_event_mutation();

alter table public.external_validation_events enable row level security;

drop policy if exists external_validation_events_select_tenant on public.external_validation_events;
create policy external_validation_events_select_tenant
    on public.external_validation_events
    for select using (tenant_id = auth.uid());

drop policy if exists external_validation_events_insert_tenant on public.external_validation_events;
create policy external_validation_events_insert_tenant
    on public.external_validation_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_external_validation_events" on public.external_validation_events;
create policy "service_role_external_validation_events"
    on public.external_validation_events for all to service_role using (true) with check (true);

comment on table public.external_validation_events is
    'Append-only partner/external validation ledger for proving moat evidence beyond internal architecture claims.';

comment on column public.external_validation_events.validation_target_ref is
    'Stable de-identified target reference, such as a moat key, case-graph promotion digest, AMR signal ref, federation node ref, or retrieval corpus ref.';

comment on column public.external_validation_events.attestor_ref is
    'De-identified attestor reference. Do not store personal names, emails, licenses, or raw partner secrets here.';

comment on column public.external_validation_events.evidence is
    'De-identified external validation evidence: aggregate counts, hashes, reviewer role, source table refs, scope, and limitations only.';

comment on column public.external_validation_events.evidence_grade is
    'Computed validation grade: none, source_attested, reviewer_verified, or externally_verified.';

notify pgrst, 'reload schema';
