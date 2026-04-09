-- =============================================================================
-- Migration 041: CIRE + Sovereign
-- Reliability monitoring for VetIOS inference and standalone Sovereign runs.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.cire_snapshots (
    id uuid primary key default gen_random_uuid(),
    inference_id uuid not null references public.ai_inference_events(id) on delete cascade,
    tenant_id text not null,
    phi_hat double precision not null,
    delta_rolling double precision,
    sigma_delta double precision,
    cps double precision not null,
    input_m_hat double precision,
    safety_state text not null check (safety_state in ('nominal', 'warning', 'critical', 'blocked')),
    reliability_badge text not null check (reliability_badge in ('HIGH', 'REVIEW', 'CAUTION', 'SUPPRESSED')),
    created_at timestamptz not null default now()
);

create table if not exists public.cire_incidents (
    id uuid primary key default gen_random_uuid(),
    inference_id uuid not null references public.ai_inference_events(id) on delete cascade,
    tenant_id text not null,
    safety_state text not null check (safety_state in ('nominal', 'warning', 'critical', 'blocked')),
    phi_hat double precision,
    cps double precision,
    input_summary jsonb not null default '{}'::jsonb,
    resolution_notes text,
    resolved boolean not null default false,
    resolved_at timestamptz,
    resolved_by text,
    created_at timestamptz not null default now()
);

create table if not exists public.cire_collapse_profiles (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    model_version text not null,
    phi_baseline double precision not null,
    m_threshold_map jsonb not null,
    hii double precision,
    phi_curve jsonb not null default '[]'::jsonb,
    calibrated_at timestamptz not null default now(),
    simulation_id uuid references public.simulations(id) on delete set null
);

create table if not exists public.cire_rolling_state (
    tenant_id text primary key,
    phi_ema double precision not null default 1.0,
    delta_ema double precision not null default 0.0,
    sigma_buffer double precision[] not null default '{}',
    window_count integer not null default 0,
    last_phi_hat double precision,
    updated_at timestamptz not null default now()
);

create index if not exists idx_cire_snapshots_tenant_created
    on public.cire_snapshots(tenant_id, created_at desc);

create index if not exists idx_cire_incidents_tenant_resolved_created
    on public.cire_incidents(tenant_id, resolved, created_at desc);

create index if not exists idx_cire_profiles_tenant_calibrated
    on public.cire_collapse_profiles(tenant_id, calibrated_at desc);

create table if not exists public.sovereign_clients (
    id uuid primary key default gen_random_uuid(),
    api_key text unique not null,
    name text not null,
    email text not null,
    plan text not null default 'starter' check (plan in ('starter', 'pro', 'enterprise')),
    runs_used integer not null default 0,
    runs_limit integer not null default 1,
    created_at timestamptz not null default now()
);

create table if not exists public.sovereign_registrations (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.sovereign_clients(id) on delete cascade,
    system_name text not null,
    system_type text not null check (system_type in ('llm', 'classifier', 'diagnostic', 'custom')),
    inference_endpoint text not null,
    auth_header text,
    input_schema jsonb not null,
    output_schema jsonb not null,
    phi_field_path text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.sovereign_runs (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.sovereign_clients(id) on delete cascade,
    registration_id uuid references public.sovereign_registrations(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed', 'blocked')),
    config jsonb not null,
    phi_curve jsonb,
    collapse_profile jsonb,
    hii double precision,
    report_url text,
    sentinel_config jsonb,
    summary jsonb not null default '{}'::jsonb,
    error_message text,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists idx_sovereign_registrations_client_created
    on public.sovereign_registrations(client_id, created_at desc);

create index if not exists idx_sovereign_runs_client_created
    on public.sovereign_runs(client_id, created_at desc);

create index if not exists idx_sovereign_runs_registration_created
    on public.sovereign_runs(registration_id, created_at desc);
