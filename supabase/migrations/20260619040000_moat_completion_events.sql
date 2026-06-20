create table if not exists public.moat_completion_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    moat_key text not null,
    moat_name text not null,
    value_capture_layer text not null default 'data_provenance',
    completion_level text not null default 'foundation',
    completion_score numeric(5, 4) not null default 0,
    claim_posture text not null default 'architecture_only',
    hard_to_substitute boolean not null default false,
    two_quarter_replicability text not null default 'unknown',
    live_event_count integer not null default 0,
    outcome_confirmed_count integer not null default 0,
    provenance_verified_count integer not null default 0,
    trust_scored_count integer not null default 0,
    external_validation_count integer not null default 0,
    last_signal_at timestamptz,
    scarcity_basis text[] not null default '{}',
    missing_evidence text[] not null default '{}',
    evidence_requirements jsonb not null default '{}'::jsonb,
    evidence jsonb not null default '{}'::jsonb,
    owner_label text,
    next_unblock_action text,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint moat_completion_events_tenant_request_moat_key
        unique (tenant_id, request_id, moat_key),
    constraint moat_completion_events_key_check
        check (moat_key ~ '^[a-z0-9][a-z0-9:_-]{2,96}$'),
    constraint moat_completion_events_value_capture_layer_check
        check (value_capture_layer in (
            'interface',
            'workflow',
            'data_provenance',
            'trust_scoring',
            'federation',
            'surveillance'
        )),
    constraint moat_completion_events_completion_level_check
        check (completion_level in (
            'not_started',
            'foundation',
            'operating',
            'defensible',
            'blocked'
        )),
    constraint moat_completion_events_completion_score_check
        check (completion_score >= 0 and completion_score <= 1),
    constraint moat_completion_events_claim_posture_check
        check (claim_posture in (
            'architecture_only',
            'measured_activity',
            'evidence_grade_claims',
            'restricted_claims'
        )),
    constraint moat_completion_events_replicability_check
        check (two_quarter_replicability in (
            'unknown',
            'copyable_interface',
            'hard_to_replicate',
            'not_replicable_short_term'
        )),
    constraint moat_completion_events_count_check
        check (
            live_event_count >= 0
            and outcome_confirmed_count >= 0
            and provenance_verified_count >= 0
            and trust_scored_count >= 0
            and external_validation_count >= 0
        )
);

create index if not exists idx_moat_completion_tenant_created
    on public.moat_completion_events (tenant_id, created_at desc);

create index if not exists idx_moat_completion_tenant_moat_observed
    on public.moat_completion_events (tenant_id, moat_key, observed_at desc);

create index if not exists idx_moat_completion_level_claim
    on public.moat_completion_events (tenant_id, completion_level, claim_posture, observed_at desc);

create index if not exists idx_moat_completion_missing_evidence_gin
    on public.moat_completion_events using gin (missing_evidence);

create index if not exists idx_moat_completion_evidence_gin
    on public.moat_completion_events using gin (evidence);

create or replace function public.prevent_moat_completion_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'moat_completion_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_moat_completion_events on public.moat_completion_events;
create trigger enforce_immutability_moat_completion_events
    before update or delete on public.moat_completion_events
    for each row execute function public.prevent_moat_completion_event_mutation();

alter table public.moat_completion_events enable row level security;

drop policy if exists moat_completion_events_select_tenant on public.moat_completion_events;
create policy moat_completion_events_select_tenant
    on public.moat_completion_events
    for select using (tenant_id = auth.uid()::text);

drop policy if exists moat_completion_events_insert_tenant on public.moat_completion_events;
create policy moat_completion_events_insert_tenant
    on public.moat_completion_events
    for insert with check (tenant_id = auth.uid()::text);

drop policy if exists "service_role_moat_completion_events" on public.moat_completion_events;
create policy "service_role_moat_completion_events"
    on public.moat_completion_events for all to service_role using (true) with check (true);

comment on table public.moat_completion_events is
    'Append-only completion ledger that separates technical moat foundations from operating evidence and defensible outcome/provenance/trust-scored assets.';

comment on column public.moat_completion_events.value_capture_layer is
    'Layer where value is expected to concentrate: interface, workflow, data_provenance, trust_scoring, federation, or surveillance.';

comment on column public.moat_completion_events.completion_level is
    'Evidence state: not_started, foundation, operating, defensible, or blocked. Do not use defensible without outcome/provenance/trust evidence.';

comment on column public.moat_completion_events.claim_posture is
    'Permitted external claim posture for this moat based on evidence: architecture_only, measured_activity, evidence_grade_claims, or restricted_claims.';

comment on column public.moat_completion_events.two_quarter_replicability is
    'Falsifiable scarcity test for whether a well-funded competitor could replicate this layer in two quarters.';

comment on column public.moat_completion_events.evidence is
    'De-identified evidence summary. Store aggregate counts, hashes, thresholds, and source table names, not raw clinical payloads or PHI.';

notify pgrst, 'reload schema';
