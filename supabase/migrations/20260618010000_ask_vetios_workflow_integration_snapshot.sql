alter table public.ask_vetios_queries
    add column if not exists workflow_integration_snapshot jsonb,
    add column if not exists workflow_integration_status text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ask_vetios_queries_workflow_integration_status_check'
    ) then
        alter table public.ask_vetios_queries
            add constraint ask_vetios_queries_workflow_integration_status_check
            check (
                workflow_integration_status is null
                or workflow_integration_status in (
                    'non_clinical',
                    'needs_intake',
                    'case_handoff_ready',
                    'diagnostics_workflow_ready',
                    'outcome_workflow_ready'
                )
            );
    end if;
end $$;

create index if not exists ask_vetios_queries_workflow_integration_status_idx
    on public.ask_vetios_queries (workflow_integration_status, created_at desc);

create index if not exists ask_vetios_queries_workflow_integration_snapshot_gin_idx
    on public.ask_vetios_queries
    using gin (workflow_integration_snapshot);

comment on column public.ask_vetios_queries.workflow_integration_snapshot is
    'Ask VetIOS workflow integration snapshot: case form and inference handoff readiness, connected clinical data, downstream workflow status, and next actions.';

comment on column public.ask_vetios_queries.workflow_integration_status is
    'Current Ask VetIOS workflow integration state: non_clinical, needs_intake, case_handoff_ready, diagnostics_workflow_ready, or outcome_workflow_ready.';
