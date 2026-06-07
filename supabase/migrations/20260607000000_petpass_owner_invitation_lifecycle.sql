-- PetPass owner invitation lifecycle
-- Adds one-time hashed invitations and owner activation markers for the
-- consumer PetPass moat. Raw invite tokens are returned once by the app and
-- are never stored in the database.

create extension if not exists pgcrypto;

alter table public.owner_accounts
    add column if not exists consumer_identity_hash text,
    add column if not exists consumer_auth_provider text,
    add column if not exists consumer_activated_at timestamptz,
    add column if not exists consumer_last_seen_at timestamptz;

create table if not exists public.petpass_owner_invitations (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    owner_account_id uuid not null references public.owner_accounts(id) on delete cascade,
    pet_profile_id uuid references public.petpass_pet_profiles(id) on delete cascade,
    clinic_owner_link_id uuid references public.clinic_owner_links(id) on delete set null,
    token_hash text not null unique,
    invite_url text not null,
    delivery_channel text not null default 'link' check (delivery_channel in ('link', 'email', 'sms')),
    delivery_address_hash text,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
    expires_at timestamptz not null default now() + interval '14 days',
    accepted_at timestamptz,
    accepted_identity_hash text,
    accepted_user_agent_hash text,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_owner_accounts_consumer_identity
    on public.owner_accounts (consumer_identity_hash)
    where consumer_identity_hash is not null;

create index if not exists idx_petpass_owner_invitations_tenant_status
    on public.petpass_owner_invitations (tenant_id, status, expires_at desc);

create index if not exists idx_petpass_owner_invitations_owner
    on public.petpass_owner_invitations (tenant_id, owner_account_id, created_at desc);

create index if not exists idx_petpass_owner_invitations_pet
    on public.petpass_owner_invitations (tenant_id, pet_profile_id, created_at desc)
    where pet_profile_id is not null;

drop trigger if exists set_updated_at_petpass_owner_invitations on public.petpass_owner_invitations;
create trigger set_updated_at_petpass_owner_invitations
    before update on public.petpass_owner_invitations
    for each row execute function public.trigger_set_updated_at();

alter table public.petpass_owner_invitations enable row level security;

drop policy if exists petpass_owner_invitations_select_own on public.petpass_owner_invitations;
create policy petpass_owner_invitations_select_own
    on public.petpass_owner_invitations
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_owner_invitations_insert_own on public.petpass_owner_invitations;
create policy petpass_owner_invitations_insert_own
    on public.petpass_owner_invitations
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_owner_invitations_update_own on public.petpass_owner_invitations;
create policy petpass_owner_invitations_update_own
    on public.petpass_owner_invitations
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
