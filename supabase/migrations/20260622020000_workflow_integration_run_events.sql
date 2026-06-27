create extension if not exists pgcrypto;

create table if not exists public.workflow_integration_run_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id text not null,
    signal_event_id uuid references public.passive_signal_events(id) on delete set null,
    connector_type text not null,
    ingestion_profile text not null,
    source_standard text not null,
    vendor_name text,
    vendor_account_ref_hash text,
    workflow_event_type text,
    evidence_status text not null,
    moat_posture text not null,
    readiness_score numeric(5, 4) not null default 0,
    workflow_moat_status text not null default 'blocked',
    workflow_readiness_score numeric(5, 4) not null default 0,
    packets_evaluated integer not null default 0,
    ready_packets integer not null default 0,
    blocked_packets integer not null default 0,
    outcome_linked_packets integer not null default 0,
    diagnostic_packets integer not null default 0,
    required_capabilities integer not null default 0,
    required_capabilities_ready integer not null default 0,
    pims_workflow_packets integer not null default 0,
    lab_result_packets integer not null default 0,
    pacs_report_packets integer not null default 0,
    follow_up_packets integer not null default 0,
    source_payload_hash text not null,
    source_record_digest text not null,
    packet_hash text not null,
    packet jsonb not null default '{}'::jsonb,
    readiness_snapshot jsonb not null default '{}'::jsonb,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint workflow_integration_run_events_tenant_request_key unique (tenant_id, request_id),
    constraint workflow_integration_run_events_connector_type_check
        check (connector_type in (
            'lab_result',
            'prescription_refill',
            'recheck',
            'referral',
            'imaging_report'
        )),
    constraint workflow_integration_run_events_ingestion_profile_check
        check (ingestion_profile in (
            'pims_history_sync',
            'appointment_follow_up_sync',
            'lab_result_import',
            'pacs_report_import',
            'referral_sync',
            'prescription_sync'
        )),
    constraint workflow_integration_run_events_source_standard_check
        check (source_standard in (
            'vendor_webhook',
            'hl7_v2_oru',
            'fhir_r4',
            'dicomweb',
            'manual_file_drop'
        )),
    constraint workflow_integration_run_events_evidence_status_check
        check (evidence_status in (
            'blocked',
            'insufficient_context',
            'workflow_signal_ready',
            'diagnostic_signal_ready',
            'outcome_signal_ready'
        )),
    constraint workflow_integration_run_events_moat_posture_check
        check (moat_posture in (
            'interface_only',
            'provenance_foundation',
            'outcome_linkage_ready',
            'blocked_phi_risk'
        )),
    constraint workflow_integration_run_events_workflow_moat_status_check
        check (workflow_moat_status in ('blocked', 'foundation', 'operating')),
    constraint workflow_integration_run_events_score_check
        check (
            readiness_score >= 0
            and readiness_score <= 1
            and workflow_readiness_score >= 0
            and workflow_readiness_score <= 1
        ),
    constraint workflow_integration_run_events_count_check
        check (
            packets_evaluated >= 0
            and ready_packets >= 0
            and blocked_packets >= 0
            and outcome_linked_packets >= 0
            and diagnostic_packets >= 0
            and required_capabilities >= 0
            and required_capabilities_ready >= 0
            and pims_workflow_packets >= 0
            and lab_result_packets >= 0
            and pacs_report_packets >= 0
            and follow_up_packets >= 0
        ),
    constraint workflow_integration_run_events_hash_check
        check (
            source_payload_hash ~ '^[a-f0-9]{64}$'
            and source_record_digest ~ '^[a-f0-9]{64}$'
            and packet_hash ~ '^[a-f0-9]{64}$'
            and (vendor_account_ref_hash is null or vendor_account_ref_hash ~ '^[a-f0-9]{64}$')
        )
);

create index if not exists idx_workflow_integration_run_events_tenant_created
    on public.workflow_integration_run_events (tenant_id, created_at desc);

create index if not exists idx_workflow_integration_run_events_connector
    on public.workflow_integration_run_events
        (tenant_id, connector_type, evidence_status, observed_at desc);

create index if not exists idx_workflow_integration_run_events_moat
    on public.workflow_integration_run_events
        (tenant_id, workflow_moat_status, workflow_readiness_score desc, observed_at desc);

create index if not exists idx_workflow_integration_run_events_signal
    on public.workflow_integration_run_events (signal_event_id)
    where signal_event_id is not null;

create index if not exists idx_workflow_integration_run_events_source_digest
    on public.workflow_integration_run_events (source_record_digest);

create index if not exists idx_workflow_integration_run_events_packet_gin
    on public.workflow_integration_run_events using gin (packet);

create index if not exists idx_workflow_integration_run_events_readiness_gin
    on public.workflow_integration_run_events using gin (readiness_snapshot);

create index if not exists idx_workflow_integration_run_events_blockers_gin
    on public.workflow_integration_run_events using gin (blockers);

create index if not exists idx_workflow_integration_run_events_evidence_gin
    on public.workflow_integration_run_events using gin (evidence);

create or replace function public.prevent_workflow_integration_run_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'workflow_integration_run_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_workflow_integration_run_events
    on public.workflow_integration_run_events;
create trigger enforce_immutability_workflow_integration_run_events
    before update or delete on public.workflow_integration_run_events
    for each row execute function public.prevent_workflow_integration_run_event_mutation();

alter table public.workflow_integration_run_events enable row level security;

drop policy if exists workflow_integration_run_events_select_tenant
    on public.workflow_integration_run_events;
create policy workflow_integration_run_events_select_tenant
    on public.workflow_integration_run_events
    for select using (tenant_id = public.current_tenant_id()::text);

drop policy if exists workflow_integration_run_events_insert_tenant
    on public.workflow_integration_run_events;
create policy workflow_integration_run_events_insert_tenant
    on public.workflow_integration_run_events
    for insert with check (tenant_id = public.current_tenant_id()::text);

drop policy if exists "service_role_workflow_integration_run_events"
    on public.workflow_integration_run_events;
create policy "service_role_workflow_integration_run_events"
    on public.workflow_integration_run_events for all to service_role using (true) with check (true);

comment on table public.workflow_integration_run_events is
    'Append-only operational workflow integration run ledger for PIMS, lab, PACS, referral, refill, and follow-up connector submissions. Stores de-identified evidence packets, readiness snapshots, hashes, and blockers, not raw vendor payloads.';

comment on column public.workflow_integration_run_events.packet is
    'De-identified workflow connector evidence packet. Raw PIMS/lab/PACS payloads, owner details, patient names, raw reports, and source documents must not be stored here.';

comment on column public.workflow_integration_run_events.readiness_snapshot is
    'Single-run or batch workflow integration readiness snapshot proving source standards, capability coverage, outcome linkage, and privacy blockers.';

notify pgrst, 'reload schema';
