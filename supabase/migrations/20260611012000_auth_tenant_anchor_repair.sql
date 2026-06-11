-- VetIOS auth tenant anchor repair.
-- V1 tenant model uses auth.users.id as tenant_id, so every auth user must
-- have a matching public.tenants row before FK-backed clinical tables can
-- accept writes.

create extension if not exists pgcrypto;

create or replace function public.ensure_tenant_anchor_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    insert into public.tenants (id, name, settings)
    values (
        new.id,
        'VetIOS clinical workspace ' || left(new.id::text, 8),
        jsonb_build_object(
            'source', 'auth_user_insert_trigger',
            'tenant_model', 'v1_auth_user_id',
            'created_for_fk_integrity', true
        )
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

insert into public.tenants (id, name, settings)
select
    users.id,
    'VetIOS clinical workspace ' || left(users.id::text, 8),
    jsonb_build_object(
        'source', 'auth_user_backfill',
        'tenant_model', 'v1_auth_user_id',
        'created_for_fk_integrity', true
    )
from auth.users
where not exists (
    select 1
    from public.tenants
    where tenants.id = users.id
);

drop trigger if exists ensure_tenant_anchor_on_auth_user_insert on auth.users;
create trigger ensure_tenant_anchor_on_auth_user_insert
    after insert on auth.users
    for each row execute function public.ensure_tenant_anchor_for_auth_user();

notify pgrst, 'reload schema';
