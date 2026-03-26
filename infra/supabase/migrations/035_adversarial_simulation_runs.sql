-- =============================================================================
-- Migration 035: Adversarial Simulation Runs
-- Stores per-step integrity sweep data for collapse mapping and dashboarding.
-- =============================================================================

create table if not exists public.adversarial_simulation_runs (
    id uuid primary key default gen_random_uuid(),
    simulation_event_id uuid not null
        references public.edge_simulation_events(id) on delete cascade,
    tenant_id uuid not null
        references public.tenants(id) on delete cascade,
    base_case_id uuid
        references public.clinical_cases(id) on delete set null,
    step_index integer not null check (step_index >= 0),
    m double precision not null check (m between 0 and 1),
    perturbation_vector jsonb not null,
    input_variant jsonb not null,
    output_summary jsonb not null default '{}'::jsonb,
    global_phi double precision not null check (global_phi between 0 and 1),
    state text not null check (state in ('stable', 'fragile', 'metastable', 'collapsed')),
    collapse_risk double precision not null check (collapse_risk between 0 and 1),
    precliff_flag boolean not null default false,
    instability jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint adversarial_simulation_runs_unique_step unique (simulation_event_id, step_index)
);

create index if not exists idx_adversarial_simulation_runs_base_case_m
    on public.adversarial_simulation_runs (base_case_id, m);

create index if not exists idx_adversarial_simulation_runs_base_case_state
    on public.adversarial_simulation_runs (base_case_id, state, created_at desc);

create index if not exists idx_adversarial_simulation_runs_simulation_step
    on public.adversarial_simulation_runs (simulation_event_id, step_index);

alter table public.adversarial_simulation_runs enable row level security;

drop policy if exists adversarial_simulation_runs_select_own on public.adversarial_simulation_runs;
create policy adversarial_simulation_runs_select_own
    on public.adversarial_simulation_runs
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists adversarial_simulation_runs_insert_own on public.adversarial_simulation_runs;
create policy adversarial_simulation_runs_insert_own
    on public.adversarial_simulation_runs
    for insert with check (tenant_id = public.current_tenant_id());

notify pgrst, 'reload schema';
