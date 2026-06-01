-- VetIOS Gaussian Boson Sampling result schema
-- Based on Yu et al. (2023), Nature Computational Science
-- DOI: 10.1038/s43588-023-00526-y

create extension if not exists pgcrypto;

create or replace function public.enforce_immutability()
returns trigger as $$
begin
    raise exception
        'Table % is append-only. UPDATE and DELETE are not permitted. Event ID: %',
        tg_table_name,
        old.id;
end;
$$ language plpgsql;

-- Ensure the inference event store can persist quantum ranking lineage.
alter table public.ai_inference_events
    add column if not exists quantum_result jsonb,
    add column if not exists ranker text not null default 'classical';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'ai_inference_events_ranker_check'
    ) then
        alter table public.ai_inference_events
            add constraint ai_inference_events_ranker_check
            check (ranker in ('classical', 'quantum', 'hybrid'));
    end if;
end $$;

create index if not exists idx_ai_inference_events_ranker
    on public.ai_inference_events (tenant_id, ranker, created_at desc);

-- Quantum Inverse Virtual Screening results.
-- Append-only, immutable, and stores only hashed drug structures.
create table if not exists public.qivs_screening_events (
    id                   uuid primary key default gen_random_uuid(),
    tenant_id            uuid not null,

    drug_smiles_hash     text not null,
    drug_name            text,

    pathogen_label       text not null,
    pathogen_species     text not null,

    big_node_count       int not null,
    big_edge_count       int not null,
    tau_flexibility      double precision not null default 1.5,
    epsilon_interaction  double precision not null default 0.5,

    max_clique_nodes     text[] not null,
    max_clique_weight    double precision not null,
    binding_pose         jsonb,
    gbs_samples_used     int not null,
    gbs_backend          text not null default 'strawberryfields.simulator',

    classical_max_weight double precision,
    quantum_advantage    double precision,

    confidence_score     double precision,
    phi_hat              double precision,

    paper_doi            text not null default '10.1038/s43588-023-00526-y',
    algorithm_version    text not null default 'banchi2020_yu2023',
    strawberryfields_ver text,

    created_at           timestamptz not null default now()
);

do $$
begin
    if not exists (
        select 1 from pg_trigger
        where tgname = 'qivs_screening_events_immutable'
    ) then
        create trigger qivs_screening_events_immutable
            before update or delete on public.qivs_screening_events
            for each row execute function public.enforce_immutability();
    end if;
end $$;

create index if not exists idx_qivs_pathogen
    on public.qivs_screening_events (pathogen_label);

create index if not exists idx_qivs_drug_hash
    on public.qivs_screening_events (drug_smiles_hash);

create index if not exists idx_qivs_advantage
    on public.qivs_screening_events (quantum_advantage desc);

-- RNA secondary structure prediction events.
-- Raw RNA sequences are never stored; only sequence_hash and derived outputs.
create table if not exists public.rna_folding_events (
    id                   uuid primary key default gen_random_uuid(),
    tenant_id            uuid,

    sequence_hash        text not null unique,
    sequence_length      int not null,
    pathogen_label       text,
    region               text,

    wfsg_node_count      int not null,
    wfsg_edge_count      int not null,

    predicted_stems      jsonb not null,
    max_clique_weight    double precision not null,
    secondary_structure  text,

    mcc_score            double precision,
    fold_mcc_classical   double precision,
    rnaprobing_mcc       double precision,

    gbs_backend          text not null default 'strawberryfields.simulator',
    algorithm_version    text not null default 'tang2023_wfsg_yu2023_gbs',
    paper_doi            text not null default '10.1038/s43588-023-00526-y',
    card_db_version      text,

    created_at           timestamptz not null default now()
);

do $$
begin
    if not exists (
        select 1 from pg_trigger
        where tgname = 'rna_folding_events_immutable'
    ) then
        create trigger rna_folding_events_immutable
            before update or delete on public.rna_folding_events
            for each row execute function public.enforce_immutability();
    end if;
end $$;

create index if not exists idx_rna_pathogen
    on public.rna_folding_events (pathogen_label, region);

create index if not exists idx_rna_mcc
    on public.rna_folding_events (mcc_score desc nulls last);

-- Veterinary target pathogens for QIVS screening.
create table if not exists public.vet_target_pathogens (
    id                 uuid primary key default gen_random_uuid(),
    label              text not null unique,
    display_name       text not null,
    species            text not null,
    drug_class_focus   text[] not null,
    amr_genes          text[],
    geographic_focus   text[],
    created_at         timestamptz not null default now()
);

insert into public.vet_target_pathogens
    (label, display_name, species, drug_class_focus, amr_genes, geographic_focus)
values
    (
        'staph_pseudintermedius',
        'Staphylococcus pseudintermedius',
        'canine',
        array['methicillin', 'fluoroquinolone', 'tetracycline'],
        array['mecA', 'blaZ', 'tetM', 'aacA-aphD'],
        array['global', 'KE', 'ZA', 'GB', 'US']
    ),
    (
        'ecoli_amr',
        'Escherichia coli (AMR strains)',
        'bovine',
        array['beta_lactam', 'colistin', 'carbapenem'],
        array['blaCTX-M-15', 'mcr-1', 'blaNDM-1', 'sul1'],
        array['KE', 'ET', 'TZ', 'NG', 'ZA']
    ),
    (
        'salmonella_infantis',
        'Salmonella Infantis',
        'avian',
        array['fluoroquinolone', 'beta_lactam', 'tetracycline'],
        array['blaCTX-M', 'qnrS', 'tetA', 'sul1'],
        array['global', 'KE', 'UG', 'EU']
    ),
    (
        'brucella_abortus',
        'Brucella abortus',
        'bovine',
        array['tetracycline', 'rifampicin', 'streptomycin'],
        array['rpoB_mut', 'tetB'],
        array['KE', 'ET', 'TZ', 'SS', 'SD']
    ),
    (
        'mannheimia_haemolytica',
        'Mannheimia haemolytica',
        'bovine',
        array['beta_lactam', 'tetracycline', 'macrolide'],
        array['blaROB-1', 'tetH', 'msrE', 'mph(E)'],
        array['KE', 'ET', 'global']
    )
on conflict (label) do update set
    display_name = excluded.display_name,
    species = excluded.species,
    drug_class_focus = excluded.drug_class_focus,
    amr_genes = excluded.amr_genes,
    geographic_focus = excluded.geographic_focus;

notify pgrst, 'reload schema';
