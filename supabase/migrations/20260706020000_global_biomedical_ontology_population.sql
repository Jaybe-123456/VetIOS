-- VetIOS Global biomedical ontology population v1
-- Stores official ontology release manifests plus imported node/relationship evidence.

create extension if not exists pgcrypto;

create table if not exists public.official_ontology_release_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    provider_key text not null,
    source_key text not null,
    code_system text not null,
    source_url text not null,
    access_mode text not null,
    release_status text not null default 'imported',
    release_version text,
    source_document_hash text not null,
    node_count integer not null default 0,
    relationship_count integer not null default 0,
    imported_node_count integer not null default 0,
    imported_relationship_count integer not null default 0,
    license_status text not null default 'unknown',
    release_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint official_ontology_release_events_request_key
        unique (request_id, provider_key, source_document_hash),
    constraint official_ontology_release_events_access_check
        check (access_mode in ('public_obo_json', 'credentialed_api', 'licensed_release')),
    constraint official_ontology_release_events_status_check
        check (release_status in ('planned', 'dry_run', 'imported', 'partial', 'failed', 'blocked')),
    constraint official_ontology_release_events_license_check
        check (license_status in ('unknown', 'public_reference', 'open_license', 'licensed', 'restricted', 'blocked')),
    constraint official_ontology_release_events_counts_check
        check (
            node_count >= 0
            and relationship_count >= 0
            and imported_node_count >= 0
            and imported_relationship_count >= 0
        ),
    constraint official_ontology_release_events_hash_check
        check (source_document_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.global_biomedical_ontology_node_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    release_event_id uuid references public.official_ontology_release_events(id) on delete set null,
    provider_key text not null,
    source_key text not null,
    code_system text not null,
    external_code text not null,
    source_iri text,
    canonical_label text not null,
    synonyms text[] not null default array[]::text[],
    xrefs text[] not null default array[]::text[],
    obsolete boolean not null default false,
    node_kind text not null default 'class',
    node_packet jsonb not null default '{}'::jsonb,
    node_hash text not null,
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_biomedical_ontology_node_events_request_key
        unique (request_id, provider_key, external_code),
    constraint global_biomedical_ontology_node_events_kind_check
        check (node_kind in ('class', 'phenotype', 'relationship', 'unknown')),
    constraint global_biomedical_ontology_node_events_hash_check
        check (node_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.global_biomedical_ontology_relationship_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    release_event_id uuid references public.official_ontology_release_events(id) on delete set null,
    provider_key text not null,
    source_key text not null,
    code_system text not null,
    subject_code text not null,
    predicate text not null,
    object_code text not null,
    relationship_kind text not null default 'ontology_edge',
    relationship_packet jsonb not null default '{}'::jsonb,
    relationship_hash text not null,
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_biomedical_ontology_relationship_events_request_key
        unique (request_id, provider_key, relationship_hash),
    constraint global_biomedical_ontology_relationship_events_kind_check
        check (relationship_kind in ('ontology_edge', 'subclass', 'xref', 'other')),
    constraint global_biomedical_ontology_relationship_events_hash_check
        check (relationship_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.global_biomedical_ontology_population_snapshot_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null unique,
    population_scope text not null default 'global_biomedical_ontology',
    population_status text not null,
    provider_count integer not null default 0,
    imported_provider_count integer not null default 0,
    blocked_provider_count integer not null default 0,
    total_node_count integer not null default 0,
    total_relationship_count integer not null default 0,
    condition_code_provider_count integer not null default 0,
    phenotype_provider_count integer not null default 0,
    terminology_provider_count integer not null default 0,
    licensed_provider_count integer not null default 0,
    credentialed_provider_count integer not null default 0,
    population_packet jsonb not null default '{}'::jsonb,
    source_manifest_hash text,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_biomedical_ontology_population_snapshot_status_check
        check (population_status in ('foundation', 'partial', 'public_sources_populated', 'credentialed_sources_populated', 'fully_populated', 'blocked')),
    constraint global_biomedical_ontology_population_snapshot_counts_check
        check (
            provider_count >= 0
            and imported_provider_count >= 0
            and blocked_provider_count >= 0
            and total_node_count >= 0
            and total_relationship_count >= 0
            and condition_code_provider_count >= 0
            and phenotype_provider_count >= 0
            and terminology_provider_count >= 0
            and licensed_provider_count >= 0
            and credentialed_provider_count >= 0
        ),
    constraint global_biomedical_ontology_population_snapshot_hash_check
        check (source_manifest_hash is null or source_manifest_hash ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_global_biomedical_ontology_population_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'global biomedical ontology population tables are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_official_ontology_release_events
    on public.official_ontology_release_events;
create trigger enforce_immutability_official_ontology_release_events
    before update or delete on public.official_ontology_release_events
    for each row execute function public.prevent_global_biomedical_ontology_population_mutation();

drop trigger if exists enforce_immutability_global_biomedical_ontology_node_events
    on public.global_biomedical_ontology_node_events;
create trigger enforce_immutability_global_biomedical_ontology_node_events
    before update or delete on public.global_biomedical_ontology_node_events
    for each row execute function public.prevent_global_biomedical_ontology_population_mutation();

drop trigger if exists enforce_immutability_global_biomedical_ontology_relationship_events
    on public.global_biomedical_ontology_relationship_events;
create trigger enforce_immutability_global_biomedical_ontology_relationship_events
    before update or delete on public.global_biomedical_ontology_relationship_events
    for each row execute function public.prevent_global_biomedical_ontology_population_mutation();

drop trigger if exists enforce_immutability_global_biomedical_ontology_population_snapshot_events
    on public.global_biomedical_ontology_population_snapshot_events;
create trigger enforce_immutability_global_biomedical_ontology_population_snapshot_events
    before update or delete on public.global_biomedical_ontology_population_snapshot_events
    for each row execute function public.prevent_global_biomedical_ontology_population_mutation();

create index if not exists official_ontology_release_events_provider_idx
    on public.official_ontology_release_events (provider_key, code_system, created_at desc);
create index if not exists official_ontology_release_events_status_idx
    on public.official_ontology_release_events (release_status, created_at desc);

create index if not exists global_biomedical_ontology_node_code_idx
    on public.global_biomedical_ontology_node_events (code_system, external_code, created_at desc);
create index if not exists global_biomedical_ontology_node_label_idx
    on public.global_biomedical_ontology_node_events using gin (to_tsvector('english', canonical_label));
create index if not exists global_biomedical_ontology_node_synonyms_gin_idx
    on public.global_biomedical_ontology_node_events using gin (synonyms);
create index if not exists global_biomedical_ontology_node_xrefs_gin_idx
    on public.global_biomedical_ontology_node_events using gin (xrefs);

create index if not exists global_biomedical_ontology_relationship_subject_idx
    on public.global_biomedical_ontology_relationship_events (code_system, subject_code, predicate, created_at desc);
create index if not exists global_biomedical_ontology_relationship_object_idx
    on public.global_biomedical_ontology_relationship_events (code_system, object_code, created_at desc);

create index if not exists global_biomedical_ontology_population_snapshot_status_idx
    on public.global_biomedical_ontology_population_snapshot_events (population_status, created_at desc);

alter table public.official_ontology_release_events enable row level security;
alter table public.global_biomedical_ontology_node_events enable row level security;
alter table public.global_biomedical_ontology_relationship_events enable row level security;
alter table public.global_biomedical_ontology_population_snapshot_events enable row level security;

drop policy if exists "service_role_official_ontology_release_events"
    on public.official_ontology_release_events;
create policy "service_role_official_ontology_release_events"
    on public.official_ontology_release_events
    for all to service_role using (true) with check (true);

drop policy if exists "service_role_global_biomedical_ontology_node_events"
    on public.global_biomedical_ontology_node_events;
create policy "service_role_global_biomedical_ontology_node_events"
    on public.global_biomedical_ontology_node_events
    for all to service_role using (true) with check (true);

drop policy if exists "service_role_global_biomedical_ontology_relationship_events"
    on public.global_biomedical_ontology_relationship_events;
create policy "service_role_global_biomedical_ontology_relationship_events"
    on public.global_biomedical_ontology_relationship_events
    for all to service_role using (true) with check (true);

drop policy if exists "service_role_global_biomedical_ontology_population_snapshot_events"
    on public.global_biomedical_ontology_population_snapshot_events;
create policy "service_role_global_biomedical_ontology_population_snapshot_events"
    on public.global_biomedical_ontology_population_snapshot_events
    for all to service_role using (true) with check (true);

comment on table public.official_ontology_release_events is
    'Append-only official ontology release manifest ledger with release hashes, provider status, imported node counts, and relationship counts.';

comment on table public.global_biomedical_ontology_node_events is
    'Append-only imported biomedical ontology node ledger for official source concepts such as MONDO, HPO, UMLS, ICD, SNOMED, and VeNom.';

comment on table public.global_biomedical_ontology_relationship_events is
    'Append-only imported biomedical ontology relationship ledger for source graph edges and normalized code-to-code relationships.';

comment on table public.global_biomedical_ontology_population_snapshot_events is
    'Append-only population status snapshot proving which official providers are imported, blocked, credentialed, licensed, and usable for global candidate expansion.';

notify pgrst, 'reload schema';
