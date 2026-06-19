alter table public.ask_vetios_queries
    add column if not exists human_review_snapshot jsonb,
    add column if not exists human_review_status text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ask_vetios_queries_human_review_status_check'
    ) then
        alter table public.ask_vetios_queries
            add constraint ask_vetios_queries_human_review_status_check
            check (
                human_review_status is null
                or human_review_status in (
                    'not_required',
                    'clinician_review_required',
                    'specialist_review_recommended',
                    'emergency_review_required'
                )
            );
    end if;
end $$;

create index if not exists ask_vetios_queries_human_review_status_idx
    on public.ask_vetios_queries (human_review_status, created_at desc);

create index if not exists ask_vetios_queries_human_review_snapshot_gin_idx
    on public.ask_vetios_queries
    using gin (human_review_snapshot);

comment on column public.ask_vetios_queries.human_review_snapshot is
    'Ask VetIOS human-in-the-loop review snapshot for clinician confirmation, specialist escalation, and emergency routing.';

comment on column public.ask_vetios_queries.human_review_status is
    'Current Ask VetIOS human review state: not_required, clinician_review_required, specialist_review_recommended, or emergency_review_required.';
