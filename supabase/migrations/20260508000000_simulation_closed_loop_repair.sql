-- =============================================================================
-- Simulation closed-loop repair
-- Aligns the existing public.simulations table with the simulation_runs contract
-- and closes simulation -> ai_inference_events -> outcome provenance.
-- =============================================================================

create extension if not exists pgcrypto;

alter table public.simulations
    add column if not exists heartbeat_at timestamptz,
    add column if not exists worker_id text,
    add column if not exists timeout_at timestamptz,
    add column if not exists duration_s integer,
    add column if not exists failure_reason text,
    add column if not exists failure_stack text,
    add column if not exists requests_completed integer not null default 0,
    add column if not exists requests_failed integer not null default 0,
    add column if not exists requests_total integer,
    add column if not exists mean_latency_ms double precision,
    add column if not exists p50_latency_ms double precision,
    add column if not exists p95_latency_ms double precision,
    add column if not exists p99_latency_ms double precision,
    add column if not exists success_rate double precision,
    add column if not exists model_safety_class text;

update public.simulations
set
    duration_s = coalesce(
        duration_s,
        case
            when config->>'duration_seconds' ~ '^[0-9]+$' then (config->>'duration_seconds')::integer
            else null
        end
    ),
    requests_total = coalesce(requests_total, nullif(total, 0)),
    requests_completed = coalesce(requests_completed, completed, 0),
    requests_failed = coalesce(requests_failed, greatest(coalesce(total, 0) - coalesce(completed, 0), 0)),
    timeout_at = coalesce(
        timeout_at,
        case
            when started_at is not null then started_at + make_interval(secs => coalesce(
                case
                    when config->>'duration_seconds' ~ '^[0-9]+$' then (config->>'duration_seconds')::integer
                    else null
                end,
                duration_s,
                300
            ) + 120)
            else null
        end
    ),
    model_safety_class = coalesce(model_safety_class, 'experimental')
where duration_s is null
   or requests_total is null
   or requests_completed is null
   or requests_failed is null
   or timeout_at is null
   or model_safety_class is null;

alter table public.simulations
    drop constraint if exists simulations_model_safety_class_check;

alter table public.simulations
    add constraint simulations_model_safety_class_check
    check (model_safety_class in ('production', 'experimental', 'archived'));

create index if not exists idx_simulations_running_timeout
    on public.simulations (status, timeout_at)
    where status = 'running';

create index if not exists idx_simulations_heartbeat
    on public.simulations (heartbeat_at)
    where status = 'running';

create index if not exists idx_simulations_model_safety_class
    on public.simulations (model_safety_class);

alter table public.simulation_events
    add column if not exists simulation_run_id uuid references public.simulations(id) on delete cascade,
    add column if not exists agent_index integer,
    add column if not exists request_index integer,
    add column if not exists species text,
    add column if not exists scenario_payload jsonb,
    add column if not exists response_status integer,
    add column if not exists response_body jsonb,
    add column if not exists latency_ms integer,
    add column if not exists inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    add column if not exists success boolean,
    add column if not exists failure_reason text,
    add column if not exists adversarial_type text;

update public.simulation_events
set simulation_run_id = coalesce(simulation_run_id, simulation_id)
where simulation_run_id is null;

create index if not exists sim_events_run_idx
    on public.simulation_events (simulation_run_id);

create index if not exists sim_events_inference_idx
    on public.simulation_events (inference_event_id);

create index if not exists sim_events_simulation_id_idx
    on public.simulation_events (simulation_id);

create index if not exists sim_events_success_idx
    on public.simulation_events (simulation_id, success);

alter table public.ai_inference_events
    add column if not exists simulation_id uuid references public.simulations(id) on delete set null,
    add column if not exists is_synthetic boolean not null default false,
    add column if not exists simulation_agent_index integer,
    add column if not exists simulation_request_index integer;

create index if not exists ai_inference_events_simulation_idx
    on public.ai_inference_events (simulation_id)
    where simulation_id is not null;

create index if not exists ai_inference_events_synthetic_idx
    on public.ai_inference_events (is_synthetic);

alter table public.clinical_outcome_events
    add column if not exists simulation_id uuid references public.simulations(id) on delete set null,
    add column if not exists is_synthetic boolean not null default false;

create index if not exists clinical_outcome_events_simulation_idx
    on public.clinical_outcome_events (simulation_id)
    where simulation_id is not null;

alter table public.outcomes
    add column if not exists simulation_id uuid references public.simulations(id) on delete set null,
    add column if not exists is_synthetic boolean not null default false;

create index if not exists outcomes_simulation_idx
    on public.outcomes (simulation_id)
    where simulation_id is not null;

create table if not exists public.simulation_watchdog_log (
    id uuid primary key default gen_random_uuid(),
    simulation_run_id uuid not null references public.simulations(id) on delete cascade,
    detected_at timestamptz not null default now(),
    action_taken text not null check (action_taken in ('marked_failed', 'heartbeat_ok', 'timeout_detected')),
    last_heartbeat_at timestamptz,
    expected_timeout_at timestamptz,
    notes text
);

create index if not exists idx_simulation_watchdog_log_run
    on public.simulation_watchdog_log (simulation_run_id, detected_at desc);

create table if not exists public.adversarial_failure_modes (
    id uuid primary key default gen_random_uuid(),
    simulation_run_id uuid not null references public.simulations(id) on delete cascade,
    simulation_event_id uuid not null references public.simulation_events(id) on delete cascade,
    adversarial_type text not null,
    species text,
    failure_mode text not null,
    failure_classification text not null check (failure_classification in (
        'hallucination',
        'confidence_miscalibration',
        'input_validation_bypass',
        'prompt_injection_success',
        'performance_degradation',
        'unexpected_success'
    )),
    expected_behavior text not null,
    actual_behavior text not null,
    severity text not null check (severity in ('critical', 'major', 'minor', 'informational')),
    regression_risk boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists idx_adversarial_failure_modes_run
    on public.adversarial_failure_modes (simulation_run_id, created_at desc);

create table if not exists public.regression_fixtures (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    species text not null,
    input_payload jsonb not null,
    expected_top_differential text not null,
    expected_confidence_min double precision not null,
    expected_confidence_max double precision not null,
    expected_should_refuse boolean not null default false,
    source text not null check (source in ('confirmed_clinical_case', 'specialist_reviewed', 'adversarial_survivor')),
    active boolean not null default true,
    added_at timestamptz not null default now(),
    added_by text not null
);

create index if not exists idx_regression_fixtures_active
    on public.regression_fixtures (active, species);

create table if not exists public.regression_results (
    id uuid primary key default gen_random_uuid(),
    simulation_run_id uuid not null references public.simulations(id) on delete cascade,
    fixture_id uuid not null references public.regression_fixtures(id) on delete cascade,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    passed boolean not null,
    actual_top_differential text,
    actual_confidence double precision,
    confidence_delta double precision,
    failure_reason text,
    latency_ms integer,
    created_at timestamptz not null default now()
);

create index if not exists idx_regression_results_run
    on public.regression_results (simulation_run_id, created_at desc);

create index if not exists idx_regression_results_fixture
    on public.regression_results (fixture_id, created_at desc);

insert into public.simulation_watchdog_log (
    simulation_run_id,
    action_taken,
    last_heartbeat_at,
    expected_timeout_at,
    notes
)
select
    s.id,
    'marked_failed',
    s.heartbeat_at,
    s.timeout_at,
    'Migration watchdog backfill: running simulation exceeded timeout or heartbeat window.'
from public.simulations s
where s.status = 'running'
  and (
      coalesce(s.timeout_at, s.started_at + make_interval(secs => coalesce(
          s.duration_s,
          case
              when s.config->>'duration_seconds' ~ '^[0-9]+$' then (s.config->>'duration_seconds')::integer
              else null
          end,
          300
      ) + 120)) < now()
      or (s.heartbeat_at is not null and s.heartbeat_at < now() - interval '60 seconds')
      or s.started_at < now() - interval '10 minutes'
  )
on conflict do nothing;

update public.simulations
set
    status = 'failed',
    failure_reason = 'WATCHDOG: Run exceeded timeout_at without completing. Marked failed by migration watchdog at ' || now()::text,
    error_message = coalesce(error_message, 'WATCHDOG: Run exceeded timeout_at without completing.'),
    updated_at = now()
where status = 'running'
  and (
      coalesce(timeout_at, started_at + make_interval(secs => coalesce(
          duration_s,
          case
              when config->>'duration_seconds' ~ '^[0-9]+$' then (config->>'duration_seconds')::integer
              else null
          end,
          300
      ) + 120)) < now()
      or (heartbeat_at is not null and heartbeat_at < now() - interval '60 seconds')
      or started_at < now() - interval '10 minutes'
  );

notify pgrst, 'reload schema';
