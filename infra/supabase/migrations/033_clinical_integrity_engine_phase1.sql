-- =============================================================================
-- Migration 033: Clinical Integrity Engine (Phase 1)
-- Lightweight safety/degradation event log for inference integrity tracking.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.clinical_integrity_events (
    id uuid primary key default gen_random_uuid(),
    inference_event_id uuid not null
        references public.ai_inference_events(id) on delete cascade,
    tenant_id uuid not null,
    perturbation_score_m double precision not null
        check (perturbation_score_m between 0 and 1),
    global_phi double precision not null
        check (global_phi between 0 and 1),
    state text not null
        check (state in ('stable', 'fragile', 'metastable', 'collapsed')),
    collapse_risk double precision not null
        check (collapse_risk between 0 and 1),
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint clinical_integrity_events_inference_key unique (inference_event_id)
);

create index if not exists idx_clinical_integrity_events_tenant_created
    on public.clinical_integrity_events (tenant_id, created_at desc);

create index if not exists idx_clinical_integrity_events_tenant_state_created
    on public.clinical_integrity_events (tenant_id, state, created_at desc);

alter table public.clinical_integrity_events enable row level security;

drop policy if exists clinical_integrity_events_select_own on public.clinical_integrity_events;
create policy clinical_integrity_events_select_own
    on public.clinical_integrity_events
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists clinical_integrity_events_insert_own on public.clinical_integrity_events;
create policy clinical_integrity_events_insert_own
    on public.clinical_integrity_events
    for insert with check (tenant_id = public.current_tenant_id());

notify pgrst, 'reload schema';
