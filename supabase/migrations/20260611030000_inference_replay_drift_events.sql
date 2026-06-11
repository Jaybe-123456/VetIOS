-- VetIOS inference replay drift events
-- Append-only ledger for single-event deterministic replay checks.
-- Stores drift summaries and hashes only; raw clinical input/output is not duplicated here.

create extension if not exists pgcrypto;

create table if not exists public.inference_replay_events (
    id                          uuid primary key default gen_random_uuid(),
    tenant_id                   text not null,
    replay_request_id           uuid not null default gen_random_uuid(),
    source_inference_event_id   uuid not null references public.ai_inference_events(id) on delete restrict,
    source_request_id           uuid,

    replay_mode                 text not null default 'deterministic_core',
    replay_status               text not null,
    failure_reason              text,

    source_model_name           text,
    source_model_version        text,
    replay_model_name           text,
    replay_model_version        text,
    source_schema_version       text,
    replay_schema_version       text,
    source_ranker               text,
    replay_ranker               text,

    original_top_label          text,
    replay_top_label            text,
    original_confidence         double precision,
    replay_confidence           double precision,
    top_label_changed           boolean not null default false,
    confidence_delta            double precision,
    distribution_drift          double precision,

    latency_ms                  integer not null default 0,
    input_digest                text,
    original_output_digest      text,
    replay_output_digest        text,
    replay_summary              jsonb not null default '{}'::jsonb,

    created_at                  timestamptz not null default now(),

    constraint inference_replay_status_check
        check (replay_status in ('completed', 'failed')),
    constraint inference_replay_mode_check
        check (replay_mode in ('deterministic_core')),
    constraint inference_replay_source_ranker_check
        check (source_ranker is null or source_ranker in ('classical', 'quantum', 'hybrid')),
    constraint inference_replay_replay_ranker_check
        check (replay_ranker is null or replay_ranker in ('classical', 'quantum', 'hybrid')),
    constraint inference_replay_confidence_delta_check
        check (confidence_delta is null or confidence_delta >= 0),
    constraint inference_replay_distribution_drift_check
        check (distribution_drift is null or (distribution_drift >= 0 and distribution_drift <= 1)),
    constraint inference_replay_latency_check
        check (latency_ms >= 0),
    constraint inference_replay_input_digest_check
        check (input_digest is null or input_digest ~ '^[a-f0-9]{64}$'),
    constraint inference_replay_original_output_digest_check
        check (original_output_digest is null or original_output_digest ~ '^[a-f0-9]{64}$'),
    constraint inference_replay_replay_output_digest_check
        check (replay_output_digest is null or replay_output_digest ~ '^[a-f0-9]{64}$'),
    constraint inference_replay_summary_object_check
        check (jsonb_typeof(replay_summary) = 'object')
);

create or replace function public.prevent_inference_replay_events_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'inference replay events are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_inference_replay_events
    on public.inference_replay_events;

create trigger enforce_immutability_inference_replay_events
    before update or delete on public.inference_replay_events
    for each row execute function public.prevent_inference_replay_events_mutation();

create index if not exists idx_inference_replay_tenant_source
    on public.inference_replay_events (tenant_id, source_inference_event_id, created_at desc);

create index if not exists idx_inference_replay_tenant_status
    on public.inference_replay_events (tenant_id, replay_status, created_at desc);

create index if not exists idx_inference_replay_tenant_drift
    on public.inference_replay_events (tenant_id, distribution_drift desc nulls last, created_at desc);

alter table public.inference_replay_events enable row level security;

drop policy if exists "Tenant members can read inference replay events"
    on public.inference_replay_events;
create policy "Tenant members can read inference replay events"
    on public.inference_replay_events
    for select
    using (tenant_id = public.current_tenant_id()::text);

drop policy if exists "Tenant members can append inference replay events"
    on public.inference_replay_events;
create policy "Tenant members can append inference replay events"
    on public.inference_replay_events
    for insert
    with check (tenant_id = public.current_tenant_id()::text);

grant select, insert on public.inference_replay_events to authenticated;
grant select, insert on public.inference_replay_events to service_role;
revoke update, delete on public.inference_replay_events from anon, authenticated;

notify pgrst, 'reload schema';
