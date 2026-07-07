-- VetIOS Global One Health candidate expansion evidence v1
-- Persists inference-time verified ontology expansion and official ingestion run audits.

create extension if not exists pgcrypto;

create table if not exists public.global_condition_expansion_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    coverage_snapshot_id uuid references public.condition_coverage_snapshot_events(id) on delete set null,
    expansion_scope text not null default 'inference_global_one_health',
    expansion_status text not null,
    candidate_count integer not null default 0,
    verified_mapping_count integer not null default 0,
    candidate_keys text[] not null default array[]::text[],
    verified_condition_keys text[] not null default array[]::text[],
    verified_code_systems text[] not null default array[]::text[],
    probability_scoring_status text not null default 'blocked_pending_review',
    reviewer_gate_status text not null default 'required',
    expansion_packet jsonb not null default '{}'::jsonb,
    source_manifest_hash text,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_condition_expansion_events_request_key
        unique (request_id, expansion_scope),
    constraint global_condition_expansion_events_status_check
        check (expansion_status in (
            'verified_candidates_available',
            'no_candidate_hints',
            'no_verified_mappings',
            'query_failed'
        )),
    constraint global_condition_expansion_events_scoring_check
        check (probability_scoring_status in (
            'blocked_pending_review',
            'shadow_only',
            'reviewer_verified',
            'outcome_validated'
        )),
    constraint global_condition_expansion_events_reviewer_check
        check (reviewer_gate_status in ('required', 'queued', 'approved', 'rejected', 'not_required')),
    constraint global_condition_expansion_events_counts_check
        check (candidate_count >= 0 and verified_mapping_count >= 0),
    constraint global_condition_expansion_events_hash_check
        check (source_manifest_hash is null or source_manifest_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.official_ontology_ingestion_run_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null unique,
    ingestion_scope text not null default 'global_one_health_official_ontology',
    ingestion_status text not null,
    provider_keys text[] not null default array[]::text[],
    ready_provider_count integer not null default 0,
    skipped_provider_count integer not null default 0,
    error_count integer not null default 0,
    matched_condition_count integer not null default 0,
    verified_mapping_count integer not null default 0,
    inserted_mapping_count integer not null default 0,
    dry_run boolean not null default false,
    ingestion_packet jsonb not null default '{}'::jsonb,
    source_manifest_hash text,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint official_ontology_ingestion_run_events_status_check
        check (ingestion_status in ('planned', 'dry_run', 'ingested', 'partial', 'failed')),
    constraint official_ontology_ingestion_run_events_counts_check
        check (
            ready_provider_count >= 0
            and skipped_provider_count >= 0
            and error_count >= 0
            and matched_condition_count >= 0
            and verified_mapping_count >= 0
            and inserted_mapping_count >= 0
        ),
    constraint official_ontology_ingestion_run_events_hash_check
        check (source_manifest_hash is null or source_manifest_hash ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_global_condition_expansion_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'global condition expansion evidence tables are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_global_condition_expansion_events
    on public.global_condition_expansion_events;
create trigger enforce_immutability_global_condition_expansion_events
    before update or delete on public.global_condition_expansion_events
    for each row execute function public.prevent_global_condition_expansion_event_mutation();

drop trigger if exists enforce_immutability_official_ontology_ingestion_run_events
    on public.official_ontology_ingestion_run_events;
create trigger enforce_immutability_official_ontology_ingestion_run_events
    before update or delete on public.official_ontology_ingestion_run_events
    for each row execute function public.prevent_global_condition_expansion_event_mutation();

create index if not exists global_condition_expansion_events_inference_idx
    on public.global_condition_expansion_events (inference_event_id, created_at desc)
    where inference_event_id is not null;
create index if not exists global_condition_expansion_events_status_idx
    on public.global_condition_expansion_events (expansion_status, probability_scoring_status, created_at desc);
create index if not exists global_condition_expansion_events_candidate_gin_idx
    on public.global_condition_expansion_events using gin (candidate_keys);
create index if not exists global_condition_expansion_events_packet_gin_idx
    on public.global_condition_expansion_events using gin (expansion_packet);

create index if not exists official_ontology_ingestion_run_events_status_idx
    on public.official_ontology_ingestion_run_events (ingestion_status, created_at desc);
create index if not exists official_ontology_ingestion_run_events_provider_gin_idx
    on public.official_ontology_ingestion_run_events using gin (provider_keys);
create index if not exists official_ontology_ingestion_run_events_packet_gin_idx
    on public.official_ontology_ingestion_run_events using gin (ingestion_packet);

alter table public.global_condition_expansion_events enable row level security;
alter table public.official_ontology_ingestion_run_events enable row level security;

drop policy if exists "service_role_global_condition_expansion_events"
    on public.global_condition_expansion_events;
create policy "service_role_global_condition_expansion_events"
    on public.global_condition_expansion_events
    for all to service_role using (true) with check (true);

drop policy if exists "service_role_official_ontology_ingestion_run_events"
    on public.official_ontology_ingestion_run_events;
create policy "service_role_official_ontology_ingestion_run_events"
    on public.official_ontology_ingestion_run_events
    for all to service_role using (true) with check (true);

comment on table public.global_condition_expansion_events is
    'Append-only inference-time global One Health candidate expansion audit. Verified mappings are surfaced for review and remain blocked from probability scoring until reviewer/outcome validation.';

comment on table public.official_ontology_ingestion_run_events is
    'Append-only audit for official ontology ingestion runs, including provider readiness, skipped credential/license-gated providers, verified mapping counts, and dry-run state.';

comment on column public.global_condition_expansion_events.expansion_packet is
    'Compact expansion evidence packet. Stores external code refs, source keys, blockers, and review state; no raw clinical notes or source corpus text.';

notify pgrst, 'reload schema';
