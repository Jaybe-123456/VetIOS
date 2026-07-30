-- VetIOS AMR Network Operations and Private Exchange Kernel v1
-- Cryptographic connector probes, canonical culture/AST ingestion,
-- reconciliation, governed usage, and settlement evidence.

create extension if not exists pgcrypto;

create table if not exists public.amr_connector_probe_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    site_id uuid not null,
    connector_installation_id uuid references public.connector_installations(id) on delete set null,
    oauth_client_id uuid references public.oauth_clients(id) on delete set null,
    api_credential_id uuid references public.api_credentials(id) on delete set null,
    probe_type text not null,
    probe_status text not null,
    token_binding_method text not null,
    certificate_thumbprint_hash text,
    source_system text not null,
    connector_version text not null,
    schema_version text not null,
    observed_record_count integer not null default 0,
    latency_ms integer,
    oldest_record_at timestamptz,
    newest_record_at timestamptz,
    request_digest text not null,
    response_digest text not null,
    receipt_hash text not null,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint amr_connector_probe_tenant_request_key unique (tenant_id, request_id),
    constraint amr_connector_probe_type_check
        check (probe_type in ('dry_run', 'schema_validation', 'production_probe', 'heartbeat')),
    constraint amr_connector_probe_status_check
        check (probe_status in ('passed', 'failed', 'blocked')),
    constraint amr_connector_probe_binding_check
        check (token_binding_method in ('session', 'api_key', 'dpop', 'mtls')),
    constraint amr_connector_probe_counts_check
        check (
            observed_record_count >= 0
            and (latency_ms is null or latency_ms >= 0)
        ),
    constraint amr_connector_probe_hash_check
        check (
            request_digest ~ '^[a-f0-9]{64}$'
            and response_digest ~ '^[a-f0-9]{64}$'
            and receipt_hash ~ '^[a-f0-9]{64}$'
            and (
                certificate_thumbprint_hash is null
                or certificate_thumbprint_hash ~ '^[a-f0-9]{64}$'
            )
        ),
    constraint amr_connector_probe_production_proof_check
        check (
            probe_type not in ('production_probe', 'heartbeat')
            or probe_status <> 'passed'
            or (
                token_binding_method = 'mtls'
                and oauth_client_id is not null
                and certificate_thumbprint_hash is not null
                and (
                    probe_type = 'heartbeat'
                    or observed_record_count > 0
                )
                and cardinality(blockers) = 0
            )
        )
);

create table if not exists public.amr_ast_ingestion_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    site_id uuid not null,
    lab_site_id uuid not null,
    connector_probe_event_id uuid not null
        references public.amr_connector_probe_events(id) on delete restrict,
    connector_installation_id uuid references public.connector_installations(id) on delete set null,
    oauth_client_id uuid references public.oauth_clients(id) on delete set null,
    source_system text not null,
    source_version text,
    schema_version text not null,
    source_record_digest text not null,
    canonical_packet_hash text not null,
    isolate_ref_hash text not null,
    patient_ref_hash text,
    species text not null,
    breed text,
    production_class text,
    specimen_type text not null,
    anatomical_site text,
    country_code text,
    admin_area_hash text,
    organism_label text not null,
    organism_key text not null,
    organism_code_system text,
    organism_code text,
    culture_collected_at timestamptz,
    observed_at timestamptz not null,
    ast_method text not null,
    interpretation_standard text not null,
    interpretation_standard_version text not null,
    qc_status text not null,
    ingestion_status text not null,
    result_count integer not null default 0,
    deidentified boolean not null default true,
    is_synthetic boolean not null default false,
    raw_payload_stored boolean not null default false,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    actor_id text,
    created_at timestamptz not null default now(),

    constraint amr_ast_ingestion_tenant_request_key unique (tenant_id, request_id),
    constraint amr_ast_ingestion_status_check
        check (ingestion_status in ('accepted', 'blocked')),
    constraint amr_ast_ingestion_qc_check
        check (qc_status in ('passed', 'warning', 'failed', 'not_reported')),
    constraint amr_ast_ingestion_result_count_check check (result_count >= 0),
    constraint amr_ast_ingestion_country_check
        check (country_code is null or country_code ~ '^[A-Z]{2}$'),
    constraint amr_ast_ingestion_hash_check
        check (
            source_record_digest ~ '^[a-f0-9]{64}$'
            and canonical_packet_hash ~ '^[a-f0-9]{64}$'
            and isolate_ref_hash ~ '^[a-f0-9]{64}$'
            and (patient_ref_hash is null or patient_ref_hash ~ '^[a-f0-9]{64}$')
            and (admin_area_hash is null or admin_area_hash ~ '^[a-f0-9]{64}$')
        ),
    constraint amr_ast_ingestion_privacy_check check (raw_payload_stored is false),
    constraint amr_ast_ingestion_acceptance_check
        check (
            ingestion_status <> 'accepted'
            or (
                deidentified
                and not is_synthetic
                and qc_status <> 'failed'
                and result_count > 0
                and cardinality(blockers) = 0
            )
        )
);

create table if not exists public.amr_ast_result_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    ingestion_event_id uuid not null
        references public.amr_ast_ingestion_events(id) on delete restrict,
    result_index integer not null,
    antimicrobial_label text not null,
    antimicrobial_key text not null,
    antimicrobial_code_system text,
    antimicrobial_code text,
    drug_class text,
    measurement_type text not null,
    mic_value numeric,
    mic_operator text,
    mic_unit text,
    zone_diameter_mm numeric,
    qualitative_result text,
    interpretation text not null,
    breakpoint_value numeric,
    breakpoint_unit text,
    breakpoint_basis text,
    result_hash text not null,
    evidence jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null,
    created_at timestamptz not null default now(),

    constraint amr_ast_result_ingestion_index_key
        unique (ingestion_event_id, result_index),
    constraint amr_ast_result_measurement_check
        check (measurement_type in ('mic', 'disk_diffusion', 'qualitative')),
    constraint amr_ast_result_interpretation_check
        check (interpretation in ('S', 'I', 'R', 'SDD', 'NS', 'IE', 'UNKNOWN')),
    constraint amr_ast_result_mic_operator_check
        check (mic_operator is null or mic_operator in ('<', '<=', '=', '>=', '>')),
    constraint amr_ast_result_measurement_value_check
        check (
            (measurement_type = 'mic' and mic_value is not null and mic_unit is not null)
            or (measurement_type = 'disk_diffusion' and zone_diameter_mm is not null)
            or (measurement_type = 'qualitative' and qualitative_result is not null)
        ),
    constraint amr_ast_result_hash_check check (result_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.amr_ast_reconciliation_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    ingestion_event_id uuid not null
        references public.amr_ast_ingestion_events(id) on delete restrict,
    reconciliation_event text not null,
    episode_id uuid,
    case_id uuid references public.clinical_cases(id) on delete set null,
    amr_lab_feed_event_ids uuid[] not null default '{}',
    blocker_code text,
    attempt_no integer not null default 1,
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint amr_ast_reconciliation_tenant_request_key unique (tenant_id, request_id),
    constraint amr_ast_reconciliation_event_check
        check (reconciliation_event in ('queued', 'matched', 'unmatched', 'failed', 'requeued', 'blocked')),
    constraint amr_ast_reconciliation_attempt_check check (attempt_no > 0),
    constraint amr_ast_reconciliation_hash_check check (event_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.amr_exchange_agreement_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    agreement_id uuid not null,
    event_type text not null,
    product_key text not null,
    provider_site_id uuid,
    consumer_tenant_id uuid,
    counterparty_ref_hash text,
    purpose text not null,
    license_key text not null,
    privacy_class text not null,
    permitted_species text[] not null default '{}',
    permitted_geographies text[] not null default '{}',
    permitted_use_cases text[] not null default '{}',
    pricing_model text not null,
    currency text not null default 'USD',
    unit_price_minor integer not null default 0,
    platform_fee_bps integer not null default 0,
    terms_hash text not null,
    data_use_agreement_hash text not null,
    effective_at timestamptz,
    expires_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    event_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint amr_exchange_agreement_tenant_request_key unique (tenant_id, request_id),
    constraint amr_exchange_agreement_event_check
        check (event_type in ('drafted', 'offered', 'accepted', 'activated', 'suspended', 'revoked', 'expired')),
    constraint amr_exchange_agreement_product_check
        check (product_key in (
            'amr.culture_ast.normalized.v1',
            'amr.outcome_evidence.aggregate.v1',
            'amr.surveillance.signal.v1',
            'amr.federated_compute.v1',
            'amr.specialist_review.v1'
        )),
    constraint amr_exchange_agreement_privacy_check
        check (privacy_class in ('deidentified_record', 'aggregate_only', 'federated_only')),
    constraint amr_exchange_agreement_pricing_check
        check (pricing_model in ('per_record', 'per_episode', 'subscription', 'no_charge')),
    constraint amr_exchange_agreement_currency_check check (currency ~ '^[A-Z]{3}$'),
    constraint amr_exchange_agreement_amount_check
        check (unit_price_minor >= 0 and platform_fee_bps between 0 and 10000),
    constraint amr_exchange_agreement_hash_check
        check (
            terms_hash ~ '^[a-f0-9]{64}$'
            and data_use_agreement_hash ~ '^[a-f0-9]{64}$'
            and event_hash ~ '^[a-f0-9]{64}$'
            and (
                counterparty_ref_hash is null
                or counterparty_ref_hash ~ '^[a-f0-9]{64}$'
            )
        ),
    constraint amr_exchange_agreement_counterparty_check
        check (consumer_tenant_id is not null or counterparty_ref_hash is not null)
);

create table if not exists public.amr_exchange_usage_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    agreement_id uuid not null,
    product_key text not null,
    meter_key text not null,
    source_type text not null,
    source_event_id uuid not null,
    source_digest text not null,
    quantity numeric(18, 6) not null,
    unit text not null,
    unit_price_minor integer not null,
    amount_minor integer not null,
    currency text not null,
    usage_status text not null,
    blockers text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null,
    metered_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint amr_exchange_usage_tenant_request_key unique (tenant_id, request_id),
    constraint amr_exchange_usage_source_key
        unique (tenant_id, agreement_id, meter_key, source_type, source_event_id),
    constraint amr_exchange_usage_source_type_check
        check (source_type in ('ast_ingestion', 'outcome_episode', 'surveillance_export', 'federated_job', 'specialist_review')),
    constraint amr_exchange_usage_status_check
        check (usage_status in ('metered', 'excluded', 'reversed')),
    constraint amr_exchange_usage_quantity_check check (quantity > 0),
    constraint amr_exchange_usage_amount_check
        check (unit_price_minor >= 0 and amount_minor >= 0),
    constraint amr_exchange_usage_currency_check check (currency ~ '^[A-Z]{3}$'),
    constraint amr_exchange_usage_hash_check
        check (source_digest ~ '^[a-f0-9]{64}$' and event_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.amr_exchange_settlement_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    settlement_id uuid not null,
    agreement_id uuid not null,
    event_type text not null,
    period_start timestamptz not null,
    period_end timestamptz not null,
    usage_event_count integer not null,
    total_quantity numeric(18, 6) not null,
    gross_amount_minor integer not null,
    platform_fee_minor integer not null,
    provider_net_amount_minor integer not null,
    currency text not null,
    source_digest_bundle_hash text not null,
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint amr_exchange_settlement_tenant_request_key unique (tenant_id, request_id),
    constraint amr_exchange_settlement_event_check
        check (event_type in ('calculated', 'approved', 'invoiced', 'paid', 'voided')),
    constraint amr_exchange_settlement_period_check check (period_end > period_start),
    constraint amr_exchange_settlement_counts_check
        check (
            usage_event_count >= 0
            and total_quantity >= 0
            and gross_amount_minor >= 0
            and platform_fee_minor >= 0
            and provider_net_amount_minor >= 0
            and gross_amount_minor = platform_fee_minor + provider_net_amount_minor
        ),
    constraint amr_exchange_settlement_currency_check check (currency ~ '^[A-Z]{3}$'),
    constraint amr_exchange_settlement_hash_check
        check (
            source_digest_bundle_hash ~ '^[a-f0-9]{64}$'
            and event_hash ~ '^[a-f0-9]{64}$'
        ),
    constraint amr_exchange_settlement_payment_evidence_check
        check (
            event_type <> 'paid'
            or (
                evidence ? 'confirmation_hash'
                and evidence->>'confirmation_hash' ~ '^[a-f0-9]{64}$'
                and coalesce((evidence->>'payment_executed_by_vetios')::boolean, false) = false
            )
        )
);

create index if not exists idx_amr_connector_probe_site
    on public.amr_connector_probe_events (tenant_id, site_id, occurred_at desc);
create index if not exists idx_amr_connector_probe_installation
    on public.amr_connector_probe_events (connector_installation_id, occurred_at desc)
    where connector_installation_id is not null;
create index if not exists idx_amr_ast_ingestion_tenant_observed
    on public.amr_ast_ingestion_events (tenant_id, observed_at desc);
create unique index if not exists idx_amr_ast_ingestion_source_accepted
    on public.amr_ast_ingestion_events (tenant_id, source_record_digest)
    where ingestion_status = 'accepted';
create index if not exists idx_amr_ast_ingestion_taxonomy
    on public.amr_ast_ingestion_events
        (tenant_id, species, organism_key, specimen_type, observed_at desc);
create index if not exists idx_amr_ast_results_ingestion
    on public.amr_ast_result_events (ingestion_event_id, result_index);
create index if not exists idx_amr_ast_results_surveillance
    on public.amr_ast_result_events
        (tenant_id, antimicrobial_key, interpretation, observed_at desc);
create index if not exists idx_amr_ast_reconciliation_pending
    on public.amr_ast_reconciliation_events
        (tenant_id, reconciliation_event, occurred_at desc);
create index if not exists idx_amr_exchange_agreement_tenant
    on public.amr_exchange_agreement_events
        (tenant_id, agreement_id, occurred_at);
create index if not exists idx_amr_exchange_usage_agreement
    on public.amr_exchange_usage_events
        (tenant_id, agreement_id, metered_at desc);
create index if not exists idx_amr_exchange_settlement_agreement
    on public.amr_exchange_settlement_events
        (tenant_id, agreement_id, period_end desc);

create or replace function public.validate_amr_network_operations_provenance()
returns trigger
language plpgsql
as $$
declare
    probe public.amr_connector_probe_events%rowtype;
begin
    if tg_table_name = 'amr_connector_probe_events' then
        if not exists (
            select 1
            from public.amr_network_site_events site_event
            where site_event.tenant_id = new.tenant_id
              and site_event.site_id = new.site_id
        ) then
            raise exception 'AMR connector probe site is not owned by the tenant'
                using errcode = '23514';
        end if;

        if new.connector_installation_id is not null and not exists (
            select 1
            from public.connector_installations installation
            where installation.id = new.connector_installation_id
              and installation.tenant_id = new.tenant_id::text
              and installation.status = 'active'
        ) then
            raise exception 'AMR connector installation is not active for the tenant'
                using errcode = '23514';
        end if;
        return new;
    end if;

    if tg_table_name = 'amr_ast_ingestion_events' then
        select *
        into probe
        from public.amr_connector_probe_events probe_event
        where probe_event.id = new.connector_probe_event_id
          and probe_event.tenant_id = new.tenant_id
          and probe_event.site_id = new.lab_site_id;

        if probe.id is null then
            raise exception 'AMR AST ingestion probe is not owned by the tenant and laboratory'
                using errcode = '23514';
        end if;

        if new.ingestion_status = 'accepted' and (
            probe.probe_status <> 'passed'
            or probe.probe_type not in ('production_probe', 'heartbeat')
            or probe.token_binding_method <> 'mtls'
        ) then
            raise exception 'Accepted AMR AST ingestion requires a passed mTLS production probe'
                using errcode = '23514';
        end if;
        return new;
    end if;

    if tg_table_name = 'amr_ast_result_events' and not exists (
        select 1
        from public.amr_ast_ingestion_events ingestion
        where ingestion.id = new.ingestion_event_id
          and ingestion.tenant_id = new.tenant_id
    ) then
        raise exception 'AMR AST result ingestion is not owned by the tenant'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

drop trigger if exists validate_amr_connector_probe_provenance
    on public.amr_connector_probe_events;
create trigger validate_amr_connector_probe_provenance
    before insert on public.amr_connector_probe_events
    for each row execute function public.validate_amr_network_operations_provenance();

drop trigger if exists validate_amr_ast_ingestion_provenance
    on public.amr_ast_ingestion_events;
create trigger validate_amr_ast_ingestion_provenance
    before insert on public.amr_ast_ingestion_events
    for each row execute function public.validate_amr_network_operations_provenance();

drop trigger if exists validate_amr_ast_result_provenance
    on public.amr_ast_result_events;
create trigger validate_amr_ast_result_provenance
    before insert on public.amr_ast_result_events
    for each row execute function public.validate_amr_network_operations_provenance();

create or replace function public.validate_amr_exchange_agreement_transition()
returns trigger
language plpgsql
as $$
declare
    previous_event text;
    previous_row public.amr_exchange_agreement_events%rowtype;
begin
    select agreement_event.*
    into previous_row
    from public.amr_exchange_agreement_events agreement_event
    where agreement_event.tenant_id = new.tenant_id
      and agreement_event.agreement_id = new.agreement_id
    order by agreement_event.occurred_at desc, agreement_event.created_at desc
    limit 1;
    previous_event := previous_row.event_type;

    if previous_event is null and new.event_type <> 'drafted' then
        raise exception 'AMR exchange agreement must begin as drafted'
            using errcode = '23514';
    end if;
    if previous_event in ('revoked', 'expired') then
        raise exception 'Terminal AMR exchange agreement cannot transition'
            using errcode = '23514';
    end if;
    if new.event_type = 'offered' and previous_event <> 'drafted' then
        raise exception 'AMR exchange agreement must be drafted before offer'
            using errcode = '23514';
    end if;
    if new.event_type = 'accepted' and previous_event <> 'offered' then
        raise exception 'AMR exchange agreement must be offered before acceptance'
            using errcode = '23514';
    end if;
    if new.event_type = 'activated' and previous_event not in ('accepted', 'suspended') then
        raise exception 'AMR exchange agreement must be accepted before activation'
            using errcode = '23514';
    end if;
    if new.event_type = 'activated' and (
        new.effective_at is null
        or new.data_use_agreement_hash is null
        or new.terms_hash is null
    ) then
        raise exception 'AMR exchange activation requires effective terms and data-use agreement'
            using errcode = '23514';
    end if;
    if new.event_type = 'suspended' and previous_event <> 'activated' then
        raise exception 'Only active AMR exchange agreements can be suspended'
            using errcode = '23514';
    end if;
    if new.event_type in ('accepted', 'activated', 'suspended', 'revoked', 'expired')
       and (
           new.product_key is distinct from previous_row.product_key
           or new.provider_site_id is distinct from previous_row.provider_site_id
           or new.consumer_tenant_id is distinct from previous_row.consumer_tenant_id
           or new.counterparty_ref_hash is distinct from previous_row.counterparty_ref_hash
           or new.purpose is distinct from previous_row.purpose
           or new.license_key is distinct from previous_row.license_key
           or new.privacy_class is distinct from previous_row.privacy_class
           or new.permitted_species is distinct from previous_row.permitted_species
           or new.permitted_geographies is distinct from previous_row.permitted_geographies
           or new.permitted_use_cases is distinct from previous_row.permitted_use_cases
           or new.pricing_model is distinct from previous_row.pricing_model
           or new.currency is distinct from previous_row.currency
           or new.unit_price_minor is distinct from previous_row.unit_price_minor
           or new.platform_fee_bps is distinct from previous_row.platform_fee_bps
           or new.terms_hash is distinct from previous_row.terms_hash
           or new.data_use_agreement_hash is distinct from previous_row.data_use_agreement_hash
           or new.effective_at is distinct from previous_row.effective_at
           or new.expires_at is distinct from previous_row.expires_at
       )
    then
        raise exception 'Accepted AMR exchange agreement terms are immutable'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_amr_exchange_agreement_transition
    on public.amr_exchange_agreement_events;
create trigger validate_amr_exchange_agreement_transition
    before insert on public.amr_exchange_agreement_events
    for each row execute function public.validate_amr_exchange_agreement_transition();

create or replace function public.validate_amr_exchange_settlement_transition()
returns trigger
language plpgsql
as $$
declare
    previous_event public.amr_exchange_settlement_events%rowtype;
begin
    select settlement_event.*
    into previous_event
    from public.amr_exchange_settlement_events settlement_event
    where settlement_event.tenant_id = new.tenant_id
      and settlement_event.settlement_id = new.settlement_id
    order by settlement_event.occurred_at desc, settlement_event.created_at desc
    limit 1;

    if previous_event.id is null then
        if new.event_type <> 'calculated' then
            raise exception 'AMR exchange settlement must begin as calculated'
                using errcode = '23514';
        end if;
        return new;
    end if;

    if previous_event.event_type in ('paid', 'voided') then
        raise exception 'Terminal AMR exchange settlement cannot transition'
            using errcode = '23514';
    end if;
    if new.event_type = 'calculated' then
        raise exception 'AMR exchange settlement is already calculated'
            using errcode = '23514';
    end if;
    if new.event_type = 'approved' and previous_event.event_type <> 'calculated' then
        raise exception 'AMR exchange settlement must be calculated before approval'
            using errcode = '23514';
    end if;
    if new.event_type = 'invoiced' and previous_event.event_type <> 'approved' then
        raise exception 'AMR exchange settlement must be approved before invoicing'
            using errcode = '23514';
    end if;
    if new.event_type = 'paid' and previous_event.event_type <> 'invoiced' then
        raise exception 'AMR exchange settlement must be invoiced before payment evidence'
            using errcode = '23514';
    end if;
    if new.event_type not in ('approved', 'invoiced', 'paid', 'voided') then
        raise exception 'AMR exchange settlement transition is invalid'
            using errcode = '23514';
    end if;

    if new.agreement_id is distinct from previous_event.agreement_id
       or new.period_start is distinct from previous_event.period_start
       or new.period_end is distinct from previous_event.period_end
       or new.usage_event_count is distinct from previous_event.usage_event_count
       or new.total_quantity is distinct from previous_event.total_quantity
       or new.gross_amount_minor is distinct from previous_event.gross_amount_minor
       or new.platform_fee_minor is distinct from previous_event.platform_fee_minor
       or new.provider_net_amount_minor is distinct from previous_event.provider_net_amount_minor
       or new.currency is distinct from previous_event.currency
       or new.source_digest_bundle_hash is distinct from previous_event.source_digest_bundle_hash
    then
        raise exception 'AMR exchange settlement facts are immutable across state events'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_amr_exchange_settlement_transition
    on public.amr_exchange_settlement_events;
create trigger validate_amr_exchange_settlement_transition
    before insert on public.amr_exchange_settlement_events
    for each row execute function public.validate_amr_exchange_settlement_transition();

create or replace function public.prevent_amr_network_operations_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'AMR network operations and exchange ledgers are append-only'
        using errcode = '55000';
end;
$$;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'amr_connector_probe_events',
        'amr_ast_ingestion_events',
        'amr_ast_result_events',
        'amr_ast_reconciliation_events',
        'amr_exchange_agreement_events',
        'amr_exchange_usage_events',
        'amr_exchange_settlement_events'
    ]
    loop
        execute format('drop trigger if exists enforce_immutability_%I on public.%I', table_name, table_name);
        execute format(
            'create trigger enforce_immutability_%I before update or delete on public.%I for each row execute function public.prevent_amr_network_operations_mutation()',
            table_name,
            table_name
        );
        execute format('alter table public.%I enable row level security', table_name);
        execute format('drop policy if exists %I on public.%I', table_name || '_select_tenant', table_name);
        execute format(
            'create policy %I on public.%I for select using (tenant_id = public.current_tenant_id())',
            table_name || '_select_tenant',
            table_name
        );
        execute format('drop policy if exists %I on public.%I', table_name || '_insert_tenant', table_name);
        execute format(
            'create policy %I on public.%I for insert with check (tenant_id = public.current_tenant_id())',
            table_name || '_insert_tenant',
            table_name
        );
        execute format('drop policy if exists %I on public.%I', 'service_role_' || table_name, table_name);
        execute format(
            'create policy %I on public.%I for all to service_role using (true) with check (true)',
            'service_role_' || table_name,
            table_name
        );
        execute format('grant select, insert on public.%I to service_role', table_name);
        execute format('revoke update, delete on public.%I from anon, authenticated', table_name);
    end loop;
end;
$$;

create or replace function public.ingest_amr_ast_packet_v1(
    p_ingestion jsonb,
    p_results jsonb,
    p_surveillance_events jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    ingestion_id uuid;
    existing_id uuid;
    result_row jsonb;
    surveillance_row jsonb;
    reconciliation_id uuid;
    cached boolean := false;
begin
    if jsonb_typeof(p_ingestion) <> 'object'
       or jsonb_typeof(p_results) <> 'array'
       or jsonb_typeof(p_surveillance_events) <> 'array' then
        raise exception 'Invalid AMR AST ingestion packet'
            using errcode = '22023';
    end if;

    select event.id
    into existing_id
    from public.amr_ast_ingestion_events event
    where event.tenant_id = (p_ingestion->>'tenant_id')::uuid
      and (
          event.request_id = (p_ingestion->>'request_id')::uuid
          or (
              event.ingestion_status = 'accepted'
              and event.source_record_digest = p_ingestion->>'source_record_digest'
          )
      )
    order by event.created_at desc
    limit 1;

    if existing_id is not null then
        return jsonb_build_object(
            'ingestion_event_id', existing_id,
            'reconciliation_event_id', null,
            'lab_feed_event_ids', '[]'::jsonb,
            'cached', true
        );
    end if;

    insert into public.amr_ast_ingestion_events (
        tenant_id,
        request_id,
        site_id,
        lab_site_id,
        connector_probe_event_id,
        connector_installation_id,
        oauth_client_id,
        source_system,
        source_version,
        schema_version,
        source_record_digest,
        canonical_packet_hash,
        isolate_ref_hash,
        patient_ref_hash,
        species,
        breed,
        production_class,
        specimen_type,
        anatomical_site,
        country_code,
        admin_area_hash,
        organism_label,
        organism_key,
        organism_code_system,
        organism_code,
        culture_collected_at,
        observed_at,
        ast_method,
        interpretation_standard,
        interpretation_standard_version,
        qc_status,
        ingestion_status,
        result_count,
        deidentified,
        is_synthetic,
        raw_payload_stored,
        blockers,
        warnings,
        evidence,
        actor_id
    ) values (
        (p_ingestion->>'tenant_id')::uuid,
        (p_ingestion->>'request_id')::uuid,
        (p_ingestion->>'site_id')::uuid,
        (p_ingestion->>'lab_site_id')::uuid,
        (p_ingestion->>'connector_probe_event_id')::uuid,
        nullif(p_ingestion->>'connector_installation_id', '')::uuid,
        nullif(p_ingestion->>'oauth_client_id', '')::uuid,
        p_ingestion->>'source_system',
        nullif(p_ingestion->>'source_version', ''),
        p_ingestion->>'schema_version',
        p_ingestion->>'source_record_digest',
        p_ingestion->>'canonical_packet_hash',
        p_ingestion->>'isolate_ref_hash',
        nullif(p_ingestion->>'patient_ref_hash', ''),
        p_ingestion->>'species',
        nullif(p_ingestion->>'breed', ''),
        nullif(p_ingestion->>'production_class', ''),
        p_ingestion->>'specimen_type',
        nullif(p_ingestion->>'anatomical_site', ''),
        nullif(p_ingestion->>'country_code', ''),
        nullif(p_ingestion->>'admin_area_hash', ''),
        p_ingestion->>'organism_label',
        p_ingestion->>'organism_key',
        nullif(p_ingestion->>'organism_code_system', ''),
        nullif(p_ingestion->>'organism_code', ''),
        nullif(p_ingestion->>'culture_collected_at', '')::timestamptz,
        (p_ingestion->>'observed_at')::timestamptz,
        p_ingestion->>'ast_method',
        p_ingestion->>'interpretation_standard',
        p_ingestion->>'interpretation_standard_version',
        p_ingestion->>'qc_status',
        p_ingestion->>'ingestion_status',
        (p_ingestion->>'result_count')::integer,
        coalesce((p_ingestion->>'deidentified')::boolean, true),
        coalesce((p_ingestion->>'is_synthetic')::boolean, false),
        false,
        coalesce(
            array(select jsonb_array_elements_text(p_ingestion->'blockers')),
            '{}'::text[]
        ),
        coalesce(
            array(select jsonb_array_elements_text(p_ingestion->'warnings')),
            '{}'::text[]
        ),
        coalesce(p_ingestion->'evidence', '{}'::jsonb),
        nullif(p_ingestion->>'actor_id', '')
    )
    returning id into ingestion_id;

    if p_ingestion->>'ingestion_status' = 'accepted' then
        for result_row in select value from jsonb_array_elements(p_results)
        loop
            insert into public.amr_ast_result_events (
                tenant_id,
                ingestion_event_id,
                result_index,
                antimicrobial_label,
                antimicrobial_key,
                antimicrobial_code_system,
                antimicrobial_code,
                drug_class,
                measurement_type,
                mic_value,
                mic_operator,
                mic_unit,
                zone_diameter_mm,
                qualitative_result,
                interpretation,
                breakpoint_value,
                breakpoint_unit,
                breakpoint_basis,
                result_hash,
                evidence,
                observed_at
            ) values (
                (p_ingestion->>'tenant_id')::uuid,
                ingestion_id,
                (result_row->>'result_index')::integer,
                result_row->>'antimicrobial_label',
                result_row->>'antimicrobial_key',
                nullif(result_row->>'antimicrobial_code_system', ''),
                nullif(result_row->>'antimicrobial_code', ''),
                nullif(result_row->>'drug_class', ''),
                result_row->>'measurement_type',
                nullif(result_row->>'mic_value', '')::numeric,
                nullif(result_row->>'mic_operator', ''),
                nullif(result_row->>'mic_unit', ''),
                nullif(result_row->>'zone_diameter_mm', '')::numeric,
                nullif(result_row->>'qualitative_result', ''),
                result_row->>'interpretation',
                nullif(result_row->>'breakpoint_value', '')::numeric,
                nullif(result_row->>'breakpoint_unit', ''),
                nullif(result_row->>'breakpoint_basis', ''),
                result_row->>'result_hash',
                coalesce(result_row->'evidence', '{}'::jsonb),
                (result_row->>'observed_at')::timestamptz
            );
        end loop;

        for surveillance_row in select value from jsonb_array_elements(p_surveillance_events)
        loop
            insert into public.amr_lab_feed_surveillance_events (
                tenant_id,
                request_id,
                amr_stewardship_event_id,
                case_id,
                inference_event_id,
                clinical_outcome_id,
                species,
                pathogen_label,
                pathogen_key,
                infection_site,
                sample_source,
                drug_name,
                drug_class,
                ast_method,
                culture_collected,
                culture_result,
                lab_feed_status,
                surveillance_score,
                resistance_signal_score,
                ast_panel_drug_count,
                mic_result_count,
                susceptibility_result_count,
                resistance_gene_count,
                resistance_class_count,
                lab_partner_feed_ready,
                one_health_export_ready,
                trend_bucket_key,
                source_record_digest,
                packet_hash,
                ast_panel_hash,
                mic_results_hash,
                evidence_hash,
                surveillance_packet,
                blockers,
                warnings,
                next_actions,
                evidence,
                observed_at
            ) values (
                (surveillance_row->>'tenant_id')::uuid,
                (surveillance_row->>'request_id')::uuid,
                nullif(surveillance_row->>'amr_stewardship_event_id', '')::uuid,
                nullif(surveillance_row->>'case_id', '')::uuid,
                nullif(surveillance_row->>'inference_event_id', '')::uuid,
                nullif(surveillance_row->>'clinical_outcome_id', '')::uuid,
                surveillance_row->>'species',
                nullif(surveillance_row->>'pathogen_label', ''),
                nullif(surveillance_row->>'pathogen_key', ''),
                nullif(surveillance_row->>'infection_site', ''),
                nullif(surveillance_row->>'sample_source', ''),
                surveillance_row->>'drug_name',
                nullif(surveillance_row->>'drug_class', ''),
                nullif(surveillance_row->>'ast_method', ''),
                coalesce((surveillance_row->>'culture_collected')::boolean, false),
                nullif(surveillance_row->>'culture_result', ''),
                surveillance_row->>'lab_feed_status',
                (surveillance_row->>'surveillance_score')::numeric,
                (surveillance_row->>'resistance_signal_score')::numeric,
                (surveillance_row->>'ast_panel_drug_count')::integer,
                (surveillance_row->>'mic_result_count')::integer,
                (surveillance_row->>'susceptibility_result_count')::integer,
                (surveillance_row->>'resistance_gene_count')::integer,
                (surveillance_row->>'resistance_class_count')::integer,
                (surveillance_row->>'lab_partner_feed_ready')::boolean,
                (surveillance_row->>'one_health_export_ready')::boolean,
                surveillance_row->>'trend_bucket_key',
                surveillance_row->>'source_record_digest',
                surveillance_row->>'packet_hash',
                surveillance_row->>'ast_panel_hash',
                surveillance_row->>'mic_results_hash',
                surveillance_row->>'evidence_hash',
                coalesce(surveillance_row->'surveillance_packet', '{}'::jsonb),
                coalesce(
                    array(select jsonb_array_elements_text(surveillance_row->'blockers')),
                    '{}'::text[]
                ),
                coalesce(
                    array(select jsonb_array_elements_text(surveillance_row->'warnings')),
                    '{}'::text[]
                ),
                coalesce(
                    array(select jsonb_array_elements_text(surveillance_row->'next_actions')),
                    '{}'::text[]
                ),
                coalesce(surveillance_row->'evidence', '{}'::jsonb),
                (surveillance_row->>'observed_at')::timestamptz
            )
            on conflict (tenant_id, request_id) do nothing;
        end loop;
    end if;

    insert into public.amr_ast_reconciliation_events (
        tenant_id,
        request_id,
        ingestion_event_id,
        reconciliation_event,
        blocker_code,
        attempt_no,
        evidence,
        event_hash,
        actor_id
    ) values (
        (p_ingestion->>'tenant_id')::uuid,
        gen_random_uuid(),
        ingestion_id,
        case
            when p_ingestion->>'ingestion_status' = 'accepted' then 'queued'
            else 'blocked'
        end,
        case
            when p_ingestion->>'ingestion_status' = 'accepted' then null
            else coalesce(p_ingestion->'blockers'->>0, 'ingestion_blocked')
        end,
        1,
        jsonb_build_object(
            'schema_version', 'amr-ast-reconciliation-v1',
            'source', 'ingest_amr_ast_packet_v1'
        ),
        encode(
            digest(
                ingestion_id::text
                || ':'
                || case
                    when p_ingestion->>'ingestion_status' = 'accepted' then 'queued'
                    else 'blocked'
                end,
                'sha256'
            ),
            'hex'
        ),
        nullif(p_ingestion->>'actor_id', '')
    )
    returning id into reconciliation_id;

    return jsonb_build_object(
        'ingestion_event_id', ingestion_id,
        'reconciliation_event_id', reconciliation_id,
        'lab_feed_event_ids', coalesce(
            (
                select jsonb_agg(feed.id order by feed.created_at)
                from public.amr_lab_feed_surveillance_events feed
                where feed.tenant_id = (p_ingestion->>'tenant_id')::uuid
                  and feed.request_id in (
                      select (value->>'request_id')::uuid
                      from jsonb_array_elements(p_surveillance_events)
                  )
            ),
            '[]'::jsonb
        ),
        'cached', cached
    );
end;
$$;

revoke all on function public.ingest_amr_ast_packet_v1(jsonb, jsonb, jsonb) from public;
grant execute on function public.ingest_amr_ast_packet_v1(jsonb, jsonb, jsonb) to service_role;

comment on table public.amr_connector_probe_events is
    'Append-only connector probe receipts. Production pass requires mTLS-bound OAuth workload identity.';
comment on table public.amr_ast_ingestion_events is
    'Canonical de-identified culture/AST packet ledger. Raw laboratory payloads and direct identifiers are prohibited.';
comment on table public.amr_ast_result_events is
    'Normalized immutable antimicrobial susceptibility results with measurement, interpretation, breakpoint, and provenance.';
comment on table public.amr_exchange_agreement_events is
    'Private AMR evidence-product agreement lifecycle. This is a contract ledger, not a public sale of identifiable records.';
comment on table public.amr_exchange_settlement_events is
    'Auditable settlement-state evidence. A paid event records external confirmation and does not itself transfer funds.';

notify pgrst, 'reload schema';
