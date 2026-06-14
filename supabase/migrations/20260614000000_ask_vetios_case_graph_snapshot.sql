alter table public.ask_vetios_queries
    add column if not exists case_graph_snapshot jsonb,
    add column if not exists case_graph_status text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ask_vetios_queries_case_graph_status_check'
    ) then
        alter table public.ask_vetios_queries
            add constraint ask_vetios_queries_case_graph_status_check
            check (
                case_graph_status is null
                or case_graph_status in ('non_clinical', 'draft', 'ready_for_case_graph')
            );
    end if;
end $$;

create index if not exists ask_vetios_queries_case_graph_status_idx
    on public.ask_vetios_queries (case_graph_status, created_at desc);

create index if not exists ask_vetios_queries_case_graph_snapshot_gin_idx
    on public.ask_vetios_queries
    using gin (case_graph_snapshot);

comment on column public.ask_vetios_queries.case_graph_snapshot is
    'De-identified Ask VetIOS case graph draft snapshot for later clinician-confirmed promotion into clinical_cases.';

comment on column public.ask_vetios_queries.case_graph_status is
    'Ask VetIOS case graph draft status: non_clinical, draft, or ready_for_case_graph.';
