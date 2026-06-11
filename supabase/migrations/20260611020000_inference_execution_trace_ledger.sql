-- VetIOS inference execution trace ledger
-- Append-only infrastructure audit trail for clinical inference runs.
-- Stores operational lineage only: no raw symptoms, patient names, owner data, notes, or clinical narratives.

create extension if not exists pgcrypto;

create table if not exists public.inference_execution_trace_events (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           text not null,
    request_id          uuid not null,
    trace_id            uuid not null,
    inference_event_id  uuid references public.ai_inference_events(id) on delete set null,

    stage_key           text not null,
    stage_label         text not null,
    stage_status        text not null,
    started_at          timestamptz not null,
    completed_at        timestamptz not null default now(),
    latency_ms          integer not null default 0,

    source_module       text not null default 'clinical_api',
    model_name          text,
    model_version       text,
    provider_name       text,
    ranker              text,
    schema_version      text,

    input_digest        text,
    output_digest       text,
    stage_metadata      jsonb not null default '{}'::jsonb,

    created_at          timestamptz not null default now(),

    constraint inference_execution_trace_stage_key_check
        check (length(trim(stage_key)) > 0),
    constraint inference_execution_trace_stage_label_check
        check (length(trim(stage_label)) > 0),
    constraint inference_execution_trace_stage_status_check
        check (stage_status in ('completed', 'skipped', 'failed')),
    constraint inference_execution_trace_latency_check
        check (latency_ms >= 0),
    constraint inference_execution_trace_ranker_check
        check (ranker is null or ranker in ('classical', 'quantum', 'hybrid')),
    constraint inference_execution_trace_input_digest_check
        check (input_digest is null or input_digest ~ '^[a-f0-9]{64}$'),
    constraint inference_execution_trace_output_digest_check
        check (output_digest is null or output_digest ~ '^[a-f0-9]{64}$'),
    constraint inference_execution_trace_metadata_object_check
        check (jsonb_typeof(stage_metadata) = 'object')
);

create or replace function public.prevent_inference_execution_trace_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'inference execution trace ledger is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_inference_execution_trace_events
    on public.inference_execution_trace_events;

create trigger enforce_immutability_inference_execution_trace_events
    before update or delete on public.inference_execution_trace_events
    for each row execute function public.prevent_inference_execution_trace_mutation();

create index if not exists idx_inference_trace_tenant_request
    on public.inference_execution_trace_events (tenant_id, request_id, created_at desc);

create index if not exists idx_inference_trace_event
    on public.inference_execution_trace_events (tenant_id, inference_event_id, created_at asc)
    where inference_event_id is not null;

create index if not exists idx_inference_trace_stage
    on public.inference_execution_trace_events (tenant_id, stage_key, created_at desc);

create index if not exists idx_inference_trace_status
    on public.inference_execution_trace_events (tenant_id, stage_status, created_at desc);

alter table public.inference_execution_trace_events enable row level security;

drop policy if exists "Tenant members can read inference trace events"
    on public.inference_execution_trace_events;
create policy "Tenant members can read inference trace events"
    on public.inference_execution_trace_events
    for select
    using (tenant_id = public.current_tenant_id()::text);

drop policy if exists "Tenant members can append inference trace events"
    on public.inference_execution_trace_events;
create policy "Tenant members can append inference trace events"
    on public.inference_execution_trace_events
    for insert
    with check (tenant_id = public.current_tenant_id()::text);

grant select, insert on public.inference_execution_trace_events to authenticated;
grant select, insert on public.inference_execution_trace_events to service_role;
revoke update, delete on public.inference_execution_trace_events from anon, authenticated;

notify pgrst, 'reload schema';
