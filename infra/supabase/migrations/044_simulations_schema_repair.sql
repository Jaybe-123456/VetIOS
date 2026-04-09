-- =============================================================================
-- Migration 044: Simulations schema repair
-- Ensures older environments have the full simulations table shape expected by
-- the Simulation Workbench and refreshes the PostgREST schema cache.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.simulations (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    mode text not null default 'load'
        check (mode in ('load', 'scenario_load', 'adversarial', 'regression')),
    status text not null default 'pending'
        check (status in ('pending', 'queued', 'running', 'complete', 'completed', 'failed', 'blocked')),
    scenario_name text not null default 'simulation',
    config jsonb not null default '{}'::jsonb,
    results jsonb,
    summary jsonb not null default '{}'::jsonb,
    completed integer not null default 0,
    total integer not null default 0,
    started_at timestamptz,
    completed_at timestamptz,
    created_by text not null default 'system',
    candidate_model_version text,
    error_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.simulations
    add column if not exists tenant_id text,
    add column if not exists mode text default 'load',
    add column if not exists status text default 'pending',
    add column if not exists scenario_name text default 'simulation',
    add column if not exists config jsonb default '{}'::jsonb,
    add column if not exists results jsonb,
    add column if not exists summary jsonb default '{}'::jsonb,
    add column if not exists completed integer default 0,
    add column if not exists total integer default 0,
    add column if not exists started_at timestamptz,
    add column if not exists completed_at timestamptz,
    add column if not exists created_by text default 'system',
    add column if not exists candidate_model_version text,
    add column if not exists error_message text,
    add column if not exists created_at timestamptz default now(),
    add column if not exists updated_at timestamptz default now();

update public.simulations
set
    mode = case
        when mode = 'scenario_load' then 'scenario_load'
        when mode = 'adversarial' then 'adversarial'
        when mode = 'regression' then 'regression'
        else 'load'
    end,
    status = case
        when status = 'completed' then 'completed'
        when status = 'complete' then 'complete'
        when status = 'blocked' then 'blocked'
        when status = 'failed' then 'failed'
        when status = 'running' then 'running'
        when status = 'queued' then 'queued'
        else 'pending'
    end,
    scenario_name = coalesce(nullif(scenario_name, ''), 'simulation'),
    config = coalesce(config, '{}'::jsonb),
    summary = coalesce(summary, '{}'::jsonb),
    completed = coalesce(completed, 0),
    total = coalesce(total, 0),
    created_by = coalesce(nullif(created_by, ''), 'system'),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now())
where tenant_id is null
   or mode is null
   or status is null
   or scenario_name is null
   or config is null
   or summary is null
   or completed is null
   or total is null
   or created_by is null
   or created_at is null
   or updated_at is null;

alter table public.simulations
    alter column tenant_id set not null,
    alter column mode set not null,
    alter column status set not null,
    alter column scenario_name set not null,
    alter column config set not null,
    alter column summary set not null,
    alter column completed set not null,
    alter column total set not null,
    alter column created_by set not null,
    alter column created_at set not null,
    alter column updated_at set not null,
    alter column mode set default 'load',
    alter column status set default 'pending',
    alter column scenario_name set default 'simulation',
    alter column config set default '{}'::jsonb,
    alter column summary set default '{}'::jsonb,
    alter column completed set default 0,
    alter column total set default 0,
    alter column created_by set default 'system',
    alter column created_at set default now(),
    alter column updated_at set default now();

alter table public.simulations
    drop constraint if exists simulations_mode_check;

alter table public.simulations
    add constraint simulations_mode_check
    check (mode in ('load', 'scenario_load', 'adversarial', 'regression'));

alter table public.simulations
    drop constraint if exists simulations_status_check;

alter table public.simulations
    add constraint simulations_status_check
    check (status in ('pending', 'queued', 'running', 'complete', 'completed', 'failed', 'blocked'));

create index if not exists idx_simulations_tenant_mode_status
    on public.simulations (tenant_id, mode, status, created_at desc);

notify pgrst, 'reload schema';
