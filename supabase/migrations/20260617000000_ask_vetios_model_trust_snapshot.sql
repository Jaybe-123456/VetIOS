alter table public.ask_vetios_queries
    add column if not exists model_trust_snapshot jsonb,
    add column if not exists model_trust_status text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ask_vetios_queries_model_trust_status_check'
    ) then
        alter table public.ask_vetios_queries
            add constraint ask_vetios_queries_model_trust_status_check
            check (
                model_trust_status is null
                or model_trust_status in (
                    'non_clinical',
                    'needs_evidence',
                    'needs_review',
                    'grounded_draft'
                )
            );
    end if;
end $$;

create index if not exists ask_vetios_queries_model_trust_status_idx
    on public.ask_vetios_queries (model_trust_status, created_at desc);

create index if not exists ask_vetios_queries_model_trust_snapshot_gin_idx
    on public.ask_vetios_queries
    using gin (model_trust_snapshot);

comment on column public.ask_vetios_queries.model_trust_snapshot is
    'Ask VetIOS governance snapshot for grounding, review requirement, calibration posture, and output quality.';

comment on column public.ask_vetios_queries.model_trust_status is
    'Current Ask VetIOS model trust state: non_clinical, needs_evidence, needs_review, or grounded_draft.';
