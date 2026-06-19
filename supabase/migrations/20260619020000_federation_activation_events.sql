create table if not exists public.federation_activation_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    federation_key text not null,
    partner_ref text not null,
    membership_id uuid references public.federation_memberships(id) on delete set null,
    node_kind text not null default 'clinic',
    deployment_environment text not null default 'sandbox',
    data_residency_region text,
    activation_stage text not null default 'invited',
    activation_status text not null default 'pending',
    data_policy_status text not null default 'not_reviewed',
    attestation_status text not null default 'not_attested',
    secure_aggregation_status text not null default 'not_ready',
    heartbeat_status text not null default 'not_seen',
    last_heartbeat_at timestamptz,
    readiness_score numeric(5, 4) not null default 0,
    blockers text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federation_activation_events_tenant_request_key unique (tenant_id, request_id),
    constraint federation_activation_events_node_kind_check
        check (node_kind in (
            'clinic',
            'reference_lab',
            'university',
            'ngo',
            'government',
            'public_health',
            'research_network',
            'sandbox'
        )),
    constraint federation_activation_events_environment_check
        check (deployment_environment in ('sandbox', 'staging', 'production')),
    constraint federation_activation_events_stage_check
        check (activation_stage in (
            'invited',
            'data_policy_review',
            'sandbox_connected',
            'secure_aggregation_ready',
            'active_node',
            'paused',
            'revoked'
        )),
    constraint federation_activation_events_status_check
        check (activation_status in ('pending', 'ready', 'active', 'blocked', 'revoked')),
    constraint federation_activation_events_data_policy_status_check
        check (data_policy_status in ('not_reviewed', 'approved', 'needs_review', 'rejected')),
    constraint federation_activation_events_attestation_status_check
        check (attestation_status in ('not_attested', 'self_attested', 'verified', 'rejected')),
    constraint federation_activation_events_secure_aggregation_status_check
        check (secure_aggregation_status in ('not_ready', 'keys_registered', 'masking_ready', 'ready')),
    constraint federation_activation_events_heartbeat_status_check
        check (heartbeat_status in ('not_seen', 'healthy', 'stale', 'failed')),
    constraint federation_activation_events_readiness_score_check
        check (readiness_score >= 0 and readiness_score <= 1)
);

create index if not exists idx_federation_activation_tenant_created
    on public.federation_activation_events (tenant_id, created_at desc);

create index if not exists idx_federation_activation_federation_status
    on public.federation_activation_events (tenant_id, federation_key, activation_status, observed_at desc);

create index if not exists idx_federation_activation_partner
    on public.federation_activation_events (tenant_id, federation_key, partner_ref, observed_at desc);

create index if not exists idx_federation_activation_membership
    on public.federation_activation_events (membership_id)
    where membership_id is not null;

create index if not exists idx_federation_activation_blockers_gin
    on public.federation_activation_events using gin (blockers);

create index if not exists idx_federation_activation_evidence_gin
    on public.federation_activation_events using gin (evidence);

create or replace function public.prevent_federation_activation_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federation_activation_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federation_activation_events on public.federation_activation_events;
create trigger enforce_immutability_federation_activation_events
    before update or delete on public.federation_activation_events
    for each row execute function public.prevent_federation_activation_event_mutation();

alter table public.federation_activation_events enable row level security;

drop policy if exists federation_activation_events_select_tenant on public.federation_activation_events;
create policy federation_activation_events_select_tenant
    on public.federation_activation_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federation_activation_events_insert_tenant on public.federation_activation_events;
create policy federation_activation_events_insert_tenant
    on public.federation_activation_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federation_activation_events" on public.federation_activation_events;
create policy "service_role_federation_activation_events"
    on public.federation_activation_events for all to service_role using (true) with check (true);

comment on table public.federation_activation_events is
    'Append-only federation node activation ledger for partner readiness, policy approval, attestation, heartbeat health, and secure aggregation readiness.';

comment on column public.federation_activation_events.partner_ref is
    'De-identified partner or node reference. Do not store partner secrets, PHI, or raw clinic data here.';

comment on column public.federation_activation_events.evidence is
    'De-identified activation evidence: policy references, attestation summaries, key-registration metadata, heartbeat proofs, and reviewer notes.';

comment on column public.federation_activation_events.readiness_score is
    'Computed 0-1 activation readiness score used to separate architecture claims from active federation claims.';

notify pgrst, 'reload schema';
