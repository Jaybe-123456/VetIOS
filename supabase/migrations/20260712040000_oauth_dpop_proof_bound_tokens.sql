alter table public.oauth_access_tokens
    add column if not exists token_binding_method text not null default 'bearer',
    add column if not exists dpop_jwk_thumbprint text,
    add column if not exists dpop_public_jwk jsonb not null default '{}'::jsonb,
    add column if not exists dpop_bound_at timestamptz,
    add column if not exists dpop_last_seen_at timestamptz;

alter table public.oauth_access_tokens
    drop constraint if exists oauth_access_tokens_binding_method_check,
    add constraint oauth_access_tokens_binding_method_check
        check (token_binding_method in ('bearer', 'dpop'));

alter table public.oauth_access_tokens
    drop constraint if exists oauth_access_tokens_dpop_binding_check,
    add constraint oauth_access_tokens_dpop_binding_check
        check (
            token_binding_method = 'bearer'
            or (
                token_binding_method = 'dpop'
                and dpop_jwk_thumbprint ~ '^[A-Za-z0-9_-]{43}$'
                and dpop_public_jwk <> '{}'::jsonb
                and dpop_bound_at is not null
            )
        );

create index if not exists idx_oauth_access_tokens_binding
    on public.oauth_access_tokens (tenant_id, token_binding_method, dpop_jwk_thumbprint, created_at desc);

create table if not exists public.oauth_dpop_proof_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    oauth_client_id uuid references public.oauth_clients(id) on delete set null,
    oauth_access_token_id uuid references public.oauth_access_tokens(id) on delete set null,
    proof_use text not null,
    proof_jti text not null,
    jwk_thumbprint text not null,
    http_method text not null,
    http_uri_hash text not null,
    access_token_hash text,
    proof_iat timestamptz,
    risk_level text not null default 'low',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint oauth_dpop_proof_events_unique_jti
        unique (tenant_id, jwk_thumbprint, proof_jti),
    constraint oauth_dpop_proof_events_use_check
        check (proof_use in ('token_request', 'resource_request')),
    constraint oauth_dpop_proof_events_risk_check
        check (risk_level in ('low', 'medium', 'high', 'critical')),
    constraint oauth_dpop_proof_events_hash_check
        check (
            jwk_thumbprint ~ '^[A-Za-z0-9_-]{43}$'
            and http_uri_hash ~ '^[a-f0-9]{64}$'
            and (access_token_hash is null or access_token_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_oauth_dpop_proof_events_token
    on public.oauth_dpop_proof_events (oauth_access_token_id, observed_at desc)
    where oauth_access_token_id is not null;

create index if not exists idx_oauth_dpop_proof_events_client
    on public.oauth_dpop_proof_events (oauth_client_id, proof_use, observed_at desc)
    where oauth_client_id is not null;

create index if not exists idx_oauth_dpop_proof_events_tenant_created
    on public.oauth_dpop_proof_events (tenant_id, created_at desc);

create index if not exists idx_oauth_dpop_proof_events_evidence_gin
    on public.oauth_dpop_proof_events using gin (evidence);

drop trigger if exists enforce_immutability_oauth_dpop_proof_events
    on public.oauth_dpop_proof_events;
create trigger enforce_immutability_oauth_dpop_proof_events
    before update or delete on public.oauth_dpop_proof_events
    for each row execute function public.prevent_oauth_trust_event_mutation();

alter table public.oauth_dpop_proof_events enable row level security;

drop policy if exists oauth_dpop_proof_events_select_tenant on public.oauth_dpop_proof_events;
create policy oauth_dpop_proof_events_select_tenant
    on public.oauth_dpop_proof_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists oauth_dpop_proof_events_insert_tenant on public.oauth_dpop_proof_events;
create policy oauth_dpop_proof_events_insert_tenant
    on public.oauth_dpop_proof_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_oauth_dpop_proof_events" on public.oauth_dpop_proof_events;
create policy "service_role_oauth_dpop_proof_events"
    on public.oauth_dpop_proof_events for all to service_role using (true) with check (true);

comment on column public.oauth_access_tokens.token_binding_method is
    'OAuth access token presentation binding. bearer tokens are ordinary bearer tokens; dpop tokens require a matching DPoP proof at resource access.';

comment on column public.oauth_access_tokens.dpop_jwk_thumbprint is
    'RFC7638 SHA-256 JWK thumbprint for DPoP-bound OAuth access tokens.';

comment on table public.oauth_dpop_proof_events is
    'Append-only DPoP proof ledger for OAuth token issuance and protected resource presentation. Unique tenant/key/jti records provide replay resistance evidence.';

notify pgrst, 'reload schema';
