-- =============================================================================
-- Migration 025: Experiment Reliability Governance Consistency
-- Compatibility version for projects without public.tenants
-- =============================================================================

create extension if not exists pgcrypto;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'current_tenant_id'
    ) then
        execute $fn$
            create function public.current_tenant_id()
            returns uuid
            language sql
            stable
            as $inner$
                select coalesce(
                    nullif(current_setting('app.tenant_id', true), '')::uuid,
                    auth.uid()
                )
            $inner$;
        $fn$;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'trigger_set_updated_at'
    ) then
        execute $fn$
            create function public.trigger_set_updated_at()
            returns trigger
            language plpgsql
            as $inner$
            begin
                new.updated_at = now();
                return new;
            end;
            $inner$;
        $fn$;
    end if;
end $$;

alter table public.experiment_runs
    drop constraint if exists experiment_runs_status_check;

alter table public.experiment_runs
    add constraint experiment_runs_status_check check (status in (
        'queued',
        'initializing',
        'training',
        'validating',
        'checkpointing',
        'stalled',
        'interrupted',
        'completed',
        'failed',
        'aborted',
        'promoted',
        'rolled_back'
    ));

alter table public.calibration_metrics
    add column if not exists confidence_histogram jsonb not null default '[]'::jsonb;

alter table public.adversarial_metrics
    add column if not exists dangerous_false_reassurance_rate double precision;

update public.adversarial_metrics
set dangerous_false_reassurance_rate = coalesce(
    dangerous_false_reassurance_rate,
    false_reassurance_rate
)
where dangerous_false_reassurance_rate is null;

update public.calibration_metrics
set confidence_histogram = coalesce(
    (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'confidence', nullif(entry ->> 'confidence', '')::double precision,
                    'count', coalesce(nullif(entry ->> 'count', '')::integer, 0)
                )
            ),
            '[]'::jsonb
        )
        from jsonb_array_elements(
            case
                when jsonb_typeof(reliability_bins) = 'array' then reliability_bins
                else '[]'::jsonb
            end
        ) entry
    ),
    '[]'::jsonb
)
where confidence_histogram = '[]'::jsonb;

notify pgrst, 'reload schema';
