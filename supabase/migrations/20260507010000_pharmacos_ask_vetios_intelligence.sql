-- VetIOS PharmacOS + Ask VetIOS intelligence upgrade.
-- Adds structured formulary, validation audit, interaction, clinical image,
-- and query-feedback persistence.

create extension if not exists pgcrypto;

create table if not exists public.pharmacos_validation_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete set null,
    session_id uuid,
    species text not null,
    weight_kg double precision not null,
    validation_result text not null check (validation_result in ('valid', 'impossible', 'extreme_outlier')),
    message text,
    blocked boolean not null default false,
    created_at timestamptz default now()
);

create index if not exists pharmacos_validation_events_tenant_created_idx
    on public.pharmacos_validation_events (tenant_id, created_at desc);

create table if not exists public.drug_formulary (
    id uuid primary key default gen_random_uuid(),

    drug_name text not null,
    brand_names text[] not null default '{}',
    drug_class text not null,
    drug_class_code text not null,
    who_inn text,

    primary_indication text not null,
    indication_codes text[] not null default '{}',

    species_dosing jsonb not null default '[]'::jsonb,
    withdrawal_periods jsonb not null default '[]'::jsonb,
    organ_adjustments jsonb not null default '{}'::jsonb,
    contraindications jsonb not null default '[]'::jsonb,
    pk_profiles jsonb not null default '{}'::jsonb,
    monitoring jsonb not null default '[]'::jsonb,
    adverse_effects jsonb not null default '[]'::jsonb,
    compounding jsonb not null default '{}'::jsonb,

    fda_cvm_approved_species text[],
    ema_cvmp_approved_species text[],
    apvma_approved_species text[],
    controlled_substance boolean default false,
    dea_schedule text,

    primary_reference text not null,
    secondary_references text[],
    formulary_version integer not null default 1 check (formulary_version > 0),
    last_updated_at timestamptz default now(),
    update_source text,
    active boolean default true,

    created_at timestamptz default now()
);

create unique index if not exists drug_formulary_drug_who_unique_idx
    on public.drug_formulary (lower(drug_name), coalesce(lower(who_inn), ''));
create index if not exists drug_formulary_drug_name_idx on public.drug_formulary (drug_name);
create index if not exists drug_formulary_class_code_idx on public.drug_formulary (drug_class_code);
create index if not exists drug_formulary_who_inn_idx on public.drug_formulary (who_inn);
create index if not exists drug_formulary_indication_codes_gin_idx on public.drug_formulary using gin (indication_codes);
create index if not exists drug_formulary_species_dosing_gin_idx on public.drug_formulary using gin (species_dosing);

create table if not exists public.drug_interactions (
    id uuid primary key default gen_random_uuid(),
    drug_a_name text not null,
    drug_b_name text not null,
    interaction_type text not null,
    severity text not null,
    mechanism text not null,
    species_scope text[],
    route_specific jsonb,
    management text not null,
    monitoring_required text[],
    evidence_level text not null,
    reference text not null,
    created_at timestamptz default now()
);

create index if not exists drug_interactions_pair_idx
    on public.drug_interactions (drug_a_name, drug_b_name);
create index if not exists drug_interactions_reverse_pair_idx
    on public.drug_interactions (drug_b_name, drug_a_name);
create index if not exists drug_interactions_species_scope_gin_idx
    on public.drug_interactions using gin (species_scope);

create table if not exists public.drug_formulary_updates (
    id uuid primary key default gen_random_uuid(),
    drug_id uuid references public.drug_formulary(id) on delete set null,
    update_type text not null check (update_type in ('new_drug', 'label_update', 'dose_revision', 'new_species', 'withdrawal_update')),
    change_summary text not null,
    changed_by text not null,
    previous_version jsonb,
    new_version jsonb,
    regulatory_reference text,
    effective_date date,
    created_at timestamptz default now()
);

create index if not exists drug_formulary_updates_drug_created_idx
    on public.drug_formulary_updates (drug_id, created_at desc);

create table if not exists public.drug_formulary_review_queue (
    id uuid primary key default gen_random_uuid(),
    update_type text not null,
    drug_name text not null,
    draft_record jsonb not null,
    regulatory_reference text,
    effective_date date,
    status text not null default 'pending_operator_review' check (status in ('pending_operator_review', 'approved', 'rejected', 'published')),
    review_notes text,
    created_by text not null default 'fda_sync',
    created_at timestamptz default now(),
    reviewed_at timestamptz
);

create index if not exists drug_formulary_review_queue_status_idx
    on public.drug_formulary_review_queue (status, created_at desc);

create table if not exists public.clinical_image_library (
    id uuid primary key default gen_random_uuid(),
    species text not null,
    condition_code text not null,
    finding_type text not null,
    image_category text not null,
    storage_path text not null,
    thumbnail_path text not null,
    caption text not null,
    attribution text not null,
    license_type text not null,
    license_url text,
    magnification text,
    stain text,
    imaging_parameters jsonb,
    quality_score double precision,
    reviewed_by text,
    reviewed_at timestamptz,
    active boolean default true,
    created_at timestamptz default now()
);

create index if not exists clinical_image_library_lookup_idx
    on public.clinical_image_library (species, condition_code, finding_type);
create index if not exists clinical_image_library_active_quality_idx
    on public.clinical_image_library (active, quality_score desc);

create table if not exists public.ask_vetios_queries (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete set null,
    query_text text not null,
    parsed_query jsonb not null,
    species text,
    condition text,
    query_type text not null,
    response_sections jsonb not null,
    images_resolved integer default 0,
    papers_returned integer default 0,
    user_feedback text check (user_feedback in ('helpful', 'not_helpful') or user_feedback is null),
    feedback_notes text,
    response_latency_ms integer,
    created_at timestamptz default now()
);

create index if not exists ask_vetios_queries_tenant_created_idx
    on public.ask_vetios_queries (tenant_id, created_at desc);
create index if not exists ask_vetios_queries_species_condition_idx
    on public.ask_vetios_queries (species, condition);
create index if not exists ask_vetios_queries_type_idx
    on public.ask_vetios_queries (query_type);

alter table public.pharmacos_validation_events enable row level security;
alter table public.drug_formulary enable row level security;
alter table public.drug_interactions enable row level security;
alter table public.drug_formulary_updates enable row level security;
alter table public.drug_formulary_review_queue enable row level security;
alter table public.clinical_image_library enable row level security;
alter table public.ask_vetios_queries enable row level security;

drop policy if exists pharmacos_validation_events_select_own on public.pharmacos_validation_events;
create policy pharmacos_validation_events_select_own
    on public.pharmacos_validation_events for select
    using (tenant_id is null or tenant_id = auth.uid());

drop policy if exists pharmacos_validation_events_insert_own on public.pharmacos_validation_events;
create policy pharmacos_validation_events_insert_own
    on public.pharmacos_validation_events for insert
    with check (tenant_id is null or tenant_id = auth.uid());

drop policy if exists drug_formulary_select_active on public.drug_formulary;
create policy drug_formulary_select_active
    on public.drug_formulary for select
    using (active = true);

drop policy if exists drug_interactions_select_all on public.drug_interactions;
create policy drug_interactions_select_all
    on public.drug_interactions for select
    using (true);

drop policy if exists clinical_image_library_select_active on public.clinical_image_library;
create policy clinical_image_library_select_active
    on public.clinical_image_library for select
    using (active = true);

drop policy if exists ask_vetios_queries_select_own on public.ask_vetios_queries;
create policy ask_vetios_queries_select_own
    on public.ask_vetios_queries for select
    using (tenant_id is null or tenant_id = auth.uid());

drop policy if exists ask_vetios_queries_insert_own on public.ask_vetios_queries;
create policy ask_vetios_queries_insert_own
    on public.ask_vetios_queries for insert
    with check (tenant_id is null or tenant_id = auth.uid());

drop policy if exists ask_vetios_queries_update_own_feedback on public.ask_vetios_queries;
create policy ask_vetios_queries_update_own_feedback
    on public.ask_vetios_queries for update
    using (tenant_id is null or tenant_id = auth.uid())
    with check (tenant_id is null or tenant_id = auth.uid());
