-- =============================================================================
-- Migration 038: Transactional Outbox Operations
-- Production-grade scheduled dispatch, retry control, and dead-letter recovery
-- =============================================================================

create extension if not exists pgcrypto;

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
    tenant_id text not null default 'outbox_system',
    aggregate_type text,
    aggregate_id text,
    event_name text,
    topic text not null default 'OUTBOX_EVENT',
    handler_key text not null default 'passive_signal_reconcile',
    target_type text not null default 'internal_task',
    target_ref text,
    idempotency_key text,
    payload jsonb not null default '{}'::jsonb,
    headers jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    attempt_count integer not null default 0,
    max_attempts integer not null default 5,
    last_attempted_at timestamptz,
    next_retry_at timestamptz,
    leased_until timestamptz,
    leased_by text,
    available_at timestamptz,
    locked_at timestamptz,
    locked_by text,
    error_detail text,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    delivered_at timestamptz
);

alter table public.outbox_events
    add column if not exists tenant_id text,
    add column if not exists aggregate_type text,
    add column if not exists aggregate_id text,
    add column if not exists event_name text,
    add column if not exists topic text,
    add column if not exists handler_key text,
    add column if not exists target_type text,
    add column if not exists target_ref text,
    add column if not exists idempotency_key text,
    add column if not exists payload jsonb not null default '{}'::jsonb,
    add column if not exists headers jsonb not null default '{}'::jsonb,
    add column if not exists metadata jsonb not null default '{}'::jsonb,
    add column if not exists status text not null default 'pending',
    add column if not exists attempt_count integer not null default 0,
    add column if not exists max_attempts integer not null default 5,
    add column if not exists last_attempted_at timestamptz,
    add column if not exists next_retry_at timestamptz,
    add column if not exists leased_until timestamptz,
    add column if not exists leased_by text,
    add column if not exists available_at timestamptz,
    add column if not exists locked_at timestamptz,
    add column if not exists locked_by text,
    add column if not exists error_detail text,
    add column if not exists last_error text,
    add column if not exists delivered_at timestamptz,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

alter table public.outbox_events
    alter column tenant_id set default 'outbox_system',
    alter column topic set default 'OUTBOX_EVENT',
    alter column handler_key set default 'passive_signal_reconcile',
    alter column target_type set default 'internal_task',
    alter column payload set default '{}'::jsonb,
    alter column headers set default '{}'::jsonb,
    alter column metadata set default '{}'::jsonb,
    alter column status set default 'pending',
    alter column attempt_count set default 0,
    alter column max_attempts set default 5,
    alter column created_at set default now(),
    alter column updated_at set default now();

update public.outbox_events
set
    tenant_id = coalesce(nullif(tenant_id, ''), 'outbox_system'),
    topic = coalesce(nullif(topic, ''), coalesce(event_name, 'OUTBOX_EVENT')),
    handler_key = coalesce(nullif(handler_key, ''), 'passive_signal_reconcile'),
    target_type = coalesce(nullif(target_type, ''), 'internal_task'),
    payload = coalesce(payload, '{}'::jsonb),
    headers = coalesce(headers, '{}'::jsonb),
    metadata = coalesce(metadata, '{}'::jsonb),
    status = coalesce(nullif(status, ''), 'pending'),
    attempt_count = coalesce(attempt_count, 0),
    max_attempts = greatest(coalesce(max_attempts, 5), 1),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now())
where
    tenant_id is null
    or topic is null
    or handler_key is null
    or target_type is null
    or payload is null
    or headers is null
    or metadata is null
    or status is null
    or attempt_count is null
    or max_attempts is null
    or created_at is null
    or updated_at is null;

do $$
begin
    if exists (
        select 1
        from pg_constraint
        where conname = 'outbox_events_status_check'
          and conrelid = 'public.outbox_events'::regclass
    ) then
        alter table public.outbox_events drop constraint outbox_events_status_check;
    end if;
end $$;

alter table public.outbox_events
    add constraint outbox_events_status_check
    check (status in ('pending', 'processing', 'retryable', 'dead_letter', 'delivered'));

create index if not exists idx_outbox_events_status_next_retry_at
    on public.outbox_events (status, next_retry_at);

create index if not exists idx_outbox_events_leased_until
    on public.outbox_events (leased_until);

create index if not exists idx_outbox_events_aggregate_lookup
    on public.outbox_events (aggregate_type, aggregate_id);

create table if not exists public.outbox_delivery_attempts (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.outbox_events(id) on delete cascade,
    attempted_at timestamptz not null default now(),
    success boolean not null,
    status_code integer,
    response_body text,
    error_detail text,
    duration_ms integer
);

create index if not exists idx_outbox_delivery_attempts_event_id
    on public.outbox_delivery_attempts (event_id);

drop trigger if exists set_updated_at_outbox_events on public.outbox_events;
create trigger set_updated_at_outbox_events
    before update on public.outbox_events
    for each row execute function public.trigger_set_updated_at();

create or replace function public.lease_transactional_outbox_events(
    p_batch_size integer default 25,
    p_worker_id text default 'outbox-worker',
    p_lease_duration_ms integer default 60000
)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := now();
    v_lease_until timestamptz := v_now + make_interval(secs => greatest(1, p_lease_duration_ms / 1000));
begin
    return query
    with candidates as (
        select e.id
        from public.outbox_events e
        where e.aggregate_type is not null
          and e.event_name is not null
          and e.status in ('pending', 'retryable')
          and coalesce(e.next_retry_at, e.available_at, e.created_at, v_now) <= v_now
          and (e.leased_until is null or e.leased_until <= v_now)
        order by e.created_at asc
        for update skip locked
        limit greatest(1, coalesce(p_batch_size, 25))
    ),
    updated as (
        update public.outbox_events e
        set
            status = 'processing',
            attempt_count = coalesce(e.attempt_count, 0) + 1,
            last_attempted_at = v_now,
            leased_until = v_lease_until,
            leased_by = p_worker_id,
            available_at = null,
            locked_at = v_now,
            locked_by = p_worker_id
        from candidates c
        where e.id = c.id
        returning e.*
    )
    select * from updated;
end;
$$;

grant execute on function public.lease_transactional_outbox_events(integer, text, integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
