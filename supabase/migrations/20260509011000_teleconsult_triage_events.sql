create table if not exists public.teleconsult_triage_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    intake_session_id uuid references public.intake_sessions(id) on delete set null,
    patient_id uuid not null references public.patients(id) on delete cascade,
    teleconsult_session_id uuid not null,
    species text not null,
    symptom_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(symptom_codes) = 'array'),
    vitals jsonb not null default '{}'::jsonb check (jsonb_typeof(vitals) = 'object'),
    red_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(red_flags) = 'array'),
    scoring_signals jsonb not null default '[]'::jsonb check (jsonb_typeof(scoring_signals) = 'array'),
    triage_score double precision not null check (triage_score >= 0 and triage_score <= 1),
    urgency_level text not null check (urgency_level in ('routine','priority','urgent','emergency')),
    disposition text not null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    description_hash text,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create index if not exists idx_teleconsult_triage_session_time
    on public.teleconsult_triage_events (tenant_id, teleconsult_session_id, created_at desc);

create index if not exists idx_teleconsult_triage_urgency_time
    on public.teleconsult_triage_events (urgency_level, created_at desc);

alter table public.teleconsult_triage_events enable row level security;

drop policy if exists service_role_teleconsult_triage_events on public.teleconsult_triage_events;
create policy service_role_teleconsult_triage_events
    on public.teleconsult_triage_events
    for all
    to service_role
    using (true)
    with check (true);

comment on table public.teleconsult_triage_events is
    'Telemedicine triage scores linked to intake sessions and optional inference events without storing raw transcript text.';
