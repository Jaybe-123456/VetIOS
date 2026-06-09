-- Agentic RAG moat snapshot ledger.
-- Stores aggregate retrieval quality, corpus authority, freshness, and fallback-dependence signals.
-- Raw query text, answer text, citation quotes, and patient context are intentionally not copied here.

create table if not exists public.agentic_rag_moat_snapshots (
    id                              uuid primary key default gen_random_uuid(),
    tenant_id                       text not null,

    snapshot_key                    text not null unique,
    snapshot_date                   date not null,

    sources                         int not null default 0,
    documents                       int not null default 0,
    chunks                          int not null default 0,
    high_authority_sources          int not null default 0,
    stale_documents                 int not null default 0,
    last_refreshed_at               timestamptz,
    ready                           boolean not null default false,

    query_count_30d                 int not null default 0,
    grounded_queries_30d            int not null default 0,
    grounding_rate                  double precision not null default 0,
    citation_coverage_avg           double precision not null default 0,
    unsupported_claims_30d          int not null default 0,
    catalog_fallback_queries_30d    int not null default 0,
    catalog_fallback_rate           double precision not null default 0,
    withheld_citations_30d          int not null default 0,
    avg_retrieval_ms                double precision,
    top_authority_tier              text,

    evidence_freshness              text not null default 'empty'
        check (evidence_freshness in ('fresh', 'stale', 'empty')),
    moat_status                     text not null default 'blocked'
        check (moat_status in ('compounding', 'forming', 'blocked')),

    readiness_payload               jsonb not null default '{}'::jsonb,
    query_metrics_payload           jsonb not null default '{}'::jsonb,
    warnings                        text[] not null default '{}'::text[],

    generated_from                  text not null default 'agentic_rag_query_ledger',
    created_at                      timestamptz not null default now()
);

create or replace function public.prevent_agentic_rag_moat_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'agentic_rag_moat_snapshots is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_agentic_rag_moat_snapshots
    on public.agentic_rag_moat_snapshots;

create trigger enforce_immutability_agentic_rag_moat_snapshots
    before update or delete on public.agentic_rag_moat_snapshots
    for each row execute function public.prevent_agentic_rag_moat_snapshot_mutation();

create index if not exists idx_agentic_rag_moat_snapshots_tenant_date
    on public.agentic_rag_moat_snapshots (tenant_id, snapshot_date desc, created_at desc);

create index if not exists idx_agentic_rag_moat_snapshots_status
    on public.agentic_rag_moat_snapshots (moat_status, ready, created_at desc);

create index if not exists idx_agentic_rag_moat_snapshots_grounding
    on public.agentic_rag_moat_snapshots (grounding_rate desc, catalog_fallback_rate asc, created_at desc);

alter table public.agentic_rag_moat_snapshots enable row level security;

drop policy if exists agentic_rag_moat_snapshots_select_own
    on public.agentic_rag_moat_snapshots;

create policy agentic_rag_moat_snapshots_select_own
    on public.agentic_rag_moat_snapshots
    for select
    using (
        tenant_id = auth.uid()::text
        or tenant_id = current_setting('app.tenant_id', true)
        or auth.role() = 'service_role'
    );

drop policy if exists agentic_rag_moat_snapshots_insert_own
    on public.agentic_rag_moat_snapshots;

create policy agentic_rag_moat_snapshots_insert_own
    on public.agentic_rag_moat_snapshots
    for insert
    with check (
        tenant_id = auth.uid()::text
        or tenant_id = current_setting('app.tenant_id', true)
        or auth.role() = 'service_role'
    );

grant select, insert on public.agentic_rag_moat_snapshots to authenticated, service_role;

notify pgrst, 'reload schema';
