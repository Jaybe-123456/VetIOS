-- Governance lineage for core inference events.
-- Adds the auditable tuple required to trace input schema, prompt template,
-- model version, and CIRE reliability for every stored inference.

drop trigger if exists enforce_immutability_ai_inference_events on public.ai_inference_events;

alter table public.ai_inference_events disable trigger user;

alter table public.ai_inference_events
    add column if not exists prompt_template_hash text,
    add column if not exists prompt_template_version text,
    add column if not exists schema_version text,
    add column if not exists phi_hat double precision;

alter table public.ai_inference_events
    alter column prompt_template_hash set default '1b0401e4cfaf264e4e1c7883a455c5ca22f2dd2cce6877cb66d366e7c0affe7b',
    alter column prompt_template_version set default 'vetios_clinical_diagnostic_v1',
    alter column schema_version set default 'v1',
    alter column phi_hat set default 0;

update public.ai_inference_events
set
    prompt_template_hash = coalesce(
        nullif(prompt_template_hash, ''),
        nullif(output_payload -> 'governance_lineage' ->> 'prompt_template_hash', ''),
        '1b0401e4cfaf264e4e1c7883a455c5ca22f2dd2cce6877cb66d366e7c0affe7b'
    ),
    prompt_template_version = coalesce(
        nullif(prompt_template_version, ''),
        nullif(output_payload -> 'governance_lineage' ->> 'prompt_template_version', ''),
        'vetios_clinical_diagnostic_v1'
    ),
    schema_version = coalesce(
        nullif(schema_version, ''),
        nullif(input_signature -> 'metadata' ->> 'schema_version', ''),
        nullif(output_payload -> 'governance_lineage' ->> 'schema_version', ''),
        case
            when lower(coalesce(input_signature -> 'metadata' ->> 'v2_payload', 'false')) in ('true', 't', '1', 'yes') then 'v2'
            else 'v1'
        end
    ),
    phi_hat = least(1, greatest(0, coalesce(
        phi_hat,
        case
            when nullif(uncertainty_metrics ->> 'phi_hat', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (uncertainty_metrics ->> 'phi_hat')::double precision
            else null
        end,
        case
            when nullif(output_payload -> 'cire' ->> 'phi_hat', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (output_payload -> 'cire' ->> 'phi_hat')::double precision
            else null
        end,
        confidence_score,
        0
    )));

alter table public.ai_inference_events
    alter column prompt_template_hash set not null,
    alter column prompt_template_version set not null,
    alter column schema_version set not null,
    alter column phi_hat set not null;

alter table public.ai_inference_events enable trigger user;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'ai_inference_events_prompt_template_hash_check'
    ) then
        alter table public.ai_inference_events
            add constraint ai_inference_events_prompt_template_hash_check
            check (prompt_template_hash ~ '^[a-f0-9]{64}$');
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'ai_inference_events_schema_version_check'
    ) then
        alter table public.ai_inference_events
            add constraint ai_inference_events_schema_version_check
            check (length(btrim(schema_version)) > 0);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'ai_inference_events_phi_hat_range_check'
    ) then
        alter table public.ai_inference_events
            add constraint ai_inference_events_phi_hat_range_check
            check (phi_hat >= 0 and phi_hat <= 1);
    end if;
end $$;

create index if not exists idx_ai_inference_events_lineage
    on public.ai_inference_events (tenant_id, schema_version, prompt_template_version, model_version, created_at desc);

create or replace function public.prevent_core_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'Core event tables are append-only; attempted % on %.%', tg_op, tg_table_schema, tg_table_name
        using errcode = 'P0001';
end;
$$;

create trigger enforce_immutability_ai_inference_events
    before update or delete on public.ai_inference_events
    for each row execute function public.prevent_core_event_mutation();

notify pgrst, 'reload schema';
