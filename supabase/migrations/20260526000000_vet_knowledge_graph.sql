-- Veterinary Knowledge Graph
-- Versioned disease-symptom ontology for classical graph priors.

create schema if not exists vet_knowledge_graph;

create table if not exists public.vet_disease_nodes (
    id uuid primary key default gen_random_uuid(),
    label text not null unique,
    display_name text not null,
    species text not null check (species in ('canine', 'feline', 'both')),
    icd_vet_code text,
    base_prior double precision not null default 0.01 check (base_prior >= 0 and base_prior <= 1),
    urgency text not null default 'medium' check (urgency in ('high', 'medium', 'low')),
    graph_version int not null default 1,
    created_at timestamptz not null default now()
);

create table if not exists public.vet_symptom_nodes (
    id uuid primary key default gen_random_uuid(),
    label text not null unique,
    display_name text not null,
    species text not null check (species in ('canine', 'feline', 'both')),
    prevalence_weight double precision not null default 1.0 check (prevalence_weight >= 0),
    graph_version int not null default 1,
    created_at timestamptz not null default now()
);

create table if not exists public.vet_graph_edges (
    id uuid primary key default gen_random_uuid(),
    symptom_id uuid not null references public.vet_symptom_nodes(id),
    disease_id uuid not null references public.vet_disease_nodes(id),
    weight double precision not null check (weight >= 0 and weight <= 1),
    age_range_min int,
    age_range_max int,
    modifier_key text,
    modifier_value text,
    evidence_level text not null default 'clinical_consensus',
    graph_version int not null default 1,
    created_at timestamptz not null default now()
);

create unique index if not exists idx_vet_graph_edges_unique_relationship
    on public.vet_graph_edges (
        symptom_id,
        disease_id,
        coalesce(modifier_key, ''),
        coalesce(modifier_value, '')
    );

create index if not exists idx_vet_graph_edges_symptom on public.vet_graph_edges(symptom_id);
create index if not exists idx_vet_graph_edges_disease on public.vet_graph_edges(disease_id);
create index if not exists idx_vet_disease_nodes_species on public.vet_disease_nodes(species);
create index if not exists idx_vet_symptom_nodes_species on public.vet_symptom_nodes(species);
create index if not exists idx_vet_disease_nodes_graph_version on public.vet_disease_nodes(graph_version);
create index if not exists idx_vet_symptom_nodes_graph_version on public.vet_symptom_nodes(graph_version);
create index if not exists idx_vet_graph_edges_graph_version on public.vet_graph_edges(graph_version);

create or replace view vet_knowledge_graph.nodes as
select id, label, display_name, species, 'disease'::text as node_type, graph_version, created_at
from public.vet_disease_nodes
union all
select id, label, display_name, species, 'symptom'::text as node_type, graph_version, created_at
from public.vet_symptom_nodes;

create or replace view vet_knowledge_graph.edges as
select id, symptom_id, disease_id, weight, evidence_level, graph_version, created_at
from public.vet_graph_edges;

create or replace function public.prevent_vet_graph_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'vet knowledge graph table % is append-only; UPDATE and DELETE are not allowed', tg_table_name
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_vet_disease_nodes on public.vet_disease_nodes;
create trigger enforce_immutability_vet_disease_nodes
    before update or delete on public.vet_disease_nodes
    for each row execute function public.prevent_vet_graph_mutation();

drop trigger if exists enforce_immutability_vet_symptom_nodes on public.vet_symptom_nodes;
create trigger enforce_immutability_vet_symptom_nodes
    before update or delete on public.vet_symptom_nodes
    for each row execute function public.prevent_vet_graph_mutation();

drop trigger if exists enforce_immutability_vet_graph_edges on public.vet_graph_edges;
create trigger enforce_immutability_vet_graph_edges
    before update or delete on public.vet_graph_edges
    for each row execute function public.prevent_vet_graph_mutation();

alter table public.vet_disease_nodes enable row level security;
alter table public.vet_symptom_nodes enable row level security;
alter table public.vet_graph_edges enable row level security;

drop policy if exists "service_role_vet_disease_nodes" on public.vet_disease_nodes;
create policy "service_role_vet_disease_nodes"
    on public.vet_disease_nodes for all to service_role using (true) with check (true);

drop policy if exists "service_role_vet_symptom_nodes" on public.vet_symptom_nodes;
create policy "service_role_vet_symptom_nodes"
    on public.vet_symptom_nodes for all to service_role using (true) with check (true);

drop policy if exists "service_role_vet_graph_edges" on public.vet_graph_edges;
create policy "service_role_vet_graph_edges"
    on public.vet_graph_edges for all to service_role using (true) with check (true);

comment on schema vet_knowledge_graph is 'Versioned veterinary disease-symptom graph views.';
comment on table public.vet_disease_nodes is 'Append-only disease nodes for graph prior enrichment.';
comment on table public.vet_symptom_nodes is 'Append-only symptom nodes for graph prior enrichment.';
comment on table public.vet_graph_edges is 'Append-only weighted disease-symptom relationships.';

notify pgrst, 'reload schema';
