-- Cross-tenant learning flywheel exports and calibration drift reports.

alter table public.tenants
    add column if not exists data_sharing_consent boolean not null default false,
    add column if not exists data_sharing_consented_at timestamptz,
    add column if not exists data_sharing_anonymization_level text not null default 'full_anon';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'tenants_data_sharing_anonymization_level_check'
          and conrelid = 'public.tenants'::regclass
    ) then
        alter table public.tenants
            add constraint tenants_data_sharing_anonymization_level_check
            check (data_sharing_anonymization_level in ('full_anon', 'species_only', 'breed_species'));
    end if;
end $$;

create table if not exists public.flywheel_export_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    export_path text not null,
    storage_bucket text not null default 'vetios-training-data',
    row_count integer not null default 0,
    consenting_tenant_count integer not null default 0,
    content_sha256 text not null,
    milestone text,
    export_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_flywheel_export_events_tenant_created
    on public.flywheel_export_events (tenant_id, created_at desc);

create table if not exists public.calibration_drift_reports (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    species text not null,
    symptom_cluster text not null,
    report_window_start timestamptz not null,
    report_window_end timestamptz not null,
    case_count integer not null default 0,
    top1_accuracy double precision,
    top3_recall double precision,
    brier_score double precision,
    alert boolean not null default false,
    report_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_calibration_drift_reports_tenant_created
    on public.calibration_drift_reports (tenant_id, created_at desc);

create index if not exists idx_calibration_drift_reports_cluster
    on public.calibration_drift_reports (tenant_id, species, symptom_cluster, created_at desc);

alter table public.flywheel_export_events enable row level security;
alter table public.calibration_drift_reports enable row level security;

drop policy if exists flywheel_export_events_tenant_isolation on public.flywheel_export_events;
create policy flywheel_export_events_tenant_isolation
    on public.flywheel_export_events
    for all
    using (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        or auth.role() = 'service_role'
    )
    with check (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        or auth.role() = 'service_role'
    );

drop policy if exists calibration_drift_reports_tenant_isolation on public.calibration_drift_reports;
create policy calibration_drift_reports_tenant_isolation
    on public.calibration_drift_reports
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
