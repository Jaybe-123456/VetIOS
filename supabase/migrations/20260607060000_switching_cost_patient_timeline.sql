-- VetIOS switching-cost moat: clinic patient timeline ledger.
-- Creates an append-only memory layer for longitudinal clinical context.
-- Raw owner contacts, addresses, microchip IDs, and patient names are not stored here.

create extension if not exists pgcrypto;

create table if not exists public.clinic_patient_timeline_events (
    id                   uuid primary key default gen_random_uuid(),
    tenant_id            text not null,

    -- Stable hashed identity for timeline grouping.
    -- Derived from patient_id when available, otherwise de-identified case patient metadata.
    patient_key          text not null,
    patient_id           text,

    case_id              text,
    inference_event_id   text,
    outcome_event_id     text,

    event_key            text not null unique,
    event_type           text not null
        check (event_type in (
            'case_created',
            'inference_recorded',
            'confirmed_diagnosis',
            'lab_result',
            'imaging_result',
            'treatment_started',
            'follow_up',
            'petpass_update',
            'external_record'
        )),
    event_title          text not null,
    event_summary        text not null,
    event_payload        jsonb not null default '{}'::jsonb,

    source_module        text not null default 'clinical_workspace',
    occurred_at          timestamptz not null,
    created_at           timestamptz not null default now()
);

create or replace function public.prevent_clinic_patient_timeline_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'clinic_patient_timeline_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_clinic_patient_timeline_events
    on public.clinic_patient_timeline_events;

create trigger enforce_immutability_clinic_patient_timeline_events
    before update or delete on public.clinic_patient_timeline_events
    for each row execute function public.prevent_clinic_patient_timeline_mutation();

create index if not exists idx_clinic_patient_timeline_patient
    on public.clinic_patient_timeline_events (tenant_id, patient_key, occurred_at desc);

create index if not exists idx_clinic_patient_timeline_case
    on public.clinic_patient_timeline_events (tenant_id, case_id, occurred_at desc)
    where case_id is not null;

create index if not exists idx_clinic_patient_timeline_outcome
    on public.clinic_patient_timeline_events (tenant_id, outcome_event_id)
    where outcome_event_id is not null;

create index if not exists idx_clinic_patient_timeline_type
    on public.clinic_patient_timeline_events (tenant_id, event_type, occurred_at desc);

alter table public.clinic_patient_timeline_events enable row level security;

drop policy if exists clinic_patient_timeline_events_select_own
    on public.clinic_patient_timeline_events;

create policy clinic_patient_timeline_events_select_own
    on public.clinic_patient_timeline_events
    for select
    using (tenant_id = auth.uid()::text or auth.role() = 'service_role');

drop policy if exists clinic_patient_timeline_events_insert_own
    on public.clinic_patient_timeline_events;

create policy clinic_patient_timeline_events_insert_own
    on public.clinic_patient_timeline_events
    for insert
    with check (tenant_id = auth.uid()::text or auth.role() = 'service_role');

grant select, insert on public.clinic_patient_timeline_events to authenticated, service_role;

notify pgrst, 'reload schema';
