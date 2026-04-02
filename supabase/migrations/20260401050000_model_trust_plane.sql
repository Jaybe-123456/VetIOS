-- Migration: Model Trust Plane
-- Description: Adds publication records, certifications,
-- and external attestations for public model cards.

create extension if not exists pgcrypto;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'current_tenant_id'
    ) then
        execute $fn$
            create function public.current_tenant_id()
            returns uuid
            language sql
            stable
            as $inner$
                select coalesce(
                    nullif(current_setting('app.tenant_id', true), '')::uuid,
                    auth.uid()
                )
            $inner$;
        $fn$;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'trigger_set_updated_at'
    ) then
        execute $fn$
            create function public.trigger_set_updated_at()
            returns trigger
            language plpgsql
            as $inner$
            begin
                new.updated_at = now();
                return new;
            end;
            $inner$;
        $fn$;
    end if;
end $$;

create table if not exists public.model_card_publications (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    registry_id text not null references public.model_registry(registry_id) on delete cascade,
    publication_status text not null default 'draft' check (publication_status in ('draft', 'published', 'retired')),
    public_slug text not null,
    summary_override text,
    intended_use text,
    limitations text,
    review_notes text,
    published_by text,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint model_card_publications_registry_unique unique (tenant_id, registry_id),
    constraint model_card_publications_slug_unique unique (tenant_id, public_slug)
);

create table if not exists public.model_certifications (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    registry_id text not null references public.model_registry(registry_id) on delete cascade,
    publication_id uuid references public.model_card_publications(id) on delete set null,
    certification_name text not null,
    issuer_name text not null,
    status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'revoked')),
    certificate_ref text,
    valid_from timestamptz,
    valid_until timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.model_attestations (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    registry_id text not null references public.model_registry(registry_id) on delete cascade,
    publication_id uuid references public.model_card_publications(id) on delete set null,
    attestation_type text not null,
    attestor_name text not null,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
    evidence_uri text,
    summary text not null,
    attested_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_model_card_publications_tenant_status
    on public.model_card_publications (tenant_id, publication_status, updated_at desc);

create index if not exists idx_model_certifications_tenant_registry
    on public.model_certifications (tenant_id, registry_id, created_at desc);

create index if not exists idx_model_attestations_tenant_registry
    on public.model_attestations (tenant_id, registry_id, created_at desc);

drop trigger if exists set_updated_at_model_card_publications on public.model_card_publications;
create trigger set_updated_at_model_card_publications
    before update on public.model_card_publications
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_model_certifications on public.model_certifications;
create trigger set_updated_at_model_certifications
    before update on public.model_certifications
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_model_attestations on public.model_attestations;
create trigger set_updated_at_model_attestations
    before update on public.model_attestations
    for each row execute function public.trigger_set_updated_at();

alter table public.model_card_publications enable row level security;
alter table public.model_certifications enable row level security;
alter table public.model_attestations enable row level security;

drop policy if exists model_card_publications_select_own on public.model_card_publications;
create policy model_card_publications_select_own
    on public.model_card_publications
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_card_publications_insert_own on public.model_card_publications;
create policy model_card_publications_insert_own
    on public.model_card_publications
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_card_publications_update_own on public.model_card_publications;
create policy model_card_publications_update_own
    on public.model_card_publications
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_certifications_select_own on public.model_certifications;
create policy model_certifications_select_own
    on public.model_certifications
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_certifications_insert_own on public.model_certifications;
create policy model_certifications_insert_own
    on public.model_certifications
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_certifications_update_own on public.model_certifications;
create policy model_certifications_update_own
    on public.model_certifications
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_attestations_select_own on public.model_attestations;
create policy model_attestations_select_own
    on public.model_attestations
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_attestations_insert_own on public.model_attestations;
create policy model_attestations_insert_own
    on public.model_attestations
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_attestations_update_own on public.model_attestations;
create policy model_attestations_update_own
    on public.model_attestations
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
