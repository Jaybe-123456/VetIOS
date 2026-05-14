-- Clinician case entry foundation.
-- Turns canonical clinical_cases into the clinician-facing intake and closure record
-- while preserving the existing inference -> outcome flywheel.

alter table public.clinical_cases
    add column if not exists case_status text not null default 'open',
    add column if not exists closed_at timestamptz,
    add column if not exists presenting_complaint text,
    add column if not exists history text,
    add column if not exists duration_text text,
    add column if not exists patient_name text,
    add column if not exists owner_name text,
    add column if not exists owner_contact jsonb not null default '{}'::jsonb,
    add column if not exists microchip_id text,
    add column if not exists date_of_birth date,
    add column if not exists sex text,
    add column if not exists age_years numeric(5,2),
    add column if not exists weight_kg numeric(7,2),
    add column if not exists vitals jsonb not null default '{}'::jsonb,
    add column if not exists physical_exam jsonb not null default '{}'::jsonb,
    add column if not exists labs jsonb not null default '{}'::jsonb,
    add column if not exists images jsonb not null default '[]'::jsonb,
    add column if not exists treatments jsonb not null default '[]'::jsonb,
    add column if not exists case_closure_summary jsonb not null default '{}'::jsonb;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'clinical_cases_case_status_check'
          and conrelid = 'public.clinical_cases'::regclass
    ) then
        alter table public.clinical_cases
            add constraint clinical_cases_case_status_check
            check (case_status in ('open', 'closed', 'referred'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'clinical_cases_sex_check'
          and conrelid = 'public.clinical_cases'::regclass
    ) then
        alter table public.clinical_cases
            add constraint clinical_cases_sex_check
            check (
                sex is null
                or sex in ('male', 'female', 'male_neutered', 'female_spayed', 'unknown')
            );
    end if;
end $$;

create index if not exists idx_clinical_cases_tenant_status_created
    on public.clinical_cases (tenant_id, case_status, created_at desc);

create index if not exists idx_clinical_cases_tenant_patient_name
    on public.clinical_cases (tenant_id, lower(patient_name))
    where patient_name is not null;

create table if not exists public.diagnosis_records (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    clinical_case_id uuid references public.clinical_cases(id) on delete cascade,
    encounter_id uuid,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    outcome_event_id uuid references public.clinical_outcome_events(id) on delete set null,
    confirmed_diagnosis text not null,
    diagnosis_method text check (
        diagnosis_method in (
            'clinical',
            'lab_confirmed',
            'imaging_confirmed',
            'pathology',
            'response_to_treatment'
        )
    ),
    clinician_notes text,
    treatment_initiated text[] not null default '{}',
    outcome_at_followup text,
    created_by uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists idx_diagnosis_records_tenant_created
    on public.diagnosis_records (tenant_id, created_at desc);

create index if not exists idx_diagnosis_records_case
    on public.diagnosis_records (tenant_id, clinical_case_id, created_at desc);

create index if not exists idx_diagnosis_records_inference
    on public.diagnosis_records (tenant_id, inference_event_id)
    where inference_event_id is not null;

alter table public.diagnosis_records enable row level security;

drop policy if exists diagnosis_records_tenant_isolation on public.diagnosis_records;
create policy diagnosis_records_tenant_isolation
    on public.diagnosis_records
    for all
    using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        or auth.role() = 'service_role'
    )
    with check (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        or auth.role() = 'service_role'
    );

notify pgrst, 'reload schema';
