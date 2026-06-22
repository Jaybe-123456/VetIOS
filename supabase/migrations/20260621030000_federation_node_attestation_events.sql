create extension if not exists pgcrypto;

create table if not exists public.federation_node_attestation_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    federation_key text not null,
    partner_ref text not null,
    node_ref text not null,
    membership_id uuid references public.federation_memberships(id) on delete set null,
    attestation_event text not null default 'registration',
    attestation_status text not null default 'submitted',
    verification_status text not null default 'unsigned',
    deployment_environment text not null default 'sandbox',
    software_version text,
    software_artifact_hash text,
    build_provenance_hash text,
    sbom_hash text,
    signed_payload_hash text,
    signature_algorithm text,
    signature_hash text,
    signing_key_fingerprint text,
    transparency_log_ref text,
    attestation_score numeric(5, 4) not null default 0,
    allowed_task_types text[] not null default '{}',
    expires_at timestamptz,
    blockers text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federation_node_attestation_events_tenant_request_key
        unique (tenant_id, request_id),
    constraint federation_node_attestation_events_event_check
        check (attestation_event in (
            'registration',
            'provenance',
            'key_rotation',
            'renewal',
            'revocation',
            'incident_response'
        )),
    constraint federation_node_attestation_events_status_check
        check (attestation_status in ('submitted', 'accepted', 'rejected', 'revoked', 'expired')),
    constraint federation_node_attestation_events_verification_check
        check (verification_status in ('unsigned', 'signature_pending', 'signature_verified', 'reviewer_verified', 'failed')),
    constraint federation_node_attestation_events_environment_check
        check (deployment_environment in ('sandbox', 'staging', 'production')),
    constraint federation_node_attestation_events_score_check
        check (attestation_score >= 0 and attestation_score <= 1),
    constraint federation_node_attestation_events_software_hash_check
        check (software_artifact_hash is null or software_artifact_hash ~ '^[a-f0-9]{64}$'),
    constraint federation_node_attestation_events_build_hash_check
        check (build_provenance_hash is null or build_provenance_hash ~ '^[a-f0-9]{64}$'),
    constraint federation_node_attestation_events_sbom_hash_check
        check (sbom_hash is null or sbom_hash ~ '^[a-f0-9]{64}$'),
    constraint federation_node_attestation_events_payload_hash_check
        check (signed_payload_hash is null or signed_payload_hash ~ '^[a-f0-9]{64}$'),
    constraint federation_node_attestation_events_signature_hash_check
        check (signature_hash is null or signature_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_federation_node_attestation_tenant_created
    on public.federation_node_attestation_events (tenant_id, created_at desc);

create index if not exists idx_federation_node_attestation_lookup
    on public.federation_node_attestation_events
        (tenant_id, federation_key, node_ref, observed_at desc);

create index if not exists idx_federation_node_attestation_status
    on public.federation_node_attestation_events
        (federation_key, attestation_status, verification_status, observed_at desc);

create index if not exists idx_federation_node_attestation_membership
    on public.federation_node_attestation_events (membership_id)
    where membership_id is not null;

create index if not exists idx_federation_node_attestation_allowed_tasks_gin
    on public.federation_node_attestation_events using gin (allowed_task_types);

create index if not exists idx_federation_node_attestation_blockers_gin
    on public.federation_node_attestation_events using gin (blockers);

create index if not exists idx_federation_node_attestation_evidence_gin
    on public.federation_node_attestation_events using gin (evidence);

create or replace function public.prevent_federation_node_attestation_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federation_node_attestation_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federation_node_attestation_events
    on public.federation_node_attestation_events;
create trigger enforce_immutability_federation_node_attestation_events
    before update or delete on public.federation_node_attestation_events
    for each row execute function public.prevent_federation_node_attestation_event_mutation();

alter table public.federation_node_attestation_events enable row level security;

drop policy if exists federation_node_attestation_events_select_tenant
    on public.federation_node_attestation_events;
create policy federation_node_attestation_events_select_tenant
    on public.federation_node_attestation_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federation_node_attestation_events_insert_tenant
    on public.federation_node_attestation_events;
create policy federation_node_attestation_events_insert_tenant
    on public.federation_node_attestation_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federation_node_attestation_events"
    on public.federation_node_attestation_events;
create policy "service_role_federation_node_attestation_events"
    on public.federation_node_attestation_events for all to service_role using (true) with check (true);

comment on table public.federation_node_attestation_events is
    'Append-only federation node attestation and revocation ledger. Proves node software, artifact hash, build provenance, signing key, and policy posture before live contribution.';

comment on column public.federation_node_attestation_events.software_artifact_hash is
    'SHA-256 digest of the approved node runtime artifact or container image. Do not store raw binaries here.';

comment on column public.federation_node_attestation_events.build_provenance_hash is
    'SHA-256 digest for SLSA/in-toto style build provenance or equivalent attestation bundle.';

comment on column public.federation_node_attestation_events.allowed_task_types is
    'Federated task types this node attestation permits, such as diagnosis_delta, severity_delta, support_summary, secure_aggregation_key, or unmask_share.';

comment on column public.federation_node_attestation_events.attestation_score is
    '0-1 runtime trust score for approved node contribution, based on accepted status, signature/reviewer verification, artifact hash, provenance, SBOM, key fingerprint, expiry, and blockers.';

notify pgrst, 'reload schema';
