alter table public.api_credentials
    add column if not exists deployment_environment text,
    add column if not exists allowed_origins text[] not null default '{}',
    add column if not exists allowed_ip_cidrs text[] not null default '{}',
    add column if not exists rotation_due_at timestamptz,
    add column if not exists risk_score integer not null default 0,
    add column if not exists last_risk_event_at timestamptz;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'api_credentials_deployment_environment_check'
    ) then
        alter table public.api_credentials
            add constraint api_credentials_deployment_environment_check
            check (
                deployment_environment is null
                or deployment_environment in ('sandbox', 'staging', 'production')
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'api_credentials_risk_score_check'
    ) then
        alter table public.api_credentials
            add constraint api_credentials_risk_score_check
            check (risk_score >= 0 and risk_score <= 100);
    end if;
end $$;

update public.api_credentials
set
    deployment_environment = case
        when metadata ->> 'deployment_environment' in ('sandbox', 'staging', 'production')
            then metadata ->> 'deployment_environment'
        when metadata ->> 'environment' in ('sandbox', 'staging', 'production')
            then metadata ->> 'environment'
        else deployment_environment
    end,
    allowed_origins = case
        when jsonb_typeof(metadata -> 'allowed_origins') = 'array'
            then array(select jsonb_array_elements_text(metadata -> 'allowed_origins'))
        else allowed_origins
    end,
    allowed_ip_cidrs = case
        when jsonb_typeof(metadata -> 'allowed_ip_cidrs') = 'array'
            then array(select jsonb_array_elements_text(metadata -> 'allowed_ip_cidrs'))
        when jsonb_typeof(metadata -> 'allowed_ips') = 'array'
            then array(select jsonb_array_elements_text(metadata -> 'allowed_ips'))
        else allowed_ip_cidrs
    end,
    rotation_due_at = case
        when nullif(metadata ->> 'rotation_due_at', '') is not null
            then (metadata ->> 'rotation_due_at')::timestamptz
        else rotation_due_at
    end
where metadata is not null;

create index if not exists idx_api_credentials_environment_status
    on public.api_credentials (tenant_id, deployment_environment, status, created_at desc);

create index if not exists idx_api_credentials_rotation_due
    on public.api_credentials (tenant_id, rotation_due_at)
    where rotation_due_at is not null and status = 'active';

create index if not exists idx_api_credentials_risk_score
    on public.api_credentials (tenant_id, risk_score desc, last_risk_event_at desc)
    where risk_score > 0;

create index if not exists idx_api_credentials_allowed_origins_gin
    on public.api_credentials using gin (allowed_origins);

create index if not exists idx_api_credentials_allowed_ip_cidrs_gin
    on public.api_credentials using gin (allowed_ip_cidrs);

comment on column public.api_credentials.deployment_environment is
    'Optional environment binding. When set, the credential is only valid in the matching VetIOS deployment environment.';

comment on column public.api_credentials.allowed_origins is
    'Optional origin allowlist for machine API credential use. Empty means no origin restriction.';

comment on column public.api_credentials.allowed_ip_cidrs is
    'Optional IP/CIDR allowlist for machine API credential use. Empty means no IP restriction.';

comment on column public.api_credentials.rotation_due_at is
    'Optional credential rotation deadline. Overdue credentials are blocked and logged to api_credential_lifecycle_events.';

comment on column public.api_credentials.risk_score is
    'Latest computed credential risk score from use-policy checks, 0-100.';

notify pgrst, 'reload schema';
