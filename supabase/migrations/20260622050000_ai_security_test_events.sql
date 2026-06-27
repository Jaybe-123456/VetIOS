create extension if not exists pgcrypto;

create table if not exists public.ai_security_test_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    ask_vetios_query_id uuid references public.ask_vetios_queries(id) on delete set null,
    test_suite text not null default 'ask_vetios_runtime_security',
    test_case_type text not null,
    security_status text not null,
    risk_level text not null,
    attack_detected boolean not null default false,
    blocked_by_policy boolean not null default false,
    incident_required boolean not null default false,
    external_attestation_required boolean not null default false,
    prompt_injection_detected boolean not null default false,
    admin_tool_request_detected boolean not null default false,
    data_exfiltration_request_detected boolean not null default false,
    vector_boundary_required boolean not null default false,
    misinformation_review_required boolean not null default false,
    sensitive_info_detected boolean not null default false,
    excessive_agency_request_detected boolean not null default false,
    finding_count integer not null default 0,
    mitigation_count integer not null default 0,
    control_count integer not null default 0,
    security_score numeric(5, 4) not null default 0,
    snapshot_hash text not null,
    test_packet_hash text not null,
    security_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    next_actions text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint ai_security_test_events_request_case_key
        unique (request_id, test_case_type),
    constraint ai_security_test_events_case_type_check
        check (test_case_type in (
            'prompt_injection',
            'rag_boundary',
            'tool_abuse',
            'data_exfiltration',
            'sensitive_identifier',
            'misinformation',
            'rate_limit',
            'incident_response',
            'external_attestation'
        )),
    constraint ai_security_test_events_status_check
        check (security_status in (
            'monitored',
            'guarded',
            'restricted',
            'security_review_required'
        )),
    constraint ai_security_test_events_risk_level_check
        check (risk_level in ('low', 'medium', 'high')),
    constraint ai_security_test_events_counts_check
        check (
            finding_count >= 0
            and mitigation_count >= 0
            and control_count >= 0
        ),
    constraint ai_security_test_events_score_check
        check (security_score >= 0 and security_score <= 1),
    constraint ai_security_test_events_hash_check
        check (
            snapshot_hash ~ '^[a-f0-9]{64}$'
            and test_packet_hash ~ '^[a-f0-9]{64}$'
        )
);

create index if not exists idx_ai_security_test_events_tenant_created
    on public.ai_security_test_events (tenant_id, created_at desc)
    where tenant_id is not null;

create index if not exists idx_ai_security_test_events_request
    on public.ai_security_test_events (request_id, created_at desc);

create index if not exists idx_ai_security_test_events_status
    on public.ai_security_test_events
        (test_suite, security_status, risk_level, observed_at desc);

create index if not exists idx_ai_security_test_events_query
    on public.ai_security_test_events (ask_vetios_query_id)
    where ask_vetios_query_id is not null;

create index if not exists idx_ai_security_test_events_blockers_gin
    on public.ai_security_test_events using gin (blockers);

create index if not exists idx_ai_security_test_events_warnings_gin
    on public.ai_security_test_events using gin (warnings);

create index if not exists idx_ai_security_test_events_packet_gin
    on public.ai_security_test_events using gin (security_packet);

create or replace function public.prevent_ai_security_test_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'ai_security_test_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_ai_security_test_events
    on public.ai_security_test_events;
create trigger enforce_immutability_ai_security_test_events
    before update or delete on public.ai_security_test_events
    for each row execute function public.prevent_ai_security_test_event_mutation();

alter table public.ai_security_test_events enable row level security;

drop policy if exists ai_security_test_events_select_tenant
    on public.ai_security_test_events;
create policy ai_security_test_events_select_tenant
    on public.ai_security_test_events
    for select using (tenant_id = auth.uid());

drop policy if exists ai_security_test_events_insert_tenant
    on public.ai_security_test_events;
create policy ai_security_test_events_insert_tenant
    on public.ai_security_test_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_ai_security_test_events"
    on public.ai_security_test_events;
create policy "service_role_ai_security_test_events"
    on public.ai_security_test_events for all to service_role using (true) with check (true);

comment on table public.ai_security_test_events is
    'Append-only AI security evidence ledger for Ask VetIOS runtime prompt-injection, RAG-boundary, tool-abuse, data-exfiltration, incident-response, and external-attestation tests.';

comment on column public.ai_security_test_events.security_packet is
    'De-identified security test packet. Store detection flags, controls, hashes, blockers, and audit metadata only; do not store raw prompts, raw clinical notes, secrets, or retrieved source text.';

comment on column public.ai_security_test_events.snapshot_hash is
    'SHA-256 digest of the Ask VetIOS AI security snapshot that produced this test evidence event.';

notify pgrst, 'reload schema';
