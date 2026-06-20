create table if not exists public.ask_vetios_case_graph_promotion_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    ask_vetios_query_id uuid references public.ask_vetios_queries(id) on delete set null,
    clinical_case_id uuid references public.clinical_cases(id) on delete set null,
    clinical_outcome_id uuid references public.clinical_outcome_events(id) on delete set null,
    specialist_review_event_id uuid references public.specialist_review_events(id) on delete set null,
    draft_key text,
    case_graph_status text not null default 'draft',
    promotion_status text not null default 'review_required',
    clinician_confirmation_status text not null default 'not_reviewed',
    outcome_linkage_status text not null default 'not_linked',
    value_capture_status text not null default 'foundation',
    readiness_score numeric(5, 2) not null default 0,
    field_coverage jsonb not null default '{}'::jsonb,
    promoted_fields text[] not null default '{}',
    missing_fields text[] not null default '{}',
    provenance_hash text,
    deidentified_case_graph_snapshot jsonb not null default '{}'::jsonb,
    review_evidence jsonb not null default '{}'::jsonb,
    reviewer_ref text,
    next_required_action text,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint ask_vetios_case_graph_promotion_tenant_request_key
        unique (tenant_id, request_id),
    constraint ask_vetios_case_graph_promotion_case_graph_status_check
        check (case_graph_status in ('non_clinical', 'draft', 'ready_for_case_graph')),
    constraint ask_vetios_case_graph_promotion_status_check
        check (promotion_status in (
            'draft_not_ready',
            'needs_more_information',
            'review_required',
            'promoted_to_case',
            'linked_to_outcome',
            'rejected'
        )),
    constraint ask_vetios_case_graph_promotion_confirmation_check
        check (clinician_confirmation_status in (
            'not_reviewed',
            'reviewed',
            'confirmed',
            'modified',
            'rejected'
        )),
    constraint ask_vetios_case_graph_promotion_outcome_linkage_check
        check (outcome_linkage_status in ('not_linked', 'pending', 'linked', 'not_required')),
    constraint ask_vetios_case_graph_promotion_value_capture_check
        check (value_capture_status in ('foundation', 'operating', 'defensible_candidate')),
    constraint ask_vetios_case_graph_promotion_readiness_check
        check (readiness_score >= 0 and readiness_score <= 100),
    constraint ask_vetios_case_graph_promotion_hash_check
        check (provenance_hash is null or provenance_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_ask_vetios_case_graph_promotion_tenant_created
    on public.ask_vetios_case_graph_promotion_events (tenant_id, created_at desc);

create index if not exists idx_ask_vetios_case_graph_promotion_query
    on public.ask_vetios_case_graph_promotion_events (ask_vetios_query_id)
    where ask_vetios_query_id is not null;

create index if not exists idx_ask_vetios_case_graph_promotion_case
    on public.ask_vetios_case_graph_promotion_events (clinical_case_id)
    where clinical_case_id is not null;

create index if not exists idx_ask_vetios_case_graph_promotion_outcome
    on public.ask_vetios_case_graph_promotion_events (clinical_outcome_id)
    where clinical_outcome_id is not null;

create index if not exists idx_ask_vetios_case_graph_promotion_status
    on public.ask_vetios_case_graph_promotion_events (tenant_id, promotion_status, observed_at desc);

create index if not exists idx_ask_vetios_case_graph_promotion_value_capture
    on public.ask_vetios_case_graph_promotion_events (tenant_id, value_capture_status, observed_at desc);

create index if not exists idx_ask_vetios_case_graph_promotion_snapshot_gin
    on public.ask_vetios_case_graph_promotion_events using gin (deidentified_case_graph_snapshot);

create index if not exists idx_ask_vetios_case_graph_promotion_review_gin
    on public.ask_vetios_case_graph_promotion_events using gin (review_evidence);

create or replace function public.prevent_ask_vetios_case_graph_promotion_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'ask_vetios_case_graph_promotion_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_ask_vetios_case_graph_promotion_events
    on public.ask_vetios_case_graph_promotion_events;
create trigger enforce_immutability_ask_vetios_case_graph_promotion_events
    before update or delete on public.ask_vetios_case_graph_promotion_events
    for each row execute function public.prevent_ask_vetios_case_graph_promotion_event_mutation();

alter table public.ask_vetios_case_graph_promotion_events enable row level security;

drop policy if exists ask_vetios_case_graph_promotion_select_tenant
    on public.ask_vetios_case_graph_promotion_events;
create policy ask_vetios_case_graph_promotion_select_tenant
    on public.ask_vetios_case_graph_promotion_events
    for select using (tenant_id = auth.uid());

drop policy if exists ask_vetios_case_graph_promotion_insert_tenant
    on public.ask_vetios_case_graph_promotion_events;
create policy ask_vetios_case_graph_promotion_insert_tenant
    on public.ask_vetios_case_graph_promotion_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_ask_vetios_case_graph_promotion_events"
    on public.ask_vetios_case_graph_promotion_events;
create policy "service_role_ask_vetios_case_graph_promotion_events"
    on public.ask_vetios_case_graph_promotion_events for all to service_role using (true) with check (true);

comment on table public.ask_vetios_case_graph_promotion_events is
    'Append-only Ask VetIOS case graph promotion ledger for clinician-reviewed promotion from structured intake draft into outcome-trackable clinical case evidence.';

comment on column public.ask_vetios_case_graph_promotion_events.deidentified_case_graph_snapshot is
    'De-identified case graph snapshot used for promotion evidence. Do not store raw notes, owner contacts, microchip IDs, or unredacted documents.';

comment on column public.ask_vetios_case_graph_promotion_events.provenance_hash is
    'SHA-256 digest over stable de-identified promotion inputs for replayable provenance without raw clinical text.';

comment on column public.ask_vetios_case_graph_promotion_events.value_capture_status is
    'Promotion evidence state: foundation, operating, or defensible_candidate once a promoted case is outcome-linked with provenance.';

notify pgrst, 'reload schema';
