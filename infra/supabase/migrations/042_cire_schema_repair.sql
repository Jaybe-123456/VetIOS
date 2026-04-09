-- =============================================================================
-- Migration 042: CIRE schema repair
-- Ensures the full CIRE schema exists in environments where 041 was skipped
-- or only partially applied, and refreshes the PostgREST schema cache.
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

alter table public.cire_snapshots
    add column if not exists inference_id uuid references public.ai_inference_events(id) on delete cascade,
    add column if not exists tenant_id text,
    add column if not exists phi_hat double precision,
    add column if not exists delta_rolling double precision,
    add column if not exists sigma_delta double precision,
    add column if not exists cps double precision,
    add column if not exists input_m_hat double precision,
    add column if not exists safety_state text,
    add column if not exists reliability_badge text,
    add column if not exists created_at timestamptz default now();

update public.cire_snapshots
set
    tenant_id = coalesce(nullif(tenant_id, ''), 'system'),
    phi_hat = coalesce(phi_hat, 1.0),
    cps = coalesce(cps, 0.0),
    safety_state = case
        when safety_state in ('nominal', 'warning', 'critical', 'blocked') then safety_state
        else 'warning'
    end,
    reliability_badge = case
        when reliability_badge in ('HIGH', 'REVIEW', 'CAUTION', 'SUPPRESSED') then reliability_badge
        else 'REVIEW'
    end,
    created_at = coalesce(created_at, now())
where tenant_id is null
   or phi_hat is null
   or cps is null
   or safety_state is null
   or reliability_badge is null
   or created_at is null;

alter table public.cire_snapshots
    alter column inference_id set not null,
    alter column tenant_id set not null,
    alter column phi_hat set not null,
    alter column cps set not null,
    alter column safety_state set not null,
    alter column reliability_badge set not null,
    alter column created_at set not null,
    alter column created_at set default now();

alter table public.cire_snapshots
    drop constraint if exists cire_snapshots_safety_state_check;

alter table public.cire_snapshots
    add constraint cire_snapshots_safety_state_check
    check (safety_state in ('nominal', 'warning', 'critical', 'blocked'));

alter table public.cire_snapshots
    drop constraint if exists cire_snapshots_reliability_badge_check;

alter table public.cire_snapshots
    add constraint cire_snapshots_reliability_badge_check
    check (reliability_badge in ('HIGH', 'REVIEW', 'CAUTION', 'SUPPRESSED'));

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

alter table public.cire_incidents
    add column if not exists inference_id uuid references public.ai_inference_events(id) on delete cascade,
    add column if not exists tenant_id text,
    add column if not exists safety_state text,
    add column if not exists phi_hat double precision,
    add column if not exists cps double precision,
    add column if not exists input_summary jsonb default '{}'::jsonb,
    add column if not exists resolution_notes text,
    add column if not exists resolved boolean default false,
    add column if not exists resolved_at timestamptz,
    add column if not exists resolved_by text,
    add column if not exists created_at timestamptz default now();

update public.cire_incidents
set
    tenant_id = coalesce(nullif(tenant_id, ''), 'system'),
    safety_state = case
        when safety_state in ('nominal', 'warning', 'critical', 'blocked') then safety_state
        else 'warning'
    end,
    input_summary = coalesce(input_summary, '{}'::jsonb),
    resolved = coalesce(resolved, false),
    created_at = coalesce(created_at, now())
where tenant_id is null
   or safety_state is null
   or input_summary is null
   or resolved is null
   or created_at is null;

alter table public.cire_incidents
    alter column inference_id set not null,
    alter column tenant_id set not null,
    alter column safety_state set not null,
    alter column input_summary set not null,
    alter column resolved set not null,
    alter column created_at set not null,
    alter column input_summary set default '{}'::jsonb,
    alter column resolved set default false,
    alter column created_at set default now();

alter table public.cire_incidents
    drop constraint if exists cire_incidents_safety_state_check;

alter table public.cire_incidents
    add constraint cire_incidents_safety_state_check
    check (safety_state in ('nominal', 'warning', 'critical', 'blocked'));

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

alter table public.cire_collapse_profiles
    add column if not exists tenant_id text,
    add column if not exists model_version text,
    add column if not exists phi_baseline double precision,
    add column if not exists m_threshold_map jsonb,
    add column if not exists hii double precision,
    add column if not exists phi_curve jsonb default '[]'::jsonb,
    add column if not exists calibrated_at timestamptz default now(),
    add column if not exists simulation_id uuid references public.simulations(id) on delete set null;

update public.cire_collapse_profiles
set
    tenant_id = coalesce(nullif(tenant_id, ''), 'system'),
    model_version = coalesce(nullif(model_version, ''), 'unknown'),
    phi_baseline = coalesce(phi_baseline, 1.0),
    m_threshold_map = coalesce(m_threshold_map, '{}'::jsonb),
    phi_curve = coalesce(phi_curve, '[]'::jsonb),
    calibrated_at = coalesce(calibrated_at, now())
where tenant_id is null
   or model_version is null
   or phi_baseline is null
   or m_threshold_map is null
   or phi_curve is null
   or calibrated_at is null;

alter table public.cire_collapse_profiles
    alter column tenant_id set not null,
    alter column model_version set not null,
    alter column phi_baseline set not null,
    alter column m_threshold_map set not null,
    alter column phi_curve set not null,
    alter column calibrated_at set not null,
    alter column phi_curve set default '[]'::jsonb,
    alter column calibrated_at set default now();

create table if not exists public.cire_rolling_state (
    tenant_id text primary key,
    phi_ema double precision not null default 1.0,
    delta_ema double precision not null default 0.0,
    sigma_buffer double precision[] not null default '{}',
    window_count integer not null default 0,
    last_phi_hat double precision,
    updated_at timestamptz not null default now()
);

alter table public.cire_rolling_state
    add column if not exists tenant_id text,
    add column if not exists phi_ema double precision default 1.0,
    add column if not exists delta_ema double precision default 0.0,
    add column if not exists sigma_buffer double precision[] default '{}',
    add column if not exists window_count integer default 0,
    add column if not exists last_phi_hat double precision,
    add column if not exists updated_at timestamptz default now();

update public.cire_rolling_state
set
    phi_ema = coalesce(phi_ema, 1.0),
    delta_ema = coalesce(delta_ema, 0.0),
    sigma_buffer = coalesce(sigma_buffer, '{}'),
    window_count = coalesce(window_count, 0),
    updated_at = coalesce(updated_at, now())
where phi_ema is null
   or delta_ema is null
   or sigma_buffer is null
   or window_count is null
   or updated_at is null;

alter table public.cire_rolling_state
    alter column tenant_id set not null,
    alter column phi_ema set not null,
    alter column delta_ema set not null,
    alter column sigma_buffer set not null,
    alter column window_count set not null,
    alter column updated_at set not null,
    alter column phi_ema set default 1.0,
    alter column delta_ema set default 0.0,
    alter column sigma_buffer set default '{}',
    alter column window_count set default 0,
    alter column updated_at set default now();

create index if not exists idx_cire_snapshots_tenant_created
    on public.cire_snapshots(tenant_id, created_at desc);

create index if not exists idx_cire_incidents_tenant_resolved_created
    on public.cire_incidents(tenant_id, resolved, created_at desc);

create index if not exists idx_cire_profiles_tenant_calibrated
    on public.cire_collapse_profiles(tenant_id, calibrated_at desc);

notify pgrst, 'reload schema';
