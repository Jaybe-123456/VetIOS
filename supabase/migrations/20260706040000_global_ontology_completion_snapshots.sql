-- VetIOS global ontology completion snapshot v1
-- Computes whether the global biomedical ontology is foundation, partial, ready for review,
-- externally validated, or fully populated from live imports and validation evidence.

create extension if not exists pgcrypto;

create table if not exists public.global_biomedical_ontology_completion_snapshot_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null unique,
    completion_scope text not null default 'global_biomedical_ontology',
    completion_status text not null default 'foundation',
    required_provider_count integer not null default 0,
    imported_provider_count integer not null default 0,
    missing_provider_count integer not null default 0,
    source_attested_mapping_count integer not null default 0,
    reviewer_verified_mapping_count integer not null default 0,
    externally_verified_mapping_count integer not null default 0,
    review_event_count integer not null default 0,
    external_validation_event_count integer not null default 0,
    live_coverage_snapshot_count integer not null default 0,
    latest_coverage_score numeric(5, 4) not null default 0,
    open_world_candidate_generation_status text not null default 'missing',
    scoring_state text not null default 'blocked_pending_review',
    required_provider_keys text[] not null default array[]::text[],
    imported_provider_keys text[] not null default array[]::text[],
    missing_provider_keys text[] not null default array[]::text[],
    completion_packet jsonb not null default '{}'::jsonb,
    source_manifest_hash text,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint global_biomedical_ontology_completion_status_check
        check (completion_status in (
            'foundation',
            'partial',
            'blocked',
            'ready_for_review',
            'externally_validated',
            'fully_populated'
        )),
    constraint global_biomedical_ontology_completion_open_world_check
        check (open_world_candidate_generation_status in ('missing', 'shadow', 'active', 'blocked')),
    constraint global_biomedical_ontology_completion_scoring_state_check
        check (scoring_state in (
            'blocked_pending_review',
            'reviewer_verified_shadow',
            'externally_verified_shadow',
            'outcome_validated_active'
        )),
    constraint global_biomedical_ontology_completion_counts_check
        check (
            required_provider_count >= 0
            and imported_provider_count >= 0
            and missing_provider_count >= 0
            and source_attested_mapping_count >= 0
            and reviewer_verified_mapping_count >= 0
            and externally_verified_mapping_count >= 0
            and review_event_count >= 0
            and external_validation_event_count >= 0
            and live_coverage_snapshot_count >= 0
        ),
    constraint global_biomedical_ontology_completion_score_check
        check (latest_coverage_score >= 0 and latest_coverage_score <= 1),
    constraint global_biomedical_ontology_completion_hash_check
        check (source_manifest_hash is null or source_manifest_hash ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_global_ontology_completion_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'global_biomedical_ontology_completion_snapshot_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_global_biomedical_ontology_completion_snapshot_events
    on public.global_biomedical_ontology_completion_snapshot_events;
create trigger enforce_immutability_global_biomedical_ontology_completion_snapshot_events
    before update or delete on public.global_biomedical_ontology_completion_snapshot_events
    for each row execute function public.prevent_global_ontology_completion_snapshot_mutation();

create index if not exists global_biomedical_ontology_completion_status_idx
    on public.global_biomedical_ontology_completion_snapshot_events
        (completion_status, created_at desc);

create index if not exists global_biomedical_ontology_completion_provider_gin_idx
    on public.global_biomedical_ontology_completion_snapshot_events using gin (missing_provider_keys);

alter table public.global_biomedical_ontology_completion_snapshot_events enable row level security;

drop policy if exists "service_role_global_biomedical_ontology_completion_snapshot_events"
    on public.global_biomedical_ontology_completion_snapshot_events;
create policy "service_role_global_biomedical_ontology_completion_snapshot_events"
    on public.global_biomedical_ontology_completion_snapshot_events
    for all to service_role using (true) with check (true);

comment on table public.global_biomedical_ontology_completion_snapshot_events is
    'Append-only computed completion evidence for the global biomedical ontology. Full status requires imported official providers, reviewer/external validation evidence, and live inference coverage snapshots.';

notify pgrst, 'reload schema';
