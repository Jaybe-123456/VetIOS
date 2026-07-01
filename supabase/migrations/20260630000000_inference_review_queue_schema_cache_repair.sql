-- Repair/reload the inference review queue table for environments where the
-- original queue migration was not applied or PostgREST still has a stale schema cache.

create extension if not exists pgcrypto;

create table if not exists public.inference_review_queue_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    inference_event_id uuid not null,
    actionability_gate_event_id uuid,
    request_id text,
    case_id uuid,
    review_status text not null default 'queued',
    severity text not null default 'review',
    review_reason text not null,
    source text not null default 'actionability_gate',
    top_label text,
    top_confidence double precision not null default 0,
    phi_hat double precision not null default 0,
    actionability_score double precision not null default 0,
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    recommended_next_step text,
    reviewer_note text,
    created_by text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint inference_review_queue_status_check
        check (review_status in ('queued', 'acknowledged', 'resolved', 'dismissed')),
    constraint inference_review_queue_severity_check
        check (severity in ('routine', 'review', 'urgent', 'critical')),
    constraint inference_review_queue_top_confidence_check
        check (top_confidence >= 0 and top_confidence <= 1),
    constraint inference_review_queue_phi_hat_check
        check (phi_hat >= 0 and phi_hat <= 1),
    constraint inference_review_queue_actionability_score_check
        check (actionability_score >= 0 and actionability_score <= 1)
);

do $$
begin
    if to_regclass('public.ai_inference_events') is not null
       and not exists (
            select 1 from pg_constraint
            where conname = 'inference_review_queue_events_inference_event_id_fkey'
       ) then
        alter table public.inference_review_queue_events
            add constraint inference_review_queue_events_inference_event_id_fkey
            foreign key (inference_event_id)
            references public.ai_inference_events(id)
            on delete cascade;
    end if;

    if to_regclass('public.inference_actionability_gate_events') is not null
       and not exists (
            select 1 from pg_constraint
            where conname = 'inference_review_queue_events_actionability_gate_event_id_fkey'
       ) then
        alter table public.inference_review_queue_events
            add constraint inference_review_queue_events_actionability_gate_event_id_fkey
            foreign key (actionability_gate_event_id)
            references public.inference_actionability_gate_events(id)
            on delete set null;
    end if;
end $$;

create or replace function public.prevent_inference_review_queue_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'inference review queue events are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_inference_review_queue_events
    on public.inference_review_queue_events;

create trigger enforce_immutability_inference_review_queue_events
    before update or delete on public.inference_review_queue_events
    for each row execute function public.prevent_inference_review_queue_mutation();

create index if not exists inference_review_queue_tenant_event_created_idx
    on public.inference_review_queue_events (tenant_id, inference_event_id, created_at desc);

create index if not exists inference_review_queue_tenant_status_created_idx
    on public.inference_review_queue_events (tenant_id, review_status, created_at desc);

create index if not exists inference_review_queue_tenant_severity_created_idx
    on public.inference_review_queue_events (tenant_id, severity, created_at desc);

create index if not exists inference_review_queue_tenant_label_created_idx
    on public.inference_review_queue_events (tenant_id, top_label, created_at desc)
    where top_label is not null;

alter table public.inference_review_queue_events enable row level security;

drop policy if exists "service_role_inference_review_queue_events"
    on public.inference_review_queue_events;

create policy "service_role_inference_review_queue_events"
    on public.inference_review_queue_events
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.inference_review_queue_events to service_role;
revoke update, delete on public.inference_review_queue_events from anon, authenticated;

comment on table public.inference_review_queue_events is
    'Append-only review queue for inference actionability decisions that require licensed clinician review, evidence hold, or suppression follow-up.';

notify pgrst, 'reload schema';
