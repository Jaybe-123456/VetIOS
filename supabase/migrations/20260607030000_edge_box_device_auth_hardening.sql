-- Edge Box device authentication hardening
-- Adds first-class, tenant-scoped device credentials with hashed tokens,
-- rotation/revocation state, expiry, and last-use telemetry.

create extension if not exists pgcrypto;

create table if not exists public.edge_box_device_credentials (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    edge_box_id uuid not null references public.edge_boxes(id) on delete cascade,
    key_prefix text not null,
    token_hash text not null,
    status text not null default 'active'
        check (status in ('active', 'rotated', 'revoked', 'expired')),
    issued_reason text not null default 'provisioning'
        check (issued_reason in ('provisioning', 'rotation', 'recovery')),
    scopes text[] not null default array['edge:heartbeat', 'edge:sync:pull', 'edge:sync:ack'],
    expires_at timestamptz,
    last_used_at timestamptz,
    last_used_action text,
    metadata jsonb not null default '{}'::jsonb,
    created_by text,
    revoked_by text,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists idx_edge_box_device_credentials_token_hash
    on public.edge_box_device_credentials (token_hash);

create unique index if not exists idx_edge_box_device_credentials_one_active
    on public.edge_box_device_credentials (edge_box_id)
    where status = 'active';

create index if not exists idx_edge_box_device_credentials_tenant_status
    on public.edge_box_device_credentials (tenant_id, status, updated_at desc);

create index if not exists idx_edge_box_device_credentials_edge_box
    on public.edge_box_device_credentials (tenant_id, edge_box_id, status, created_at desc);

drop trigger if exists set_updated_at_edge_box_device_credentials on public.edge_box_device_credentials;
create trigger set_updated_at_edge_box_device_credentials
    before update on public.edge_box_device_credentials
    for each row execute function public.trigger_set_updated_at();

alter table public.edge_box_device_credentials enable row level security;

drop policy if exists edge_box_device_credentials_select_own on public.edge_box_device_credentials;
create policy edge_box_device_credentials_select_own
    on public.edge_box_device_credentials
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_box_device_credentials_insert_own on public.edge_box_device_credentials;
create policy edge_box_device_credentials_insert_own
    on public.edge_box_device_credentials
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists edge_box_device_credentials_update_own on public.edge_box_device_credentials;
create policy edge_box_device_credentials_update_own
    on public.edge_box_device_credentials
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

-- Preserve live nodes after migration by lifting legacy metadata token hashes
-- into the credential ledger. Raw tokens never exist in the database.
insert into public.edge_box_device_credentials (
    tenant_id,
    edge_box_id,
    key_prefix,
    token_hash,
    status,
    issued_reason,
    expires_at,
    metadata,
    created_by,
    created_at,
    updated_at
)
select
    edge_boxes.tenant_id,
    edge_boxes.id,
    concat('legacy_', left(edge_boxes.metadata ->> 'edge_auth_token_hash', 8)),
    edge_boxes.metadata ->> 'edge_auth_token_hash',
    'active',
    'provisioning',
    now() + interval '180 days',
    jsonb_build_object(
        'migrated_from_edge_box_metadata', true,
        'sync_endpoint', coalesce(edge_boxes.metadata ->> 'sync_endpoint', '/api/edge-box/sync')
    ),
    edge_boxes.created_by,
    edge_boxes.created_at,
    now()
from public.edge_boxes
where edge_boxes.metadata ? 'edge_auth_token_hash'
  and nullif(edge_boxes.metadata ->> 'edge_auth_token_hash', '') is not null
  and not exists (
      select 1
      from public.edge_box_device_credentials existing
      where existing.edge_box_id = edge_boxes.id
        and existing.status = 'active'
  )
on conflict (token_hash) do nothing;

notify pgrst, 'reload schema';
