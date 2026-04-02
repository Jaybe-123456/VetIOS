-- Migration: PetPass Network Plane
-- Description: Adds owner accounts, pet profiles, clinic-owner links,
-- consents, preferences, timeline entries, and notification deliveries.

create extension if not exists pgcrypto;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'current_tenant_id'
    ) then
        execute $fn$
            create function public.current_tenant_id()
            returns uuid
            language sql
            stable
            as $inner$
                select coalesce(
                    nullif(current_setting('app.tenant_id', true), '')::uuid,
                    auth.uid()
                )
            $inner$;
        $fn$;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'trigger_set_updated_at'
    ) then
        execute $fn$
            create function public.trigger_set_updated_at()
            returns trigger
            language plpgsql
            as $inner$
            begin
                new.updated_at = now();
                return new;
            end;
            $inner$;
        $fn$;
    end if;
end $$;

create table if not exists public.owner_accounts (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    external_owner_ref text,
    full_name text not null,
    preferred_name text,
    email text,
    phone text,
    status text not null default 'active' check (status in ('invited', 'active', 'inactive')),
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    last_active_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.petpass_pet_profiles (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    patient_id text,
    pet_name text not null,
    species text,
    breed text,
    age_display text,
    sex text,
    risk_state text not null default 'stable' check (risk_state in ('stable', 'watch', 'urgent')),
    clinic_id text,
    clinic_name text,
    latest_case_id text,
    latest_episode_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.owner_pet_links (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    owner_account_id uuid not null references public.owner_accounts(id) on delete cascade,
    pet_profile_id uuid not null references public.petpass_pet_profiles(id) on delete cascade,
    relationship_type text not null default 'owner',
    primary_owner boolean not null default false,
    status text not null default 'active' check (status in ('invited', 'active', 'inactive')),
    linked_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint owner_pet_links_unique unique (tenant_id, owner_account_id, pet_profile_id)
);

create table if not exists public.clinic_owner_links (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    owner_account_id uuid not null references public.owner_accounts(id) on delete cascade,
    clinic_id text,
    clinic_name text not null,
    status text not null default 'active' check (status in ('invited', 'active', 'paused', 'revoked')),
    invite_token text,
    invite_expires_at timestamptz,
    linked_by text,
    linked_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.petpass_consents (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    owner_account_id uuid not null references public.owner_accounts(id) on delete cascade,
    pet_profile_id uuid references public.petpass_pet_profiles(id) on delete cascade,
    consent_type text not null,
    status text not null default 'granted' check (status in ('pending', 'granted', 'revoked')),
    granted_at timestamptz,
    revoked_at timestamptz,
    expires_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.petpass_notification_preferences (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    owner_account_id uuid not null references public.owner_accounts(id) on delete cascade,
    pet_profile_id uuid references public.petpass_pet_profiles(id) on delete cascade,
    channel text not null check (channel in ('sms', 'email', 'push')),
    notification_type text not null,
    enabled boolean not null default true,
    quiet_hours jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint petpass_notification_preferences_unique unique (tenant_id, owner_account_id, pet_profile_id, channel, notification_type)
);

create table if not exists public.petpass_timeline_entries (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    owner_account_id uuid references public.owner_accounts(id) on delete set null,
    pet_profile_id uuid not null references public.petpass_pet_profiles(id) on delete cascade,
    clinic_owner_link_id uuid references public.clinic_owner_links(id) on delete set null,
    entry_type text not null check (entry_type in ('visit', 'result', 'medication', 'alert', 'message', 'referral')),
    title text not null,
    detail text not null,
    occurred_at timestamptz not null default now(),
    visibility text not null default 'owner_safe' check (visibility in ('owner_safe', 'internal')),
    source_module text,
    source_record_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.petpass_notification_deliveries (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    owner_account_id uuid not null references public.owner_accounts(id) on delete cascade,
    pet_profile_id uuid references public.petpass_pet_profiles(id) on delete set null,
    timeline_entry_id uuid references public.petpass_timeline_entries(id) on delete set null,
    channel text not null check (channel in ('sms', 'email', 'push')),
    notification_type text not null,
    title text not null,
    body text not null,
    delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'failed', 'canceled')),
    scheduled_at timestamptz not null default now(),
    delivered_at timestamptz,
    error_message text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_owner_accounts_tenant_status
    on public.owner_accounts (tenant_id, status, updated_at desc);

create index if not exists idx_petpass_pet_profiles_tenant_clinic
    on public.petpass_pet_profiles (tenant_id, clinic_name, updated_at desc);

create index if not exists idx_owner_pet_links_tenant_pet
    on public.owner_pet_links (tenant_id, pet_profile_id, status, updated_at desc);

create index if not exists idx_clinic_owner_links_tenant_owner
    on public.clinic_owner_links (tenant_id, owner_account_id, status, updated_at desc);

create index if not exists idx_petpass_consents_tenant_owner
    on public.petpass_consents (tenant_id, owner_account_id, created_at desc);

create index if not exists idx_petpass_notification_preferences_tenant_owner
    on public.petpass_notification_preferences (tenant_id, owner_account_id, updated_at desc);

create index if not exists idx_petpass_timeline_entries_tenant_pet
    on public.petpass_timeline_entries (tenant_id, pet_profile_id, occurred_at desc);

create index if not exists idx_petpass_notification_deliveries_tenant_owner
    on public.petpass_notification_deliveries (tenant_id, owner_account_id, scheduled_at desc);

drop trigger if exists set_updated_at_owner_accounts on public.owner_accounts;
create trigger set_updated_at_owner_accounts
    before update on public.owner_accounts
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_petpass_pet_profiles on public.petpass_pet_profiles;
create trigger set_updated_at_petpass_pet_profiles
    before update on public.petpass_pet_profiles
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_owner_pet_links on public.owner_pet_links;
create trigger set_updated_at_owner_pet_links
    before update on public.owner_pet_links
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_clinic_owner_links on public.clinic_owner_links;
create trigger set_updated_at_clinic_owner_links
    before update on public.clinic_owner_links
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_petpass_consents on public.petpass_consents;
create trigger set_updated_at_petpass_consents
    before update on public.petpass_consents
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_petpass_notification_preferences on public.petpass_notification_preferences;
create trigger set_updated_at_petpass_notification_preferences
    before update on public.petpass_notification_preferences
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_updated_at_petpass_notification_deliveries on public.petpass_notification_deliveries;
create trigger set_updated_at_petpass_notification_deliveries
    before update on public.petpass_notification_deliveries
    for each row execute function public.trigger_set_updated_at();

alter table public.owner_accounts enable row level security;
alter table public.petpass_pet_profiles enable row level security;
alter table public.owner_pet_links enable row level security;
alter table public.clinic_owner_links enable row level security;
alter table public.petpass_consents enable row level security;
alter table public.petpass_notification_preferences enable row level security;
alter table public.petpass_timeline_entries enable row level security;
alter table public.petpass_notification_deliveries enable row level security;

drop policy if exists owner_accounts_select_own on public.owner_accounts;
create policy owner_accounts_select_own
    on public.owner_accounts
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists owner_accounts_insert_own on public.owner_accounts;
create policy owner_accounts_insert_own
    on public.owner_accounts
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists owner_accounts_update_own on public.owner_accounts;
create policy owner_accounts_update_own
    on public.owner_accounts
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_pet_profiles_select_own on public.petpass_pet_profiles;
create policy petpass_pet_profiles_select_own
    on public.petpass_pet_profiles
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_pet_profiles_insert_own on public.petpass_pet_profiles;
create policy petpass_pet_profiles_insert_own
    on public.petpass_pet_profiles
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_pet_profiles_update_own on public.petpass_pet_profiles;
create policy petpass_pet_profiles_update_own
    on public.petpass_pet_profiles
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists owner_pet_links_select_own on public.owner_pet_links;
create policy owner_pet_links_select_own
    on public.owner_pet_links
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists owner_pet_links_insert_own on public.owner_pet_links;
create policy owner_pet_links_insert_own
    on public.owner_pet_links
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists owner_pet_links_update_own on public.owner_pet_links;
create policy owner_pet_links_update_own
    on public.owner_pet_links
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists clinic_owner_links_select_own on public.clinic_owner_links;
create policy clinic_owner_links_select_own
    on public.clinic_owner_links
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists clinic_owner_links_insert_own on public.clinic_owner_links;
create policy clinic_owner_links_insert_own
    on public.clinic_owner_links
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists clinic_owner_links_update_own on public.clinic_owner_links;
create policy clinic_owner_links_update_own
    on public.clinic_owner_links
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_consents_select_own on public.petpass_consents;
create policy petpass_consents_select_own
    on public.petpass_consents
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_consents_insert_own on public.petpass_consents;
create policy petpass_consents_insert_own
    on public.petpass_consents
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_consents_update_own on public.petpass_consents;
create policy petpass_consents_update_own
    on public.petpass_consents
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_notification_preferences_select_own on public.petpass_notification_preferences;
create policy petpass_notification_preferences_select_own
    on public.petpass_notification_preferences
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_notification_preferences_insert_own on public.petpass_notification_preferences;
create policy petpass_notification_preferences_insert_own
    on public.petpass_notification_preferences
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_notification_preferences_update_own on public.petpass_notification_preferences;
create policy petpass_notification_preferences_update_own
    on public.petpass_notification_preferences
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_timeline_entries_select_own on public.petpass_timeline_entries;
create policy petpass_timeline_entries_select_own
    on public.petpass_timeline_entries
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_timeline_entries_insert_own on public.petpass_timeline_entries;
create policy petpass_timeline_entries_insert_own
    on public.petpass_timeline_entries
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_notification_deliveries_select_own on public.petpass_notification_deliveries;
create policy petpass_notification_deliveries_select_own
    on public.petpass_notification_deliveries
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_notification_deliveries_insert_own on public.petpass_notification_deliveries;
create policy petpass_notification_deliveries_insert_own
    on public.petpass_notification_deliveries
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists petpass_notification_deliveries_update_own on public.petpass_notification_deliveries;
create policy petpass_notification_deliveries_update_own
    on public.petpass_notification_deliveries
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
