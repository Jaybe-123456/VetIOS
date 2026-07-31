-- VetIOS AMR Evidence Fabric v1
--
-- Adds isolate-linked genomic provenance and append-only phenotype/genotype
-- concordance. Genomic evidence never overrides quantitative AST, and
-- experimental quantum or hybrid computation is excluded from clinical use.

create extension if not exists pgcrypto;

alter table public.amr_genomic_events
    add column if not exists request_id uuid,
    add column if not exists amr_ast_ingestion_event_id uuid
        references public.amr_ast_ingestion_events(id) on delete restrict,
    add column if not exists lab_site_id uuid,
    add column if not exists oauth_client_id uuid,
    add column if not exists external_validation_event_id uuid,
    add column if not exists pipeline_validation_ref text,
    add column if not exists isolate_ref_hash text,
    add column if not exists source_system text,
    add column if not exists source_version text,
    add column if not exists source_record_digest text,
    add column if not exists pipeline_name text,
    add column if not exists pipeline_version text,
    add column if not exists reference_database_versions jsonb not null default '{}'::jsonb,
    add column if not exists assayed_drug_classes text[] not null default '{}',
    add column if not exists quality_status text not null default 'not_reported',
    add column if not exists validation_status text not null default 'unvalidated',
    add column if not exists computation_class text not null default 'legacy_unclassified',
    add column if not exists clinical_use_allowed boolean not null default false,
    add column if not exists deidentified boolean not null default true,
    add column if not exists is_synthetic boolean not null default false,
    add column if not exists raw_sequence_stored boolean not null default false,
    add column if not exists evidence_hash text,
    add column if not exists blockers text[] not null default '{}',
    add column if not exists clinical_blockers text[] not null default '{}',
    add column if not exists warnings text[] not null default '{}',
    add column if not exists evidence jsonb not null default '{}'::jsonb,
    add column if not exists actor_id text,
    add column if not exists observed_at timestamptz;

alter table public.amr_genomic_events
    drop constraint if exists amr_genomic_oauth_client_fk,
    add constraint amr_genomic_oauth_client_fk
        foreign key (oauth_client_id)
        references public.oauth_clients(id) on delete restrict,
    drop constraint if exists amr_genomic_external_validation_fk,
    add constraint amr_genomic_external_validation_fk
        foreign key (external_validation_event_id)
        references public.external_validation_events(id) on delete restrict,
    drop constraint if exists amr_genomic_quality_status_check,
    add constraint amr_genomic_quality_status_check
        check (quality_status in ('passed', 'warning', 'failed', 'not_reported')),
    drop constraint if exists amr_genomic_validation_status_check,
    add constraint amr_genomic_validation_status_check
        check (validation_status in (
            'unvalidated',
            'internally_validated',
            'externally_validated'
        )),
    drop constraint if exists amr_genomic_computation_class_check,
    add constraint amr_genomic_computation_class_check
        check (computation_class in (
            'classical_validated',
            'classical_heuristic',
            'quantum_experimental',
            'hybrid_experimental',
            'legacy_unclassified'
        )),
    drop constraint if exists amr_genomic_source_digest_check,
    add constraint amr_genomic_source_digest_check
        check (
            source_record_digest is null
            or source_record_digest ~ '^[a-f0-9]{64}$'
        ),
    drop constraint if exists amr_genomic_isolate_hash_check,
    add constraint amr_genomic_isolate_hash_check
        check (
            isolate_ref_hash is null
            or isolate_ref_hash ~ '^[a-f0-9]{64}$'
        ),
    drop constraint if exists amr_genomic_evidence_hash_check,
    add constraint amr_genomic_evidence_hash_check
        check (
            evidence_hash is null
            or evidence_hash ~ '^[a-f0-9]{64}$'
        ),
    drop constraint if exists amr_genomic_pipeline_validation_ref_check,
    add constraint amr_genomic_pipeline_validation_ref_check
        check (
            pipeline_validation_ref is null
            or pipeline_validation_ref
                ~ '^amr_genomic_pipeline:[a-f0-9]{64}$'
        ),
    drop constraint if exists amr_genomic_raw_sequence_prohibited,
    add constraint amr_genomic_raw_sequence_prohibited
        check (raw_sequence_stored is false),
    drop constraint if exists amr_genomic_experimental_clinical_use_prohibited,
    add constraint amr_genomic_experimental_clinical_use_prohibited
        check (
            clinical_use_allowed is false
            or (
                computation_class = 'classical_validated'
                and validation_status = 'externally_validated'
                and quality_status = 'passed'
                and deidentified is true
                and is_synthetic is false
                and amr_ast_ingestion_event_id is not null
                and oauth_client_id is not null
                and external_validation_event_id is not null
                and pipeline_validation_ref is not null
                and cardinality(assayed_drug_classes) > 0
                and cardinality(clinical_blockers) = 0
            )
        );

-- The original index was globally unique and could expose cross-tenant
-- sequence reuse through conflict behavior. Identity is tenant scoped.
drop index if exists public.idx_amr_sequence_hash;

create unique index if not exists idx_amr_genomic_tenant_sequence_pipeline
    on public.amr_genomic_events (
        tenant_id,
        sequence_hash,
        coalesce(pipeline_name, ''),
        coalesce(pipeline_version, '')
    );

create unique index if not exists idx_amr_genomic_tenant_request
    on public.amr_genomic_events (tenant_id, request_id)
    where request_id is not null;

create index if not exists idx_amr_genomic_ast_link
    on public.amr_genomic_events
        (tenant_id, amr_ast_ingestion_event_id, observed_at desc)
    where amr_ast_ingestion_event_id is not null;

create index if not exists idx_amr_genomic_validation
    on public.amr_genomic_events
        (tenant_id, validation_status, quality_status, observed_at desc);

create index if not exists idx_amr_genomic_pipeline_validation
    on public.amr_genomic_events
        (tenant_id, pipeline_validation_ref, observed_at desc)
    where pipeline_validation_ref is not null;

create index if not exists idx_amr_genomic_computation_boundary
    on public.amr_genomic_events
        (tenant_id, computation_class, clinical_use_allowed, observed_at desc);

create or replace function public.validate_amr_genomic_evidence_insert()
returns trigger
language plpgsql
as $$
declare
    ingestion public.amr_ast_ingestion_events%rowtype;
    validation public.external_validation_events%rowtype;
    latest_validation_id uuid;
begin
    if new.amr_ast_ingestion_event_id is not null then
        select source_event.*
        into ingestion
        from public.amr_ast_ingestion_events source_event
        where source_event.id = new.amr_ast_ingestion_event_id
          and source_event.tenant_id = new.tenant_id;

        if ingestion.id is null then
            raise exception 'AMR genomic evidence AST ingestion is not owned by the tenant'
                using errcode = '23514';
        end if;
        if ingestion.ingestion_status <> 'accepted' then
            raise exception 'AMR genomic evidence requires an accepted AST ingestion'
                using errcode = '23514';
        end if;
        if new.isolate_ref_hash is distinct from ingestion.isolate_ref_hash then
            raise exception 'AMR genomic evidence isolate does not match the AST ingestion'
                using errcode = '23514';
        end if;
        if new.lab_site_id is distinct from ingestion.lab_site_id then
            raise exception 'AMR genomic evidence laboratory does not match the AST ingestion'
                using errcode = '23514';
        end if;
        if new.oauth_client_id is null
           or ingestion.oauth_client_id is null
           or new.oauth_client_id is distinct from ingestion.oauth_client_id then
            raise exception 'AMR genomic evidence OAuth client does not own the AST ingestion'
                using errcode = '23514';
        end if;
    end if;

    if new.external_validation_event_id is not null then
        select validation_event.*
        into validation
        from public.external_validation_events validation_event
        where validation_event.id = new.external_validation_event_id
          and validation_event.tenant_id = new.tenant_id
          and validation_event.validation_target_ref
                = new.pipeline_validation_ref;

        select validation_event.id
        into latest_validation_id
        from public.external_validation_events validation_event
        where validation_event.tenant_id = new.tenant_id
          and validation_event.validation_target_ref
                = new.pipeline_validation_ref
        order by validation_event.observed_at desc,
                 validation_event.created_at desc,
                 validation_event.id desc
        limit 1;

        if validation.id is null
           or validation.id is distinct from latest_validation_id
           or validation.validation_target_type not in ('amr_stewardship', 'other')
           or validation.attestor_kind not in (
                'reference_lab',
                'university',
                'public_health',
                'government',
                'research_partner',
                'auditor'
           )
           or validation.validation_scope not in ('amr_signal', 'data_quality')
           or validation.attestation_status <> 'accepted'
           or validation.verification_status not in (
                'signature_verified',
                'reviewer_verified'
           )
           or validation.evidence_grade <> 'externally_verified'
           or validation.validation_score < 0.8 then
            raise exception 'AMR genomic pipeline validation proof is not current and externally verified'
                using errcode = '23514';
        end if;
    elsif new.validation_status = 'externally_validated' then
        raise exception 'Externally validated genomic evidence requires a linked validation event'
            using errcode = '23514';
    end if;

    if new.clinical_use_allowed and (
        new.computation_class <> 'classical_validated'
        or new.validation_status <> 'externally_validated'
        or new.quality_status <> 'passed'
        or new.deidentified is not true
        or new.is_synthetic is true
        or new.amr_ast_ingestion_event_id is null
        or new.oauth_client_id is null
        or new.external_validation_event_id is null
        or new.pipeline_validation_ref is null
        or cardinality(new.assayed_drug_classes) = 0
        or cardinality(new.clinical_blockers) > 0
    ) then
        raise exception 'Clinical genomic evidence requires externally validated classical computation, passed quality, and linked AST'
            using errcode = '23514';
    end if;

    if new.raw_sequence_stored is true then
        raise exception 'Raw genomic sequences are prohibited in the AMR evidence ledger'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

drop trigger if exists validate_amr_genomic_evidence_insert
    on public.amr_genomic_events;
create trigger validate_amr_genomic_evidence_insert
    before insert on public.amr_genomic_events
    for each row execute function public.validate_amr_genomic_evidence_insert();

create table if not exists public.amr_phenotype_genotype_concordance_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null,
    request_id uuid not null,
    ast_ingestion_event_id uuid not null
        references public.amr_ast_ingestion_events(id) on delete restrict,
    ast_result_event_id uuid not null
        references public.amr_ast_result_events(id) on delete restrict,
    genomic_event_id uuid not null
        references public.amr_genomic_events(id) on delete restrict,
    isolate_ref_hash text not null check (isolate_ref_hash ~ '^[a-f0-9]{64}$'),
    antimicrobial_key text not null,
    drug_class text,
    phenotype_status text not null check (phenotype_status in (
        'resistant',
        'non_susceptible',
        'susceptible',
        'intermediate',
        'unknown'
    )),
    genotype_status text not null check (genotype_status in (
        'detected',
        'not_detected',
        'not_assayed',
        'unknown'
    )),
    concordance_status text not null check (concordance_status in (
        'concordant_resistant',
        'concordant_susceptible',
        'phenotype_only_resistance',
        'genotype_only_signal',
        'indeterminate',
        'not_comparable'
    )),
    clinical_actionability text not null check (clinical_actionability in (
        'surveillance_supported',
        'review_required',
        'research_only'
    )),
    phenotype_result_hash text not null
        check (phenotype_result_hash ~ '^[a-f0-9]{64}$'),
    genomic_evidence_hash text not null
        check (genomic_evidence_hash ~ '^[a-f0-9]{64}$'),
    resistance_genes text[] not null default '{}',
    interpretation_standard text,
    interpretation_standard_version text,
    algorithm_version text not null,
    blockers text[] not null default '{}',
    warnings text[] not null default '{}',
    evidence jsonb not null default '{}'::jsonb,
    event_hash text not null check (event_hash ~ '^[a-f0-9]{64}$'),
    actor_id text not null,
    observed_at timestamptz not null,
    created_at timestamptz not null default now()
);

create unique index if not exists idx_amr_concordance_materialization
    on public.amr_phenotype_genotype_concordance_events (
        tenant_id,
        ast_result_event_id,
        genomic_event_id,
        algorithm_version
    );

create index if not exists idx_amr_concordance_review_queue
    on public.amr_phenotype_genotype_concordance_events
        (tenant_id, clinical_actionability, observed_at desc);

create index if not exists idx_amr_concordance_surveillance
    on public.amr_phenotype_genotype_concordance_events
        (tenant_id, drug_class, concordance_status, observed_at desc);

create or replace function public.validate_amr_concordance_provenance()
returns trigger
language plpgsql
as $$
declare
    ingestion public.amr_ast_ingestion_events%rowtype;
    ast_result public.amr_ast_result_events%rowtype;
    genomic public.amr_genomic_events%rowtype;
    latest_validation public.external_validation_events%rowtype;
begin
    select source_event.*
    into ingestion
    from public.amr_ast_ingestion_events source_event
    where source_event.id = new.ast_ingestion_event_id
      and source_event.tenant_id = new.tenant_id;

    select result_event.*
    into ast_result
    from public.amr_ast_result_events result_event
    where result_event.id = new.ast_result_event_id
      and result_event.tenant_id = new.tenant_id
      and result_event.ingestion_event_id = new.ast_ingestion_event_id;

    select genomic_event.*
    into genomic
    from public.amr_genomic_events genomic_event
    where genomic_event.id = new.genomic_event_id
      and genomic_event.tenant_id = new.tenant_id
      and genomic_event.amr_ast_ingestion_event_id = new.ast_ingestion_event_id;

    if ingestion.id is null or ast_result.id is null or genomic.id is null then
        raise exception 'AMR concordance evidence lineage is incomplete or cross-tenant'
            using errcode = '23514';
    end if;
    if ingestion.isolate_ref_hash is distinct from genomic.isolate_ref_hash
       or new.isolate_ref_hash is distinct from genomic.isolate_ref_hash then
        raise exception 'AMR concordance isolate lineage mismatch'
            using errcode = '23514';
    end if;
    if genomic.pipeline_validation_ref is not null then
        select validation_event.*
        into latest_validation
        from public.external_validation_events validation_event
        where validation_event.tenant_id = new.tenant_id
          and validation_event.validation_target_ref
                = genomic.pipeline_validation_ref
        order by validation_event.observed_at desc,
                 validation_event.created_at desc,
                 validation_event.id desc
        limit 1;
    end if;
    if new.clinical_actionability = 'surveillance_supported' and (
        genomic.clinical_use_allowed is not true
        or genomic.external_validation_event_id is null
        or latest_validation.id is distinct from genomic.external_validation_event_id
        or latest_validation.attestation_status <> 'accepted'
        or latest_validation.verification_status not in (
            'signature_verified',
            'reviewer_verified'
        )
        or latest_validation.evidence_grade <> 'externally_verified'
        or cardinality(genomic.clinical_blockers) > 0
        or new.concordance_status not in (
            'concordant_resistant',
            'concordant_susceptible'
        )
        or cardinality(new.blockers) > 0
    ) then
        raise exception 'Surveillance-supported concordance requires validated genomic evidence and no blockers'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_amr_concordance_provenance
    on public.amr_phenotype_genotype_concordance_events;
create trigger validate_amr_concordance_provenance
    before insert on public.amr_phenotype_genotype_concordance_events
    for each row execute function public.validate_amr_concordance_provenance();

create or replace function public.prevent_amr_evidence_fabric_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'AMR evidence fabric ledgers are append-only'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_amr_concordance_events
    on public.amr_phenotype_genotype_concordance_events;
create trigger enforce_immutability_amr_concordance_events
    before update or delete on public.amr_phenotype_genotype_concordance_events
    for each row execute function public.prevent_amr_evidence_fabric_mutation();

alter table public.amr_phenotype_genotype_concordance_events enable row level security;

drop policy if exists amr_concordance_select_tenant
    on public.amr_phenotype_genotype_concordance_events;
create policy amr_concordance_select_tenant
    on public.amr_phenotype_genotype_concordance_events
    for select using (tenant_id = public.current_tenant_id());

drop policy if exists amr_concordance_insert_tenant
    on public.amr_phenotype_genotype_concordance_events;
create policy amr_concordance_insert_tenant
    on public.amr_phenotype_genotype_concordance_events
    for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists service_role_amr_concordance
    on public.amr_phenotype_genotype_concordance_events;
create policy service_role_amr_concordance
    on public.amr_phenotype_genotype_concordance_events
    for all to service_role using (true) with check (true);

drop policy if exists amr_genomic_events_select_tenant
    on public.amr_genomic_events;
create policy amr_genomic_events_select_tenant
    on public.amr_genomic_events
    for select using (tenant_id = public.current_tenant_id());

grant select, insert on public.amr_phenotype_genotype_concordance_events
    to service_role;
revoke update, delete on public.amr_phenotype_genotype_concordance_events
    from anon, authenticated;

comment on table public.amr_genomic_events is
    'Append-only derived AMR genomic evidence. Raw sequences are prohibited; experimental computation is never clinical evidence.';
comment on table public.amr_phenotype_genotype_concordance_events is
    'Append-only isolate-linked phenotype/genotype comparison. Genomic absence is only asserted for explicitly assayed drug classes.';

notify pgrst, 'reload schema';
