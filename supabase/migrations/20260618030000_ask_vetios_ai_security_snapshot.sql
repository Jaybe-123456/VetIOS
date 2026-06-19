alter table public.ask_vetios_queries
    add column if not exists ai_security_snapshot jsonb,
    add column if not exists ai_security_status text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ask_vetios_queries_ai_security_status_check'
    ) then
        alter table public.ask_vetios_queries
            add constraint ask_vetios_queries_ai_security_status_check
            check (
                ai_security_status is null
                or ai_security_status in (
                    'monitored',
                    'guarded',
                    'restricted',
                    'security_review_required'
                )
            );
    end if;
end $$;

create index if not exists ask_vetios_queries_ai_security_status_idx
    on public.ask_vetios_queries (ai_security_status, created_at desc);

create index if not exists ask_vetios_queries_ai_security_snapshot_gin_idx
    on public.ask_vetios_queries
    using gin (ai_security_snapshot);

comment on column public.ask_vetios_queries.ai_security_snapshot is
    'Ask VetIOS public AI security snapshot for prompt injection, sensitive data, tool restrictions, rate limits, and retrieval boundary controls.';

comment on column public.ask_vetios_queries.ai_security_status is
    'Current Ask VetIOS AI security state: monitored, guarded, restricted, or security_review_required.';
