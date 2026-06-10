-- Agentic RAG citation usefulness feedback.
-- Append-only quality ledger for grounded evidence, without raw patient notes
-- or raw citation quote storage.

create table if not exists public.rag_citation_feedback_events (
    id                         uuid primary key default gen_random_uuid(),
    tenant_id                  text not null,
    query_id                   uuid references public.rag_queries(id) on delete set null,
    actor_kind                 text not null default 'session',

    feedback_kind              text not null
        check (feedback_kind in (
            'answer_useful',
            'answer_not_useful',
            'citation_useful',
            'citation_not_useful',
            'needs_review'
        )),

    citation_indexes           int[] not null default '{}',
    citation_source_names      text[] not null default '{}',
    citation_titles            text[] not null default '{}',
    citation_urls              text[] not null default '{}',

    grounded                   boolean,
    clinical_use_case          text,
    outcome_event_id           uuid,

    -- Raw free-text notes are intentionally not persisted.
    notes_hash                 text,
    metadata                   jsonb not null default '{}',

    created_at                 timestamptz not null default now()
);

create or replace function public.prevent_rag_citation_feedback_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'rag_citation_feedback_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_rag_citation_feedback_events
    on public.rag_citation_feedback_events;

create trigger enforce_immutability_rag_citation_feedback_events
    before update or delete on public.rag_citation_feedback_events
    for each row execute function public.prevent_rag_citation_feedback_mutation();

create index if not exists idx_rag_feedback_tenant_created
    on public.rag_citation_feedback_events (tenant_id, created_at desc);

create index if not exists idx_rag_feedback_query
    on public.rag_citation_feedback_events (query_id, created_at desc);

create index if not exists idx_rag_feedback_kind
    on public.rag_citation_feedback_events (tenant_id, feedback_kind, created_at desc);

create index if not exists idx_rag_feedback_citation_indexes
    on public.rag_citation_feedback_events using gin (citation_indexes);

alter table public.rag_citation_feedback_events enable row level security;

drop policy if exists rag_citation_feedback_select_own
    on public.rag_citation_feedback_events;

create policy rag_citation_feedback_select_own
    on public.rag_citation_feedback_events
    for select
    using (
        tenant_id = auth.uid()::text
        or tenant_id = current_setting('app.tenant_id', true)
        or auth.role() = 'service_role'
    );

drop policy if exists rag_citation_feedback_insert_own
    on public.rag_citation_feedback_events;

create policy rag_citation_feedback_insert_own
    on public.rag_citation_feedback_events
    for insert
    with check (
        tenant_id = auth.uid()::text
        or tenant_id = current_setting('app.tenant_id', true)
        or auth.role() = 'service_role'
    );

grant select, insert on public.rag_citation_feedback_events to authenticated, service_role;

do $$
begin
    if to_regclass('public.agentic_rag_moat_snapshots') is not null then
        alter table public.agentic_rag_moat_snapshots
            add column if not exists feedback_events_30d int not null default 0,
            add column if not exists useful_feedback_30d int not null default 0,
            add column if not exists needs_review_feedback_30d int not null default 0,
            add column if not exists citation_usefulness_rate double precision not null default 0;

        create index if not exists idx_agentic_rag_moat_snapshots_feedback
            on public.agentic_rag_moat_snapshots (citation_usefulness_rate desc, feedback_events_30d desc, created_at desc);
    end if;
end $$;

comment on table public.rag_citation_feedback_events is
    'Append-only Agentic RAG evidence usefulness ledger. Stores citation identifiers, answer usefulness, and hashed notes only; no raw patient text or raw citation quotes.';

comment on column public.rag_citation_feedback_events.notes_hash is
    'SHA-256 hash of optional clinician feedback notes. The raw note text is intentionally not stored.';

notify pgrst, 'reload schema';
