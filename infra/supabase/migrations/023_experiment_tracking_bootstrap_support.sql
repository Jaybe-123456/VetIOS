-- =============================================================================
-- Migration 023: Experiment Tracking Bootstrap Support
--
-- Allows experiment runs to store human-readable creator labels such as emails
-- in created_by while remaining compatible with prior UUID values.
-- =============================================================================

do $$
declare
    column_type text;
begin
    select data_type
      into column_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'experiment_runs'
       and column_name = 'created_by';

    if column_type = 'uuid' then
        execute 'alter table public.experiment_runs alter column created_by type text using created_by::text';
    end if;
end $$;

notify pgrst, 'reload schema';
