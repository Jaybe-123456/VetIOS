create extension if not exists pgcrypto;

create table if not exists public.cire_conformance_certification_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    request_id uuid not null,
    external_validation_event_id uuid references public.external_validation_events(id) on delete set null,
    standard_version text not null default '1.0.0',
    implementation_name text not null,
    implementation_version text,
    implementation_url text,
    package_name text,
    repository_url text,
    artifact_url text,
    certification_status text not null default 'submitted',
    verification_status text not null default 'self_attested',
    conformance_result text not null default 'failed',
    total_checks integer not null default 0,
    passed_checks integer not null default 0,
    failed_checks integer not null default 0,
    conformance_score numeric(5, 4) not null default 0,
    public_listing_eligible boolean not null default false,
    public_listing_label text,
    signed_payload_hash text not null,
    signature_algorithm text,
    signature_hash text,
    signing_key_fingerprint text,
    report jsonb not null default '{}'::jsonb,
    validation jsonb not null default '{}'::jsonb,
    limitations text,
    observed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint cire_conformance_certification_tenant_request_key
        unique (tenant_id, request_id),
    constraint cire_conformance_certification_status_check
        check (certification_status in ('submitted', 'passed', 'failed', 'revoked', 'expired')),
    constraint cire_conformance_certification_verification_check
        check (verification_status in (
            'self_attested',
            'reviewer_verified',
            'signature_verified',
            'third_party_verified'
        )),
    constraint cire_conformance_certification_result_check
        check (conformance_result in ('passed', 'failed')),
    constraint cire_conformance_certification_counts_check
        check (
            total_checks >= 0
            and passed_checks >= 0
            and failed_checks >= 0
            and passed_checks + failed_checks = total_checks
        ),
    constraint cire_conformance_certification_score_check
        check (conformance_score >= 0 and conformance_score <= 1),
    constraint cire_conformance_certification_signed_hash_check
        check (signed_payload_hash ~ '^[a-f0-9]{64}$'),
    constraint cire_conformance_certification_signature_hash_check
        check (signature_hash is null or signature_hash ~ '^[a-f0-9]{64}$'),
    constraint cire_conformance_certification_public_label_check
        check (
            public_listing_eligible = false
            or (public_listing_label is not null and length(trim(public_listing_label)) >= 3)
        )
);

create index if not exists idx_cire_conformance_certification_tenant_created
    on public.cire_conformance_certification_events (tenant_id, created_at desc);

create index if not exists idx_cire_conformance_certification_public
    on public.cire_conformance_certification_events
        (standard_version, certification_status, verification_status, observed_at desc)
    where public_listing_eligible = true;

create index if not exists idx_cire_conformance_certification_implementation
    on public.cire_conformance_certification_events
        (implementation_name, implementation_version, observed_at desc);

create index if not exists idx_cire_conformance_certification_report_gin
    on public.cire_conformance_certification_events using gin (report);

create index if not exists idx_cire_conformance_certification_validation_gin
    on public.cire_conformance_certification_events using gin (validation);

create or replace function public.prevent_cire_conformance_certification_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'cire_conformance_certification_events is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_cire_conformance_certification_events
    on public.cire_conformance_certification_events;
create trigger enforce_immutability_cire_conformance_certification_events
    before update or delete on public.cire_conformance_certification_events
    for each row execute function public.prevent_cire_conformance_certification_event_mutation();

alter table public.cire_conformance_certification_events enable row level security;

drop policy if exists cire_conformance_certification_select_tenant
    on public.cire_conformance_certification_events;
create policy cire_conformance_certification_select_tenant
    on public.cire_conformance_certification_events
    for select using (tenant_id = auth.uid()::text);

drop policy if exists cire_conformance_certification_insert_tenant
    on public.cire_conformance_certification_events;
create policy cire_conformance_certification_insert_tenant
    on public.cire_conformance_certification_events
    for insert with check (tenant_id = auth.uid()::text);

drop policy if exists "service_role_cire_conformance_certification_events"
    on public.cire_conformance_certification_events;
create policy "service_role_cire_conformance_certification_events"
    on public.cire_conformance_certification_events for all to service_role using (true) with check (true);

comment on table public.cire_conformance_certification_events is
    'Append-only CIRE open-standard certification registry. Stores conformance reports, validation summaries, public-safe implementation labels, hashes, and verification status only.';

comment on column public.cire_conformance_certification_events.report is
    'Machine-readable CIRE conformance report submitted by an implementation. Do not store raw clinical records, prompts, owner data, or secrets here.';

comment on column public.cire_conformance_certification_events.validation is
    'Reference-validator output for the submitted report, including pass/fail checks and compatibility summary.';

comment on column public.cire_conformance_certification_events.public_listing_eligible is
    'True only when the submitter has explicitly allowed a public listing and the certification can be safely shown without tenant or private partner details.';

notify pgrst, 'reload schema';
