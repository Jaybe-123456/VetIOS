-- VetIOS Global One Health condition ontology spine v1
-- Creates append-only evidence for source-mapped animal-human-environment condition coverage.

create extension if not exists pgcrypto;

create table if not exists public.global_health_condition_ontology_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    condition_key text not null,
    canonical_name text not null,
    condition_domain text not null,
    host_scope text[] not null default array[]::text[],
    species_scope text[] not null default array[]::text[],
    human_relevance text not null default 'not_assessed',
    zoonotic_role text not null default 'not_assessed',
    syndrome_tags text[] not null default array[]::text[],
    pathogen_refs text[] not null default array[]::text[],
    vector_refs text[] not null default array[]::text[],
    reservoir_refs text[] not null default array[]::text[],
    transmission_routes text[] not null default array[]::text[],
    geography_tags text[] not null default array[]::text[],
    climate_tags text[] not null default array[]::text[],
    amr_relevance text not null default 'not_assessed',
    ontology_version text not null default 'global_one_health_v1',
    evidence_grade text not null default 'source_attested',
    source_manifest_hash text not null,
    condition_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_health_condition_ontology_events_request_key
        unique (request_id, condition_key, ontology_version),
    constraint global_health_condition_ontology_events_domain_check
        check (condition_domain in (
            'infectious',
            'parasitic',
            'toxicology',
            'metabolic',
            'neoplastic',
            'immune_mediated',
            'reproductive',
            'cardiorespiratory',
            'gastrointestinal',
            'neurologic',
            'renal_urinary',
            'musculoskeletal',
            'dermatologic',
            'public_health',
            'environmental',
            'unknown'
        )),
    constraint global_health_condition_ontology_events_human_relevance_check
        check (human_relevance in ('not_assessed', 'none_known', 'correlated', 'zoonotic', 'shared_pathogen', 'shared_exposure', 'human_only')),
    constraint global_health_condition_ontology_events_zoonotic_role_check
        check (zoonotic_role in ('not_assessed', 'not_zoonotic', 'reservoir', 'spillover_host', 'dead_end_host', 'vector_borne_bridge', 'environmental_bridge')),
    constraint global_health_condition_ontology_events_amr_check
        check (amr_relevance in ('not_assessed', 'none_known', 'possible', 'confirmed', 'surveillance_priority')),
    constraint global_health_condition_ontology_events_grade_check
        check (evidence_grade in ('source_attested', 'reviewer_verified', 'externally_verified')),
    constraint global_health_condition_ontology_events_hash_check
        check (source_manifest_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.global_condition_source_mapping_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    condition_key text not null,
    source_key text not null,
    source_authority text not null,
    source_type text not null,
    external_code_system text,
    external_code text,
    mapping_status text not null default 'candidate',
    mapping_confidence numeric(5, 4) not null default 0,
    license_status text not null default 'unknown',
    source_version text,
    source_document_hash text,
    mapping_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_condition_source_mapping_events_status_check
        check (mapping_status in ('candidate', 'source_attested', 'reviewer_verified', 'deprecated', 'rejected')),
    constraint global_condition_source_mapping_events_confidence_check
        check (mapping_confidence >= 0 and mapping_confidence <= 1),
    constraint global_condition_source_mapping_events_license_check
        check (license_status in ('unknown', 'public_reference', 'open_license', 'licensed', 'restricted', 'blocked')),
    constraint global_condition_source_mapping_events_hash_check
        check (source_document_hash is null or source_document_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.one_health_condition_edge_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    edge_key text not null,
    source_condition_key text not null,
    target_condition_key text,
    edge_type text not null,
    host_scope text[] not null default array[]::text[],
    pathogen_ref text,
    vector_ref text,
    reservoir_ref text,
    exposure_route text,
    geography_tags text[] not null default array[]::text[],
    evidence_grade text not null default 'source_attested',
    edge_confidence numeric(5, 4) not null default 0,
    source_manifest_hash text not null,
    edge_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint one_health_condition_edge_events_request_key
        unique (request_id, edge_key),
    constraint one_health_condition_edge_events_type_check
        check (edge_type in (
            'zoonotic_bridge',
            'reverse_zoonosis',
            'shared_pathogen',
            'shared_vector',
            'shared_reservoir',
            'shared_environment',
            'foodborne_route',
            'waterborne_route',
            'amr_bridge',
            'surveillance_correlation'
        )),
    constraint one_health_condition_edge_events_grade_check
        check (evidence_grade in ('source_attested', 'reviewer_verified', 'externally_verified')),
    constraint one_health_condition_edge_events_score_check
        check (edge_confidence >= 0 and edge_confidence <= 1),
    constraint one_health_condition_edge_events_hash_check
        check (source_manifest_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.condition_coverage_snapshot_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    coverage_scope text not null default 'global_one_health',
    ontology_version text not null default 'global_one_health_v1',
    species_scope text[] not null default array[]::text[],
    syndrome_scope text[] not null default array[]::text[],
    region_scope text[] not null default array[]::text[],
    registered_condition_count integer not null default 0,
    source_mapped_condition_count integer not null default 0,
    one_health_edge_count integer not null default 0,
    human_correlation_count integer not null default 0,
    amr_relevant_condition_count integer not null default 0,
    unsupported_species_count integer not null default 0,
    coverage_score numeric(5, 4) not null default 0,
    coverage_status text not null default 'foundation',
    open_world_candidate_generation_status text not null default 'missing',
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    coverage_packet jsonb not null default '{}'::jsonb,
    source_manifest_hash text,
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint condition_coverage_snapshot_events_request_key
        unique (request_id, coverage_scope, ontology_version),
    constraint condition_coverage_snapshot_events_counts_check
        check (
            registered_condition_count >= 0
            and source_mapped_condition_count >= 0
            and one_health_edge_count >= 0
            and human_correlation_count >= 0
            and amr_relevant_condition_count >= 0
            and unsupported_species_count >= 0
        ),
    constraint condition_coverage_snapshot_events_score_check
        check (coverage_score >= 0 and coverage_score <= 1),
    constraint condition_coverage_snapshot_events_status_check
        check (coverage_status in ('foundation', 'partial', 'operational', 'externally_validated', 'blocked')),
    constraint condition_coverage_snapshot_events_open_world_check
        check (open_world_candidate_generation_status in ('missing', 'shadow', 'active', 'blocked')),
    constraint condition_coverage_snapshot_events_hash_check
        check (source_manifest_hash is null or source_manifest_hash ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_global_one_health_condition_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'global One Health ontology evidence tables are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_global_health_condition_ontology_events
    on public.global_health_condition_ontology_events;
create trigger enforce_immutability_global_health_condition_ontology_events
    before update or delete on public.global_health_condition_ontology_events
    for each row execute function public.prevent_global_one_health_condition_event_mutation();

drop trigger if exists enforce_immutability_global_condition_source_mapping_events
    on public.global_condition_source_mapping_events;
create trigger enforce_immutability_global_condition_source_mapping_events
    before update or delete on public.global_condition_source_mapping_events
    for each row execute function public.prevent_global_one_health_condition_event_mutation();

drop trigger if exists enforce_immutability_one_health_condition_edge_events
    on public.one_health_condition_edge_events;
create trigger enforce_immutability_one_health_condition_edge_events
    before update or delete on public.one_health_condition_edge_events
    for each row execute function public.prevent_global_one_health_condition_event_mutation();

drop trigger if exists enforce_immutability_condition_coverage_snapshot_events
    on public.condition_coverage_snapshot_events;
create trigger enforce_immutability_condition_coverage_snapshot_events
    before update or delete on public.condition_coverage_snapshot_events
    for each row execute function public.prevent_global_one_health_condition_event_mutation();

create index if not exists global_health_condition_ontology_condition_idx
    on public.global_health_condition_ontology_events (condition_key, ontology_version, created_at desc);
create index if not exists global_health_condition_ontology_species_gin_idx
    on public.global_health_condition_ontology_events using gin (species_scope);
create index if not exists global_health_condition_ontology_packet_gin_idx
    on public.global_health_condition_ontology_events using gin (condition_packet);

create index if not exists global_condition_source_mapping_condition_idx
    on public.global_condition_source_mapping_events (condition_key, mapping_status, created_at desc);
create index if not exists global_condition_source_mapping_source_idx
    on public.global_condition_source_mapping_events (source_key, source_authority, created_at desc);
create unique index if not exists global_condition_source_mapping_events_request_key
    on public.global_condition_source_mapping_events (
        request_id,
        condition_key,
        source_key,
        coalesce(external_code_system, ''),
        coalesce(external_code, '')
    );

create index if not exists one_health_condition_edge_source_idx
    on public.one_health_condition_edge_events (source_condition_key, edge_type, created_at desc);
create index if not exists one_health_condition_edge_host_gin_idx
    on public.one_health_condition_edge_events using gin (host_scope);

create index if not exists condition_coverage_snapshot_scope_idx
    on public.condition_coverage_snapshot_events (coverage_scope, ontology_version, created_at desc);
create index if not exists condition_coverage_snapshot_status_idx
    on public.condition_coverage_snapshot_events (coverage_status, open_world_candidate_generation_status, created_at desc);

alter table public.global_health_condition_ontology_events enable row level security;
alter table public.global_condition_source_mapping_events enable row level security;
alter table public.one_health_condition_edge_events enable row level security;
alter table public.condition_coverage_snapshot_events enable row level security;

drop policy if exists "service_role_global_health_condition_ontology_events"
    on public.global_health_condition_ontology_events;
create policy "service_role_global_health_condition_ontology_events"
    on public.global_health_condition_ontology_events
    for all to service_role using (true) with check (true);

drop policy if exists "service_role_global_condition_source_mapping_events"
    on public.global_condition_source_mapping_events;
create policy "service_role_global_condition_source_mapping_events"
    on public.global_condition_source_mapping_events
    for all to service_role using (true) with check (true);

drop policy if exists "service_role_one_health_condition_edge_events"
    on public.one_health_condition_edge_events;
create policy "service_role_one_health_condition_edge_events"
    on public.one_health_condition_edge_events
    for all to service_role using (true) with check (true);

drop policy if exists "service_role_condition_coverage_snapshot_events"
    on public.condition_coverage_snapshot_events;
create policy "service_role_condition_coverage_snapshot_events"
    on public.condition_coverage_snapshot_events
    for all to service_role using (true) with check (true);

grant select, insert on public.global_health_condition_ontology_events to service_role;
grant select, insert on public.global_condition_source_mapping_events to service_role;
grant select, insert on public.one_health_condition_edge_events to service_role;
grant select, insert on public.condition_coverage_snapshot_events to service_role;

revoke update, delete on public.global_health_condition_ontology_events from anon, authenticated;
revoke update, delete on public.global_condition_source_mapping_events from anon, authenticated;
revoke update, delete on public.one_health_condition_edge_events from anon, authenticated;
revoke update, delete on public.condition_coverage_snapshot_events from anon, authenticated;

comment on table public.global_health_condition_ontology_events is
    'Append-only source-mapped Global One Health condition ontology evidence. Stores canonical disease metadata, host/species scope, zoonotic role, AMR relevance, and source hashes only.';

comment on table public.global_condition_source_mapping_events is
    'Append-only condition-to-source/code mapping evidence for WOAH, WAHIS, ICD, SNOMED, UMLS, MONDO, PubMed, veterinary references, and licensed corpora.';

comment on table public.one_health_condition_edge_events is
    'Append-only animal-human-environment condition edges for zoonotic bridges, shared pathogens, vectors, reservoirs, exposures, AMR, and surveillance correlations.';

comment on table public.condition_coverage_snapshot_events is
    'Append-only ontology coverage snapshot proving whether VetIOS has enough source-mapped condition breadth for species, region, syndrome, AMR, and One Health inference.';

comment on column public.global_health_condition_ontology_events.condition_packet is
    'Sanitized condition metadata and hashes only. Do not store raw source text, full articles, raw clinical notes, owner data, or unlicensed reference content.';

comment on column public.condition_coverage_snapshot_events.coverage_packet is
    'Aggregate coverage counts, gaps, source manifests, and build blockers only; no raw clinical payloads or raw source text.';

notify pgrst, 'reload schema';
