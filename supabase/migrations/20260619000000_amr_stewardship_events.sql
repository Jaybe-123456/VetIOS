create table if not exists public.amr_stewardship_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    clinical_outcome_id uuid references public.clinical_outcome_events(id) on delete set null,
    species text not null,
    breed text,
    age_years numeric,
    pathogen_label text,
    syndrome text,
    infection_site text,
    sample_source text,
    culture_collected boolean not null default false,
    culture_result text,
    ast_method text,
    ast_panel jsonb not null default '{}'::jsonb,
    mic_results jsonb not null default '{}'::jsonb,
    resistance_genes text[] not null default '{}',
    resistance_classes text[] not null default '{}',
    drug_name text not null,
    drug_class text,
    dose text,
    route text,
    frequency text,
    duration_days numeric,
    indication text,
    decision_stage text not null default 'unknown',
    stewardship_status text not null default 'monitoring',
    outcome_status text,
    response_at_followup text,
    resistance_suspected boolean not null default false,
    de_escalation_recommended boolean not null default false,
    review_required boolean not null default true,
    rationale text,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint amr_stewardship_events_decision_stage_check
        check (decision_stage in (
            'unknown',
            'empiric',
            'culture_guided',
            'de_escalated',
            'escalated',
            'stopped',
            'prophylaxis',
            'watchful_waiting'
        )),
    constraint amr_stewardship_events_status_check
        check (stewardship_status in (
            'monitoring',
            'pending_culture',
            'culture_guided',
            'non_antimicrobial',
            'watchful_waiting',
            'success',
            'failure',
            'relapse',
            'adverse_event'
        )),
    constraint amr_stewardship_events_outcome_status_check
        check (
            outcome_status is null
            or outcome_status in (
                'improved',
                'resolved',
                'unchanged',
                'worsened',
                'relapsed',
                'adverse_event',
                'unknown'
            )
        ),
    constraint amr_stewardship_events_duration_days_check
        check (duration_days is null or duration_days >= 0)
);

create unique index if not exists idx_amr_stewardship_tenant_request
    on public.amr_stewardship_events (tenant_id, request_id);

create index if not exists idx_amr_stewardship_tenant_created
    on public.amr_stewardship_events (tenant_id, created_at desc);

create index if not exists idx_amr_stewardship_species_region_proxy
    on public.amr_stewardship_events (species, pathogen_label, infection_site);

create index if not exists idx_amr_stewardship_drug_class
    on public.amr_stewardship_events (drug_class, decision_stage, stewardship_status);

create index if not exists idx_amr_stewardship_resistance_classes
    on public.amr_stewardship_events using gin (resistance_classes);

create index if not exists idx_amr_stewardship_ast_panel_gin
    on public.amr_stewardship_events using gin (ast_panel);

create index if not exists idx_amr_stewardship_mic_results_gin
    on public.amr_stewardship_events using gin (mic_results);

create or replace function public.prevent_amr_stewardship_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'amr_stewardship_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_amr_stewardship_events on public.amr_stewardship_events;
create trigger enforce_immutability_amr_stewardship_events
    before update or delete on public.amr_stewardship_events
    for each row execute function public.prevent_amr_stewardship_event_mutation();

alter table public.amr_stewardship_events enable row level security;

drop policy if exists "service_role_amr_stewardship_events" on public.amr_stewardship_events;
create policy "service_role_amr_stewardship_events"
    on public.amr_stewardship_events for all to service_role using (true) with check (true);

comment on table public.amr_stewardship_events is
    'Append-only de-identified antimicrobial stewardship decision and outcome events for AMR surveillance and outcome learning.';

comment on column public.amr_stewardship_events.ast_panel is
    'Structured culture and susceptibility panel summary. Store derived susceptibility facts, not raw lab documents.';

comment on column public.amr_stewardship_events.mic_results is
    'Structured MIC or breakpoint results keyed by antimicrobial where available.';

comment on column public.amr_stewardship_events.evidence is
    'Citation, clinician, guideline, lab, or case-review evidence supporting the antimicrobial decision.';

notify pgrst, 'reload schema';
