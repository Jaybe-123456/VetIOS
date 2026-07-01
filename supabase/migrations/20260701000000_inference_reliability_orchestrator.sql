-- VetIOS inference reliability orchestrator
-- Persists the unified trusted/review/hold/suppress packet after inference.

create extension if not exists pgcrypto;

create table if not exists public.inference_reliability_packets (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    inference_event_id uuid not null references public.ai_inference_events(id) on delete cascade,
    request_id text,
    case_id uuid,
    packet_version text not null default 'vetios_inference_reliability_packet_v1',
    final_state text not null,
    top_label text,
    top_confidence double precision not null default 0,
    risk_class text not null default 'routine',
    calibration_status text not null default 'indeterminate',
    historical_sample_count integer not null default 0,
    actionability_decision text not null default 'not_available',
    review_queue_event_id uuid references public.inference_review_queue_events(id) on delete set null,
    training_eligible boolean not null default false,
    reasons text[] not null default array[]::text[],
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    packet_digest text not null,
    packet jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),

    constraint inference_reliability_packets_final_state_check
        check (final_state in ('trusted', 'review', 'hold', 'suppress')),
    constraint inference_reliability_packets_risk_class_check
        check (risk_class in ('routine', 'elevated', 'high', 'critical')),
    constraint inference_reliability_packets_calibration_status_check
        check (calibration_status in ('needs_outcome', 'calibrated', 'underconfident', 'overconfident', 'indeterminate')),
    constraint inference_reliability_packets_actionability_decision_check
        check (actionability_decision in (
            'actionable_with_confirmation',
            'review_before_action',
            'hold_for_evidence',
            'suppressed',
            'not_available'
        )),
    constraint inference_reliability_packets_confidence_check
        check (top_confidence >= 0 and top_confidence <= 1),
    constraint inference_reliability_packets_sample_count_check
        check (historical_sample_count >= 0),
    constraint inference_reliability_packets_digest_check
        check (packet_digest ~ '^[a-f0-9]{64}$')
);

create table if not exists public.gate_decision_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    inference_event_id uuid references public.ai_inference_events(id) on delete cascade,
    reliability_packet_id uuid references public.inference_reliability_packets(id) on delete set null,
    request_id text,
    case_id uuid,
    gate_kind text not null,
    gate_version text not null,
    final_state text not null,
    decision text not null,
    reasons text[] not null default array[]::text[],
    blockers text[] not null default array[]::text[],
    warnings text[] not null default array[]::text[],
    packet_digest text,
    evidence jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),

    constraint gate_decision_events_kind_check
        check (gate_kind in ('inference_reliability', 'actionability', 'security', 'rag', 'amr', 'review')),
    constraint gate_decision_events_final_state_check
        check (final_state in ('trusted', 'review', 'hold', 'suppress')),
    constraint gate_decision_events_decision_check
        check (decision in ('trusted', 'review', 'hold', 'suppress')),
    constraint gate_decision_events_digest_check
        check (packet_digest is null or packet_digest ~ '^[a-f0-9]{64}$')
);

create or replace function public.prevent_inference_reliability_orchestrator_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'inference reliability orchestrator tables are append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_inference_reliability_packets
    on public.inference_reliability_packets;
create trigger enforce_immutability_inference_reliability_packets
    before update or delete on public.inference_reliability_packets
    for each row execute function public.prevent_inference_reliability_orchestrator_mutation();

drop trigger if exists enforce_immutability_gate_decision_events
    on public.gate_decision_events;
create trigger enforce_immutability_gate_decision_events
    before update or delete on public.gate_decision_events
    for each row execute function public.prevent_inference_reliability_orchestrator_mutation();

create index if not exists inference_reliability_packets_tenant_event_created_idx
    on public.inference_reliability_packets (tenant_id, inference_event_id, created_at desc);

create index if not exists inference_reliability_packets_tenant_state_created_idx
    on public.inference_reliability_packets (tenant_id, final_state, risk_class, created_at desc);

create index if not exists inference_reliability_packets_tenant_label_created_idx
    on public.inference_reliability_packets (tenant_id, top_label, created_at desc)
    where top_label is not null;

create index if not exists inference_reliability_packets_reasons_gin_idx
    on public.inference_reliability_packets using gin (reasons);

create index if not exists inference_reliability_packets_packet_gin_idx
    on public.inference_reliability_packets using gin (packet);

create index if not exists gate_decision_events_tenant_inference_created_idx
    on public.gate_decision_events (tenant_id, inference_event_id, created_at desc)
    where inference_event_id is not null;

create index if not exists gate_decision_events_tenant_kind_state_created_idx
    on public.gate_decision_events (tenant_id, gate_kind, final_state, created_at desc);

create index if not exists gate_decision_events_reasons_gin_idx
    on public.gate_decision_events using gin (reasons);

create index if not exists gate_decision_events_evidence_gin_idx
    on public.gate_decision_events using gin (evidence);

alter table public.inference_reliability_packets enable row level security;
alter table public.gate_decision_events enable row level security;

drop policy if exists "service_role_inference_reliability_packets"
    on public.inference_reliability_packets;
create policy "service_role_inference_reliability_packets"
    on public.inference_reliability_packets
    for all to service_role
    using (true)
    with check (true);

drop policy if exists "service_role_gate_decision_events"
    on public.gate_decision_events;
create policy "service_role_gate_decision_events"
    on public.gate_decision_events
    for all to service_role
    using (true)
    with check (true);

grant select, insert on public.inference_reliability_packets to service_role;
grant select, insert on public.gate_decision_events to service_role;
revoke update, delete on public.inference_reliability_packets from anon, authenticated;
revoke update, delete on public.gate_decision_events from anon, authenticated;

comment on table public.inference_reliability_packets is
    'Append-only unified reliability packet for each inference. Stores trusted/review/hold/suppress governance evidence, hashes, and scores only; no raw notes, raw reports, owner identifiers, or raw documents.';

comment on table public.gate_decision_events is
    'Append-only compact gate decision ledger for inference reliability and related safety gates.';

comment on column public.inference_reliability_packets.packet is
    'Sanitized runtime governance packet for calibration, drift, counterfactual stability, RAG grounding, lab contradiction, AMR, security, and gate state. No raw clinical narrative or source text.';

notify pgrst, 'reload schema';
