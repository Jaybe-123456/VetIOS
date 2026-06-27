create extension if not exists pgcrypto;

create table if not exists public.specialist_review_operation_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    specialist_review_event_id uuid references public.specialist_review_events(id) on delete set null,
    ask_vetios_query_id uuid references public.ask_vetios_queries(id) on delete set null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    clinical_outcome_id uuid references public.clinical_outcome_events(id) on delete set null,
    reviewer_route text not null,
    specialty text,
    urgency_level text not null,
    queue_status text not null,
    operations_score numeric(5, 4) not null default 0,
    assignment_status text not null,
    assigned_reviewer_ref text,
    candidate_reviewer_count integer not null default 0,
    sla_minutes integer not null default 0,
    due_at timestamptz not null,
    minutes_until_due integer not null default 0,
    overdue boolean not null default false,
    pacs_required boolean not null default false,
    pacs_status text not null,
    pacs_upload_required boolean not null default false,
    pacs_link_required boolean not null default false,
    report_status text not null,
    final_report_ready boolean not null default false,
    closure_ready boolean not null default false,
    learning_eligible boolean not null default false,
    operation_digest text not null,
    packet_hash text not null,
    evidence_pack_hash text not null,
    corrections_hash text not null,
    annotations_hash text not null,
    deidentified_report_hash text not null,
    operations_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    next_actions text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint specialist_review_operation_events_tenant_request_key unique (tenant_id, request_id),
    constraint specialist_review_operation_events_route_check
        check (reviewer_route in (
            'none',
            'primary_clinician',
            'emergency_veterinarian',
            'internal_medicine',
            'diagnostic_imaging',
            'toxicology',
            'cardiology',
            'neurology',
            'oncology',
            'surgery',
            'dermatology',
            'ophthalmology',
            'anesthesia',
            'pathology'
        )),
    constraint specialist_review_operation_events_urgency_check
        check (urgency_level in ('routine', 'priority', 'urgent', 'emergency')),
    constraint specialist_review_operation_events_queue_status_check
        check (queue_status in (
            'blocked',
            'awaiting_pacs',
            'ready_for_assignment',
            'assigned',
            'in_review',
            'report_ready',
            'closure_ready',
            'learning_ready',
            'overdue'
        )),
    constraint specialist_review_operation_events_assignment_check
        check (assignment_status in ('not_required', 'needs_assignment', 'assigned', 'blocked')),
    constraint specialist_review_operation_events_pacs_status_check
        check (pacs_status in ('not_applicable', 'pending', 'linked', 'unavailable')),
    constraint specialist_review_operation_events_report_status_check
        check (report_status in ('not_started', 'draft', 'final', 'amended')),
    constraint specialist_review_operation_events_score_check
        check (operations_score >= 0 and operations_score <= 1),
    constraint specialist_review_operation_events_count_check
        check (candidate_reviewer_count >= 0 and sla_minutes >= 0),
    constraint specialist_review_operation_events_hash_check
        check (
            operation_digest ~ '^[a-f0-9]{64}$'
            and packet_hash ~ '^[a-f0-9]{64}$'
            and evidence_pack_hash ~ '^[a-f0-9]{64}$'
            and corrections_hash ~ '^[a-f0-9]{64}$'
            and annotations_hash ~ '^[a-f0-9]{64}$'
            and deidentified_report_hash ~ '^[a-f0-9]{64}$'
        )
);

create index if not exists idx_specialist_review_operation_tenant_created
    on public.specialist_review_operation_events (tenant_id, created_at desc);

create index if not exists idx_specialist_review_operation_queue
    on public.specialist_review_operation_events
        (tenant_id, queue_status, urgency_level, observed_at desc);

create index if not exists idx_specialist_review_operation_assignment
    on public.specialist_review_operation_events
        (tenant_id, assignment_status, reviewer_route, observed_at desc);

create index if not exists idx_specialist_review_operation_review_event
    on public.specialist_review_operation_events (specialist_review_event_id)
    where specialist_review_event_id is not null;

create index if not exists idx_specialist_review_operation_case
    on public.specialist_review_operation_events (case_id)
    where case_id is not null;

create index if not exists idx_specialist_review_operation_packet_gin
    on public.specialist_review_operation_events using gin (operations_packet);

create index if not exists idx_specialist_review_operation_blockers_gin
    on public.specialist_review_operation_events using gin (blockers);

create index if not exists idx_specialist_review_operation_actions_gin
    on public.specialist_review_operation_events using gin (next_actions);

create index if not exists idx_specialist_review_operation_evidence_gin
    on public.specialist_review_operation_events using gin (evidence);

create or replace function public.prevent_specialist_review_operation_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'specialist_review_operation_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_specialist_review_operation_events
    on public.specialist_review_operation_events;
create trigger enforce_immutability_specialist_review_operation_events
    before update or delete on public.specialist_review_operation_events
    for each row execute function public.prevent_specialist_review_operation_event_mutation();

alter table public.specialist_review_operation_events enable row level security;

drop policy if exists specialist_review_operation_events_select_tenant
    on public.specialist_review_operation_events;
create policy specialist_review_operation_events_select_tenant
    on public.specialist_review_operation_events
    for select using (tenant_id = auth.uid());

drop policy if exists specialist_review_operation_events_insert_tenant
    on public.specialist_review_operation_events;
create policy specialist_review_operation_events_insert_tenant
    on public.specialist_review_operation_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_specialist_review_operation_events"
    on public.specialist_review_operation_events;
create policy "service_role_specialist_review_operation_events"
    on public.specialist_review_operation_events for all to service_role using (true) with check (true);

comment on table public.specialist_review_operation_events is
    'Append-only specialist review operations ledger for reviewer assignment, SLA, PACS/report workflow, closure readiness, and learning handoff evidence. Stores operational hashes and de-identified packets only.';

comment on column public.specialist_review_operation_events.operations_packet is
    'De-identified specialist-review operations packet. Do not store raw imaging, owner data, patient identifiers, raw PACS reports, or full external reports here.';

comment on column public.specialist_review_operation_events.operation_digest is
    'SHA-256 digest over the stable operational state used for queue, SLA, assignment, PACS/report, and closure proof.';

notify pgrst, 'reload schema';
