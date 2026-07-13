create extension if not exists pgcrypto;

create table if not exists public.auth_session_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    user_id uuid,
    subject_ref text,
    session_ref_hash text,
    event_type text not null,
    auth_provider text not null default 'supabase',
    assurance_level text not null default 'session',
    session_age_seconds integer,
    password_changed_at timestamptz,
    session_issued_at timestamptz,
    stale_session_blocked boolean not null default false,
    ip_hash text,
    user_agent_hash text,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint auth_session_events_event_type_check
        check (event_type in (
            'session_resolved',
            'session_rejected',
            'password_changed',
            'global_logout_requested',
            'step_up_required',
            'step_up_satisfied',
            'stale_session_blocked'
        )),
    constraint auth_session_events_assurance_check
        check (assurance_level in (
            'anonymous',
            'session',
            'recent_auth',
            'mfa',
            'passkey',
            'workload_identity'
        )),
    constraint auth_session_events_age_check
        check (session_age_seconds is null or session_age_seconds >= 0),
    constraint auth_session_events_hash_check
        check (
            (session_ref_hash is null or session_ref_hash ~ '^[a-f0-9]{64}$')
            and (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$')
            and (user_agent_hash is null or user_agent_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_auth_session_events_tenant_created
    on public.auth_session_events (tenant_id, created_at desc);

create index if not exists idx_auth_session_events_user
    on public.auth_session_events (tenant_id, user_id, observed_at desc)
    where user_id is not null;

create index if not exists idx_auth_session_events_type
    on public.auth_session_events (tenant_id, event_type, observed_at desc);

create index if not exists idx_auth_session_events_evidence_gin
    on public.auth_session_events using gin (evidence);

create table if not exists public.api_credential_lifecycle_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    credential_id uuid,
    service_account_id uuid references public.service_accounts(id) on delete set null,
    connector_installation_id uuid references public.connector_installations(id) on delete set null,
    actor_user_id uuid,
    lifecycle_event text not null,
    principal_type text not null default 'service_account',
    auth_protocol text not null default 'api_key',
    key_prefix text,
    scopes text[] not null default '{}',
    deployment_environment text not null default 'production',
    ip_hash text,
    user_agent_hash text,
    risk_level text not null default 'medium',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint api_credential_lifecycle_event_check
        check (lifecycle_event in (
            'issued',
            'rotated',
            'revoked',
            'expired',
            'used',
            'scope_changed',
            'anomaly_detected',
            'blocked'
        )),
    constraint api_credential_lifecycle_principal_check
        check (principal_type in (
            'service_account',
            'connector_installation',
            'oauth_client',
            'internal_service'
        )),
    constraint api_credential_lifecycle_protocol_check
        check (auth_protocol in (
            'api_key',
            'oauth_client_credentials',
            'jwt_bearer',
            'dpop',
            'mtls',
            'workload_identity'
        )),
    constraint api_credential_lifecycle_environment_check
        check (deployment_environment in ('sandbox', 'staging', 'production')),
    constraint api_credential_lifecycle_risk_check
        check (risk_level in ('low', 'medium', 'high', 'critical')),
    constraint api_credential_lifecycle_hash_check
        check (
            (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$')
            and (user_agent_hash is null or user_agent_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_api_credential_lifecycle_tenant_created
    on public.api_credential_lifecycle_events (tenant_id, created_at desc);

create index if not exists idx_api_credential_lifecycle_credential
    on public.api_credential_lifecycle_events (tenant_id, credential_id, observed_at desc)
    where credential_id is not null;

create index if not exists idx_api_credential_lifecycle_service_account
    on public.api_credential_lifecycle_events (service_account_id, observed_at desc)
    where service_account_id is not null;

create index if not exists idx_api_credential_lifecycle_connector
    on public.api_credential_lifecycle_events (connector_installation_id, observed_at desc)
    where connector_installation_id is not null;

create index if not exists idx_api_credential_lifecycle_scopes_gin
    on public.api_credential_lifecycle_events using gin (scopes);

create index if not exists idx_api_credential_lifecycle_evidence_gin
    on public.api_credential_lifecycle_events using gin (evidence);

create table if not exists public.authorization_decision_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    subject_type text not null,
    subject_ref text,
    actor_user_id uuid,
    credential_id uuid,
    auth_mode text not null,
    action_key text not null,
    action_category text not null,
    resource_type text not null,
    resource_id text,
    resource_tenant_id text,
    decision text not null,
    risk_level text not null default 'medium',
    assurance_level text not null default 'session',
    required_assurance_level text not null default 'session',
    required_scopes text[] not null default '{}',
    granted_scopes text[] not null default '{}',
    role text,
    permission_snapshot jsonb not null default '{}'::jsonb,
    reasons text[] not null default '{}',
    blockers text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint authorization_decision_subject_check
        check (subject_type in (
            'session_user',
            'service_account',
            'connector_installation',
            'oauth_client',
            'internal_service',
            'dev_bypass'
        )),
    constraint authorization_decision_auth_mode_check
        check (auth_mode in (
            'session',
            'dev_bypass',
            'service_account',
            'connector_installation',
            'oauth_client',
            'internal_token',
            'workload_identity'
        )),
    constraint authorization_decision_category_check
        check (action_category in (
            'clinical_inference',
            'outcome_learning',
            'dataset_export',
            'federation_admin',
            'api_credential_management',
            'model_governance',
            'billing_admin',
            'cross_tenant_surveillance',
            'ontology_ingestion',
            'infrastructure_admin',
            'read_only'
        )),
    constraint authorization_decision_decision_check
        check (decision in ('allow', 'deny', 'challenge')),
    constraint authorization_decision_risk_check
        check (risk_level in ('low', 'medium', 'high', 'critical')),
    constraint authorization_decision_assurance_check
        check (
            assurance_level in ('anonymous', 'session', 'recent_auth', 'mfa', 'passkey', 'workload_identity')
            and required_assurance_level in ('anonymous', 'session', 'recent_auth', 'mfa', 'passkey', 'workload_identity')
        )
);

create index if not exists idx_authorization_decision_tenant_created
    on public.authorization_decision_events (tenant_id, created_at desc);

create index if not exists idx_authorization_decision_request
    on public.authorization_decision_events (tenant_id, request_id, observed_at desc);

create index if not exists idx_authorization_decision_action
    on public.authorization_decision_events (tenant_id, action_key, decision, observed_at desc);

create index if not exists idx_authorization_decision_resource
    on public.authorization_decision_events (tenant_id, resource_type, resource_id, observed_at desc);

create index if not exists idx_authorization_decision_blockers_gin
    on public.authorization_decision_events using gin (blockers);

create index if not exists idx_authorization_decision_evidence_gin
    on public.authorization_decision_events using gin (evidence);

create table if not exists public.high_risk_operation_challenge_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    authorization_decision_event_id uuid references public.authorization_decision_events(id) on delete set null,
    subject_type text not null,
    subject_ref text,
    actor_user_id uuid,
    action_key text not null,
    resource_type text not null,
    resource_id text,
    challenge_type text not null default 'recent_auth',
    challenge_status text not null default 'required',
    required_assurance_level text not null default 'recent_auth',
    satisfied_assurance_level text,
    expires_at timestamptz,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint high_risk_operation_challenge_subject_check
        check (subject_type in (
            'session_user',
            'service_account',
            'connector_installation',
            'oauth_client',
            'internal_service',
            'dev_bypass'
        )),
    constraint high_risk_operation_challenge_type_check
        check (challenge_type in (
            'recent_auth',
            'mfa',
            'passkey',
            'admin_approval',
            'workload_identity',
            'external_attestation'
        )),
    constraint high_risk_operation_challenge_status_check
        check (challenge_status in ('required', 'satisfied', 'expired', 'failed', 'waived')),
    constraint high_risk_operation_challenge_assurance_check
        check (
            required_assurance_level in ('recent_auth', 'mfa', 'passkey', 'workload_identity')
            and (
                satisfied_assurance_level is null
                or satisfied_assurance_level in ('recent_auth', 'mfa', 'passkey', 'workload_identity')
            )
        )
);

create index if not exists idx_high_risk_operation_challenge_tenant_created
    on public.high_risk_operation_challenge_events (tenant_id, created_at desc);

create index if not exists idx_high_risk_operation_challenge_request
    on public.high_risk_operation_challenge_events (tenant_id, request_id, observed_at desc);

create index if not exists idx_high_risk_operation_challenge_action
    on public.high_risk_operation_challenge_events
        (tenant_id, action_key, challenge_status, observed_at desc);

create index if not exists idx_high_risk_operation_challenge_evidence_gin
    on public.high_risk_operation_challenge_events using gin (evidence);

create or replace function public.prevent_auth_trust_fabric_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'auth trust fabric event ledgers are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_auth_session_events
    on public.auth_session_events;
create trigger enforce_immutability_auth_session_events
    before update or delete on public.auth_session_events
    for each row execute function public.prevent_auth_trust_fabric_event_mutation();

drop trigger if exists enforce_immutability_api_credential_lifecycle_events
    on public.api_credential_lifecycle_events;
create trigger enforce_immutability_api_credential_lifecycle_events
    before update or delete on public.api_credential_lifecycle_events
    for each row execute function public.prevent_auth_trust_fabric_event_mutation();

drop trigger if exists enforce_immutability_authorization_decision_events
    on public.authorization_decision_events;
create trigger enforce_immutability_authorization_decision_events
    before update or delete on public.authorization_decision_events
    for each row execute function public.prevent_auth_trust_fabric_event_mutation();

drop trigger if exists enforce_immutability_high_risk_operation_challenge_events
    on public.high_risk_operation_challenge_events;
create trigger enforce_immutability_high_risk_operation_challenge_events
    before update or delete on public.high_risk_operation_challenge_events
    for each row execute function public.prevent_auth_trust_fabric_event_mutation();

alter table public.auth_session_events enable row level security;
alter table public.api_credential_lifecycle_events enable row level security;
alter table public.authorization_decision_events enable row level security;
alter table public.high_risk_operation_challenge_events enable row level security;

drop policy if exists auth_session_events_select_tenant on public.auth_session_events;
create policy auth_session_events_select_tenant
    on public.auth_session_events
    for select using (tenant_id = auth.uid()::text);

drop policy if exists auth_session_events_insert_tenant on public.auth_session_events;
create policy auth_session_events_insert_tenant
    on public.auth_session_events
    for insert with check (tenant_id = auth.uid()::text);

drop policy if exists "service_role_auth_session_events" on public.auth_session_events;
create policy "service_role_auth_session_events"
    on public.auth_session_events for all to service_role using (true) with check (true);

drop policy if exists api_credential_lifecycle_events_select_tenant
    on public.api_credential_lifecycle_events;
create policy api_credential_lifecycle_events_select_tenant
    on public.api_credential_lifecycle_events
    for select using (tenant_id = auth.uid()::text);

drop policy if exists api_credential_lifecycle_events_insert_tenant
    on public.api_credential_lifecycle_events;
create policy api_credential_lifecycle_events_insert_tenant
    on public.api_credential_lifecycle_events
    for insert with check (tenant_id = auth.uid()::text);

drop policy if exists "service_role_api_credential_lifecycle_events"
    on public.api_credential_lifecycle_events;
create policy "service_role_api_credential_lifecycle_events"
    on public.api_credential_lifecycle_events for all to service_role using (true) with check (true);

drop policy if exists authorization_decision_events_select_tenant
    on public.authorization_decision_events;
create policy authorization_decision_events_select_tenant
    on public.authorization_decision_events
    for select using (tenant_id = auth.uid()::text);

drop policy if exists authorization_decision_events_insert_tenant
    on public.authorization_decision_events;
create policy authorization_decision_events_insert_tenant
    on public.authorization_decision_events
    for insert with check (tenant_id = auth.uid()::text);

drop policy if exists "service_role_authorization_decision_events"
    on public.authorization_decision_events;
create policy "service_role_authorization_decision_events"
    on public.authorization_decision_events for all to service_role using (true) with check (true);

drop policy if exists high_risk_operation_challenge_events_select_tenant
    on public.high_risk_operation_challenge_events;
create policy high_risk_operation_challenge_events_select_tenant
    on public.high_risk_operation_challenge_events
    for select using (tenant_id = auth.uid()::text);

drop policy if exists high_risk_operation_challenge_events_insert_tenant
    on public.high_risk_operation_challenge_events;
create policy high_risk_operation_challenge_events_insert_tenant
    on public.high_risk_operation_challenge_events
    for insert with check (tenant_id = auth.uid()::text);

drop policy if exists "service_role_high_risk_operation_challenge_events"
    on public.high_risk_operation_challenge_events;
create policy "service_role_high_risk_operation_challenge_events"
    on public.high_risk_operation_challenge_events for all to service_role using (true) with check (true);

comment on table public.auth_session_events is
    'Append-only session trust ledger for VetIOS browser and identity events, including stale-session blocks, step-up requirements, and password-change invalidation evidence.';

comment on table public.api_credential_lifecycle_events is
    'Append-only API credential lifecycle ledger for issuance, rotation, revocation, expiry, usage, scope changes, anomaly detection, and blocked machine access.';

comment on table public.authorization_decision_events is
    'Append-only authorization decision ledger. Records actor, tenant, scopes, role, resource, risk, assurance, decision, blockers, and evidence for clinical and infrastructure actions.';

comment on table public.high_risk_operation_challenge_events is
    'Append-only step-up challenge ledger for high-risk VetIOS operations such as dataset export, API credential creation, federation administration, billing ownership, and model governance.';

comment on column public.authorization_decision_events.evidence is
    'Policy evidence only. Store assurance, risk, scope, route, and resource metadata; never store raw credentials, bearer tokens, raw patient records, or secrets.';

notify pgrst, 'reload schema';
