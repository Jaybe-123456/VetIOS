-- VetIOS outcome-data moat: append-only daily snapshot ledger.
-- Converts confirmed case collection into an auditable validation asset.
-- Raw patient names, owner identifiers, contacts, microchip IDs, and symptom text are not stored here.

create extension if not exists pgcrypto;

create table if not exists public.clinical_outcome_moat_snapshots (
    id                              uuid primary key default gen_random_uuid(),
    tenant_id                       text not null,

    snapshot_key                    text not null unique,
    snapshot_date                   date not null,

    total_cases                     int not null default 0,
    confirmed_cases                 int not null default 0,
    pending_cases                   int not null default 0,
    outcome_events                  int not null default 0,
    deidentified_learning_signals   int not null default 0,
    confirmed_last_7d               int not null default 0,
    label_count                     int not null default 0,
    validation_target               int not null default 200,
    validation_progress             double precision not null default 0,
    ready_for_validation            boolean not null default false,

    open_cases                      int not null default 0,
    closed_cases                    int not null default 0,
    overdue_open_cases              int not null default 0,
    closure_rate                    double precision not null default 0,
    inferred_closure_rate           double precision not null default 0,
    average_hours_to_closure        double precision,
    median_hours_to_closure         double precision,

    top_labels                      jsonb not null default '[]'::jsonb,
    closure_backlog                 jsonb not null default '[]'::jsonb,
    metrics_payload                 jsonb not null default '{}'::jsonb,
    warnings                        text[] not null default '{}'::text[],

    generated_from                  text not null default 'case_closure_digest',
    created_at                      timestamptz not null default now()
);

create or replace function public.prevent_clinical_outcome_moat_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'clinical_outcome_moat_snapshots is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_clinical_outcome_moat_snapshots
    on public.clinical_outcome_moat_snapshots;

create trigger enforce_immutability_clinical_outcome_moat_snapshots
    before update or delete on public.clinical_outcome_moat_snapshots
    for each row execute function public.prevent_clinical_outcome_moat_snapshot_mutation();

create index if not exists idx_clinical_outcome_moat_snapshots_tenant_date
    on public.clinical_outcome_moat_snapshots (tenant_id, snapshot_date desc, created_at desc);

create index if not exists idx_clinical_outcome_moat_snapshots_validation
    on public.clinical_outcome_moat_snapshots (ready_for_validation, confirmed_cases desc, created_at desc);

create index if not exists idx_clinical_outcome_moat_snapshots_learning
    on public.clinical_outcome_moat_snapshots (tenant_id, deidentified_learning_signals desc, created_at desc);

alter table public.clinical_outcome_moat_snapshots enable row level security;

drop policy if exists clinical_outcome_moat_snapshots_select_own
    on public.clinical_outcome_moat_snapshots;

create policy clinical_outcome_moat_snapshots_select_own
    on public.clinical_outcome_moat_snapshots
    for select
    using (tenant_id = auth.uid()::text or auth.role() = 'service_role');

drop policy if exists clinical_outcome_moat_snapshots_insert_own
    on public.clinical_outcome_moat_snapshots;

create policy clinical_outcome_moat_snapshots_insert_own
    on public.clinical_outcome_moat_snapshots
    for insert
    with check (tenant_id = auth.uid()::text or auth.role() = 'service_role');

grant select, insert on public.clinical_outcome_moat_snapshots to authenticated, service_role;

notify pgrst, 'reload schema';
