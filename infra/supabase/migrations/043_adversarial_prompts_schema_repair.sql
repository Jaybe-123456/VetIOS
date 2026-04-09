-- =============================================================================
-- Migration 043: Adversarial prompt schema repair
-- Ensures older environments have the full adversarial prompt library columns
-- required by the Simulation Workbench and refreshes the schema cache.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.adversarial_prompts (
    id uuid primary key default gen_random_uuid(),
    tenant_id text,
    category text not null check (category in (
        'jailbreak',
        'injection',
        'gibberish',
        'extreme_length',
        'multilingual',
        'sensitive_topic',
        'rare_species',
        'conflicting_inputs'
    )),
    prompt text not null,
    expected_behavior text not null,
    severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
    active boolean not null default true,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint adversarial_prompts_scope_unique unique (tenant_id, prompt)
);

alter table public.adversarial_prompts
    add column if not exists tenant_id text,
    add column if not exists expected_behavior text,
    add column if not exists severity text default 'medium',
    add column if not exists active boolean default true,
    add column if not exists created_by text,
    add column if not exists created_at timestamptz default now(),
    add column if not exists updated_at timestamptz default now();

update public.adversarial_prompts
set
    expected_behavior = coalesce(nullif(expected_behavior, ''), 'refuse_or_handle_safely'),
    severity = case
        when severity in ('low', 'medium', 'high') then severity
        else 'medium'
    end,
    active = coalesce(active, true),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now())
where expected_behavior is null
   or severity is null
   or active is null
   or created_at is null
   or updated_at is null;

alter table public.adversarial_prompts
    alter column category set not null,
    alter column prompt set not null,
    alter column expected_behavior set not null,
    alter column severity set not null,
    alter column active set not null,
    alter column created_at set not null,
    alter column updated_at set not null,
    alter column severity set default 'medium',
    alter column active set default true,
    alter column created_at set default now(),
    alter column updated_at set default now();

alter table public.adversarial_prompts
    drop constraint if exists adversarial_prompts_category_check;

alter table public.adversarial_prompts
    add constraint adversarial_prompts_category_check
    check (category in (
        'jailbreak',
        'injection',
        'gibberish',
        'extreme_length',
        'multilingual',
        'sensitive_topic',
        'rare_species',
        'conflicting_inputs'
    ));

alter table public.adversarial_prompts
    drop constraint if exists adversarial_prompts_severity_check;

alter table public.adversarial_prompts
    add constraint adversarial_prompts_severity_check
    check (severity in ('low', 'medium', 'high'));

create unique index if not exists idx_adversarial_prompts_scope_unique
    on public.adversarial_prompts (tenant_id, prompt);

create index if not exists idx_adversarial_prompts_category_active
    on public.adversarial_prompts (category, active);

notify pgrst, 'reload schema';
