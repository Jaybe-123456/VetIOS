-- VetIOS public model-card signed attestation layer.
-- Adds cryptographic verification metadata to existing model_attestations.

create extension if not exists pgcrypto;

alter table public.model_attestations
    add column if not exists signed_payload_hash text,
    add column if not exists signature_algorithm text,
    add column if not exists signature_hash text,
    add column if not exists signing_key_fingerprint text,
    add column if not exists verification_status text not null default 'unsigned',
    add column if not exists verified_at timestamptz,
    add column if not exists verified_by text,
    add column if not exists verification_notes text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'model_attestations_verification_status_check'
    ) then
        alter table public.model_attestations
            add constraint model_attestations_verification_status_check
            check (verification_status in ('unsigned', 'pending', 'verified', 'failed'));
    end if;
end $$;

create index if not exists idx_model_attestations_verified
    on public.model_attestations (tenant_id, registry_id, verification_status, created_at desc);

create index if not exists idx_model_attestations_signature_hash
    on public.model_attestations (signature_hash)
    where signature_hash is not null;

comment on column public.model_attestations.signed_payload_hash is
    'SHA-256 digest of the canonical attestation payload reviewed by the attestor.';

comment on column public.model_attestations.signature_hash is
    'SHA-256 digest of the signature material. Raw signatures are not required for public display.';

comment on column public.model_attestations.signing_key_fingerprint is
    'External signing key fingerprint or certificate fingerprint used to identify the attestor key.';

comment on column public.model_attestations.verification_status is
    'Public model-card signature verification state: unsigned, pending, verified, or failed.';

notify pgrst, 'reload schema';
