-- VetIOS moat expansion modules.
-- Adds append-only contracts for intake, population calibration, ADR/pharma,
-- species priors, imaging, lab agents, audit chain, teleconsult, outbreak,
-- and realtime telemetry surfaces.

create extension if not exists pgcrypto;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'vetios_current_tenant_uuid'
    ) then
        execute $fn$
            create function public.vetios_current_tenant_uuid()
            returns uuid
            language sql
            stable
            as $inner$
                select coalesce(
                    nullif(current_setting('app.tenant_id', true), '')::uuid,
                    auth.uid()
                )
            $inner$;
        $fn$;
    end if;
end $$;

create or replace function public.vetios_prevent_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception '% is append-only; insert a new event row instead', tg_table_name;
end;
$$;

create or replace function public.vetios_set_event_hash()
returns trigger
language plpgsql
as $$
declare
    tenant_text text := coalesce(to_jsonb(new)->>'tenant_id', to_jsonb(new)->>'source_tenant_hash', 'network');
    previous_hash text;
    row_payload jsonb;
    content_hash text;
begin
    if new.event_hash is not null then
        return new;
    end if;

    if to_jsonb(new) ? 'tenant_id' then
        execute format(
            'select event_hash from public.%I where event_hash is not null and tenant_id::text = $1 order by created_at desc limit 1',
            tg_table_name
        )
        into previous_hash
        using tenant_text;
    else
        execute format(
            'select event_hash from public.%I where event_hash is not null order by created_at desc limit 1',
            tg_table_name
        )
        into previous_hash;
    end if;

    new.prev_event_hash := coalesce(new.prev_event_hash, previous_hash);
    row_payload := to_jsonb(new) - 'event_hash' - 'prev_event_hash';
    content_hash := encode(digest(row_payload::text, 'sha256'), 'hex');
    new.event_hash := encode(
        digest(
            coalesce(new.prev_event_hash, '')
            || ':' || tg_table_name
            || ':' || tenant_text
            || ':' || coalesce(to_jsonb(new)->>'created_at', now()::text)
            || ':' || content_hash,
            'sha256'
        ),
        'hex'
    );

    return new;
end;
$$;

alter table public.ai_inference_events
    add column if not exists event_hash text,
    add column if not exists prev_event_hash text,
    add column if not exists parent_inference_event_id uuid references public.ai_inference_events(id) on delete set null;

alter table public.clinical_outcome_events
    add column if not exists event_hash text,
    add column if not exists prev_event_hash text;

alter table public.edge_simulation_events
    add column if not exists event_hash text,
    add column if not exists prev_event_hash text,
    add column if not exists species_group text check (species_group is null or species_group in ('exotic', 'livestock', 'companion', 'mixed'));

create table if not exists public.intake_sessions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    patient_id uuid not null references public.patients(id) on delete cascade,
    species text not null check (species in ('canine','feline','equine','bovine','ovine','caprine','porcine','avian','reptile','rabbit','ferret','other')),
    weight_kg double precision check (weight_kg is null or weight_kg > 0),
    age_years double precision check (age_years is null or age_years >= 0),
    presenting_symptoms jsonb not null default '[]'::jsonb check (jsonb_typeof(presenting_symptoms) = 'array'),
    vitals jsonb not null default '{}'::jsonb check (jsonb_typeof(vitals) = 'object'),
    medications_current jsonb not null default '[]'::jsonb check (jsonb_typeof(medications_current) = 'array'),
    imaging_study_ids uuid[] not null default array[]::uuid[],
    modality text not null default 'in_clinic' check (modality in ('in_clinic','telemedicine','asynchronous')),
    teleconsult_session_id uuid,
    teleconsult_provider_id text,
    intake_completed_at timestamptz not null default now(),
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    status text not null default 'pending' check (status in ('pending','inferred','reviewed')),
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.population_signals (
    id uuid primary key default gen_random_uuid(),
    signal_hash text not null,
    species text not null,
    region_code text,
    symptom_vector jsonb not null default '[]'::jsonb check (jsonb_typeof(symptom_vector) = 'array'),
    outcome_label text not null,
    confidence_delta double precision,
    source_tenant_hash text not null,
    source_inference_event_hash text,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.calibration_runs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    run_at timestamptz not null default now(),
    signals_consumed integer not null default 0 check (signals_consumed >= 0),
    species_breakdowns jsonb not null default '{}'::jsonb check (jsonb_typeof(species_breakdowns) = 'object'),
    confidence_shift_mean double precision,
    confidence_shift_p95 double precision,
    model_version_before text,
    model_version_after text,
    status text not null default 'completed' check (status in ('started','completed','failed')),
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.species_knowledge_graph (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    species text not null check (species in ('canine','feline','equine','bovine','ovine','caprine','porcine','avian','reptile','rabbit','ferret','other')),
    condition_code text not null,
    condition_name text not null,
    symptom_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(symptom_codes) = 'array'),
    typical_vitals_range jsonb not null default '{}'::jsonb check (jsonb_typeof(typical_vitals_range) = 'object'),
    pharmacological_contraindications jsonb not null default '[]'::jsonb check (jsonb_typeof(pharmacological_contraindications) in ('array','object')),
    prevalence_weight double precision not null default 0.5 check (prevalence_weight >= 0 and prevalence_weight <= 1),
    source text not null check (source in ('simulated','clinical','literature')),
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.adverse_event_signals (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    signal_id uuid not null default gen_random_uuid(),
    species text not null,
    drug_code text not null,
    drug_class text not null,
    symptom_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(symptom_codes) = 'array'),
    outcome_severity text not null check (outcome_severity in ('mild','moderate','severe','fatal')),
    time_to_onset_hours double precision check (time_to_onset_hours is null or time_to_onset_hours >= 0),
    outcome_label text not null,
    source_signal_hash text not null,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.pharma_licensees (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    name text not null,
    api_key_hash text not null,
    stripe_subscription_id text,
    species_filter jsonb not null default '[]'::jsonb check (jsonb_typeof(species_filter) = 'array'),
    drug_class_filter jsonb not null default '[]'::jsonb check (jsonb_typeof(drug_class_filter) = 'array'),
    webhook_url text,
    active boolean not null default true,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.pharma_webhook_subscriptions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    licensee_id uuid references public.pharma_licensees(id) on delete cascade,
    webhook_url text not null,
    drug_class_filter jsonb not null default '[]'::jsonb,
    species_filter jsonb not null default '[]'::jsonb,
    active boolean not null default true,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.imaging_studies (
    id uuid primary key default gen_random_uuid(),
    study_id text not null,
    patient_id uuid not null references public.patients(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    modality text not null check (modality in ('xray','ultrasound','ct','mri','endoscopy')),
    body_region text not null,
    species text not null,
    acquisition_at timestamptz not null,
    storage_url text not null,
    thumbnail_url text,
    inference_enrichment jsonb not null default '{}'::jsonb check (jsonb_typeof(inference_enrichment) = 'object'),
    linked_inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    study_hash text,
    status text not null default 'received' check (status in ('received','processed','enriched','linked')),
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.lab_recommendations (
    id uuid primary key default gen_random_uuid(),
    inference_event_id uuid not null references public.ai_inference_events(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    patient_id uuid references public.patients(id) on delete set null,
    recommended_panels jsonb not null default '[]'::jsonb check (jsonb_typeof(recommended_panels) = 'array'),
    agent_confidence double precision check (agent_confidence is null or (agent_confidence >= 0 and agent_confidence <= 1)),
    status text not null default 'recommended' check (status in ('recommended','ordered','partial_results','complete')),
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.lab_results (
    id uuid primary key default gen_random_uuid(),
    lab_recommendation_id uuid not null references public.lab_recommendations(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    panel_code text not null,
    result_value double precision not null,
    unit text not null,
    reference_range_low double precision,
    reference_range_high double precision,
    result_interpretation text not null check (result_interpretation in ('normal','low','high','critical_low','critical_high')),
    received_at timestamptz not null,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.audit_chain_checkpoints (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    checkpoint_at timestamptz not null default now(),
    case_event_count integer not null default 0 check (case_event_count >= 0),
    chain_root_hash text,
    chain_tip_hash text,
    verified boolean not null default false,
    verifier_run_id text,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.audit_licensees (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    name text not null,
    organization_type text not null check (organization_type in ('insurer','hospital_group','regulator','legal')),
    api_key_hash text not null,
    stripe_subscription_id text,
    access_scope jsonb not null default '{}'::jsonb,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.symptom_cluster_snapshots (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    region_code text not null,
    species text not null,
    symptom_signature jsonb not null default '[]'::jsonb check (jsonb_typeof(symptom_signature) = 'array'),
    case_count_7d integer not null default 0 check (case_count_7d >= 0),
    case_count_prev_7d integer not null default 0 check (case_count_prev_7d >= 0),
    velocity double precision not null default 0,
    cluster_created_at timestamptz not null default now(),
    suggested_differential text,
    confidence double precision,
    status text not null default 'monitoring' check (status in ('monitoring','elevated','alert','resolved')),
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.outbreak_subscribers (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    organization_name text not null,
    webhook_url text not null,
    region_filter jsonb not null default '[]'::jsonb,
    species_filter jsonb not null default '[]'::jsonb,
    active boolean not null default true,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.telemetry_streams (
    id uuid not null default gen_random_uuid(),
    patient_id uuid not null references public.patients(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    device_id text not null,
    device_type text not null check (device_type in ('collar','implant','patch','external_monitor')),
    metric_type text not null check (metric_type in ('heart_rate_bpm','temperature_c','respiratory_rate_bpm','activity_score','spo2_pct','glucose_mmol')),
    value double precision not null,
    recorded_at timestamptz not null,
    quality_score double precision not null default 1 check (quality_score >= 0 and quality_score <= 1),
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now(),
    primary key (id, recorded_at)
) partition by range (recorded_at);

create table if not exists public.telemetry_streams_default
    partition of public.telemetry_streams default;

create table if not exists public.telemetry_anomaly_events (
    id uuid primary key default gen_random_uuid(),
    patient_id uuid not null references public.patients(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    device_id text not null,
    metric_type text not null check (metric_type in ('heart_rate_bpm','temperature_c','respiratory_rate_bpm','activity_score','spo2_pct','glucose_mmol')),
    anomaly_type text not null check (anomaly_type in ('high','low','rapid_change','flatline')),
    severity text not null check (severity in ('mild','moderate','critical')),
    triggered_inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    resolved_at timestamptz,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.cron_run_log (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id) on delete cascade,
    job_name text not null,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    records_processed integer not null default 0 check (records_processed >= 0),
    status text not null default 'started' check (status in ('started','completed','failed')),
    error_message text,
    event_hash text,
    prev_event_hash text,
    created_at timestamptz not null default now()
);

create index if not exists idx_intake_sessions_tenant_patient_created on public.intake_sessions (tenant_id, patient_id, created_at desc);
create index if not exists idx_intake_sessions_inference on public.intake_sessions (inference_event_id);
create index if not exists idx_population_signals_hash on public.population_signals (signal_hash);
create index if not exists idx_population_signals_cluster on public.population_signals (region_code, species, created_at desc);
create index if not exists idx_calibration_runs_run_at on public.calibration_runs (run_at desc);
create index if not exists idx_species_kg_species_condition on public.species_knowledge_graph (species, condition_code, created_at desc);
create index if not exists idx_adverse_event_drug_cluster on public.adverse_event_signals (drug_code, drug_class, species, created_at desc);
create index if not exists idx_pharma_licensees_key on public.pharma_licensees (api_key_hash) where active = true;
create index if not exists idx_imaging_studies_tenant_patient on public.imaging_studies (tenant_id, patient_id, created_at desc);
create index if not exists idx_lab_recommendations_inference on public.lab_recommendations (tenant_id, inference_event_id, created_at desc);
create index if not exists idx_lab_results_recommendation on public.lab_results (lab_recommendation_id, created_at desc);
create index if not exists idx_audit_checkpoints_tenant on public.audit_chain_checkpoints (tenant_id, checkpoint_at desc);
create index if not exists idx_audit_licensees_key on public.audit_licensees (api_key_hash);
create index if not exists idx_symptom_cluster_active on public.symptom_cluster_snapshots (status, region_code, species, created_at desc);
create index if not exists idx_outbreak_subscribers_active on public.outbreak_subscribers (active, created_at desc);
create index if not exists idx_telemetry_streams_patient_metric_time on public.telemetry_streams (tenant_id, patient_id, metric_type, recorded_at desc);
create index if not exists idx_telemetry_anomalies_patient_time on public.telemetry_anomaly_events (tenant_id, patient_id, created_at desc);
create index if not exists idx_cron_run_log_job_time on public.cron_run_log (job_name, started_at desc);

do $$
declare
    tbl text;
begin
    foreach tbl in array array[
        'intake_sessions',
        'species_knowledge_graph',
        'adverse_event_signals',
        'pharma_licensees',
        'pharma_webhook_subscriptions',
        'imaging_studies',
        'lab_recommendations',
        'lab_results',
        'audit_chain_checkpoints',
        'audit_licensees',
        'symptom_cluster_snapshots',
        'outbreak_subscribers',
        'telemetry_streams',
        'telemetry_anomaly_events',
        'cron_run_log'
    ] loop
        execute format('alter table public.%I enable row level security', tbl);
        execute format('drop policy if exists %I on public.%I', tbl || '_tenant_select', tbl);
        execute format(
            'create policy %I on public.%I for select using (tenant_id is null or tenant_id = public.vetios_current_tenant_uuid())',
            tbl || '_tenant_select',
            tbl
        );
        execute format('drop policy if exists %I on public.%I', tbl || '_tenant_insert', tbl);
        execute format(
            'create policy %I on public.%I for insert with check (tenant_id is null or tenant_id = public.vetios_current_tenant_uuid())',
            tbl || '_tenant_insert',
            tbl
        );
    end loop;
end $$;

alter table public.population_signals enable row level security;
alter table public.calibration_runs enable row level security;

do $$
declare
    tbl text;
begin
    foreach tbl in array array[
        'ai_inference_events',
        'clinical_outcome_events',
        'edge_simulation_events',
        'intake_sessions',
        'population_signals',
        'calibration_runs',
        'species_knowledge_graph',
        'adverse_event_signals',
        'pharma_licensees',
        'pharma_webhook_subscriptions',
        'imaging_studies',
        'lab_recommendations',
        'lab_results',
        'audit_chain_checkpoints',
        'audit_licensees',
        'symptom_cluster_snapshots',
        'outbreak_subscribers',
        'telemetry_streams',
        'telemetry_anomaly_events',
        'cron_run_log'
    ] loop
        execute format('drop trigger if exists set_event_hash_%I on public.%I', tbl, tbl);
        execute format(
            'create trigger set_event_hash_%I before insert on public.%I for each row execute function public.vetios_set_event_hash()',
            tbl,
            tbl
        );
    end loop;
end $$;

do $$
declare
    tbl text;
begin
    foreach tbl in array array[
        'intake_sessions',
        'population_signals',
        'calibration_runs',
        'species_knowledge_graph',
        'adverse_event_signals',
        'pharma_licensees',
        'pharma_webhook_subscriptions',
        'imaging_studies',
        'lab_recommendations',
        'lab_results',
        'audit_chain_checkpoints',
        'audit_licensees',
        'symptom_cluster_snapshots',
        'outbreak_subscribers',
        'telemetry_streams',
        'telemetry_anomaly_events',
        'cron_run_log'
    ] loop
        execute format('drop trigger if exists prevent_update_%I on public.%I', tbl, tbl);
        execute format('drop trigger if exists prevent_delete_%I on public.%I', tbl, tbl);
        execute format(
            'create trigger prevent_update_%I before update on public.%I for each row execute function public.vetios_prevent_event_mutation()',
            tbl,
            tbl
        );
        execute format(
            'create trigger prevent_delete_%I before delete on public.%I for each row execute function public.vetios_prevent_event_mutation()',
            tbl,
            tbl
        );
    end loop;
end $$;

comment on table public.intake_sessions is 'Module 1: append-only structured intake sessions that trigger inference.';
comment on table public.population_signals is 'Module 2: anonymized cross-clinic learning signals with no tenant_id.';
comment on table public.adverse_event_signals is 'Module 3: anonymized adverse drug reaction signals for research-tier licensees.';
comment on table public.species_knowledge_graph is 'Module 4: append-only species priors for exotic and livestock inference.';
comment on table public.imaging_studies is 'Module 5: hardware-agnostic imaging study ingestion and structured enrichment.';
comment on table public.lab_recommendations is 'Module 6: autonomous lab ordering agent recommendations.';
comment on table public.audit_chain_checkpoints is 'Module 7: hourly audit hash-chain checkpoint records.';
comment on table public.symptom_cluster_snapshots is 'Module 9: outbreak early-warning symptom cluster snapshots.';
comment on table public.telemetry_streams is 'Module 10: month-partitioned wearable and IoT telemetry readings.';

-- Down migration, if a manual rollback is required:
-- drop new triggers first, then drop the module tables in reverse dependency
-- order, then drop event_hash/prev_event_hash columns from the three existing
-- core event tables. This project keeps forward-only Supabase migrations.

notify pgrst, 'reload schema';
