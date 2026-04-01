-- Migration: Durable Event Outbox
-- Description: Adds a durable outbox, delivery-attempt tracking,
-- and atomic leasing for background event workers.

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

create table if not exists public.outbox_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    topic text not null,
    handler_key text not null,
    target_type text not null default 'internal_task' check (target_type in ('internal_task', 'connector_webhook')),
    target_ref text,
    idempotency_key text,
    payload jsonb not null default '{}'::jsonb,
    headers jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    status text not null default 'pending' check (status in ('pending', 'processing', 'retryable', 'delivered', 'dead_letter')),
    attempt_count integer not null default 0 check (attempt_count >= 0),
    max_attempts integer not null default 6 check (max_attempts > 0),
    available_at timestamptz not null default now(),
    locked_at timestamptz,
    locked_by text,
    last_error text,
    delivered_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.connector_delivery_attempts (
    id uuid primary key default gen_random_uuid(),
    outbox_event_id uuid not null references public.outbox_events(id) on delete cascade,
    tenant_id text not null,
    connector_installation_id uuid references public.connector_installations(id) on delete set null,
    handler_key text not null,
    attempt_no integer not null check (attempt_no > 0),
    worker_id text,
    status text not null check (status in ('processing', 'succeeded', 'retryable', 'dead_letter')),
    request_payload jsonb not null default '{}'::jsonb,
    response_payload jsonb not null default '{}'::jsonb,
    error_message text,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    created_at timestamptz not null default now()
);

create unique index if not exists idx_outbox_events_tenant_idempotency
    on public.outbox_events (tenant_id, idempotency_key)
    where idempotency_key is not null;

create index if not exists idx_outbox_events_dispatch
    on public.outbox_events (status, available_at, created_at);

create index if not exists idx_outbox_events_tenant_dispatch
    on public.outbox_events (tenant_id, status, available_at, created_at desc);

create index if not exists idx_outbox_events_handler_dispatch
    on public.outbox_events (handler_key, status, available_at, created_at desc);

create index if not exists idx_connector_delivery_attempts_event_attempt
    on public.connector_delivery_attempts (outbox_event_id, attempt_no desc);

create index if not exists idx_connector_delivery_attempts_tenant_status
    on public.connector_delivery_attempts (tenant_id, status, created_at desc);

drop trigger if exists set_updated_at_outbox_events on public.outbox_events;
create trigger set_updated_at_outbox_events
    before update on public.outbox_events
    for each row execute function public.trigger_set_updated_at();

create or replace function public.lease_outbox_events(
    p_worker_id text,
    p_batch_size integer default 20,
    p_topics text[] default null,
    p_tenant_id text default null
)
returns setof public.outbox_events
language plpgsql
security definer
as $$
begin
    return query
    with candidates as (
        select e.id
        from public.outbox_events e
        where e.status in ('pending', 'retryable')
          and e.available_at <= now()
          and (e.locked_at is null or e.locked_at < now() - interval '5 minutes')
          and (p_tenant_id is null or e.tenant_id = p_tenant_id)
          and (
              p_topics is null
              or cardinality(p_topics) = 0
              or e.topic = any(p_topics)
          )
        order by e.available_at asc, e.created_at asc
        limit greatest(coalesce(p_batch_size, 20), 1)
        for update skip locked
    )
    update public.outbox_events e
    set status = 'processing',
        locked_at = now(),
        locked_by = coalesce(nullif(p_worker_id, ''), 'outbox-worker'),
        attempt_count = e.attempt_count + 1,
        updated_at = now()
    from candidates
    where e.id = candidates.id
    returning e.*;
end;
$$;

alter table public.outbox_events enable row level security;
alter table public.connector_delivery_attempts enable row level security;

drop policy if exists outbox_events_select_own on public.outbox_events;
create policy outbox_events_select_own
    on public.outbox_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists outbox_events_insert_own on public.outbox_events;
create policy outbox_events_insert_own
    on public.outbox_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists outbox_events_update_own on public.outbox_events;
create policy outbox_events_update_own
    on public.outbox_events
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists connector_delivery_attempts_select_own on public.connector_delivery_attempts;
create policy connector_delivery_attempts_select_own
    on public.connector_delivery_attempts
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists connector_delivery_attempts_insert_own on public.connector_delivery_attempts;
create policy connector_delivery_attempts_insert_own
    on public.connector_delivery_attempts
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists connector_delivery_attempts_update_own on public.connector_delivery_attempts;
create policy connector_delivery_attempts_update_own
    on public.connector_delivery_attempts
    for update
    using (tenant_id = public.current_tenant_id()::text)
    with check (tenant_id = public.current_tenant_id()::text);

notify pgrst, 'reload schema';
