-- VetIOS AI security incident workflow
-- Turns continuous AI security test failures into append-only incident evidence.

create extension if not exists pgcrypto;

create table if not exists public.ai_security_incident_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid,
    request_id text not null,
    security_test_request_id text not null,
    incident_type text not null,
    incident_status text not null default 'opened',
    severity text not null default 'high',
    containment_status text not null default 'manual_review',
    external_attestation_required boolean not null default false,
    affected_modules text[] not null default array[]::text[],
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    incident_packet_hash text not null,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz,
    created_at timestamptz not null default now(),

    constraint ai_security_incident_events_request_type_key
        unique (request_id, incident_type),
    constraint ai_security_incident_events_type_check
        check (incident_type in (
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
    constraint ai_security_incident_events_status_check
        check (incident_status in ('opened', 'contained', 'external_review', 'resolved')),
    constraint ai_security_incident_events_severity_check
        check (severity in ('medium', 'high', 'critical')),
    constraint ai_security_incident_events_containment_check
        check (containment_status in ('not_started', 'policy_blocked', 'manual_review', 'external_attestation')),
    constraint ai_security_incident_events_hash_check
        check (incident_packet_hash ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_ai_security_incident_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'ai_security_incident_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_ai_security_incident_events
    on public.ai_security_incident_events;
create trigger enforce_immutability_ai_security_incident_events
    before update or delete on public.ai_security_incident_events
    for each row execute function public.prevent_ai_security_incident_event_mutation();

create index if not exists ai_security_incident_events_tenant_created_idx
    on public.ai_security_incident_events (tenant_id, created_at desc)
    where tenant_id is not null;

create index if not exists ai_security_incident_events_status_created_idx
    on public.ai_security_incident_events (incident_status, severity, created_at desc);

create index if not exists ai_security_incident_events_test_request_idx
    on public.ai_security_incident_events (security_test_request_id, created_at desc);

create index if not exists ai_security_incident_events_blockers_gin_idx
    on public.ai_security_incident_events using gin (blockers);

create index if not exists ai_security_incident_events_modules_gin_idx
    on public.ai_security_incident_events using gin (affected_modules);

create index if not exists ai_security_incident_events_evidence_gin_idx
    on public.ai_security_incident_events using gin (evidence);

alter table public.ai_security_incident_events enable row level security;

drop policy if exists "service_role_ai_security_incident_events"
    on public.ai_security_incident_events;
create policy "service_role_ai_security_incident_events"
    on public.ai_security_incident_events
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.ai_security_incident_events to service_role;
revoke update, delete on public.ai_security_incident_events from anon, authenticated;

comment on table public.ai_security_incident_events is
    'Append-only incident workflow ledger for AI security failures, including prompt-injection, RAG-boundary, tool-abuse, data-exfiltration, sensitive-identifier, misinformation, and external-attestation evidence.';

comment on column public.ai_security_incident_events.evidence is
    'Sanitized incident evidence with hashes, detections, affected modules, and containment metadata only. Do not store raw prompts, secrets, identifiers, retrieved source text, or raw clinical notes.';

notify pgrst, 'reload schema';
