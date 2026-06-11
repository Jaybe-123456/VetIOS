-- VetIOS tenant learning consent actor FK repair.
-- The V1 app stores auth.users.id in granted_by/revoked_by for lineage, but
-- some production projects do not mirror auth users into public.users. Keep the
-- actor UUIDs and remove brittle public.users FK constraints.

alter table if exists public.tenant_learning_consents
    drop constraint if exists tenant_learning_consents_granted_by_fkey;

alter table if exists public.tenant_learning_consents
    drop constraint if exists tenant_learning_consents_revoked_by_fkey;

create index if not exists idx_tenant_learning_consents_granted_by
    on public.tenant_learning_consents (granted_by)
    where granted_by is not null;

create index if not exists idx_tenant_learning_consents_revoked_by
    on public.tenant_learning_consents (revoked_by)
    where revoked_by is not null;

notify pgrst, 'reload schema';
