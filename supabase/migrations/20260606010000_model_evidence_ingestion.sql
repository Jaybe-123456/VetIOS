-- VetIOS automated model-card evidence ingestion.
-- Adds an append-only intake ledger for third-party attestation evidence.

create extension if not exists pgcrypto;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'prevent_model_evidence_ingestion_mutation'
    ) then
        execute $fn$
            create function public.prevent_model_evidence_ingestion_mutation()
            returns trigger
            language plpgsql
            as $inner$
            begin
                raise exception 'model evidence ingestion events are append-only; UPDATE and DELETE are not allowed'
                    using errcode = '55000';
            end;
            $inner$;
        $fn$;
    end if;
end $$;

create table if not exists public.model_evidence_ingestion_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    registry_id text not null references public.model_registry(registry_id) on delete cascade,
    publication_id uuid references public.model_card_publications(id) on delete set null,

    source_system text not null,
    source_ref text not null,
    attestation_type text not null,
    attestor_name text not null,
    evidence_uri text,
    summary text not null,

    signed_payload_hash text,
    signature_algorithm text,
    signature_hash text,
    signing_key_fingerprint text,
    verification_status text not null default 'pending'
        check (verification_status in ('unsigned', 'pending', 'verified', 'failed')),

    payload_hash text not null,
    payload jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    received_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint model_evidence_ingestion_source_unique
        unique (tenant_id, source_system, source_ref)
);

drop trigger if exists model_evidence_ingestion_events_immutable
    on public.model_evidence_ingestion_events;
create trigger model_evidence_ingestion_events_immutable
    before update or delete on public.model_evidence_ingestion_events
    for each row execute function public.prevent_model_evidence_ingestion_mutation();

create index if not exists idx_model_evidence_ingestion_tenant_registry
    on public.model_evidence_ingestion_events (tenant_id, registry_id, created_at desc);

create index if not exists idx_model_evidence_ingestion_signature_hash
    on public.model_evidence_ingestion_events (signature_hash)
    where signature_hash is not null;

create index if not exists idx_model_evidence_ingestion_payload_hash
    on public.model_evidence_ingestion_events (payload_hash);

alter table public.model_evidence_ingestion_events enable row level security;

drop policy if exists model_evidence_ingestion_events_select_own
    on public.model_evidence_ingestion_events;
create policy model_evidence_ingestion_events_select_own
    on public.model_evidence_ingestion_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists model_evidence_ingestion_events_insert_own
    on public.model_evidence_ingestion_events;
create policy model_evidence_ingestion_events_insert_own
    on public.model_evidence_ingestion_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

comment on table public.model_evidence_ingestion_events is
    'Append-only ledger of third-party model-card evidence submitted by automated attestation integrations.';

comment on column public.model_evidence_ingestion_events.source_ref is
    'Idempotency key from the third-party evidence source, unique per tenant and source_system.';

comment on column public.model_evidence_ingestion_events.payload_hash is
    'SHA-256 digest of the canonical evidence payload received by VetIOS.';

comment on column public.model_evidence_ingestion_events.signature_hash is
    'SHA-256 digest of the submitted signature material or explicit signature hash. Raw signatures are not persisted.';

notify pgrst, 'reload schema';
