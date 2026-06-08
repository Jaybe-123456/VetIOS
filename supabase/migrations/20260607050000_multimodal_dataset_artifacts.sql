-- VetIOS multimodal dataset artifact ledger.
-- Converts confirmed clinical cases into de-identified, outcome-labeled evidence rows.
-- Raw patient names, owner identifiers, contacts, microchip IDs, and raw voice transcripts are not stored here.

create extension if not exists pgcrypto;

create table if not exists public.clinical_multimodal_artifacts (
    id                     uuid primary key default gen_random_uuid(),
    tenant_id              uuid not null,
    case_id                uuid not null,
    inference_event_id     uuid,
    outcome_event_id       uuid,

    artifact_key           text not null unique,
    artifact_type          text not null
        check (artifact_type in (
            'lab_panel',
            'vitals',
            'physical_exam',
            'imaging_reference',
            'voice_transcript',
            'document_reference'
        )),
    source_ref             text not null,

    source_payload         jsonb not null default '{}'::jsonb,
    extracted_facts        jsonb not null default '{}'::jsonb,
    source_citations       jsonb not null default '[]'::jsonb,

    confirmed_diagnosis    text,
    label_status           text not null default 'unlabeled'
        check (label_status in ('unlabeled', 'labeled', 'suppressed')),
    label_type             text,
    label_source           text not null default 'case_outcome'
        check (label_source in ('case_outcome', 'case_intake', 'manual_review')),
    labeled_at             timestamptz,

    evidence_quality_score double precision not null default 0
        check (evidence_quality_score >= 0 and evidence_quality_score <= 1),
    deidentified           boolean not null default true,
    privacy_status         text not null default 'deidentified'
        check (privacy_status in ('deidentified', 'suppressed_phi_risk')),

    created_at             timestamptz not null default now(),

    constraint clinical_multimodal_artifacts_privacy_check
        check (deidentified = true and privacy_status = 'deidentified')
);

create or replace function public.prevent_clinical_multimodal_artifact_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'clinical_multimodal_artifacts is append-only; UPDATE and DELETE are not allowed'
        using errcode = '55000';
end;
$$;

drop trigger if exists enforce_immutability_clinical_multimodal_artifacts
    on public.clinical_multimodal_artifacts;

create trigger enforce_immutability_clinical_multimodal_artifacts
    before update or delete on public.clinical_multimodal_artifacts
    for each row execute function public.prevent_clinical_multimodal_artifact_mutation();

create index if not exists idx_clinical_multimodal_artifacts_case
    on public.clinical_multimodal_artifacts (tenant_id, case_id, created_at desc);

create index if not exists idx_clinical_multimodal_artifacts_inference
    on public.clinical_multimodal_artifacts (tenant_id, inference_event_id)
    where inference_event_id is not null;

create index if not exists idx_clinical_multimodal_artifacts_outcome
    on public.clinical_multimodal_artifacts (tenant_id, outcome_event_id)
    where outcome_event_id is not null;

create index if not exists idx_clinical_multimodal_artifacts_label
    on public.clinical_multimodal_artifacts (tenant_id, label_status, artifact_type, created_at desc);

create index if not exists idx_clinical_multimodal_artifacts_quality
    on public.clinical_multimodal_artifacts (evidence_quality_score desc, created_at desc);

alter table public.clinical_multimodal_artifacts enable row level security;

drop policy if exists clinical_multimodal_artifacts_select_own
    on public.clinical_multimodal_artifacts;

create policy clinical_multimodal_artifacts_select_own
    on public.clinical_multimodal_artifacts
    for select
    using (tenant_id = auth.uid() or auth.role() = 'service_role');

drop policy if exists clinical_multimodal_artifacts_insert_own
    on public.clinical_multimodal_artifacts;

create policy clinical_multimodal_artifacts_insert_own
    on public.clinical_multimodal_artifacts
    for insert
    with check (tenant_id = auth.uid() or auth.role() = 'service_role');

grant select, insert on public.clinical_multimodal_artifacts to authenticated, service_role;

notify pgrst, 'reload schema';
