create extension if not exists pgcrypto;

alter table public.ai_inference_events
    add column if not exists request_id uuid;

alter table public.clinical_outcome_events
    add column if not exists request_id uuid;

alter table public.edge_simulation_events
    add column if not exists request_id uuid;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'ai_inference_events_request_id_v4_check'
    ) then
        alter table public.ai_inference_events
            add constraint ai_inference_events_request_id_v4_check
            check (
                request_id is null
                or request_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'clinical_outcome_events_request_id_v4_check'
    ) then
        alter table public.clinical_outcome_events
            add constraint clinical_outcome_events_request_id_v4_check
            check (
                request_id is null
                or request_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'edge_simulation_events_request_id_v4_check'
    ) then
        alter table public.edge_simulation_events
            add constraint edge_simulation_events_request_id_v4_check
            check (
                request_id is null
                or request_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            );
    end if;
end $$;

create unique index if not exists idx_ai_inference_events_request_id
    on public.ai_inference_events (request_id)
    where request_id is not null;

create unique index if not exists idx_clinical_outcome_events_request_id
    on public.clinical_outcome_events (request_id)
    where request_id is not null;

create unique index if not exists idx_edge_simulation_events_request_id
    on public.edge_simulation_events (request_id)
    where request_id is not null;

create index if not exists idx_ai_inference_events_tenant_request_id
    on public.ai_inference_events (tenant_id, request_id)
    where request_id is not null;

create index if not exists idx_clinical_outcome_events_tenant_request_id
    on public.clinical_outcome_events (tenant_id, request_id)
    where request_id is not null;

create index if not exists idx_edge_simulation_events_tenant_request_id
    on public.edge_simulation_events (tenant_id, request_id)
    where request_id is not null;

notify pgrst, 'reload schema';
