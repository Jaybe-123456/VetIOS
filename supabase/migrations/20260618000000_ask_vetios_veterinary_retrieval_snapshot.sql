alter table public.ask_vetios_queries
    add column if not exists veterinary_retrieval_snapshot jsonb,
    add column if not exists veterinary_retrieval_status text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ask_vetios_queries_veterinary_retrieval_status_check'
    ) then
        alter table public.ask_vetios_queries
            add constraint ask_vetios_queries_veterinary_retrieval_status_check
            check (
                veterinary_retrieval_status is null
                or veterinary_retrieval_status in (
                    'non_clinical',
                    'ungrounded',
                    'needs_curated_sources',
                    'partially_grounded',
                    'veterinary_grounded'
                )
            );
    end if;
end $$;

create index if not exists ask_vetios_queries_veterinary_retrieval_status_idx
    on public.ask_vetios_queries (veterinary_retrieval_status, created_at desc);

create index if not exists ask_vetios_queries_veterinary_retrieval_snapshot_gin_idx
    on public.ask_vetios_queries
    using gin (veterinary_retrieval_snapshot);

comment on column public.ask_vetios_queries.veterinary_retrieval_snapshot is
    'Ask VetIOS veterinary-specific retrieval policy snapshot: accepted citations, authority/source mix, coverage gaps, and source grounding warnings.';

comment on column public.ask_vetios_queries.veterinary_retrieval_status is
    'Current Ask VetIOS veterinary retrieval state: non_clinical, ungrounded, needs_curated_sources, partially_grounded, or veterinary_grounded.';
