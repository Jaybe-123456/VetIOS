-- VetIOS Population Intelligence publication layer
-- Public-health safe advisory ledger for aggregate outbreak intelligence.
-- Raw tenant IDs, inference IDs, patient records, and clinic-level facts are not stored here.

create extension if not exists pgcrypto;

create table if not exists public.population_public_health_advisories (
    id                  uuid primary key default gen_random_uuid(),
    advisory_key        text not null unique,
    source_alert_id     text,

    disease             text not null,
    species             text not null,
    region              text not null,
    severity            text not null check (severity in ('watch', 'warning', 'alert', 'emergency')),

    audience            text[] not null default array['veterinary_clinics', 'regional_veterinary_authorities'],
    publication_status  text not null default 'published'
        check (publication_status in ('published', 'suppressed', 'retracted')),
    privacy_status      text not null default 'aggregate_only'
        check (privacy_status in ('aggregate_only', 'suppressed_low_support', 'retracted')),

    minimum_clinics     integer not null default 3 check (minimum_clinics >= 2),
    affected_clinics    integer not null check (affected_clinics >= 0),
    current_count       integer not null check (current_count >= 0),
    baseline_count      integer not null default 0 check (baseline_count >= 0),
    increase_percent    integer not null default 0,
    signal_window       text not null,

    public_summary      text not null,
    recommended_actions text[] not null default '{}',
    generated_from      text not null default 'population_outbreak_alerts',
    metadata            jsonb not null default '{}'::jsonb,

    published_at        timestamptz,
    created_at          timestamptz not null default now()
);

create or replace function public.prevent_population_public_advisory_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'population public health advisories are append-only; insert a new advisory event instead'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_population_public_health_advisories
    on public.population_public_health_advisories;

create trigger enforce_immutability_population_public_health_advisories
    before update or delete on public.population_public_health_advisories
    for each row execute function public.prevent_population_public_advisory_mutation();

create index if not exists idx_population_public_advisories_feed
    on public.population_public_health_advisories (publication_status, privacy_status, published_at desc);

create index if not exists idx_population_public_advisories_region
    on public.population_public_health_advisories (region, disease, species);

create index if not exists idx_population_public_advisories_severity
    on public.population_public_health_advisories (severity, published_at desc);

alter table public.population_public_health_advisories enable row level security;

drop policy if exists "public_read_aggregate_population_advisories"
    on public.population_public_health_advisories;

create policy "public_read_aggregate_population_advisories"
    on public.population_public_health_advisories
    for select
    using (
        publication_status = 'published'
        and privacy_status = 'aggregate_only'
        and affected_clinics >= minimum_clinics
    );

drop policy if exists "service_role_write_population_advisories"
    on public.population_public_health_advisories;

create policy "service_role_write_population_advisories"
    on public.population_public_health_advisories
    for insert
    with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';
