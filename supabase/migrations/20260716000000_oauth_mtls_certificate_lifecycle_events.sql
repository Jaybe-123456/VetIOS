alter table public.oauth_client_events
    drop constraint if exists oauth_client_events_lifecycle_check;

alter table public.oauth_client_events
    add constraint oauth_client_events_lifecycle_check
    check (lifecycle_event in (
        'registered',
        'secret_rotated',
        'disabled',
        'revoked',
        'scope_changed',
        'anomaly_detected',
        'certificate_bound',
        'certificate_retired'
    ));

create or replace function public.manage_oauth_client_mtls_certificate(
    p_tenant_id text,
    p_oauth_client_id uuid,
    p_certificate_thumbprint text,
    p_operation text,
    p_actor_user_id uuid default null,
    p_request_id text default null
)
returns public.oauth_clients
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_client public.oauth_clients%rowtype;
    v_thumbprint text;
    v_thumbprints text[];
    v_rotation_overlap boolean;
    v_lifecycle_event text;
    v_risk_level text;
begin
    if p_operation not in ('bind', 'retire') then
        raise exception 'Unsupported OAuth mTLS certificate operation: %', p_operation
            using errcode = '22023';
    end if;

    v_thumbprint := regexp_replace(
        lower(coalesce(p_certificate_thumbprint, '')),
        '[^a-f0-9]',
        '',
        'g'
    );
    if v_thumbprint !~ '^[a-f0-9]{64}$' then
        raise exception 'certificate_thumbprint must be a SHA-256 fingerprint'
            using errcode = '22023';
    end if;

    select *
    into v_client
    from public.oauth_clients
    where tenant_id = p_tenant_id
      and id = p_oauth_client_id
    for update;

    if not found then
        raise exception 'OAuth client was not found'
            using errcode = 'P0002';
    end if;

    if p_operation = 'bind' then
        if v_client.status <> 'active' then
            raise exception 'Certificates can only be bound to an active OAuth client'
                using errcode = '55000';
        end if;

        v_rotation_overlap := cardinality(v_client.mtls_cert_thumbprints) > 0;
        v_thumbprints := coalesce(v_client.mtls_cert_thumbprints, '{}'::text[]);
        if not (v_thumbprint = any(v_thumbprints)) then
            v_thumbprints := array_append(v_thumbprints, v_thumbprint);
        end if;
        v_lifecycle_event := 'certificate_bound';
        v_risk_level := 'high';

        update public.oauth_clients
        set mtls_required = true,
            mtls_cert_thumbprints = v_thumbprints
        where tenant_id = p_tenant_id
          and id = p_oauth_client_id
        returning * into v_client;
    else
        if not (v_thumbprint = any(coalesce(v_client.mtls_cert_thumbprints, '{}'::text[]))) then
            raise exception 'OAuth client certificate thumbprint is not registered'
                using errcode = 'P0002';
        end if;

        select coalesce(array_agg(entry order by ordinal), '{}'::text[])
        into v_thumbprints
        from unnest(v_client.mtls_cert_thumbprints) with ordinality as current_thumbprints(entry, ordinal)
        where entry <> v_thumbprint;

        if v_client.mtls_required and cardinality(v_thumbprints) = 0 then
            raise exception 'Cannot retire the final certificate from an mTLS-required OAuth client'
                using errcode = '55000';
        end if;
        v_rotation_overlap := false;
        v_lifecycle_event := 'certificate_retired';
        v_risk_level := 'critical';

        update public.oauth_clients
        set mtls_cert_thumbprints = v_thumbprints
        where tenant_id = p_tenant_id
          and id = p_oauth_client_id
        returning * into v_client;
    end if;

    insert into public.oauth_client_events (
        tenant_id,
        request_id,
        oauth_client_id,
        client_id,
        actor_user_id,
        lifecycle_event,
        status,
        allowed_scopes,
        token_ttl_seconds,
        risk_level,
        evidence
    ) values (
        p_tenant_id,
        coalesce(nullif(trim(p_request_id), ''), concat(v_lifecycle_event, ':', p_oauth_client_id, ':', extract(epoch from clock_timestamp()))),
        v_client.id,
        v_client.client_id,
        p_actor_user_id,
        v_lifecycle_event,
        v_client.status,
        v_client.allowed_scopes,
        v_client.token_ttl_seconds,
        v_risk_level,
        jsonb_build_object(
            'client_name', v_client.client_name,
            'telemetry_source', 'manage_oauth_client_mtls_certificate',
            'certificate_thumbprint_sha256', v_thumbprint,
            'active_thumbprint_count', cardinality(v_client.mtls_cert_thumbprints),
            'rotation_overlap', v_rotation_overlap
        )
    );

    return v_client;
end;
$$;

revoke all on function public.manage_oauth_client_mtls_certificate(
    text,
    uuid,
    text,
    text,
    uuid,
    text
) from public, anon, authenticated;

grant execute on function public.manage_oauth_client_mtls_certificate(
    text,
    uuid,
    text,
    text,
    uuid,
    text
) to service_role;

comment on function public.manage_oauth_client_mtls_certificate(
    text,
    uuid,
    text,
    text,
    uuid,
    text
) is
    'Service-role-only operation that atomically binds or retires a normalized partner certificate SHA-256 thumbprint and appends the corresponding OAuth client lifecycle event. Route-level admin and step-up authorization must succeed before invocation.';

comment on table public.oauth_client_events is
    'Append-only OAuth client lifecycle ledger for registration, secret rotation, certificate binding and retirement, revocation, scope changes, and anomaly evidence.';

notify pgrst, 'reload schema';
