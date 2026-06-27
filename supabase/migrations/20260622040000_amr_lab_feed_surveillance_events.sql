create extension if not exists pgcrypto;

create table if not exists public.amr_lab_feed_surveillance_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    amr_stewardship_event_id uuid references public.amr_stewardship_events(id) on delete set null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    inference_event_id uuid references public.ai_inference_events(id) on delete set null,
    clinical_outcome_id uuid references public.clinical_outcome_events(id) on delete set null,
    species text not null,
    pathogen_label text,
    pathogen_key text,
    infection_site text,
    sample_source text,
    drug_name text not null,
    drug_class text,
    ast_method text,
    culture_collected boolean not null default false,
    culture_result text,
    lab_feed_status text not null,
    surveillance_score numeric(5, 4) not null default 0,
    resistance_signal_score numeric(5, 4) not null default 0,
    ast_panel_drug_count integer not null default 0,
    mic_result_count integer not null default 0,
    susceptibility_result_count integer not null default 0,
    resistance_gene_count integer not null default 0,
    resistance_class_count integer not null default 0,
    lab_partner_feed_ready boolean not null default false,
    one_health_export_ready boolean not null default false,
    trend_bucket_key text not null,
    source_record_digest text not null,
    packet_hash text not null,
    ast_panel_hash text not null,
    mic_results_hash text not null,
    evidence_hash text not null,
    surveillance_packet jsonb not null default '{}'::jsonb,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    next_actions text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint amr_lab_feed_surveillance_tenant_request_key unique (tenant_id, request_id),
    constraint amr_lab_feed_surveillance_status_check
        check (lab_feed_status in (
            'blocked',
            'culture_pending',
            'ast_ready',
            'resistance_signal',
            'one_health_export_ready'
        )),
    constraint amr_lab_feed_surveillance_score_check
        check (
            surveillance_score >= 0
            and surveillance_score <= 1
            and resistance_signal_score >= 0
            and resistance_signal_score <= 1
        ),
    constraint amr_lab_feed_surveillance_count_check
        check (
            ast_panel_drug_count >= 0
            and mic_result_count >= 0
            and susceptibility_result_count >= 0
            and resistance_gene_count >= 0
            and resistance_class_count >= 0
        ),
    constraint amr_lab_feed_surveillance_hash_check
        check (
            source_record_digest ~ '^[a-f0-9]{64}$'
            and packet_hash ~ '^[a-f0-9]{64}$'
            and ast_panel_hash ~ '^[a-f0-9]{64}$'
            and mic_results_hash ~ '^[a-f0-9]{64}$'
            and evidence_hash ~ '^[a-f0-9]{64}$'
        )
);

create index if not exists idx_amr_lab_feed_surveillance_tenant_created
    on public.amr_lab_feed_surveillance_events (tenant_id, created_at desc);

create index if not exists idx_amr_lab_feed_surveillance_status
    on public.amr_lab_feed_surveillance_events
        (tenant_id, lab_feed_status, observed_at desc);

create index if not exists idx_amr_lab_feed_surveillance_trend
    on public.amr_lab_feed_surveillance_events
        (trend_bucket_key, observed_at desc);

create index if not exists idx_amr_lab_feed_surveillance_pathogen_drug
    on public.amr_lab_feed_surveillance_events
        (species, pathogen_key, drug_class, observed_at desc);

create index if not exists idx_amr_lab_feed_surveillance_stewardship
    on public.amr_lab_feed_surveillance_events (amr_stewardship_event_id)
    where amr_stewardship_event_id is not null;

create index if not exists idx_amr_lab_feed_surveillance_packet_gin
    on public.amr_lab_feed_surveillance_events using gin (surveillance_packet);

create index if not exists idx_amr_lab_feed_surveillance_blockers_gin
    on public.amr_lab_feed_surveillance_events using gin (blockers);

create index if not exists idx_amr_lab_feed_surveillance_evidence_gin
    on public.amr_lab_feed_surveillance_events using gin (evidence);

create or replace function public.prevent_amr_lab_feed_surveillance_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'amr_lab_feed_surveillance_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_amr_lab_feed_surveillance_events
    on public.amr_lab_feed_surveillance_events;
create trigger enforce_immutability_amr_lab_feed_surveillance_events
    before update or delete on public.amr_lab_feed_surveillance_events
    for each row execute function public.prevent_amr_lab_feed_surveillance_event_mutation();

alter table public.amr_lab_feed_surveillance_events enable row level security;

drop policy if exists amr_lab_feed_surveillance_events_select_tenant
    on public.amr_lab_feed_surveillance_events;
create policy amr_lab_feed_surveillance_events_select_tenant
    on public.amr_lab_feed_surveillance_events
    for select using (tenant_id = auth.uid());

drop policy if exists amr_lab_feed_surveillance_events_insert_tenant
    on public.amr_lab_feed_surveillance_events;
create policy amr_lab_feed_surveillance_events_insert_tenant
    on public.amr_lab_feed_surveillance_events
    for insert with check (tenant_id = auth.uid());

drop policy if exists "service_role_amr_lab_feed_surveillance_events"
    on public.amr_lab_feed_surveillance_events;
create policy "service_role_amr_lab_feed_surveillance_events"
    on public.amr_lab_feed_surveillance_events for all to service_role using (true) with check (true);

comment on table public.amr_lab_feed_surveillance_events is
    'Append-only AMR lab-feed surveillance ledger for AST/culture imports, pathogen/drug normalization, resistance signal scoring, trend buckets, and One Health export readiness. Stores de-identified derived facts and hashes only.';

comment on column public.amr_lab_feed_surveillance_events.surveillance_packet is
    'De-identified AMR lab-feed packet. Do not store raw lab reports, owner data, patient identifiers, or full external documents here.';

comment on column public.amr_lab_feed_surveillance_events.trend_bucket_key is
    'Normalized species-pathogen-site-drug trend key for resistance surveillance dashboards and One Health aggregate exports.';

notify pgrst, 'reload schema';
