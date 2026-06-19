create table if not exists public.specialist_review_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    ask_vetios_query_id uuid references public.ask_vetios_queries(id) on delete set null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    clinical_outcome_id uuid references public.clinical_outcome_events(id) on delete set null,
    reviewer_route text not null default 'primary_clinician',
    specialty text,
    urgency_level text not null default 'routine',
    review_stage text not null default 'requested',
    review_status text not null default 'pending',
    ai_disposition text not null default 'not_reviewed',
    clinician_action text not null default 'none',
    report_status text not null default 'not_started',
    pacs_status text not null default 'not_applicable',
    outcome_required boolean not null default true,
    outcome_captured boolean not null default false,
    learning_eligible boolean not null default false,
    evidence_pack jsonb not null default '{}'::jsonb,
    corrections jsonb not null default '{}'::jsonb,
    annotations jsonb not null default '{}'::jsonb,
    deidentified_report jsonb not null default '{}'::jsonb,
    review_summary text,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint specialist_review_events_tenant_request_key unique (tenant_id, request_id),
    constraint specialist_review_events_reviewer_route_check
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
    constraint specialist_review_events_urgency_level_check
        check (urgency_level in ('routine', 'priority', 'urgent', 'emergency')),
    constraint specialist_review_events_review_stage_check
        check (review_stage in (
            'requested',
            'assigned',
            'in_review',
            'report_ready',
            'returned_to_clinician',
            'closed'
        )),
    constraint specialist_review_events_review_status_check
        check (review_status in (
            'pending',
            'completed',
            'cancelled',
            'escalated',
            'unable_to_review'
        )),
    constraint specialist_review_events_ai_disposition_check
        check (ai_disposition in (
            'not_reviewed',
            'supported',
            'partially_supported',
            'corrected',
            'contradicted',
            'insufficient_evidence'
        )),
    constraint specialist_review_events_clinician_action_check
        check (clinician_action in (
            'none',
            'accepted_ai',
            'modified_plan',
            'referred',
            'emergency_transfer',
            'additional_tests',
            'treatment_changed'
        )),
    constraint specialist_review_events_report_status_check
        check (report_status in ('not_started', 'draft', 'final', 'amended')),
    constraint specialist_review_events_pacs_status_check
        check (pacs_status in ('not_applicable', 'pending', 'linked', 'unavailable'))
);

create index if not exists idx_specialist_review_tenant_created
    on public.specialist_review_events (tenant_id, created_at desc);

create index if not exists idx_specialist_review_route_status
    on public.specialist_review_events (tenant_id, reviewer_route, review_status, observed_at desc);

create index if not exists idx_specialist_review_ai_disposition
    on public.specialist_review_events (tenant_id, ai_disposition, observed_at desc);

create index if not exists idx_specialist_review_ask_query
    on public.specialist_review_events (ask_vetios_query_id)
    where ask_vetios_query_id is not null;

create index if not exists idx_specialist_review_case
    on public.specialist_review_events (case_id)
    where case_id is not null;

create index if not exists idx_specialist_review_inference
    on public.specialist_review_events (inference_event_id)
    where inference_event_id is not null;

create index if not exists idx_specialist_review_outcome
    on public.specialist_review_events (clinical_outcome_id)
    where clinical_outcome_id is not null;

create index if not exists idx_specialist_review_evidence_pack_gin
    on public.specialist_review_events using gin (evidence_pack);

create index if not exists idx_specialist_review_corrections_gin
    on public.specialist_review_events using gin (corrections);

create index if not exists idx_specialist_review_annotations_gin
    on public.specialist_review_events using gin (annotations);

create or replace function public.prevent_specialist_review_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'specialist_review_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_specialist_review_events on public.specialist_review_events;
create trigger enforce_immutability_specialist_review_events
    before update or delete on public.specialist_review_events
    for each row execute function public.prevent_specialist_review_event_mutation();

alter table public.specialist_review_events enable row level security;

drop policy if exists specialist_review_events_select_tenant on public.specialist_review_events;
create policy specialist_review_events_select_tenant
    on public.specialist_review_events
    for select using (tenant_id = auth.uid());

drop policy if exists specialist_review_events_insert_tenant on public.specialist_review_events;
create policy specialist_review_events_insert_tenant
    on public.specialist_review_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_specialist_review_events" on public.specialist_review_events;
create policy "service_role_specialist_review_events"
    on public.specialist_review_events for all to service_role using (true) with check (true);

comment on table public.specialist_review_events is
    'Append-only specialist and clinician review loop for Ask VetIOS, inference oversight, final report status, correction capture, and outcome-linked learning.';

comment on column public.specialist_review_events.evidence_pack is
    'De-identified specialist-review evidence pack metadata. Do not store raw imaging, PHI, or full external reports here.';

comment on column public.specialist_review_events.corrections is
    'Structured correction deltas from specialist or clinician review, used for model trust, case graph promotion, and training eligibility.';

comment on column public.specialist_review_events.deidentified_report is
    'Structured de-identified report summary, not the source PACS/report document.';

comment on column public.specialist_review_events.learning_eligible is
    'True only when the review has enough final disposition and outcome context to become a governed learning signal.';

notify pgrst, 'reload schema';
