alter table public.ask_vetios_queries
    add column if not exists regulatory_claims_snapshot jsonb,
    add column if not exists regulatory_claims_status text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ask_vetios_queries_regulatory_claims_status_check'
    ) then
        alter table public.ask_vetios_queries
            add constraint ask_vetios_queries_regulatory_claims_status_check
            check (
                regulatory_claims_status is null
                or regulatory_claims_status in (
                    'non_clinical',
                    'cds_reviewable',
                    'claims_review_required',
                    'restricted_claims'
                )
            );
    end if;
end $$;

create index if not exists ask_vetios_queries_regulatory_claims_status_idx
    on public.ask_vetios_queries (regulatory_claims_status, created_at desc);

create index if not exists ask_vetios_queries_regulatory_claims_snapshot_gin_idx
    on public.ask_vetios_queries
    using gin (regulatory_claims_snapshot);

comment on column public.ask_vetios_queries.regulatory_claims_snapshot is
    'Ask VetIOS regulatory and claims-discipline snapshot for CDS posture, reviewability, and diagnosis/treatment claim boundaries.';

comment on column public.ask_vetios_queries.regulatory_claims_status is
    'Ask VetIOS regulatory claims state: non_clinical, cds_reviewable, claims_review_required, or restricted_claims.';

notify pgrst, 'reload schema';
