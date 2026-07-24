-- VetIOS AMR Outcome Network Pilot v1
-- Append-only site enrollment, culture/AST episode closure, and evidence snapshots.

create extension if not exists pgcrypto;

create table if not exists public.amr_network_site_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    site_id uuid not null,
    site_type text not null,
    event_type text not null,
    display_label text,
    site_ref_hash text,
    connector_key text,
    actor_id text,
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint amr_network_site_events_tenant_request_key
        unique (tenant_id, request_id),
    constraint amr_network_site_events_type_check
        check (site_type in ('laboratory', 'clinic')),
    constraint amr_network_site_events_event_check
        check (event_type in (
            'invited',
            'enrolled',
            'data_use_approved',
            'data_use_revoked',
            'connector_verified',
            'connector_failed',
            'paused',
            'retired'
        )),
    constraint amr_network_site_events_hash_check
        check (
            event_hash ~ '^[a-f0-9]{64}$'
            and (site_ref_hash is null or site_ref_hash ~ '^[a-f0-9]{64}$')
        ),
    constraint amr_network_site_events_label_check
        check (display_label is null or char_length(display_label) <= 160)
);

create table if not exists public.amr_outcome_episode_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    episode_id uuid not null,
    site_id uuid,
    lab_site_id uuid,
    event_type text not null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    clinical_outcome_id uuid references public.clinical_outcome_events(id) on delete set null,
    amr_stewardship_event_id uuid references public.amr_stewardship_events(id) on delete set null,
    amr_lab_feed_event_id uuid references public.amr_lab_feed_surveillance_events(id) on delete set null,
    species text,
    pathogen_key text,
    drug_class text,
    outcome_status text,
    consent_status text,
    review_status text,
    reviewer_ref_hash text,
    is_synthetic boolean not null default false,
    deidentified boolean not null default true,
    source_record_digest text,
    evidence_packet_hash text,
    calibration_eligible boolean not null default false,
    federation_eligible boolean not null default false,
    eligibility_blockers text[] not null default '{}',
    event_payload jsonb not null default '{}'::jsonb,
    event_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint amr_outcome_episode_events_tenant_request_key
        unique (tenant_id, request_id),
    constraint amr_outcome_episode_events_event_check
        check (event_type in (
            'episode_opened',
            'culture_received',
            'ast_verified',
            'treatment_recorded',
            'clinical_review_completed',
            'outcome_confirmed',
            'eligibility_evaluated',
            'episode_closed'
        )),
    constraint amr_outcome_episode_events_outcome_check
        check (
            outcome_status is null
            or outcome_status in (
                'improved',
                'resolved',
                'unchanged',
                'worsened',
                'relapsed',
                'adverse_event',
                'unknown'
            )
        ),
    constraint amr_outcome_episode_events_consent_check
        check (
            consent_status is null
            or consent_status in ('pending', 'approved', 'declined', 'revoked')
        ),
    constraint amr_outcome_episode_events_review_check
        check (
            review_status is null
            or review_status in ('pending', 'completed', 'rejected')
        ),
    constraint amr_outcome_episode_events_hash_check
        check (
            event_hash ~ '^[a-f0-9]{64}$'
            and (reviewer_ref_hash is null or reviewer_ref_hash ~ '^[a-f0-9]{64}$')
            and (source_record_digest is null or source_record_digest ~ '^[a-f0-9]{64}$')
            and (evidence_packet_hash is null or evidence_packet_hash ~ '^[a-f0-9]{64}$')
        )
);

create table if not exists public.amr_outcome_network_snapshots (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    pilot_status text not null,
    operational_laboratories integer not null default 0,
    operational_clinics integer not null default 0,
    total_episodes integer not null default 0,
    outcome_confirmed_episodes integer not null default 0,
    calibration_eligible_episodes integer not null default 0,
    federation_eligible_episodes integer not null default 0,
    target_episode_count integer not null default 250,
    target_progress_percent numeric(7, 4) not null default 0,
    network_threshold_met boolean not null default false,
    calibration_status text not null default 'unavailable',
    baseline_ece numeric(7, 6),
    current_ece numeric(7, 6),
    ece_delta numeric(8, 6),
    surveillance_status text not null default 'unavailable',
    outcome_linked_surveillance_records integer not null default 0,
    one_health_export_ready_records integer not null default 0,
    unique_trend_buckets integer not null default 0,
    surveillance_source_digest_bundle_hash text not null,
    source_digest_bundle_hash text not null,
    snapshot_hash text not null,
    blockers text[] not null default '{}',
    next_actions text[] not null default '{}',
    snapshot jsonb not null default '{}'::jsonb,
    captured_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint amr_outcome_network_snapshots_tenant_request_key
        unique (tenant_id, request_id),
    constraint amr_outcome_network_snapshots_status_check
        check (pilot_status in ('not_configured', 'enrolling', 'collecting', 'evidence_ready')),
    constraint amr_outcome_network_snapshots_calibration_check
        check (calibration_status in ('unavailable', 'baseline_only', 'improved', 'stable', 'regressed')),
    constraint amr_outcome_network_snapshots_surveillance_check
        check (surveillance_status in ('unavailable', 'collecting', 'operational', 'evidence_ready')),
    constraint amr_outcome_network_snapshots_counts_check
        check (
            operational_laboratories >= 0
            and operational_clinics >= 0
            and total_episodes >= 0
            and outcome_confirmed_episodes >= 0
            and calibration_eligible_episodes >= 0
            and federation_eligible_episodes >= 0
            and outcome_linked_surveillance_records >= 0
            and one_health_export_ready_records >= 0
            and unique_trend_buckets >= 0
            and target_episode_count > 0
            and target_progress_percent >= 0
            and target_progress_percent <= 100
        ),
    constraint amr_outcome_network_snapshots_hash_check
        check (
            surveillance_source_digest_bundle_hash ~ '^[a-f0-9]{64}$'
            and
            source_digest_bundle_hash ~ '^[a-f0-9]{64}$'
            and snapshot_hash ~ '^[a-f0-9]{64}$'
        )
);

create index if not exists idx_amr_network_site_events_tenant_site
    on public.amr_network_site_events (tenant_id, site_id, occurred_at);

create index if not exists idx_amr_network_site_events_operational
    on public.amr_network_site_events (tenant_id, site_type, event_type, occurred_at desc);

create index if not exists idx_amr_outcome_episode_events_tenant_episode
    on public.amr_outcome_episode_events (tenant_id, episode_id, occurred_at);

create index if not exists idx_amr_outcome_episode_events_stage
    on public.amr_outcome_episode_events (tenant_id, event_type, occurred_at desc);

create index if not exists idx_amr_outcome_episode_events_eligibility
    on public.amr_outcome_episode_events
        (tenant_id, calibration_eligible, federation_eligible, occurred_at desc);

create index if not exists idx_amr_outcome_episode_events_source_digest
    on public.amr_outcome_episode_events (tenant_id, source_record_digest)
    where source_record_digest is not null;

create index if not exists idx_amr_outcome_network_snapshots_tenant_created
    on public.amr_outcome_network_snapshots (tenant_id, captured_at desc);

create index if not exists idx_amr_outcome_network_snapshots_packet_gin
    on public.amr_outcome_network_snapshots using gin (snapshot);

alter table public.amr_lab_feed_surveillance_events
    add column if not exists source_digest_dedupe_enforced boolean;

alter table public.outcome_calibration_runs
    add column if not exists request_dedupe_enforced boolean;

create or replace function public.enforce_amr_outcome_network_dedupe_keys()
returns trigger
language plpgsql
as $$
begin
    if tg_table_name = 'amr_lab_feed_surveillance_events' then
        new.source_digest_dedupe_enforced := true;
    elsif tg_table_name = 'outcome_calibration_runs' and new.request_id is not null then
        new.request_dedupe_enforced := true;
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_source_digest_dedupe_amr_lab_feed
    on public.amr_lab_feed_surveillance_events;
create trigger enforce_source_digest_dedupe_amr_lab_feed
    before insert on public.amr_lab_feed_surveillance_events
    for each row execute function public.enforce_amr_outcome_network_dedupe_keys();

drop trigger if exists enforce_request_dedupe_outcome_calibration_runs
    on public.outcome_calibration_runs;
create trigger enforce_request_dedupe_outcome_calibration_runs
    before insert on public.outcome_calibration_runs
    for each row execute function public.enforce_amr_outcome_network_dedupe_keys();

create unique index if not exists idx_amr_lab_feed_surveillance_source_digest
    on public.amr_lab_feed_surveillance_events (tenant_id, source_record_digest)
    where source_digest_dedupe_enforced is true;

create unique index if not exists idx_outcome_calibration_runs_tenant_request
    on public.outcome_calibration_runs (tenant_id, request_id)
    where request_id is not null and request_dedupe_enforced is true;

create or replace function public.validate_amr_outcome_episode_provenance()
returns trigger
language plpgsql
as $$
begin
    if new.site_id is not null and not exists (
        select 1
        from public.amr_network_site_events site_event
        where site_event.tenant_id = new.tenant_id
          and site_event.site_id = new.site_id
          and site_event.site_type = 'clinic'
    ) then
        raise exception 'AMR episode clinic reference is not owned by the tenant'
            using errcode = '23514';
    end if;

    if new.lab_site_id is not null and not exists (
        select 1
        from public.amr_network_site_events site_event
        where site_event.tenant_id = new.tenant_id
          and site_event.site_id = new.lab_site_id
          and site_event.site_type = 'laboratory'
    ) then
        raise exception 'AMR episode laboratory reference is not owned by the tenant'
            using errcode = '23514';
    end if;

    if new.case_id is not null and not exists (
        select 1
        from public.clinical_cases clinical_case
        where clinical_case.tenant_id = new.tenant_id
          and clinical_case.id = new.case_id
    ) then
        raise exception 'AMR episode case reference is not owned by the tenant'
            using errcode = '23514';
    end if;

    if new.inference_event_id is not null and not exists (
        select 1
        from public.ai_inference_events inference_event
        where inference_event.tenant_id = new.tenant_id
          and inference_event.id = new.inference_event_id
    ) then
        raise exception 'AMR episode inference reference is not owned by the tenant'
            using errcode = '23514';
    end if;

    if new.clinical_outcome_id is not null and not exists (
        select 1
        from public.clinical_outcome_events outcome_event
        where outcome_event.tenant_id = new.tenant_id
          and outcome_event.id = new.clinical_outcome_id
    ) then
        raise exception 'AMR episode outcome reference is not owned by the tenant'
            using errcode = '23514';
    end if;

    if new.amr_stewardship_event_id is not null and not exists (
        select 1
        from public.amr_stewardship_events stewardship_event
        where stewardship_event.tenant_id = new.tenant_id
          and stewardship_event.id = new.amr_stewardship_event_id
    ) then
        raise exception 'AMR stewardship reference is not owned by the tenant'
            using errcode = '23514';
    end if;

    if new.amr_lab_feed_event_id is not null and not exists (
        select 1
        from public.amr_lab_feed_surveillance_events lab_event
        where lab_event.tenant_id = new.tenant_id
          and lab_event.id = new.amr_lab_feed_event_id
    ) then
        raise exception 'AMR laboratory feed reference is not owned by the tenant'
            using errcode = '23514';
    end if;

    if new.case_id is not null and new.inference_event_id is not null and exists (
        select 1
        from public.ai_inference_events inference_event
        where inference_event.id = new.inference_event_id
          and inference_event.case_id is not null
          and inference_event.case_id is distinct from new.case_id
    ) then
        raise exception 'AMR episode inference and case references disagree'
            using errcode = '23514';
    end if;

    if new.inference_event_id is not null and new.clinical_outcome_id is not null and exists (
        select 1
        from public.clinical_outcome_events outcome_event
        where outcome_event.id = new.clinical_outcome_id
          and outcome_event.inference_event_id is distinct from new.inference_event_id
    ) then
        raise exception 'AMR episode outcome and inference references disagree'
            using errcode = '23514';
    end if;

    if new.amr_lab_feed_event_id is not null
       and new.source_record_digest is not null
       and exists (
           select 1
           from public.amr_lab_feed_surveillance_events lab_event
           where lab_event.id = new.amr_lab_feed_event_id
             and lab_event.source_record_digest is distinct from new.source_record_digest
       ) then
        raise exception 'AMR episode source digest does not match the laboratory feed'
            using errcode = '23514';
    end if;

    if new.amr_lab_feed_event_id is not null
       and new.evidence_packet_hash is not null
       and exists (
           select 1
           from public.amr_lab_feed_surveillance_events lab_event
           where lab_event.id = new.amr_lab_feed_event_id
             and lab_event.packet_hash is distinct from new.evidence_packet_hash
       ) then
        raise exception 'AMR episode evidence hash does not match the laboratory feed'
            using errcode = '23514';
    end if;

    if new.deidentified and exists (
        select 1
        from public.amr_outcome_episode_events prior_event
        where prior_event.tenant_id = new.tenant_id
          and prior_event.episode_id = new.episode_id
          and not prior_event.deidentified
    ) then
        raise exception 'AMR episode deidentification status cannot be upgraded after failure'
            using errcode = '23514';
    end if;

    if not new.is_synthetic and (
        exists (
            select 1
            from public.amr_outcome_episode_events prior_event
            where prior_event.tenant_id = new.tenant_id
              and prior_event.episode_id = new.episode_id
              and prior_event.is_synthetic
        )
        or exists (
            select 1
            from public.ai_inference_events inference_event
            where inference_event.id = new.inference_event_id
              and inference_event.is_synthetic
        )
        or exists (
            select 1
            from public.clinical_outcome_events outcome_event
            where outcome_event.id = new.clinical_outcome_id
              and (
                  outcome_event.is_synthetic
                  or lower(coalesce(outcome_event.label_type, '')) like '%synthetic%'
                  or lower(coalesce(outcome_event.label_type, '')) like '%simulation%'
              )
        )
        or exists (
            select 1
            from public.clinical_cases clinical_case
            where clinical_case.id = new.case_id
              and (
                  clinical_case.adversarial_case
                  or lower(coalesce(clinical_case.label_type, '')) like '%synthetic%'
                  or lower(coalesce(clinical_case.label_type, '')) like '%simulation%'
              )
        )
    ) then
        raise exception 'AMR episode synthetic status must preserve linked provenance'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

drop trigger if exists validate_provenance_amr_outcome_episode_events
    on public.amr_outcome_episode_events;
create trigger validate_provenance_amr_outcome_episode_events
    before insert on public.amr_outcome_episode_events
    for each row execute function public.validate_amr_outcome_episode_provenance();

create or replace function public.prevent_amr_outcome_network_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'AMR outcome network ledgers are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_amr_network_site_events
    on public.amr_network_site_events;
create trigger enforce_immutability_amr_network_site_events
    before update or delete on public.amr_network_site_events
    for each row execute function public.prevent_amr_outcome_network_mutation();

drop trigger if exists enforce_immutability_amr_outcome_episode_events
    on public.amr_outcome_episode_events;
create trigger enforce_immutability_amr_outcome_episode_events
    before update or delete on public.amr_outcome_episode_events
    for each row execute function public.prevent_amr_outcome_network_mutation();

drop trigger if exists enforce_immutability_amr_outcome_network_snapshots
    on public.amr_outcome_network_snapshots;
create trigger enforce_immutability_amr_outcome_network_snapshots
    before update or delete on public.amr_outcome_network_snapshots
    for each row execute function public.prevent_amr_outcome_network_mutation();

alter table public.amr_network_site_events enable row level security;
alter table public.amr_outcome_episode_events enable row level security;
alter table public.amr_outcome_network_snapshots enable row level security;

drop policy if exists amr_network_site_events_select_tenant
    on public.amr_network_site_events;
create policy amr_network_site_events_select_tenant
    on public.amr_network_site_events
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists amr_network_site_events_insert_tenant
    on public.amr_network_site_events;
create policy amr_network_site_events_insert_tenant
    on public.amr_network_site_events
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists amr_outcome_episode_events_select_tenant
    on public.amr_outcome_episode_events;
create policy amr_outcome_episode_events_select_tenant
    on public.amr_outcome_episode_events
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists amr_outcome_episode_events_insert_tenant
    on public.amr_outcome_episode_events;
create policy amr_outcome_episode_events_insert_tenant
    on public.amr_outcome_episode_events
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists amr_outcome_network_snapshots_select_tenant
    on public.amr_outcome_network_snapshots;
create policy amr_outcome_network_snapshots_select_tenant
    on public.amr_outcome_network_snapshots
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists amr_outcome_network_snapshots_insert_tenant
    on public.amr_outcome_network_snapshots;
create policy amr_outcome_network_snapshots_insert_tenant
    on public.amr_outcome_network_snapshots
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists service_role_amr_network_site_events
    on public.amr_network_site_events;
create policy service_role_amr_network_site_events
    on public.amr_network_site_events
    for all to service_role using (true) with check (true);

drop policy if exists service_role_amr_outcome_episode_events
    on public.amr_outcome_episode_events;
create policy service_role_amr_outcome_episode_events
    on public.amr_outcome_episode_events
    for all to service_role using (true) with check (true);

drop policy if exists service_role_amr_outcome_network_snapshots
    on public.amr_outcome_network_snapshots;
create policy service_role_amr_outcome_network_snapshots
    on public.amr_outcome_network_snapshots
    for all to service_role using (true) with check (true);

grant select, insert on public.amr_network_site_events to service_role;
grant select, insert on public.amr_outcome_episode_events to service_role;
grant select, insert on public.amr_outcome_network_snapshots to service_role;
revoke update, delete on public.amr_network_site_events from anon, authenticated;
revoke update, delete on public.amr_outcome_episode_events from anon, authenticated;
revoke update, delete on public.amr_outcome_network_snapshots from anon, authenticated;

comment on table public.amr_network_site_events is
    'Append-only enrollment, data-use, and connector-verification ledger for AMR pilot laboratories and clinics.';

comment on table public.amr_outcome_episode_events is
    'Append-only AMR episode lifecycle from culture and AST through treatment, clinician review, confirmed outcome, calibration eligibility, and federation eligibility.';

comment on column public.amr_outcome_episode_events.event_payload is
    'Sanitized derived facts only. Raw lab reports, accessions, owner identifiers, patient names, contact details, and credentials are prohibited.';

comment on table public.amr_outcome_network_snapshots is
    'Append-only evidence snapshot proving AMR pilot site readiness, 250-episode progress, calibration state, and federated eligibility.';

notify pgrst, 'reload schema';
