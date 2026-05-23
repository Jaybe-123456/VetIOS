create extension if not exists pgcrypto;

create table if not exists public.outbox_events (
    id uuid primary key default gen_random_uuid(),
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    attempt_count int not null default 0,
    created_at timestamptz not null default now(),
    delivered_at timestamptz,
    error_detail text
);

alter table public.outbox_events
    add column if not exists event_type text,
    add column if not exists payload jsonb not null default '{}'::jsonb,
    add column if not exists status text not null default 'pending',
    add column if not exists attempt_count int not null default 0,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists delivered_at timestamptz,
    add column if not exists error_detail text;

update public.outbox_events e
set event_type = coalesce(
    nullif(e.event_type, ''),
    nullif(to_jsonb(e)->>'topic', ''),
    nullif(to_jsonb(e)->>'event_name', ''),
    nullif(to_jsonb(e)->>'aggregate_type', ''),
    nullif(to_jsonb(e)->>'handler_key', ''),
    'unknown_event'
)
where e.event_type is null or e.event_type = '';

alter table public.outbox_events
    alter column event_type set not null,
    alter column payload set default '{}'::jsonb,
    alter column payload set not null,
    alter column status set default 'pending',
    alter column status set not null,
    alter column attempt_count set default 0,
    alter column attempt_count set not null,
    alter column created_at set default now(),
    alter column created_at set not null;

alter table public.outbox_events
    drop constraint if exists outbox_events_status_check;

alter table public.outbox_events
    drop constraint if exists outbox_events_status_core_check;

alter table public.outbox_events
    add constraint outbox_events_status_core_check
    check (status in ('pending', 'processing', 'retryable', 'delivered', 'dead_letter', 'dead_lettered'));

create index if not exists idx_outbox_events_status_created_at
    on public.outbox_events (status, created_at);

notify pgrst, 'reload schema';
