create extension if not exists pgcrypto;

create table if not exists public.veterinary_retrieval_corpus_audit_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null default gen_random_uuid(),
    refresh_run_id uuid references public.rag_source_refresh_runs(id) on delete set null,
    audit_type text not null default 'readiness_check',
    corpus_version_hash text not null,
    moat_status text not null default 'blocked',
    source_count integer not null default 0,
    document_count integer not null default 0,
    chunk_count integer not null default 0,
    high_authority_source_count integer not null default 0,
    authorized_source_count integer not null default 0,
    versioned_source_count integer not null default 0,
    source_version_coverage numeric(5, 4) not null default 0,
    authorized_source_coverage numeric(5, 4) not null default 0,
    high_authority_coverage numeric(5, 4) not null default 0,
    toxicology_index_status text not null default 'missing',
    lab_reference_index_status text not null default 'missing',
    red_team_case_count integer not null default 0,
    red_team_coverage jsonb not null default '{}'::jsonb,
    citation_quality_status text,
    citation_quality_score numeric(5, 4),
    manifest jsonb not null default '{}'::jsonb,
    readiness_summary jsonb not null default '{}'::jsonb,
    source_version_proofs jsonb not null default '[]'::jsonb,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint veterinary_retrieval_corpus_audit_tenant_request_key
        unique (tenant_id, request_id),
    constraint veterinary_retrieval_corpus_audit_type_check
        check (audit_type in (
            'catalog_seed',
            'catalog_refresh',
            'readiness_check',
            'red_team_evaluation',
            'citation_quality_evaluation'
        )),
    constraint veterinary_retrieval_corpus_audit_moat_status_check
        check (moat_status in ('operating', 'foundation', 'blocked')),
    constraint veterinary_retrieval_corpus_audit_index_status_check
        check (
            toxicology_index_status in ('covered', 'thin', 'missing')
            and lab_reference_index_status in ('covered', 'thin', 'missing')
        ),
    constraint veterinary_retrieval_corpus_audit_counts_check
        check (
            source_count >= 0
            and document_count >= 0
            and chunk_count >= 0
            and high_authority_source_count >= 0
            and authorized_source_count >= 0
            and versioned_source_count >= 0
            and red_team_case_count >= 0
        ),
    constraint veterinary_retrieval_corpus_audit_score_check
        check (
            source_version_coverage >= 0 and source_version_coverage <= 1
            and authorized_source_coverage >= 0 and authorized_source_coverage <= 1
            and high_authority_coverage >= 0 and high_authority_coverage <= 1
            and (citation_quality_score is null or (citation_quality_score >= 0 and citation_quality_score <= 1))
        ),
    constraint veterinary_retrieval_corpus_audit_hash_check
        check (corpus_version_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_veterinary_retrieval_corpus_audit_tenant_created
    on public.veterinary_retrieval_corpus_audit_events (tenant_id, created_at desc);

create index if not exists idx_veterinary_retrieval_corpus_audit_status
    on public.veterinary_retrieval_corpus_audit_events
        (tenant_id, moat_status, observed_at desc);

create index if not exists idx_veterinary_retrieval_corpus_audit_version
    on public.veterinary_retrieval_corpus_audit_events
        (tenant_id, corpus_version_hash, observed_at desc);

create index if not exists idx_veterinary_retrieval_corpus_audit_blockers_gin
    on public.veterinary_retrieval_corpus_audit_events using gin (blockers);

create index if not exists idx_veterinary_retrieval_corpus_audit_manifest_gin
    on public.veterinary_retrieval_corpus_audit_events using gin (manifest);

create index if not exists idx_veterinary_retrieval_corpus_audit_evidence_gin
    on public.veterinary_retrieval_corpus_audit_events using gin (evidence);

create or replace function public.prevent_veterinary_retrieval_corpus_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'veterinary_retrieval_corpus_audit_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_veterinary_retrieval_corpus_audit_events
    on public.veterinary_retrieval_corpus_audit_events;
create trigger enforce_immutability_veterinary_retrieval_corpus_audit_events
    before update or delete on public.veterinary_retrieval_corpus_audit_events
    for each row execute function public.prevent_veterinary_retrieval_corpus_audit_event_mutation();

alter table public.veterinary_retrieval_corpus_audit_events enable row level security;

drop policy if exists veterinary_retrieval_corpus_audit_select_tenant
    on public.veterinary_retrieval_corpus_audit_events;
create policy veterinary_retrieval_corpus_audit_select_tenant
    on public.veterinary_retrieval_corpus_audit_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists veterinary_retrieval_corpus_audit_insert_tenant
    on public.veterinary_retrieval_corpus_audit_events;
create policy veterinary_retrieval_corpus_audit_insert_tenant
    on public.veterinary_retrieval_corpus_audit_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_veterinary_retrieval_corpus_audit_events"
    on public.veterinary_retrieval_corpus_audit_events;
create policy "service_role_veterinary_retrieval_corpus_audit_events"
    on public.veterinary_retrieval_corpus_audit_events for all to service_role using (true) with check (true);

comment on table public.veterinary_retrieval_corpus_audit_events is
    'Append-only veterinary retrieval corpus audit ledger for source versioning, license authorization, toxicology/lab index coverage, citation quality, and retrieval red-team readiness.';

comment on column public.veterinary_retrieval_corpus_audit_events.manifest is
    'Sanitized corpus manifest and hashes only. Do not store raw indexed source text, full quotes, PHI, or proprietary reference content here.';

comment on column public.veterinary_retrieval_corpus_audit_events.source_version_proofs is
    'Source-level version, license, document hash, and coverage proofs used to govern veterinary retrieval. No raw source text.';

notify pgrst, 'reload schema';
