create table if not exists public.amr_genomic_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    species text not null,
    pathogen_label text,
    region text,
    resistance_genes text[] not null default '{}',
    resistance_classes text[] not null default '{}',
    novel_pattern_score double precision check (novel_pattern_score is null or (novel_pattern_score >= 0 and novel_pattern_score <= 1)),
    quantum_backend text,
    sequence_hash text not null,
    card_db_version text,
    clinical_outcome_id uuid references public.clinical_outcome_events(id),
    created_at timestamptz not null default now()
);

create unique index if not exists idx_amr_sequence_hash
    on public.amr_genomic_events(sequence_hash);

create index if not exists idx_amr_species_region
    on public.amr_genomic_events(species, region);

create index if not exists idx_amr_resistance_genes
    on public.amr_genomic_events using gin(resistance_genes);

create index if not exists idx_amr_created_at
    on public.amr_genomic_events(created_at desc);

create or replace function public.prevent_amr_genomic_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'amr_genomic_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_amr_genomic_events on public.amr_genomic_events;
create trigger enforce_immutability_amr_genomic_events
    before update or delete on public.amr_genomic_events
    for each row execute function public.prevent_amr_genomic_event_mutation();

alter table public.amr_genomic_events enable row level security;

drop policy if exists "service_role_amr_genomic_events" on public.amr_genomic_events;
create policy "service_role_amr_genomic_events"
    on public.amr_genomic_events for all to service_role using (true) with check (true);

comment on table public.amr_genomic_events is 'Append-only derived AMR genomic screening events. Raw sequences are never stored.';

notify pgrst, 'reload schema';
