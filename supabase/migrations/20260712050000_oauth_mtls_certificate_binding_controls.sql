alter table public.oauth_clients
    add column if not exists mtls_required boolean not null default false,
    add column if not exists mtls_cert_thumbprints text[] not null default '{}',
    add column if not exists mtls_last_thumbprint text,
    add column if not exists mtls_last_seen_at timestamptz;

alter table public.oauth_clients
    drop constraint if exists oauth_clients_mtls_thumbprints_check,
    add constraint oauth_clients_mtls_thumbprints_check
        check (
            (mtls_required = false or cardinality(mtls_cert_thumbprints) > 0)
            and (
                cardinality(mtls_cert_thumbprints) = 0
                or array_to_string(mtls_cert_thumbprints, ',') ~ '^([a-f0-9]{64})(,[a-f0-9]{64})*$'
            )
            and (mtls_last_thumbprint is null or mtls_last_thumbprint ~ '^[a-f0-9]{64}$')
        );

create index if not exists idx_oauth_clients_mtls_thumbprints_gin
    on public.oauth_clients using gin (mtls_cert_thumbprints);

create index if not exists idx_oauth_clients_mtls_required
    on public.oauth_clients (tenant_id, mtls_required, status, created_at desc);

comment on column public.oauth_clients.mtls_required is
    'When true, OAuth client authentication requires a matching client certificate SHA-256 fingerprint forwarded by the trusted edge or mTLS proxy.';

comment on column public.oauth_clients.mtls_cert_thumbprints is
    'Allowed lowercase SHA-256 client certificate fingerprints for edge/proxy-terminated mTLS enforcement.';

comment on column public.oauth_clients.mtls_last_seen_at is
    'Last time a matching mTLS client certificate fingerprint was observed during OAuth client authentication.';

notify pgrst, 'reload schema';
