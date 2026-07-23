drop function if exists public.match_tenant_vet_case_vectors(
    extensions.vector,
    text,
    double precision,
    integer,
    text,
    boolean
);

create function public.match_tenant_vet_case_vectors(
    query_embedding extensions.vector,
    filter_tenant text,
    match_threshold double precision,
    match_count integer,
    filter_species text,
    confirmed_only boolean
)
returns table (
    id uuid,
    inference_event_id text,
    tenant_id text,
    species text,
    breed text,
    age_years numeric,
    symptoms text[],
    diagnosis text,
    confidence_score numeric,
    outcome_confirmed boolean,
    similarity double precision,
    created_at timestamptz
)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
    if nullif(btrim(filter_tenant), '') is null then
        raise exception 'filter_tenant is required';
    end if;

    return query
    select
        v.id,
        v.inference_event_id::text,
        v.tenant_id,
        v.species,
        v.breed,
        v.age_years,
        v.symptoms,
        v.diagnosis,
        v.confidence_score,
        v.outcome_confirmed,
        1 - (v.embedding <=> query_embedding) as similarity,
        v.created_at
    from public.vet_case_vectors v
    where v.tenant_id = filter_tenant
      and 1 - (v.embedding <=> query_embedding) >= match_threshold
      and (filter_species is null or v.species = filter_species)
      and (not confirmed_only or v.outcome_confirmed = true)
    order by v.embedding <=> query_embedding
    limit greatest(1, least(coalesce(match_count, 5), 25));
end;
$$;

revoke all on function public.match_tenant_vet_case_vectors(
    extensions.vector,
    text,
    double precision,
    integer,
    text,
    boolean
) from public, anon, authenticated;

grant execute on function public.match_tenant_vet_case_vectors(
    extensions.vector,
    text,
    double precision,
    integer,
    text,
    boolean
) to service_role;

comment on function public.match_tenant_vet_case_vectors(
    extensions.vector,
    text,
    double precision,
    integer,
    text,
    boolean
) is 'Service-role-only vector retrieval constrained to one authenticated VetIOS tenant.';

alter table public.oauth_access_tokens
    add column if not exists mtls_cert_thumbprint text;

alter table public.oauth_access_tokens
    drop constraint if exists oauth_access_tokens_binding_method_check,
    add constraint oauth_access_tokens_binding_method_check
        check (token_binding_method in ('bearer', 'dpop', 'mtls'));

alter table public.oauth_access_tokens
    drop constraint if exists oauth_access_tokens_dpop_binding_check,
    add constraint oauth_access_tokens_dpop_binding_check
        check (
            token_binding_method <> 'dpop'
            or (
                dpop_jwk_thumbprint ~ '^[A-Za-z0-9_-]{43}$'
                and dpop_public_jwk <> '{}'::jsonb
                and dpop_bound_at is not null
            )
        );

alter table public.oauth_access_tokens
    drop constraint if exists oauth_access_tokens_mtls_binding_check,
    add constraint oauth_access_tokens_mtls_binding_check
        check (
            (
                token_binding_method = 'mtls'
                and mtls_cert_thumbprint ~ '^[a-f0-9]{64}$'
            )
            or (
                token_binding_method <> 'mtls'
                and mtls_cert_thumbprint is null
            )
        );

create index if not exists idx_oauth_access_tokens_mtls_binding
    on public.oauth_access_tokens (
        tenant_id,
        oauth_client_id,
        mtls_cert_thumbprint,
        expires_at desc
    )
    where token_binding_method = 'mtls';

comment on column public.oauth_access_tokens.mtls_cert_thumbprint is
    'Lowercase SHA-256 client certificate fingerprint bound to an RFC 8705-style mTLS access token. The same trusted-proxy certificate proof is required at resource access.';

alter table public.audit_licensees
    add column if not exists active boolean not null default true,
    add column if not exists expires_at timestamptz,
    add column if not exists last_used_at timestamptz;

create index if not exists idx_audit_licensees_active_expiry
    on public.audit_licensees (api_key_hash, active, expires_at);

comment on column public.audit_licensees.access_scope is
    'Optional audit scope with operations (case:read, chain:verify, audit:*) and case_ids. Every license remains tenant-bound even when the scope is empty.';

alter table public.upload_hashes
    add column if not exists tenant_id text;

update public.upload_hashes
set tenant_id = coalesce(tenant_id, 'public')
where tenant_id is null;

alter table public.upload_hashes
    alter column tenant_id set not null;

alter table public.upload_hashes
    drop constraint if exists upload_hashes_content_hash_key,
    drop constraint if exists upload_hashes_tenant_content_hash_key,
    add constraint upload_hashes_tenant_content_hash_key unique (tenant_id, content_hash);

create index if not exists idx_upload_hashes_tenant_created
    on public.upload_hashes (tenant_id, created_at desc);

alter table public.clinical_case_cards
    add column if not exists tenant_id text;

alter table public.lab_reports
    add column if not exists tenant_id text;

alter table public.inference_console_reports
    add column if not exists tenant_id text;

update public.clinical_case_cards
set tenant_id = coalesce(tenant_id, 'public')
where tenant_id is null;

update public.lab_reports
set tenant_id = coalesce(tenant_id, 'public')
where tenant_id is null;

update public.inference_console_reports
set tenant_id = coalesce(tenant_id, 'public')
where tenant_id is null;

alter table public.clinical_case_cards
    alter column tenant_id set not null;

alter table public.lab_reports
    alter column tenant_id set not null;

alter table public.inference_console_reports
    alter column tenant_id set not null;

create index if not exists idx_clinical_case_cards_tenant_session
    on public.clinical_case_cards (tenant_id, session_id, created_at desc);

create index if not exists idx_lab_reports_tenant_session
    on public.lab_reports (tenant_id, session_id, created_at desc);

create index if not exists idx_inference_console_reports_tenant_session
    on public.inference_console_reports (tenant_id, session_id, created_at desc);

comment on column public.lab_reports.tenant_id is
    'Authenticated VetIOS tenant that owns this clinical lab report.';

comment on column public.inference_console_reports.tenant_id is
    'Authenticated VetIOS tenant that owns this inference-console report.';

create or replace view public.rlhf_accuracy_by_tenant_tuple
with (security_invoker = true)
as
select
    tenant_id::text as tenant_id,
    species,
    breed,
    top_ai_diagnosis,
    count(*) as total_signals,
    count(*) filter (where vet_diagnosis = top_ai_diagnosis) as correct_count,
    round(
        count(*) filter (where vet_diagnosis = top_ai_diagnosis)::numeric
        / nullif(count(*), 0) * 100,
        2
    ) as accuracy_pct,
    avg(ai_confidence) as avg_ai_confidence,
    max(created_at) as last_signal_at
from public.vet_override_signals
where status = 'applied'
group by tenant_id, species, breed, top_ai_diagnosis;

revoke all on public.rlhf_accuracy_by_tenant_tuple from public, anon, authenticated;
grant select on public.rlhf_accuracy_by_tenant_tuple to service_role;

comment on view public.rlhf_accuracy_by_tenant_tuple is
    'Tenant-preserving RLHF accuracy aggregate. The legacy global materialized view must not be used by tenant APIs.';

create index if not exists idx_amr_genomic_events_tenant_created
    on public.amr_genomic_events (tenant_id, created_at desc);

create index if not exists idx_rna_folding_events_tenant_created
    on public.rna_folding_events (tenant_id, created_at desc);

notify pgrst, 'reload schema';
