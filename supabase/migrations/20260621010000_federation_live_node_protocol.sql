create extension if not exists pgcrypto;

create table if not exists public.federation_node_runtime_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    federation_key text not null,
    partner_ref text not null,
    node_ref text not null,
    membership_id uuid references public.federation_memberships(id) on delete set null,
    activation_event_id uuid references public.federation_activation_events(id) on delete set null,
    outcome_eligibility_snapshot_id uuid references public.federated_outcome_eligibility_snapshots(id) on delete set null,
    federation_round_id uuid references public.federation_rounds(id) on delete set null,
    node_kind text not null default 'clinic',
    runtime_event text not null,
    node_status text not null default 'pending',
    deployment_environment text not null default 'sandbox',
    software_version text,
    secure_aggregation_status text not null default 'not_ready',
    outcome_eligibility_status text not null default 'insufficient_evidence',
    last_heartbeat_at timestamptz,
    blockers text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federation_node_runtime_events_tenant_request_key unique (tenant_id, request_id),
    constraint federation_node_runtime_events_node_kind_check
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
    constraint federation_node_runtime_events_event_check
        check (runtime_event in (
            'registered',
            'heartbeat',
            'round_plan_pulled',
            'task_started',
            'masked_update_submitted',
            'unmask_share_submitted',
            'dropout_reported',
            'round_acknowledged',
            'revoked'
        )),
    constraint federation_node_runtime_events_status_check
        check (node_status in ('pending', 'online', 'degraded', 'offline', 'revoked')),
    constraint federation_node_runtime_events_environment_check
        check (deployment_environment in ('sandbox', 'staging', 'production')),
    constraint federation_node_runtime_events_secure_status_check
        check (secure_aggregation_status in ('not_ready', 'keys_registered', 'masking_ready', 'ready')),
    constraint federation_node_runtime_events_eligibility_status_check
        check (outcome_eligibility_status in ('eligible', 'insufficient_evidence', 'blocked', 'expired'))
);

create index if not exists idx_federation_node_runtime_tenant_created
    on public.federation_node_runtime_events (tenant_id, created_at desc);

create index if not exists idx_federation_node_runtime_lookup
    on public.federation_node_runtime_events
        (federation_key, node_ref, observed_at desc);

create index if not exists idx_federation_node_runtime_round
    on public.federation_node_runtime_events (federation_round_id, runtime_event, observed_at desc)
    where federation_round_id is not null;

create index if not exists idx_federation_node_runtime_blockers_gin
    on public.federation_node_runtime_events using gin (blockers);

create index if not exists idx_federation_node_runtime_evidence_gin
    on public.federation_node_runtime_events using gin (evidence);

create table if not exists public.federation_round_node_tasks (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    federation_round_id uuid not null references public.federation_rounds(id) on delete cascade,
    federation_key text not null,
    round_key text not null,
    node_ref text not null,
    partner_ref text not null,
    membership_id uuid references public.federation_memberships(id) on delete set null,
    outcome_eligibility_snapshot_id uuid references public.federated_outcome_eligibility_snapshots(id) on delete set null,
    task_type text not null,
    task_status text not null default 'planned',
    plan_hash text not null,
    model_artifact_ref text,
    dataset_policy jsonb not null default '{}'::jsonb,
    secure_aggregation_config jsonb not null default '{}'::jsonb,
    task_payload jsonb not null default '{}'::jsonb,
    due_at timestamptz,
    evidence jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint federation_round_node_tasks_unique
        unique (federation_round_id, node_ref, task_type),
    constraint federation_round_node_tasks_type_check
        check (task_type in (
            'diagnosis_delta',
            'severity_delta',
            'support_summary',
            'secure_aggregation_key',
            'unmask_share'
        )),
    constraint federation_round_node_tasks_status_check
        check (task_status in ('planned', 'issued', 'pulled', 'submitted', 'accepted', 'rejected', 'expired')),
    constraint federation_round_node_tasks_plan_hash_check
        check (plan_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_federation_round_node_tasks_tenant_created
    on public.federation_round_node_tasks (tenant_id, created_at desc);

create index if not exists idx_federation_round_node_tasks_round
    on public.federation_round_node_tasks (federation_round_id, task_status, created_at desc);

create index if not exists idx_federation_round_node_tasks_node
    on public.federation_round_node_tasks (federation_key, node_ref, task_status, created_at desc);

create index if not exists idx_federation_round_node_tasks_policy_gin
    on public.federation_round_node_tasks using gin (dataset_policy);

create index if not exists idx_federation_round_node_tasks_payload_gin
    on public.federation_round_node_tasks using gin (task_payload);

create table if not exists public.federated_update_submissions (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    federation_round_id uuid not null references public.federation_rounds(id) on delete cascade,
    round_node_task_id uuid references public.federation_round_node_tasks(id) on delete set null,
    outcome_eligibility_snapshot_id uuid references public.federated_outcome_eligibility_snapshots(id) on delete set null,
    federation_key text not null,
    round_key text not null,
    node_ref text not null,
    partner_ref text not null,
    participant_ref text not null,
    contribution_role text not null,
    submission_status text not null default 'submitted',
    masking_protocol text not null default 'pairwise_masked_commitment_v1',
    payload_commitment_hash text not null,
    mask_commitment_hash text,
    signed_payload_hash text,
    signature_algorithm text,
    signature_hash text,
    signing_key_fingerprint text,
    masked_update_summary jsonb not null default '{}'::jsonb,
    public_summary jsonb not null default '{}'::jsonb,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federated_update_submissions_tenant_request_key unique (tenant_id, request_id),
    constraint federated_update_submissions_role_check
        check (contribution_role in ('diagnosis', 'severity', 'support', 'unmask_share')),
    constraint federated_update_submissions_status_check
        check (submission_status in ('submitted', 'accepted', 'rejected', 'quarantined')),
    constraint federated_update_submissions_payload_hash_check
        check (payload_commitment_hash ~ '^[a-f0-9]{64}$'),
    constraint federated_update_submissions_mask_hash_check
        check (mask_commitment_hash is null or mask_commitment_hash ~ '^[a-f0-9]{64}$'),
    constraint federated_update_submissions_signed_hash_check
        check (signed_payload_hash is null or signed_payload_hash ~ '^[a-f0-9]{64}$'),
    constraint federated_update_submissions_signature_hash_check
        check (signature_hash is null or signature_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_federated_update_submissions_tenant_created
    on public.federated_update_submissions (tenant_id, created_at desc);

create index if not exists idx_federated_update_submissions_round
    on public.federated_update_submissions
        (federation_round_id, contribution_role, submission_status, observed_at desc);

create index if not exists idx_federated_update_submissions_node
    on public.federated_update_submissions
        (federation_key, node_ref, observed_at desc);

create index if not exists idx_federated_update_submissions_task
    on public.federated_update_submissions (round_node_task_id)
    where round_node_task_id is not null;

create index if not exists idx_federated_update_submissions_summary_gin
    on public.federated_update_submissions using gin (masked_update_summary);

create index if not exists idx_federated_update_submissions_evidence_gin
    on public.federated_update_submissions using gin (evidence);

create or replace function public.prevent_federation_node_runtime_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federation_node_runtime_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federation_node_runtime_events
    on public.federation_node_runtime_events;
create trigger enforce_immutability_federation_node_runtime_events
    before update or delete on public.federation_node_runtime_events
    for each row execute function public.prevent_federation_node_runtime_event_mutation();

create or replace function public.prevent_federated_update_submission_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'federated_update_submissions is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_federated_update_submissions
    on public.federated_update_submissions;
create trigger enforce_immutability_federated_update_submissions
    before update or delete on public.federated_update_submissions
    for each row execute function public.prevent_federated_update_submission_mutation();

alter table public.federation_node_runtime_events enable row level security;
alter table public.federation_round_node_tasks enable row level security;
alter table public.federated_update_submissions enable row level security;

drop policy if exists federation_node_runtime_events_select_tenant on public.federation_node_runtime_events;
create policy federation_node_runtime_events_select_tenant
    on public.federation_node_runtime_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federation_node_runtime_events_insert_tenant on public.federation_node_runtime_events;
create policy federation_node_runtime_events_insert_tenant
    on public.federation_node_runtime_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federation_node_runtime_events" on public.federation_node_runtime_events;
create policy "service_role_federation_node_runtime_events"
    on public.federation_node_runtime_events for all to service_role using (true) with check (true);

drop policy if exists federation_round_node_tasks_select_tenant on public.federation_round_node_tasks;
create policy federation_round_node_tasks_select_tenant
    on public.federation_round_node_tasks
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federation_round_node_tasks_insert_tenant on public.federation_round_node_tasks;
create policy federation_round_node_tasks_insert_tenant
    on public.federation_round_node_tasks
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federation_round_node_tasks" on public.federation_round_node_tasks;
create policy "service_role_federation_round_node_tasks"
    on public.federation_round_node_tasks for all to service_role using (true) with check (true);

drop policy if exists federated_update_submissions_select_tenant on public.federated_update_submissions;
create policy federated_update_submissions_select_tenant
    on public.federated_update_submissions
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists federated_update_submissions_insert_tenant on public.federated_update_submissions;
create policy federated_update_submissions_insert_tenant
    on public.federated_update_submissions
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_federated_update_submissions" on public.federated_update_submissions;
create policy "service_role_federated_update_submissions"
    on public.federated_update_submissions for all to service_role using (true) with check (true);

comment on table public.federation_node_runtime_events is
    'Append-only live federation node runtime ledger for registration, heartbeat, round plan pulls, masked update submission, unmask shares, dropouts, and acknowledgements.';

comment on table public.federation_round_node_tasks is
    'Per-round node task plan ledger for live partner-node federated training. Stores task manifests and hashes, not raw clinical records or raw model deltas.';

comment on table public.federated_update_submissions is
    'Append-only live node masked-update submission ledger for federated rounds. Stores commitments, signatures, summaries, and evidence only.';

comment on column public.federated_update_submissions.masked_update_summary is
    'De-identified masked update metadata. Do not store unmasked model deltas, raw features, patient notes, or clinic source rows here.';

notify pgrst, 'reload schema';
