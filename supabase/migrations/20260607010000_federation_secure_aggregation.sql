-- Federated secure aggregation contribution ledger
-- Stores masked contribution commitments for federation rounds so the
-- coordinator can audit participation without persisting raw per-site deltas.

create extension if not exists pgcrypto;

create table if not exists public.federated_secure_aggregation_contributions (
    id uuid primary key default gen_random_uuid(),
    federation_round_id uuid not null references public.federation_rounds(id) on delete cascade,
    federation_key text not null,
    coordinator_tenant_id text not null,
    tenant_id text not null,
    participant_ref text not null,
    contribution_role text not null check (contribution_role in ('diagnosis', 'severity', 'support')),
    masking_protocol text not null default 'pairwise_masked_commitment_v1',
    payload_commitment_hash text not null,
    mask_commitment_hash text not null,
    masked_payload_summary jsonb not null default '{}'::jsonb,
    public_summary jsonb not null default '{}'::jsonb,
    accepted_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint federated_secure_contributions_unique
        unique (federation_round_id, tenant_id, contribution_role)
);

create index if not exists idx_federated_secure_contributions_round
    on public.federated_secure_aggregation_contributions (federation_round_id, contribution_role, created_at desc);

create index if not exists idx_federated_secure_contributions_tenant
    on public.federated_secure_aggregation_contributions (tenant_id, federation_key, created_at desc);

create index if not exists idx_federated_secure_contributions_participant_ref
    on public.federated_secure_aggregation_contributions (federation_key, participant_ref);

alter table public.federated_secure_aggregation_contributions enable row level security;

drop policy if exists federated_secure_contributions_select_participant on public.federated_secure_aggregation_contributions;
create policy federated_secure_contributions_select_participant
    on public.federated_secure_aggregation_contributions
    for select using (
        coordinator_tenant_id = public.current_tenant_id()::text
        or tenant_id = public.current_tenant_id()::text
    );

drop policy if exists federated_secure_contributions_insert_participant on public.federated_secure_aggregation_contributions;
create policy federated_secure_contributions_insert_participant
    on public.federated_secure_aggregation_contributions
    for insert with check (
        coordinator_tenant_id = public.current_tenant_id()::text
        or tenant_id = public.current_tenant_id()::text
    );

notify pgrst, 'reload schema';
