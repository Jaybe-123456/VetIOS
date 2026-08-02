-- VetIOS Evidence Node Laboratory Adapter v1
-- Contract-bound source ingestion, reconciliation, closure work, and standards export evidence.

create extension if not exists pgcrypto;

create table if not exists public.evidence_node_adapter_contract_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    contract_id uuid not null,
    event_type text not null,
    adapter_key text not null,
    contract_version text not null,
    mapping_version text not null,
    mapping_hash text not null,
    reference_key_id text not null,
    clinic_site_id uuid not null,
    lab_site_id uuid not null,
    oauth_client_id uuid references public.oauth_clients(id) on delete restrict,
    mtls_cert_thumbprint_hash text,
    source_system text not null,
    source_version text,
    permitted_transports text[] not null,
    permitted_formats text[] not null,
    writeback_permitted boolean not null default false,
    closure_destination_channel text not null default 'manual_work_queue',
    purpose text not null,
    terms_hash text not null,
    data_use_agreement_hash text not null,
    consent_basis text not null,
    deidentification_profile text not null,
    effective_at timestamptz,
    expires_at timestamptz,
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint evidence_node_contract_tenant_request_key unique (tenant_id, request_id),
    constraint evidence_node_contract_event_check check (
        event_type in ('drafted', 'approved', 'activated', 'suspended', 'revoked', 'expired')
    ),
    constraint evidence_node_contract_transport_check check (
        cardinality(permitted_transports) > 0
        and permitted_transports <@ array['webhook', 'api_poll', 'sftp', 'file_drop']::text[]
    ),
    constraint evidence_node_contract_format_check check (
        cardinality(permitted_formats) > 0
        and permitted_formats <@ array[
            'vetios_ast_json_v1',
            'hl7_v2_oru_r01',
            'fhir_r4_bundle',
            'rfc4180_csv'
        ]::text[]
    ),
    constraint evidence_node_contract_writeback_channel_check check (
        closure_destination_channel in (
            'pims_writeback', 'lis_writeback', 'signed_webhook', 'manual_work_queue'
        )
        and (writeback_permitted or closure_destination_channel = 'manual_work_queue')
    ),
    constraint evidence_node_contract_hash_check check (
        mapping_hash ~ '^[a-f0-9]{64}$'
        and reference_key_id ~ '^[a-zA-Z0-9._-]{1,120}$'
        and terms_hash ~ '^[a-f0-9]{64}$'
        and data_use_agreement_hash ~ '^[a-f0-9]{64}$'
        and event_hash ~ '^[a-f0-9]{64}$'
        and (
            mtls_cert_thumbprint_hash is null
            or mtls_cert_thumbprint_hash ~ '^[a-f0-9]{64}$'
        )
    ),
    constraint evidence_node_contract_time_check check (
        expires_at is null or effective_at is null or expires_at > effective_at
    ),
    constraint evidence_node_contract_activation_check check (
        event_type <> 'activated'
        or (
            oauth_client_id is not null
            and mtls_cert_thumbprint_hash is not null
            and effective_at is not null
            and deidentification_profile <> ''
        )
    )
);

create table if not exists public.evidence_node_ingestion_receipt_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    receipt_id uuid not null,
    contract_id uuid not null,
    ingestion_event_id uuid references public.amr_ast_ingestion_events(id) on delete restrict,
    reconciliation_event_id uuid references public.amr_ast_reconciliation_events(id) on delete set null,
    oauth_client_id uuid references public.oauth_clients(id) on delete restrict,
    certificate_thumbprint_hash text not null,
    source_system text not null,
    source_version text,
    source_transport text not null,
    source_format text not null,
    adapter_key text not null,
    contract_version text not null,
    mapping_version text not null,
    mapping_hash text not null,
    reference_key_id text not null,
    source_ref_hash text not null,
    source_record_digest text not null,
    canonical_packet_hash text not null,
    receipt_status text not null,
    result_count integer not null default 0,
    removed_direct_identifier_count integer not null default 0,
    deidentified boolean not null default true,
    is_synthetic boolean not null default false,
    raw_payload_stored_centrally boolean not null default false,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    receipt_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint evidence_node_receipt_tenant_request_key unique (tenant_id, request_id),
    constraint evidence_node_receipt_id_key unique (tenant_id, receipt_id),
    constraint evidence_node_receipt_status_check check (
        receipt_status in ('accepted', 'duplicate', 'blocked', 'dead_letter')
    ),
    constraint evidence_node_receipt_transport_check check (
        source_transport in ('webhook', 'api_poll', 'sftp', 'file_drop')
    ),
    constraint evidence_node_receipt_format_check check (
        source_format in ('vetios_ast_json_v1', 'hl7_v2_oru_r01', 'fhir_r4_bundle', 'rfc4180_csv')
    ),
    constraint evidence_node_receipt_counts_check check (
        result_count >= 0 and removed_direct_identifier_count >= 0
    ),
    constraint evidence_node_receipt_hash_check check (
        mapping_hash ~ '^[a-f0-9]{64}$'
        and reference_key_id ~ '^[a-zA-Z0-9._-]{1,120}$'
        and certificate_thumbprint_hash ~ '^[a-f0-9]{64}$'
        and source_ref_hash ~ '^[a-f0-9]{64}$'
        and source_record_digest ~ '^[a-f0-9]{64}$'
        and canonical_packet_hash ~ '^[a-f0-9]{64}$'
        and receipt_hash ~ '^[a-f0-9]{64}$'
    ),
    constraint evidence_node_receipt_privacy_check check (
        raw_payload_stored_centrally is false
    ),
    constraint evidence_node_receipt_acceptance_check check (
        receipt_status not in ('accepted', 'duplicate')
        or (
            ingestion_event_id is not null
            and oauth_client_id is not null
            and deidentified
            and not is_synthetic
            and result_count > 0
            and cardinality(blockers) = 0
        )
    )
);

create table if not exists public.evidence_node_identity_link_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    link_id uuid not null,
    event_type text not null,
    contract_id uuid not null,
    ingestion_event_id uuid not null references public.amr_ast_ingestion_events(id) on delete restrict,
    clinic_site_id uuid not null,
    lab_site_id uuid not null,
    external_patient_ref_hash text,
    accession_ref_hash text not null,
    isolate_ref_hash text not null,
    patient_episode_id uuid references public.patient_episodes(id) on delete set null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    amr_episode_id uuid,
    match_method text not null,
    match_confidence numeric(7, 6) not null default 0,
    reviewer_ref_hash text,
    blockers text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint evidence_node_identity_tenant_request_key unique (tenant_id, request_id),
    constraint evidence_node_identity_link_event_key unique (tenant_id, link_id, event_type),
    constraint evidence_node_identity_event_check check (
        event_type in ('proposed', 'verified', 'revoked')
    ),
    constraint evidence_node_identity_method_check check (
        match_method in ('explicit_source_reference', 'exact_hash', 'deterministic_crosswalk', 'reviewer_confirmed', 'unmatched')
    ),
    constraint evidence_node_identity_confidence_check check (
        match_confidence between 0 and 1
    ),
    constraint evidence_node_identity_hash_check check (
        accession_ref_hash ~ '^[a-f0-9]{64}$'
        and isolate_ref_hash ~ '^[a-f0-9]{64}$'
        and event_hash ~ '^[a-f0-9]{64}$'
        and (external_patient_ref_hash is null or external_patient_ref_hash ~ '^[a-f0-9]{64}$')
        and (reviewer_ref_hash is null or reviewer_ref_hash ~ '^[a-f0-9]{64}$')
    ),
    constraint evidence_node_identity_verified_check check (
        event_type <> 'verified'
        or (
            (patient_episode_id is not null or case_id is not null)
            and match_confidence >= 0.95
            and cardinality(blockers) = 0
        )
    )
);

create table if not exists public.evidence_node_closure_task_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    task_id uuid not null,
    event_type text not null,
    task_type text not null,
    contract_id uuid not null,
    ingestion_event_id uuid references public.amr_ast_ingestion_events(id) on delete restrict,
    amr_episode_id uuid,
    patient_episode_id uuid references public.patient_episodes(id) on delete set null,
    case_id uuid references public.clinical_cases(id) on delete set null,
    destination_channel text not null,
    destination_ref_hash text,
    due_at timestamptz,
    outcome_status text,
    reviewer_ref_hash text,
    writeback_receipt_hash text,
    blockers text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint evidence_node_closure_tenant_request_key unique (tenant_id, request_id),
    constraint evidence_node_closure_event_check check (
        event_type in ('queued', 'dispatched', 'acknowledged', 'completed', 'cancelled', 'failed')
    ),
    constraint evidence_node_closure_type_check check (
        task_type in ('reconcile_episode', 'confirm_treatment', 'confirm_follow_up', 'confirm_outcome', 'review_label_authority')
    ),
    constraint evidence_node_closure_channel_check check (
        destination_channel in ('pims_writeback', 'lis_writeback', 'signed_webhook', 'manual_work_queue')
    ),
    constraint evidence_node_closure_hash_check check (
        event_hash ~ '^[a-f0-9]{64}$'
        and (destination_ref_hash is null or destination_ref_hash ~ '^[a-f0-9]{64}$')
        and (reviewer_ref_hash is null or reviewer_ref_hash ~ '^[a-f0-9]{64}$')
        and (writeback_receipt_hash is null or writeback_receipt_hash ~ '^[a-f0-9]{64}$')
    ),
    constraint evidence_node_closure_completion_check check (
        event_type <> 'completed'
        or (
            cardinality(blockers) = 0
            and (
                destination_channel = 'manual_work_queue'
                or writeback_receipt_hash is not null
            )
        )
    )
);

create table if not exists public.evidence_node_export_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    export_id uuid not null,
    event_type text not null,
    export_profile text not null,
    profile_version text not null,
    record_count integer not null default 0,
    eligible_record_count integer not null default 0,
    source_bundle_hash text not null,
    mapping_bundle_hash text not null,
    artifact_hash text not null,
    validation_scope text not null default 'vetios_internal_projection',
    validation_status text not null,
    official_acceptance boolean not null default false,
    acceptance_receipt_hash text,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null,
    actor_id text,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint evidence_node_export_tenant_request_key unique (tenant_id, request_id),
    constraint evidence_node_export_id_event_key unique (tenant_id, export_id, event_type),
    constraint evidence_node_export_event_check check (
        event_type in ('generated', 'validated', 'delivered', 'accepted', 'rejected')
    ),
    constraint evidence_node_export_profile_check check (
        export_profile in ('infarm_compat_v1', 'nahln_compat_v1', 'kabs_compat_v1')
    ),
    constraint evidence_node_export_validation_check check (
        validation_status in ('not_run', 'passed', 'failed', 'blocked')
        and validation_scope in ('vetios_internal_projection', 'external_receiver')
    ),
    constraint evidence_node_export_count_check check (
        record_count >= 0 and eligible_record_count between 0 and record_count
    ),
    constraint evidence_node_export_hash_check check (
        source_bundle_hash ~ '^[a-f0-9]{64}$'
        and mapping_bundle_hash ~ '^[a-f0-9]{64}$'
        and artifact_hash ~ '^[a-f0-9]{64}$'
        and event_hash ~ '^[a-f0-9]{64}$'
        and (acceptance_receipt_hash is null or acceptance_receipt_hash ~ '^[a-f0-9]{64}$')
    ),
    constraint evidence_node_export_acceptance_check check (
        not official_acceptance
        or (
            event_type = 'accepted'
            and acceptance_receipt_hash is not null
            and validation_scope = 'external_receiver'
            and validation_status = 'passed'
            and cardinality(blockers) = 0
        )
    )
);

create index if not exists idx_evidence_node_contract_state
    on public.evidence_node_adapter_contract_events (tenant_id, contract_id, occurred_at desc, created_at desc);
create index if not exists idx_evidence_node_contract_adapter
    on public.evidence_node_adapter_contract_events (tenant_id, adapter_key, lab_site_id, occurred_at desc);
create index if not exists idx_evidence_node_receipt_status
    on public.evidence_node_ingestion_receipt_events (tenant_id, receipt_status, occurred_at desc);
create unique index if not exists idx_evidence_node_receipt_source_accepted
    on public.evidence_node_ingestion_receipt_events (tenant_id, contract_id, source_record_digest)
    where receipt_status = 'accepted';
create index if not exists idx_evidence_node_identity_ingestion
    on public.evidence_node_identity_link_events (tenant_id, ingestion_event_id, occurred_at desc);
create index if not exists idx_evidence_node_closure_open
    on public.evidence_node_closure_task_events (tenant_id, task_type, event_type, due_at)
    where event_type in ('queued', 'dispatched', 'acknowledged', 'failed');
create index if not exists idx_evidence_node_export_profile
    on public.evidence_node_export_events (tenant_id, export_profile, occurred_at desc);

create or replace function public.validate_evidence_node_contract_transition()
returns trigger
language plpgsql
as $$
declare
    previous public.evidence_node_adapter_contract_events%rowtype;
begin
    perform pg_advisory_xact_lock(hashtextextended(
        'vetios:evidence-node:contract:' || new.tenant_id::text || ':' || new.contract_id::text,
        0
    ));

    select event.* into previous
    from public.evidence_node_adapter_contract_events event
    where event.tenant_id = new.tenant_id
      and event.contract_id = new.contract_id
    order by event.occurred_at desc, event.created_at desc
    limit 1;

    if previous.id is null then
        if new.event_type <> 'drafted' then
            raise exception 'Evidence Node contract must begin as drafted' using errcode = '23514';
        end if;
    elsif previous.event_type in ('revoked', 'expired') then
        raise exception 'Terminal Evidence Node contract cannot transition' using errcode = '23514';
    elsif not (
        (previous.event_type = 'drafted' and new.event_type in ('approved', 'revoked'))
        or (previous.event_type = 'approved' and new.event_type in ('activated', 'revoked'))
        or (previous.event_type = 'activated' and new.event_type in ('suspended', 'revoked', 'expired'))
        or (previous.event_type = 'suspended' and new.event_type in ('activated', 'revoked', 'expired'))
    ) then
        raise exception 'Invalid Evidence Node contract transition' using errcode = '23514';
    end if;
    if previous.id is not null and (
        new.adapter_key is distinct from previous.adapter_key
        or new.contract_version is distinct from previous.contract_version
        or new.mapping_version is distinct from previous.mapping_version
        or new.mapping_hash is distinct from previous.mapping_hash
        or new.reference_key_id is distinct from previous.reference_key_id
        or new.clinic_site_id is distinct from previous.clinic_site_id
        or new.lab_site_id is distinct from previous.lab_site_id
        or new.oauth_client_id is distinct from previous.oauth_client_id
        or new.mtls_cert_thumbprint_hash is distinct from previous.mtls_cert_thumbprint_hash
        or new.source_system is distinct from previous.source_system
        or new.source_version is distinct from previous.source_version
        or new.permitted_transports is distinct from previous.permitted_transports
        or new.permitted_formats is distinct from previous.permitted_formats
        or new.writeback_permitted is distinct from previous.writeback_permitted
        or new.closure_destination_channel is distinct from previous.closure_destination_channel
        or new.purpose is distinct from previous.purpose
        or new.terms_hash is distinct from previous.terms_hash
        or new.data_use_agreement_hash is distinct from previous.data_use_agreement_hash
        or new.consent_basis is distinct from previous.consent_basis
        or new.deidentification_profile is distinct from previous.deidentification_profile
        or new.effective_at is distinct from previous.effective_at
        or new.expires_at is distinct from previous.expires_at
    ) then
        raise exception 'Approved Evidence Node contract facts are immutable' using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_evidence_node_contract_transition
    on public.evidence_node_adapter_contract_events;
create trigger validate_evidence_node_contract_transition
    before insert on public.evidence_node_adapter_contract_events
    for each row execute function public.validate_evidence_node_contract_transition();

create or replace function public.validate_evidence_node_identity_link()
returns trigger
language plpgsql
as $$
begin
    if new.case_id is not null and not exists (
        select 1 from public.clinical_cases clinical_case
        where clinical_case.id = new.case_id and clinical_case.tenant_id = new.tenant_id
    ) then
        raise exception 'Evidence Node case link is not owned by the tenant' using errcode = '23514';
    end if;
    if new.patient_episode_id is not null and not exists (
        select 1 from public.patient_episodes episode
        where episode.id = new.patient_episode_id and episode.tenant_id = new.tenant_id
    ) then
        raise exception 'Evidence Node patient episode link is not owned by the tenant' using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_evidence_node_identity_link
    on public.evidence_node_identity_link_events;
create trigger validate_evidence_node_identity_link
    before insert on public.evidence_node_identity_link_events
    for each row execute function public.validate_evidence_node_identity_link();

create or replace function public.prevent_evidence_node_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'Evidence Node ledgers are append-only' using errcode = '55000';
end;
$$;

do $$
declare
    ledger text;
begin
    foreach ledger in array array[
        'evidence_node_adapter_contract_events',
        'evidence_node_ingestion_receipt_events',
        'evidence_node_identity_link_events',
        'evidence_node_closure_task_events',
        'evidence_node_export_events'
    ]
    loop
        execute format('drop trigger if exists enforce_immutability_%I on public.%I', ledger, ledger);
        execute format(
            'create trigger enforce_immutability_%I before update or delete on public.%I for each row execute function public.prevent_evidence_node_ledger_mutation()',
            ledger,
            ledger
        );
        execute format('alter table public.%I enable row level security', ledger);
        execute format('drop policy if exists %I on public.%I', ledger || '_select_tenant', ledger);
        execute format(
            'create policy %I on public.%I for select using (tenant_id = public.current_tenant_id())',
            ledger || '_select_tenant',
            ledger
        );
        execute format('drop policy if exists %I on public.%I', ledger || '_insert_tenant', ledger);
        execute format('drop policy if exists %I on public.%I', 'service_role_' || ledger, ledger);
        execute format(
            'create policy %I on public.%I for all to service_role using (true) with check (true)',
            'service_role_' || ledger,
            ledger
        );
        execute format('grant select on public.%I to authenticated', ledger);
        execute format('grant select, insert on public.%I to service_role', ledger);
        execute format('revoke insert, update, delete on public.%I from anon, authenticated', ledger);
    end loop;
end;
$$;

create or replace function public.ingest_evidence_node_packet_v1(
    p_ingestion jsonb,
    p_results jsonb,
    p_surveillance_events jsonb,
    p_receipt jsonb,
    p_reconciliation jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    active_contract public.evidence_node_adapter_contract_events%rowtype;
    cached_receipt public.evidence_node_ingestion_receipt_events%rowtype;
    cached_identity public.evidence_node_identity_link_events%rowtype;
    cached_closure public.evidence_node_closure_task_events%rowtype;
    core_result jsonb;
    ingestion_id uuid;
    reconciliation_id uuid;
    receipt_event_id uuid;
    receipt_uuid uuid;
    primary_lab_feed_event_id uuid;
    identity_link_id uuid := gen_random_uuid();
    closure_task_id uuid := gen_random_uuid();
    amr_episode_id uuid := gen_random_uuid();
    linked_case_id uuid := nullif(p_reconciliation->>'case_id', '')::uuid;
    linked_patient_episode_id uuid := nullif(p_reconciliation->>'patient_episode_id', '')::uuid;
    identity_event_type text;
    next_task_type text;
    closure_destination_channel text;
    receipt_status text;
    receipt_hash text;
    identity_event jsonb;
    closure_event jsonb;
    tenant_uuid uuid := nullif(p_ingestion->>'tenant_id', '')::uuid;
    request_uuid uuid := nullif(p_receipt->>'request_id', '')::uuid;
begin
    if jsonb_typeof(p_receipt) <> 'object' or jsonb_typeof(p_reconciliation) <> 'object' then
        raise exception 'Evidence Node receipt and reconciliation must be objects' using errcode = '22023';
    end if;
    if tenant_uuid is null or request_uuid is null then
        raise exception 'Evidence Node tenant and request identifiers are required' using errcode = '22023';
    end if;

    -- Exact retries and concurrent duplicate deliveries must resolve to one receipt chain.
    perform pg_advisory_xact_lock(hashtextextended(
        'vetios:evidence-node:ingest:' || tenant_uuid::text || ':' || request_uuid::text,
        0
    ));

    -- A committed request remains replayable even if its contract is later
    -- suspended or expires. The immutable receipt facts must still match.
    select receipt.*
    into cached_receipt
    from public.evidence_node_ingestion_receipt_events receipt
    where receipt.tenant_id = tenant_uuid
      and receipt.request_id = request_uuid;
    if cached_receipt.id is not null then
        if cached_receipt.contract_id <> (p_receipt->>'contract_id')::uuid
           or cached_receipt.source_system <> p_ingestion->>'source_system'
           or cached_receipt.source_version is distinct from nullif(p_ingestion->>'source_version', '')
           or cached_receipt.source_transport <> p_receipt->>'source_transport'
           or cached_receipt.source_format <> p_receipt->>'source_format'
           or cached_receipt.adapter_key <> p_receipt->>'adapter_key'
           or cached_receipt.contract_version <> p_receipt->>'contract_version'
           or cached_receipt.mapping_version <> p_receipt->>'mapping_version'
           or cached_receipt.mapping_hash <> p_receipt->>'mapping_hash'
           or cached_receipt.reference_key_id <> p_receipt->>'reference_key_id'
           or cached_receipt.source_ref_hash <> p_receipt->>'source_ref_hash'
           or cached_receipt.source_record_digest <> p_ingestion->>'source_record_digest'
           or cached_receipt.canonical_packet_hash <> p_ingestion->>'canonical_packet_hash'
           or cached_receipt.oauth_client_id is distinct from nullif(p_ingestion->>'oauth_client_id', '')::uuid
           or cached_receipt.certificate_thumbprint_hash <> p_receipt->>'certificate_thumbprint_hash' then
            raise exception 'Evidence Node idempotency key payload mismatch' using errcode = '23505';
        end if;

        select identity.* into cached_identity
        from public.evidence_node_identity_link_events identity
        where identity.tenant_id = cached_receipt.tenant_id
          and identity.ingestion_event_id = cached_receipt.ingestion_event_id
        order by identity.occurred_at desc, identity.created_at desc
        limit 1;

        select task.* into cached_closure
        from public.evidence_node_closure_task_events task
        where task.tenant_id = cached_receipt.tenant_id
          and task.ingestion_event_id = cached_receipt.ingestion_event_id
        order by task.occurred_at desc, task.created_at desc
        limit 1;

        return jsonb_build_object(
            'ingestion_event_id', cached_receipt.ingestion_event_id,
            'receipt_event_id', cached_receipt.id,
            'receipt_id', cached_receipt.receipt_id,
            'receipt_status', cached_receipt.receipt_status,
            'receipt_hash', cached_receipt.receipt_hash,
            'identity_link_id', cached_identity.link_id,
            'identity_status', cached_identity.event_type,
            'amr_episode_id', coalesce(cached_identity.amr_episode_id, cached_closure.amr_episode_id),
            'closure_task_id', cached_closure.task_id,
            'reconciliation_event_id', cached_receipt.reconciliation_event_id,
            'lab_feed_event_ids', coalesce((
                select to_jsonb(reconciliation.amr_lab_feed_event_ids)
                from public.amr_ast_reconciliation_events reconciliation
                where reconciliation.tenant_id = cached_receipt.tenant_id
                  and reconciliation.ingestion_event_id = cached_receipt.ingestion_event_id
                order by reconciliation.occurred_at desc, reconciliation.created_at desc
                limit 1
            ), '[]'::jsonb),
            'cached', true
        );
    end if;

    select event.* into active_contract
    from public.evidence_node_adapter_contract_events event
    where event.tenant_id = tenant_uuid
      and event.contract_id = (p_receipt->>'contract_id')::uuid
    order by event.occurred_at desc, event.created_at desc
    limit 1;

    if active_contract.id is null or active_contract.event_type <> 'activated' then
        raise exception 'Active Evidence Node adapter contract is required' using errcode = '23514';
    end if;
    if active_contract.effective_at > now()
       or (active_contract.expires_at is not null and active_contract.expires_at <= now()) then
        raise exception 'Evidence Node adapter contract is outside its active window' using errcode = '23514';
    end if;
    if active_contract.adapter_key <> p_receipt->>'adapter_key'
       or active_contract.contract_version <> p_receipt->>'contract_version'
       or active_contract.mapping_version <> p_receipt->>'mapping_version'
       or active_contract.mapping_hash <> p_receipt->>'mapping_hash'
       or active_contract.reference_key_id <> p_receipt->>'reference_key_id'
       or active_contract.clinic_site_id <> (p_ingestion->>'site_id')::uuid
       or active_contract.lab_site_id <> (p_ingestion->>'lab_site_id')::uuid
       or active_contract.oauth_client_id is distinct from nullif(p_ingestion->>'oauth_client_id', '')::uuid
       or active_contract.mtls_cert_thumbprint_hash <> p_receipt->>'certificate_thumbprint_hash'
       or active_contract.source_system <> p_ingestion->>'source_system'
       or active_contract.source_version is distinct from nullif(p_ingestion->>'source_version', '')
       or not ((p_receipt->>'source_transport') = any(active_contract.permitted_transports))
       or not ((p_receipt->>'source_format') = any(active_contract.permitted_formats)) then
        raise exception 'Evidence Node packet does not match the active adapter contract' using errcode = '23514';
    end if;

    closure_destination_channel := case
        when active_contract.writeback_permitted
            then active_contract.closure_destination_channel
        else 'manual_work_queue'
    end;

    core_result := public.ingest_amr_ast_packet_v1(p_ingestion, p_results, p_surveillance_events);
    ingestion_id := (core_result->>'ingestion_event_id')::uuid;
    reconciliation_id := nullif(core_result->>'reconciliation_event_id', '')::uuid;
    select feed_id::uuid into primary_lab_feed_event_id
    from jsonb_array_elements_text(coalesce(core_result->'lab_feed_event_ids', '[]'::jsonb)) as feed(feed_id)
    limit 1;
    receipt_status := case
        when coalesce((core_result->>'cached')::boolean, false) then 'duplicate'
        when p_ingestion->>'ingestion_status' = 'accepted' then 'accepted'
        else 'blocked'
    end;
    receipt_uuid := coalesce(nullif(p_receipt->>'receipt_id', '')::uuid, gen_random_uuid());
    receipt_hash := encode(digest(
        active_contract.contract_id::text || ':' || ingestion_id::text || ':'
        || p_ingestion->>'source_record_digest' || ':' || p_receipt->>'mapping_hash' || ':' || receipt_status,
        'sha256'
    ), 'hex');

    insert into public.evidence_node_ingestion_receipt_events (
        tenant_id, request_id, receipt_id, contract_id, ingestion_event_id,
        reconciliation_event_id, oauth_client_id, certificate_thumbprint_hash,
        source_system, source_version,
        source_transport, source_format, adapter_key, contract_version,
        mapping_version, mapping_hash, reference_key_id, source_ref_hash, source_record_digest,
        canonical_packet_hash, receipt_status, result_count,
        removed_direct_identifier_count, deidentified, is_synthetic,
        raw_payload_stored_centrally, blockers, warnings, evidence,
        receipt_hash, actor_id
    ) values (
        (p_ingestion->>'tenant_id')::uuid,
        (p_receipt->>'request_id')::uuid,
        receipt_uuid,
        active_contract.contract_id,
        ingestion_id,
        reconciliation_id,
        active_contract.oauth_client_id,
        p_receipt->>'certificate_thumbprint_hash',
        p_ingestion->>'source_system',
        nullif(p_ingestion->>'source_version', ''),
        p_receipt->>'source_transport',
        p_receipt->>'source_format',
        p_receipt->>'adapter_key',
        p_receipt->>'contract_version',
        p_receipt->>'mapping_version',
        p_receipt->>'mapping_hash',
        p_receipt->>'reference_key_id',
        p_receipt->>'source_ref_hash',
        p_ingestion->>'source_record_digest',
        p_ingestion->>'canonical_packet_hash',
        receipt_status,
        (p_ingestion->>'result_count')::integer,
        coalesce((p_receipt->>'removed_direct_identifier_count')::integer, 0),
        coalesce((p_ingestion->>'deidentified')::boolean, true),
        coalesce((p_ingestion->>'is_synthetic')::boolean, false),
        false,
        coalesce(array(select jsonb_array_elements_text(p_ingestion->'blockers')), '{}'::text[]),
        coalesce(array(select jsonb_array_elements_text(p_ingestion->'warnings')), '{}'::text[]),
        coalesce(p_receipt->'evidence', '{}'::jsonb) || jsonb_build_object(
            'raw_payload_stored_centrally', false,
            'breakpoints_computed_by_vetios', false,
            'contract_event_id', active_contract.id
        ),
        receipt_hash,
        nullif(p_ingestion->>'actor_id', '')
    ) returning id into receipt_event_id;

    if receipt_status = 'accepted' then
        identity_event_type := case
            when linked_case_id is not null or linked_patient_episode_id is not null then 'verified'
            else 'proposed'
        end;
        identity_event := jsonb_build_object(
            'contract_id', active_contract.contract_id,
            'ingestion_event_id', ingestion_id,
            'case_id', linked_case_id,
            'patient_episode_id', linked_patient_episode_id,
            'source', 'ingest_evidence_node_packet_v1'
        );
        insert into public.evidence_node_identity_link_events (
            tenant_id, request_id, link_id, event_type, contract_id,
            ingestion_event_id, clinic_site_id, lab_site_id,
            external_patient_ref_hash, accession_ref_hash, isolate_ref_hash,
            patient_episode_id, case_id, amr_episode_id, match_method,
            match_confidence, blockers, evidence, event_hash, actor_id
        ) values (
            (p_ingestion->>'tenant_id')::uuid,
            gen_random_uuid(),
            identity_link_id,
            identity_event_type,
            active_contract.contract_id,
            ingestion_id,
            active_contract.clinic_site_id,
            active_contract.lab_site_id,
            nullif(p_ingestion->>'patient_ref_hash', ''),
            p_receipt->>'accession_ref_hash',
            p_ingestion->>'isolate_ref_hash',
            linked_patient_episode_id,
            linked_case_id,
            amr_episode_id,
            case when identity_event_type = 'verified' then 'explicit_source_reference' else 'unmatched' end,
            case when identity_event_type = 'verified' then 1 else 0 end,
            case when identity_event_type = 'verified' then '{}'::text[] else array['episode_identity_review_required'] end,
            identity_event,
            encode(digest(identity_event::text || ':' || identity_event_type, 'sha256'), 'hex'),
            nullif(p_ingestion->>'actor_id', '')
        );

        insert into public.amr_outcome_episode_events (
            tenant_id, request_id, episode_id, site_id, lab_site_id,
            event_type, case_id, species, pathogen_key, review_status,
            is_synthetic, deidentified, source_record_digest,
            evidence_packet_hash, calibration_eligible, federation_eligible,
            eligibility_blockers, event_payload, event_hash, actor_id
        ) values (
            (p_ingestion->>'tenant_id')::uuid,
            gen_random_uuid(),
            amr_episode_id,
            active_contract.clinic_site_id,
            active_contract.lab_site_id,
            'episode_opened',
            linked_case_id,
            p_ingestion->>'species',
            p_ingestion->>'organism_key',
            'pending',
            coalesce((p_ingestion->>'is_synthetic')::boolean, false),
            coalesce((p_ingestion->>'deidentified')::boolean, true),
            p_ingestion->>'source_record_digest',
            p_ingestion->>'canonical_packet_hash',
            false,
            false,
            array['treatment_follow_up_outcome_closure_required'],
            jsonb_build_object(
                'schema_version', 'evidence-node-amr-episode-v1',
                'ingestion_event_id', ingestion_id,
                'identity_link_id', identity_link_id,
                'patient_episode_id', linked_patient_episode_id
            ),
            encode(digest(ingestion_id::text || ':episode_opened', 'sha256'), 'hex'),
            nullif(p_ingestion->>'actor_id', '')
        );

        insert into public.amr_outcome_episode_events (
            tenant_id, request_id, episode_id, site_id, lab_site_id,
            event_type, case_id, species, pathogen_key, review_status,
            is_synthetic, deidentified, source_record_digest,
            evidence_packet_hash, calibration_eligible, federation_eligible,
            eligibility_blockers, event_payload, event_hash, actor_id
        ) values (
            (p_ingestion->>'tenant_id')::uuid,
            gen_random_uuid(),
            amr_episode_id,
            active_contract.clinic_site_id,
            active_contract.lab_site_id,
            'culture_received',
            linked_case_id,
            p_ingestion->>'species',
            p_ingestion->>'organism_key',
            'pending',
            coalesce((p_ingestion->>'is_synthetic')::boolean, false),
            coalesce((p_ingestion->>'deidentified')::boolean, true),
            p_ingestion->>'source_record_digest',
            p_ingestion->>'canonical_packet_hash',
            false,
            false,
            array['ast_treatment_follow_up_outcome_closure_required'],
            jsonb_build_object(
                'schema_version', 'evidence-node-amr-episode-v1',
                'ingestion_event_id', ingestion_id,
                'specimen_type', p_ingestion->>'specimen_type',
                'culture_collected_at', nullif(p_ingestion->>'culture_collected_at', '')
            ),
            encode(digest(ingestion_id::text || ':culture_received', 'sha256'), 'hex'),
            nullif(p_ingestion->>'actor_id', '')
        );

        if p_ingestion->>'qc_status' = 'passed' then
            insert into public.amr_outcome_episode_events (
                tenant_id, request_id, episode_id, site_id, lab_site_id,
                event_type, case_id, amr_lab_feed_event_id, species, pathogen_key, review_status,
                is_synthetic, deidentified, source_record_digest,
                evidence_packet_hash, calibration_eligible, federation_eligible,
                eligibility_blockers, event_payload, event_hash, actor_id
            ) values (
                (p_ingestion->>'tenant_id')::uuid,
                gen_random_uuid(),
                amr_episode_id,
                active_contract.clinic_site_id,
                active_contract.lab_site_id,
                'ast_verified',
                linked_case_id,
                primary_lab_feed_event_id,
                p_ingestion->>'species',
                p_ingestion->>'organism_key',
                'completed',
                coalesce((p_ingestion->>'is_synthetic')::boolean, false),
                coalesce((p_ingestion->>'deidentified')::boolean, true),
                p_ingestion->>'source_record_digest',
                p_ingestion->>'canonical_packet_hash',
                false,
                false,
                array['treatment_follow_up_outcome_closure_required'],
                jsonb_build_object(
                    'schema_version', 'evidence-node-amr-episode-v1',
                    'ingestion_event_id', ingestion_id,
                    'ast_method', p_ingestion->>'ast_method',
                    'interpretation_standard', p_ingestion->>'interpretation_standard',
                    'interpretation_standard_version', p_ingestion->>'interpretation_standard_version',
                    'result_count', (p_ingestion->>'result_count')::integer,
                    'breakpoints_computed_by_vetios', false
                ),
                encode(digest(ingestion_id::text || ':ast_verified', 'sha256'), 'hex'),
                nullif(p_ingestion->>'actor_id', '')
            );
        end if;

        if identity_event_type = 'verified' then
            insert into public.amr_ast_reconciliation_events (
                tenant_id, request_id, ingestion_event_id, reconciliation_event,
                episode_id, case_id, amr_lab_feed_event_ids, attempt_no,
                evidence, event_hash, actor_id
            ) values (
                (p_ingestion->>'tenant_id')::uuid,
                gen_random_uuid(),
                ingestion_id,
                'matched',
                amr_episode_id,
                linked_case_id,
                coalesce(
                    array(
                        select feed_id::uuid
                        from jsonb_array_elements_text(
                            coalesce(core_result->'lab_feed_event_ids', '[]'::jsonb)
                        ) as feed(feed_id)
                    ),
                    '{}'::uuid[]
                ),
                2,
                jsonb_build_object(
                    'schema_version', 'evidence-node-reconciliation-v1',
                    'identity_link_id', identity_link_id,
                    'patient_episode_id', linked_patient_episode_id
                ),
                encode(digest(ingestion_id::text || ':matched:' || identity_link_id::text, 'sha256'), 'hex'),
                nullif(p_ingestion->>'actor_id', '')
            ) returning id into reconciliation_id;
        end if;

        next_task_type := case
            when identity_event_type <> 'verified' then 'reconcile_episode'
            when p_ingestion->>'qc_status' = 'passed' and primary_lab_feed_event_id is not null
                then 'confirm_treatment'
            else 'review_label_authority'
        end;
        closure_event := jsonb_build_object(
            'task_type', next_task_type,
            'ingestion_event_id', ingestion_id,
            'identity_link_id', identity_link_id,
            'destination_channel', closure_destination_channel
        );
        insert into public.evidence_node_closure_task_events (
            tenant_id, request_id, task_id, event_type, task_type,
            contract_id, ingestion_event_id, amr_episode_id,
            patient_episode_id, case_id, destination_channel, due_at,
            blockers, evidence, event_hash, actor_id
        ) values (
            (p_ingestion->>'tenant_id')::uuid,
            gen_random_uuid(),
            closure_task_id,
            'queued',
            next_task_type,
            active_contract.contract_id,
            ingestion_id,
            amr_episode_id,
            linked_patient_episode_id,
            linked_case_id,
            closure_destination_channel,
            now() + case when next_task_type = 'confirm_treatment' then interval '24 hours' else interval '4 hours' end,
            '{}'::text[],
            closure_event,
            encode(digest(closure_event::text || ':' || closure_task_id::text, 'sha256'), 'hex'),
            nullif(p_ingestion->>'actor_id', '')
        );
    end if;

    return core_result || jsonb_build_object(
        'receipt_event_id', receipt_event_id,
        'receipt_id', receipt_uuid,
        'receipt_status', receipt_status,
        'receipt_hash', receipt_hash,
        'identity_link_id', case when receipt_status = 'accepted' then identity_link_id else null end,
        'identity_status', case when receipt_status = 'accepted' then identity_event_type else null end,
        'amr_episode_id', case when receipt_status = 'accepted' then amr_episode_id else null end,
        'closure_task_id', case when receipt_status = 'accepted' then closure_task_id else null end,
        'reconciliation_event_id', reconciliation_id,
        'cached', coalesce((core_result->>'cached')::boolean, false)
    );
end;
$$;

revoke all on function public.ingest_evidence_node_packet_v1(jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.ingest_evidence_node_packet_v1(jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.evidence_node_site_operational_v1(
    p_tenant_id uuid,
    p_site_id uuid,
    p_site_type text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        exists (
            select 1
            from public.amr_network_site_events event
            where event.tenant_id = p_tenant_id
              and event.site_id = p_site_id
              and event.site_type = p_site_type
        )
        and coalesce((
            select event.event_type = 'enrolled'
            from public.amr_network_site_events event
            where event.tenant_id = p_tenant_id
              and event.site_id = p_site_id
              and event.event_type in ('enrolled', 'paused', 'retired')
            order by event.occurred_at desc, event.created_at desc
            limit 1
        ), false)
        and coalesce((
            select event.event_type = 'data_use_approved'
            from public.amr_network_site_events event
            where event.tenant_id = p_tenant_id
              and event.site_id = p_site_id
              and event.event_type in ('data_use_approved', 'data_use_revoked')
            order by event.occurred_at desc, event.created_at desc
            limit 1
        ), false)
        and coalesce((
            select event.event_type = 'connector_verified'
               and event.evidence->>'attestation_status' = 'verified'
               and event.evidence->>'attestation_event_id'
                   ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
               and event.evidence->>'token_binding_method' = 'mtls'
            from public.amr_network_site_events event
            where event.tenant_id = p_tenant_id
              and event.site_id = p_site_id
              and event.event_type in ('connector_verified', 'connector_failed')
            order by event.occurred_at desc, event.created_at desc
            limit 1
        ), false);
$$;

revoke all on function public.evidence_node_site_operational_v1(uuid, uuid, text) from public;
grant execute on function public.evidence_node_site_operational_v1(uuid, uuid, text) to service_role;

create or replace function public.advance_evidence_node_closure_task_v1(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    prior_task public.evidence_node_closure_task_events%rowtype;
    cached_task public.evidence_node_closure_task_events%rowtype;
    ingestion public.amr_ast_ingestion_events%rowtype;
    identity_link public.evidence_node_identity_link_events%rowtype;
    episode_state public.amr_outcome_episode_events%rowtype;
    tenant_uuid uuid := nullif(p_event->>'tenant_id', '')::uuid;
    request_uuid uuid := nullif(p_event->>'request_id', '')::uuid;
    task_uuid uuid := nullif(p_event->>'task_id', '')::uuid;
    next_task_id uuid;
    task_event_id uuid;
    episode_event_id uuid;
    eligibility_event_id uuid;
    reconciliation_event_id uuid;
    requested_event_type text := p_event->>'event_type';
    next_task_type text;
    resolved_case_id uuid;
    resolved_patient_episode_id uuid;
    resolved_inference_event_id uuid;
    resolved_clinical_outcome_id uuid;
    resolved_stewardship_event_id uuid;
    primary_lab_feed_event_id uuid;
    lab_feed_event_ids uuid[] := '{}'::uuid[];
    reviewer_hash text := nullif(p_event->>'reviewer_ref_hash', '');
    writeback_hash text := nullif(p_event->>'writeback_receipt_hash', '');
    blocker_code text := nullif(p_event->>'blocker_code', '');
    consent_value text := nullif(p_event->>'consent_status', '');
    outcome_value text := nullif(p_event->>'outcome_status', '');
    outcome_authority text;
    confirmed_outcome_label text;
    event_evidence jsonb := coalesce(p_event->'evidence', '{}'::jsonb);
    episode_payload jsonb;
    eligibility_blockers text[] := '{}'::text[];
    calibration_ok boolean := false;
    federation_ok boolean := false;
begin
    if jsonb_typeof(p_event) <> 'object'
       or tenant_uuid is null
       or request_uuid is null
       or task_uuid is null then
        raise exception 'Evidence Node closure event identifiers are required' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
        'vetios:evidence-node:closure:' || tenant_uuid::text || ':' || task_uuid::text,
        0
    ));

    select event.* into cached_task
    from public.evidence_node_closure_task_events event
    where event.tenant_id = tenant_uuid
      and event.request_id = request_uuid
    limit 1;
    if cached_task.id is not null then
        return jsonb_build_object(
            'task_event_id', cached_task.id,
            'task_id', cached_task.task_id,
            'event_type', cached_task.event_type,
            'cached', true
        );
    end if;

    select event.* into prior_task
    from public.evidence_node_closure_task_events event
    where event.tenant_id = tenant_uuid
      and event.task_id = task_uuid
    order by event.occurred_at desc, event.created_at desc
    limit 1
    for update;

    if prior_task.id is null then
        raise exception 'Evidence Node closure task was not found' using errcode = 'P0002';
    end if;
    if prior_task.event_type in ('completed', 'cancelled') then
        raise exception 'Evidence Node closure task is terminal' using errcode = '23514';
    end if;
    if not (
        (prior_task.event_type = 'queued' and requested_event_type in ('dispatched', 'completed', 'cancelled', 'failed'))
        or (prior_task.event_type = 'dispatched' and requested_event_type in ('acknowledged', 'completed', 'failed', 'cancelled'))
        or (prior_task.event_type = 'acknowledged' and requested_event_type in ('completed', 'failed', 'cancelled'))
        or (prior_task.event_type = 'failed' and requested_event_type in ('dispatched', 'cancelled'))
    ) then
        raise exception 'Invalid Evidence Node closure task transition' using errcode = '23514';
    end if;
    if requested_event_type = 'failed' and blocker_code is null then
        raise exception 'Failed closure task requires a blocker code' using errcode = '23514';
    end if;
    if requested_event_type = 'completed' and reviewer_hash is null then
        raise exception 'Completed closure task requires reviewer evidence' using errcode = '23514';
    end if;
    if requested_event_type = 'completed'
       and prior_task.destination_channel <> 'manual_work_queue'
       and writeback_hash is null then
        raise exception 'Completed write-back task requires a receipt hash' using errcode = '23514';
    end if;

    resolved_case_id := coalesce(nullif(p_event->>'case_id', '')::uuid, prior_task.case_id);
    resolved_patient_episode_id := coalesce(
        nullif(p_event->>'patient_episode_id', '')::uuid,
        prior_task.patient_episode_id
    );
    if resolved_case_id is null and resolved_patient_episode_id is not null then
        select episode.latest_case_id into resolved_case_id
        from public.patient_episodes episode
        where episode.tenant_id = tenant_uuid
          and episode.id = resolved_patient_episode_id;
    end if;

    insert into public.evidence_node_closure_task_events (
        tenant_id, request_id, task_id, event_type, task_type,
        contract_id, ingestion_event_id, amr_episode_id,
        patient_episode_id, case_id, destination_channel,
        destination_ref_hash, due_at, outcome_status, reviewer_ref_hash,
        writeback_receipt_hash, blockers, evidence, event_hash, actor_id
    ) values (
        tenant_uuid,
        request_uuid,
        task_uuid,
        requested_event_type,
        prior_task.task_type,
        prior_task.contract_id,
        prior_task.ingestion_event_id,
        prior_task.amr_episode_id,
        resolved_patient_episode_id,
        resolved_case_id,
        prior_task.destination_channel,
        coalesce(nullif(p_event->>'destination_ref_hash', ''), prior_task.destination_ref_hash),
        prior_task.due_at,
        coalesce(outcome_value, prior_task.outcome_status),
        reviewer_hash,
        writeback_hash,
        case when blocker_code is null then '{}'::text[] else array[blocker_code] end,
        event_evidence,
        encode(digest(prior_task.id::text || ':' || p_event::text, 'sha256'), 'hex'),
        nullif(p_event->>'actor_id', '')
    ) returning id into task_event_id;

    if requested_event_type <> 'completed' then
        return jsonb_build_object(
            'task_event_id', task_event_id,
            'task_id', task_uuid,
            'event_type', requested_event_type,
            'cached', false
        );
    end if;

    select event.* into ingestion
    from public.amr_ast_ingestion_events event
    where event.tenant_id = tenant_uuid
      and event.id = prior_task.ingestion_event_id;
    if ingestion.id is null or ingestion.ingestion_status <> 'accepted' then
        raise exception 'Accepted AMR ingestion is required for closure advancement' using errcode = '23514';
    end if;

    select event.* into identity_link
    from public.evidence_node_identity_link_events event
    where event.tenant_id = tenant_uuid
      and event.ingestion_event_id = ingestion.id
    order by event.occurred_at desc, event.created_at desc
    limit 1;

    select coalesce(array_agg(feed.id order by feed.created_at), '{}'::uuid[])
    into lab_feed_event_ids
    from public.amr_lab_feed_surveillance_events feed
    where feed.tenant_id = tenant_uuid
      and feed.source_record_digest = ingestion.source_record_digest;
    primary_lab_feed_event_id := lab_feed_event_ids[1];

    select event.* into episode_state
    from public.amr_outcome_episode_events event
    where event.tenant_id = tenant_uuid
      and event.episode_id = prior_task.amr_episode_id
    order by event.occurred_at desc, event.created_at desc
    limit 1;
    if episode_state.id is null then
        raise exception 'AMR outcome episode is required for closure advancement' using errcode = '23514';
    end if;

    if prior_task.task_type = 'reconcile_episode' then
        if resolved_case_id is null and resolved_patient_episode_id is null then
            raise exception 'Reconciliation requires a tenant case or patient episode' using errcode = '23514';
        end if;
        if identity_link.id is null then
            raise exception 'Evidence Node identity proposal is required' using errcode = '23514';
        end if;

        insert into public.evidence_node_identity_link_events (
            tenant_id, request_id, link_id, event_type, contract_id,
            ingestion_event_id, clinic_site_id, lab_site_id,
            external_patient_ref_hash, accession_ref_hash, isolate_ref_hash,
            patient_episode_id, case_id, amr_episode_id, match_method,
            match_confidence, reviewer_ref_hash, blockers, evidence,
            event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), identity_link.link_id, 'verified',
            identity_link.contract_id, ingestion.id, identity_link.clinic_site_id,
            identity_link.lab_site_id, identity_link.external_patient_ref_hash,
            identity_link.accession_ref_hash, identity_link.isolate_ref_hash,
            resolved_patient_episode_id, resolved_case_id, prior_task.amr_episode_id,
            'reviewer_confirmed', 1, reviewer_hash, '{}'::text[],
            event_evidence || jsonb_build_object('source_task_id', task_uuid),
            encode(digest(identity_link.link_id::text || ':verified:' || request_uuid::text, 'sha256'), 'hex'),
            nullif(p_event->>'actor_id', '')
        );

        insert into public.amr_ast_reconciliation_events (
            tenant_id, request_id, ingestion_event_id, reconciliation_event,
            episode_id, case_id, amr_lab_feed_event_ids, attempt_no,
            evidence, event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), ingestion.id, 'matched',
            prior_task.amr_episode_id, resolved_case_id, lab_feed_event_ids,
            coalesce((
                select max(event.attempt_no) + 1
                from public.amr_ast_reconciliation_events event
                where event.tenant_id = tenant_uuid
                  and event.ingestion_event_id = ingestion.id
            ), 1),
            event_evidence || jsonb_build_object(
                'schema_version', 'evidence-node-reconciliation-v1',
                'identity_link_id', identity_link.link_id,
                'patient_episode_id', resolved_patient_episode_id
            ),
            encode(digest(ingestion.id::text || ':matched:' || request_uuid::text, 'sha256'), 'hex'),
            nullif(p_event->>'actor_id', '')
        ) returning id into reconciliation_event_id;

        next_task_type := case
            when ingestion.qc_status = 'passed' and primary_lab_feed_event_id is not null
                then 'confirm_treatment'
            else 'review_label_authority'
        end;
    elsif prior_task.task_type = 'review_label_authority' then
        if primary_lab_feed_event_id is null then
            raise exception 'Laboratory feed evidence is required before AST verification' using errcode = '23514';
        end if;
        episode_payload := event_evidence || jsonb_build_object(
            'schema_version', 'evidence-node-amr-episode-v1',
            'ingestion_event_id', ingestion.id,
            'ast_method', ingestion.ast_method,
            'interpretation_standard', ingestion.interpretation_standard,
            'interpretation_standard_version', ingestion.interpretation_standard_version,
            'breakpoints_computed_by_vetios', false
        );
        insert into public.amr_outcome_episode_events (
            tenant_id, request_id, episode_id, site_id, lab_site_id, event_type,
            case_id, amr_lab_feed_event_id, species, pathogen_key, review_status,
            reviewer_ref_hash, is_synthetic, deidentified, source_record_digest,
            evidence_packet_hash, calibration_eligible, federation_eligible,
            eligibility_blockers, event_payload, event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), prior_task.amr_episode_id,
            episode_state.site_id, episode_state.lab_site_id, 'ast_verified',
            resolved_case_id, primary_lab_feed_event_id, ingestion.species,
            ingestion.organism_key, 'completed', reviewer_hash,
            ingestion.is_synthetic, ingestion.deidentified,
            ingestion.source_record_digest, ingestion.canonical_packet_hash,
            false, false, array['treatment_follow_up_outcome_closure_required'],
            episode_payload,
            encode(digest(ingestion.id::text || ':ast_verified:' || request_uuid::text, 'sha256'), 'hex'),
            nullif(p_event->>'actor_id', '')
        ) returning id into episode_event_id;
        next_task_type := 'confirm_treatment';
    elsif prior_task.task_type = 'confirm_treatment' then
        resolved_stewardship_event_id := nullif(p_event->>'amr_stewardship_event_id', '')::uuid;
        if resolved_stewardship_event_id is null
           or resolved_case_id is null
           or nullif(event_evidence->>'treatment_strategy', '') is null then
            raise exception 'Treatment closure requires stewardship evidence and strategy' using errcode = '23514';
        end if;
        if not exists (
            select 1
            from public.amr_stewardship_events stewardship
            where stewardship.tenant_id = tenant_uuid
              and stewardship.id = resolved_stewardship_event_id
              and stewardship.case_id = resolved_case_id
        ) then
            raise exception 'Tenant-owned stewardship evidence for the reconciled case is required' using errcode = '23514';
        end if;
        if not exists (
            select 1 from public.amr_outcome_episode_events event
            where event.tenant_id = tenant_uuid
              and event.episode_id = prior_task.amr_episode_id
              and event.event_type = 'ast_verified'
        ) then
            raise exception 'Verified AST is required before treatment' using errcode = '23514';
        end if;
        insert into public.amr_outcome_episode_events (
            tenant_id, request_id, episode_id, site_id, lab_site_id, event_type,
            case_id, amr_stewardship_event_id, amr_lab_feed_event_id,
            species, pathogen_key, review_status, reviewer_ref_hash,
            is_synthetic, deidentified, source_record_digest,
            evidence_packet_hash, calibration_eligible, federation_eligible,
            eligibility_blockers, event_payload, event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), prior_task.amr_episode_id,
            episode_state.site_id, episode_state.lab_site_id, 'treatment_recorded',
            resolved_case_id, resolved_stewardship_event_id,
            coalesce(episode_state.amr_lab_feed_event_id, primary_lab_feed_event_id),
            ingestion.species, ingestion.organism_key, 'pending', reviewer_hash,
            ingestion.is_synthetic, ingestion.deidentified,
            ingestion.source_record_digest, ingestion.canonical_packet_hash,
            false, false, array['follow_up_outcome_closure_required'],
            event_evidence || jsonb_build_object('schema_version', 'evidence-node-amr-episode-v1'),
            encode(digest(ingestion.id::text || ':treatment_recorded:' || request_uuid::text, 'sha256'), 'hex'),
            nullif(p_event->>'actor_id', '')
        ) returning id into episode_event_id;
        next_task_type := 'confirm_follow_up';
    elsif prior_task.task_type = 'confirm_follow_up' then
        if nullif(event_evidence->>'followup_days', '') is null then
            raise exception 'Follow-up closure requires elapsed follow-up days' using errcode = '23514';
        end if;
        if not exists (
            select 1 from public.amr_outcome_episode_events event
            where event.tenant_id = tenant_uuid
              and event.episode_id = prior_task.amr_episode_id
              and event.event_type = 'treatment_recorded'
        ) then
            raise exception 'Treatment evidence is required before clinical review' using errcode = '23514';
        end if;
        resolved_stewardship_event_id := episode_state.amr_stewardship_event_id;
        insert into public.amr_outcome_episode_events (
            tenant_id, request_id, episode_id, site_id, lab_site_id, event_type,
            case_id, amr_stewardship_event_id, amr_lab_feed_event_id,
            species, pathogen_key, review_status, reviewer_ref_hash,
            is_synthetic, deidentified, source_record_digest,
            evidence_packet_hash, calibration_eligible, federation_eligible,
            eligibility_blockers, event_payload, event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), prior_task.amr_episode_id,
            episode_state.site_id, episode_state.lab_site_id, 'clinical_review_completed',
            resolved_case_id, resolved_stewardship_event_id,
            coalesce(episode_state.amr_lab_feed_event_id, primary_lab_feed_event_id),
            ingestion.species, ingestion.organism_key, 'completed', reviewer_hash,
            ingestion.is_synthetic, ingestion.deidentified,
            ingestion.source_record_digest, ingestion.canonical_packet_hash,
            false, false, array['confirmed_outcome_and_closure_required'],
            event_evidence || jsonb_build_object('schema_version', 'evidence-node-amr-episode-v1'),
            encode(digest(ingestion.id::text || ':clinical_review_completed:' || request_uuid::text, 'sha256'), 'hex'),
            nullif(p_event->>'actor_id', '')
        ) returning id into episode_event_id;
        next_task_type := 'confirm_outcome';
    elsif prior_task.task_type = 'confirm_outcome' then
        resolved_inference_event_id := nullif(p_event->>'inference_event_id', '')::uuid;
        resolved_clinical_outcome_id := nullif(p_event->>'clinical_outcome_id', '')::uuid;
        resolved_stewardship_event_id := episode_state.amr_stewardship_event_id;
        if resolved_inference_event_id is null
           or resolved_clinical_outcome_id is null
           or resolved_case_id is null
           or outcome_value is null
           or outcome_value = 'unknown'
           or consent_value is null then
            raise exception 'Outcome closure requires linked inference, outcome, status, and consent' using errcode = '23514';
        end if;
        if not exists (
            select 1 from public.amr_outcome_episode_events event
            where event.tenant_id = tenant_uuid
              and event.episode_id = prior_task.amr_episode_id
              and event.event_type = 'clinical_review_completed'
        ) then
            raise exception 'Clinical review is required before outcome confirmation' using errcode = '23514';
        end if;
        if coalesce(episode_state.amr_lab_feed_event_id, primary_lab_feed_event_id) is null
           or resolved_stewardship_event_id is null then
            raise exception 'AST feed and stewardship links are required before outcome closure' using errcode = '23514';
        end if;
        if not exists (
            select 1
            from public.ai_inference_events inference_event
            where inference_event.tenant_id = tenant_uuid
              and inference_event.id = resolved_inference_event_id
              and inference_event.case_id = resolved_case_id
              and not coalesce(inference_event.is_synthetic, false)
        ) then
            raise exception 'Tenant-owned non-synthetic inference for the reconciled case is required' using errcode = '23514';
        end if;
        if not exists (
            select 1
            from public.clinical_outcome_events outcome_event
            where outcome_event.tenant_id = tenant_uuid
              and outcome_event.id = resolved_clinical_outcome_id
              and outcome_event.inference_event_id = resolved_inference_event_id
              and outcome_event.case_id = resolved_case_id
              and not coalesce(outcome_event.is_synthetic, false)
        ) then
            raise exception 'Tenant-owned non-synthetic outcome linked to the reconciled inference is required' using errcode = '23514';
        end if;
        select outcome_event.label_type, outcome_event.actual_label
        into outcome_authority, confirmed_outcome_label
        from public.clinical_outcome_events outcome_event
        where outcome_event.tenant_id = tenant_uuid
          and outcome_event.id = resolved_clinical_outcome_id;

        if not exists (
            select 1
            from public.amr_stewardship_events stewardship
            where stewardship.tenant_id = tenant_uuid
              and stewardship.id = resolved_stewardship_event_id
              and stewardship.case_id = resolved_case_id
              and (stewardship.inference_event_id is null or stewardship.inference_event_id = resolved_inference_event_id)
              and (stewardship.clinical_outcome_id is null or stewardship.clinical_outcome_id = resolved_clinical_outcome_id)
        ) then
            raise exception 'Stewardship evidence conflicts with the reconciled episode' using errcode = '23514';
        end if;
        if not exists (
            select 1
            from public.amr_lab_feed_surveillance_events feed
            where feed.tenant_id = tenant_uuid
              and feed.id = coalesce(episode_state.amr_lab_feed_event_id, primary_lab_feed_event_id)
              and feed.source_record_digest = ingestion.source_record_digest
              and (feed.case_id is null or feed.case_id = resolved_case_id)
              and (feed.inference_event_id is null or feed.inference_event_id = resolved_inference_event_id)
              and (feed.clinical_outcome_id is null or feed.clinical_outcome_id = resolved_clinical_outcome_id)
        ) then
            raise exception 'Laboratory feed evidence conflicts with the reconciled episode' using errcode = '23514';
        end if;

        episode_payload := event_evidence || jsonb_build_object(
            'schema_version', 'evidence-node-amr-episode-v1',
            'patient_episode_id', resolved_patient_episode_id
        );
        insert into public.amr_outcome_episode_events (
            tenant_id, request_id, episode_id, site_id, lab_site_id, event_type,
            case_id, inference_event_id, clinical_outcome_id,
            amr_stewardship_event_id, amr_lab_feed_event_id,
            species, pathogen_key, outcome_status, consent_status,
            review_status, reviewer_ref_hash, is_synthetic, deidentified,
            source_record_digest, evidence_packet_hash, calibration_eligible,
            federation_eligible, eligibility_blockers, event_payload,
            event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), prior_task.amr_episode_id,
            episode_state.site_id, episode_state.lab_site_id, 'outcome_confirmed',
            resolved_case_id, resolved_inference_event_id, resolved_clinical_outcome_id,
            resolved_stewardship_event_id,
            coalesce(episode_state.amr_lab_feed_event_id, primary_lab_feed_event_id),
            ingestion.species, ingestion.organism_key, outcome_value, consent_value,
            'completed', reviewer_hash, ingestion.is_synthetic, ingestion.deidentified,
            ingestion.source_record_digest, ingestion.canonical_packet_hash,
            false, false, array['episode_closure_required'], episode_payload,
            encode(digest(ingestion.id::text || ':outcome_confirmed:' || request_uuid::text, 'sha256'), 'hex'),
            nullif(p_event->>'actor_id', '')
        ) returning id into episode_event_id;

        insert into public.amr_outcome_episode_events (
            tenant_id, request_id, episode_id, site_id, lab_site_id, event_type,
            case_id, inference_event_id, clinical_outcome_id,
            amr_stewardship_event_id, amr_lab_feed_event_id,
            species, pathogen_key, outcome_status, consent_status,
            review_status, reviewer_ref_hash, is_synthetic, deidentified,
            source_record_digest, evidence_packet_hash, calibration_eligible,
            federation_eligible, eligibility_blockers, event_payload,
            event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), prior_task.amr_episode_id,
            episode_state.site_id, episode_state.lab_site_id, 'episode_closed',
            resolved_case_id, resolved_inference_event_id, resolved_clinical_outcome_id,
            resolved_stewardship_event_id,
            coalesce(episode_state.amr_lab_feed_event_id, primary_lab_feed_event_id),
            ingestion.species, ingestion.organism_key, outcome_value, consent_value,
            'completed', reviewer_hash, ingestion.is_synthetic, ingestion.deidentified,
            ingestion.source_record_digest, ingestion.canonical_packet_hash,
            false, false, '{}'::text[], episode_payload,
            encode(digest(ingestion.id::text || ':episode_closed:' || request_uuid::text, 'sha256'), 'hex'),
            nullif(p_event->>'actor_id', '')
        );

        calibration_ok := consent_value = 'approved'
            and ingestion.deidentified
            and not ingestion.is_synthetic
            and coalesce(outcome_authority in ('expert_reviewed', 'lab_confirmed'), false)
            and nullif(btrim(confirmed_outcome_label), '') is not null
            and resolved_inference_event_id is not null
            and resolved_clinical_outcome_id is not null
            and resolved_stewardship_event_id is not null
            and coalesce(episode_state.amr_lab_feed_event_id, primary_lab_feed_event_id) is not null;
        federation_ok := calibration_ok
            and public.evidence_node_site_operational_v1(tenant_uuid, episode_state.site_id, 'clinic')
            and public.evidence_node_site_operational_v1(tenant_uuid, episode_state.lab_site_id, 'laboratory');
        eligibility_blockers := array_remove(array[
            case when consent_value <> 'approved' then 'learning_consent_missing' end,
            case when not ingestion.deidentified then 'deidentification_failed' end,
            case when ingestion.is_synthetic then 'synthetic_episode_excluded' end,
            case when outcome_authority not in ('expert_reviewed', 'lab_confirmed')
                or outcome_authority is null then 'outcome_authority_not_evidence_grade' end,
            case when nullif(btrim(confirmed_outcome_label), '') is null
                then 'confirmed_outcome_label_missing' end,
            case when not public.evidence_node_site_operational_v1(tenant_uuid, episode_state.site_id, 'clinic')
                then 'operational_clinic_missing' end,
            case when not public.evidence_node_site_operational_v1(tenant_uuid, episode_state.lab_site_id, 'laboratory')
                then 'operational_laboratory_missing' end
        ]::text[], null);

        insert into public.amr_outcome_episode_events (
            tenant_id, request_id, episode_id, site_id, lab_site_id, event_type,
            case_id, inference_event_id, clinical_outcome_id,
            amr_stewardship_event_id, amr_lab_feed_event_id,
            species, pathogen_key, outcome_status, consent_status,
            review_status, is_synthetic, deidentified, source_record_digest,
            evidence_packet_hash, calibration_eligible, federation_eligible,
            eligibility_blockers, event_payload, event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), prior_task.amr_episode_id,
            episode_state.site_id, episode_state.lab_site_id, 'eligibility_evaluated',
            resolved_case_id, resolved_inference_event_id, resolved_clinical_outcome_id,
            resolved_stewardship_event_id,
            coalesce(episode_state.amr_lab_feed_event_id, primary_lab_feed_event_id),
            ingestion.species, ingestion.organism_key, outcome_value, consent_value,
            'completed', ingestion.is_synthetic, ingestion.deidentified,
            ingestion.source_record_digest, ingestion.canonical_packet_hash,
            calibration_ok, federation_ok, eligibility_blockers,
            jsonb_build_object(
                'evaluator', 'evidence-node-closure-v1',
                'source_task_id', task_uuid
            ),
            encode(digest(ingestion.id::text || ':eligibility_evaluated:' || request_uuid::text, 'sha256'), 'hex'),
            'vetios_evidence_node_eligibility_engine'
        ) returning id into eligibility_event_id;
    else
        raise exception 'Unsupported Evidence Node closure task type' using errcode = '23514';
    end if;

    if next_task_type is not null then
        next_task_id := gen_random_uuid();
        insert into public.evidence_node_closure_task_events (
            tenant_id, request_id, task_id, event_type, task_type,
            contract_id, ingestion_event_id, amr_episode_id,
            patient_episode_id, case_id, destination_channel, due_at,
            blockers, evidence, event_hash, actor_id
        ) values (
            tenant_uuid, gen_random_uuid(), next_task_id, 'queued', next_task_type,
            prior_task.contract_id, ingestion.id, prior_task.amr_episode_id,
            resolved_patient_episode_id, resolved_case_id, prior_task.destination_channel,
            now() + case next_task_type
                when 'review_label_authority' then interval '4 hours'
                when 'confirm_treatment' then interval '24 hours'
                when 'confirm_follow_up' then interval '7 days'
                else interval '14 days'
            end,
            '{}'::text[],
            jsonb_build_object(
                'source_task_id', task_uuid,
                'source_task_event_id', task_event_id,
                'reconciliation_event_id', reconciliation_event_id
            ),
            encode(digest(next_task_id::text || ':queued:' || next_task_type, 'sha256'), 'hex'),
            'vetios_evidence_node_orchestrator'
        );
    end if;

    return jsonb_build_object(
        'task_event_id', task_event_id,
        'task_id', task_uuid,
        'event_type', requested_event_type,
        'episode_event_id', episode_event_id,
        'eligibility_event_id', eligibility_event_id,
        'reconciliation_event_id', reconciliation_event_id,
        'next_task_id', next_task_id,
        'next_task_type', next_task_type,
        'cached', false
    );
end;
$$;

revoke all on function public.advance_evidence_node_closure_task_v1(jsonb) from public;
grant execute on function public.advance_evidence_node_closure_task_v1(jsonb) to service_role;

comment on table public.evidence_node_adapter_contract_events is
    'Append-only contract and mapping approvals for one laboratory Evidence Node adapter. Activation binds mTLS OAuth identity, sites, formats, terms, and mapping hash.';
comment on table public.evidence_node_ingestion_receipt_events is
    'Immutable source-to-canonical receipts. Raw laboratory payloads and direct identifiers are prohibited centrally.';
comment on table public.evidence_node_identity_link_events is
    'Append-only reconciliation between hashed laboratory references and tenant-owned cases or patient episodes.';
comment on table public.evidence_node_closure_task_events is
    'Workflow-neutral closure tasks and write-back receipts for treatment, follow-up, and outcome confirmation.';
comment on table public.evidence_node_export_events is
    'Compatibility export evidence. InFARM, NAHLN, or KABS compatibility does not imply official acceptance without an accepted event and external receipt.';

notify pgrst, 'reload schema';
