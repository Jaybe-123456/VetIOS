-- VetIOS global ontology mapping review and external validation v1
-- Adds governed promotion from source_attested to reviewer_verified to externally_verified.

create extension if not exists pgcrypto;

alter table public.global_condition_source_mapping_events
    drop constraint if exists global_condition_source_mapping_events_status_check;
alter table public.global_condition_source_mapping_events
    add constraint global_condition_source_mapping_events_status_check
        check (mapping_status in (
            'candidate',
            'source_attested',
            'reviewer_verified',
            'externally_verified',
            'deprecated',
            'rejected'
        ));

alter table public.official_ontology_release_events
    drop constraint if exists official_ontology_release_events_access_check;
alter table public.official_ontology_release_events
    add constraint official_ontology_release_events_access_check
        check (access_mode in (
            'public_obo_json',
            'public_api',
            'public_dataset',
            'credentialed_api',
            'licensed_release'
        ));

alter table public.global_biomedical_ontology_node_events
    drop constraint if exists global_biomedical_ontology_node_events_kind_check;
alter table public.global_biomedical_ontology_node_events
    add constraint global_biomedical_ontology_node_events_kind_check
        check (node_kind in (
            'class',
            'phenotype',
            'relationship',
            'literature_evidence',
            'surveillance_record',
            'unknown'
        ));

alter table public.global_condition_expansion_events
    drop constraint if exists global_condition_expansion_events_status_check;
alter table public.global_condition_expansion_events
    add constraint global_condition_expansion_events_status_check
        check (expansion_status in (
            'verified_candidates_available',
            'graph_candidates_available',
            'no_candidate_hints',
            'no_verified_mappings',
            'query_failed'
        ));

create table if not exists public.global_condition_source_mapping_review_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null unique,
    source_mapping_event_id uuid references public.global_condition_source_mapping_events(id) on delete set null,
    condition_key text not null,
    source_key text not null,
    external_code_system text,
    external_code text,
    prior_mapping_status text not null default 'source_attested',
    review_status text not null default 'queued',
    review_action text not null default 'queued',
    reviewer_role text,
    reviewer_ref text,
    review_confidence numeric(5, 4) not null default 0,
    promoted_mapping_status text,
    review_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_condition_source_mapping_review_prior_status_check
        check (prior_mapping_status in (
            'candidate',
            'source_attested',
            'reviewer_verified',
            'externally_verified',
            'deprecated',
            'rejected'
        )),
    constraint global_condition_source_mapping_review_status_check
        check (review_status in (
            'queued',
            'needs_review',
            'reviewer_verified',
            'needs_external_validation',
            'rejected',
            'deprecated'
        )),
    constraint global_condition_source_mapping_review_action_check
        check (review_action in (
            'queued',
            'approve',
            'reject',
            'request_external_validation',
            'deprecate'
        )),
    constraint global_condition_source_mapping_review_promoted_status_check
        check (
            promoted_mapping_status is null
            or promoted_mapping_status in ('reviewer_verified', 'externally_verified', 'rejected', 'deprecated')
        ),
    constraint global_condition_source_mapping_review_confidence_check
        check (review_confidence >= 0 and review_confidence <= 1)
);

create table if not exists public.global_ontology_external_validation_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null unique,
    source_mapping_event_id uuid references public.global_condition_source_mapping_events(id) on delete set null,
    review_event_id uuid references public.global_condition_source_mapping_review_events(id) on delete set null,
    condition_key text not null,
    source_key text not null,
    external_code_system text,
    external_code text,
    validation_provider text not null,
    validation_method text not null default 'external_review',
    validation_status text not null default 'pending',
    validation_confidence numeric(5, 4) not null default 0,
    promoted_mapping_status text,
    validation_artifact_hash text,
    validation_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_ontology_external_validation_method_check
        check (validation_method in (
            'external_review',
            'source_owner_confirmation',
            'licensed_terminology_audit',
            'public_health_authority_review',
            'third_party_conformance'
        )),
    constraint global_ontology_external_validation_status_check
        check (validation_status in (
            'pending',
            'externally_verified',
            'rejected',
            'insufficient_evidence',
            'expired'
        )),
    constraint global_ontology_external_validation_promoted_status_check
        check (
            promoted_mapping_status is null
            or promoted_mapping_status in ('externally_verified', 'rejected')
        ),
    constraint global_ontology_external_validation_confidence_check
        check (validation_confidence >= 0 and validation_confidence <= 1),
    constraint global_ontology_external_validation_hash_check
        check (validation_artifact_hash is null or validation_artifact_hash ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_global_ontology_review_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'global ontology review and validation tables are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_global_condition_source_mapping_review_events
    on public.global_condition_source_mapping_review_events;
create trigger enforce_immutability_global_condition_source_mapping_review_events
    before update or delete on public.global_condition_source_mapping_review_events
    for each row execute function public.prevent_global_ontology_review_event_mutation();

drop trigger if exists enforce_immutability_global_ontology_external_validation_events
    on public.global_ontology_external_validation_events;
create trigger enforce_immutability_global_ontology_external_validation_events
    before update or delete on public.global_ontology_external_validation_events
    for each row execute function public.prevent_global_ontology_review_event_mutation();

create index if not exists global_condition_source_mapping_review_condition_idx
    on public.global_condition_source_mapping_review_events
        (condition_key, source_key, review_status, created_at desc);

create index if not exists global_condition_source_mapping_review_mapping_idx
    on public.global_condition_source_mapping_review_events
        (source_mapping_event_id, created_at desc)
    where source_mapping_event_id is not null;

create index if not exists global_ontology_external_validation_condition_idx
    on public.global_ontology_external_validation_events
        (condition_key, source_key, validation_status, created_at desc);

create index if not exists global_ontology_external_validation_mapping_idx
    on public.global_ontology_external_validation_events
        (source_mapping_event_id, created_at desc)
    where source_mapping_event_id is not null;

alter table public.global_condition_source_mapping_review_events enable row level security;
alter table public.global_ontology_external_validation_events enable row level security;

drop policy if exists "service_role_global_condition_source_mapping_review_events"
    on public.global_condition_source_mapping_review_events;
create policy "service_role_global_condition_source_mapping_review_events"
    on public.global_condition_source_mapping_review_events
    for all to service_role using (true) with check (true);

drop policy if exists "service_role_global_ontology_external_validation_events"
    on public.global_ontology_external_validation_events;
create policy "service_role_global_ontology_external_validation_events"
    on public.global_ontology_external_validation_events
    for all to service_role using (true) with check (true);

comment on table public.global_condition_source_mapping_review_events is
    'Append-only reviewer workflow for promoting global condition source mappings from source_attested to reviewer_verified, rejected, deprecated, or queued for external validation.';

comment on table public.global_ontology_external_validation_events is
    'Append-only external validation workflow for source mappings that require third-party, source-owner, terminology, public-health, or conformance verification before becoming externally_verified.';

notify pgrst, 'reload schema';
