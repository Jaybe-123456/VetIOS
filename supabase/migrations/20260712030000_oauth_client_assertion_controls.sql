alter table public.oauth_clients
    add column if not exists client_auth_methods text[] not null default '{client_secret_basic,client_secret_post}',
    add column if not exists assertion_algorithms text[] not null default '{RS256}',
    add column if not exists assertion_audiences text[] not null default '{}',
    add column if not exists assertion_max_ttl_seconds integer not null default 300;

alter table public.oauth_clients
    drop constraint if exists oauth_clients_auth_methods_check,
    add constraint oauth_clients_auth_methods_check
        check (
            client_auth_methods <@ array[
                'client_secret_basic',
                'client_secret_post',
                'private_key_jwt'
            ]::text[]
            and array_length(client_auth_methods, 1) is not null
        );

alter table public.oauth_clients
    drop constraint if exists oauth_clients_assertion_algorithms_check,
    add constraint oauth_clients_assertion_algorithms_check
        check (
            assertion_algorithms <@ array['RS256']::text[]
            and array_length(assertion_algorithms, 1) is not null
        );

alter table public.oauth_clients
    drop constraint if exists oauth_clients_assertion_ttl_check,
    add constraint oauth_clients_assertion_ttl_check
        check (assertion_max_ttl_seconds between 60 and 600);

create index if not exists idx_oauth_clients_auth_methods_gin
    on public.oauth_clients using gin (client_auth_methods);

create index if not exists idx_oauth_clients_assertion_audiences_gin
    on public.oauth_clients using gin (assertion_audiences);

comment on column public.oauth_clients.client_auth_methods is
    'Allowed OAuth client authentication methods. private_key_jwt requires a registered JWKS and signed JWT client assertion.';

comment on column public.oauth_clients.assertion_algorithms is
    'Accepted client assertion signing algorithms. VetIOS Auth Trust Fabric v1 supports RS256 only.';

comment on column public.oauth_clients.assertion_audiences is
    'Optional allowlist of accepted client assertion audiences. Empty means the live OAuth endpoint origin/path audience is accepted.';

comment on column public.oauth_clients.assertion_max_ttl_seconds is
    'Maximum accepted JWT client assertion lifetime in seconds.';

notify pgrst, 'reload schema';
