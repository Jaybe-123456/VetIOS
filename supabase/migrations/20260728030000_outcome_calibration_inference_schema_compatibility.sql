-- Outcome Calibration inference schema compatibility.
--
-- Long-lived installations may store the differential distribution only in
-- output_payload. Add the optional materialized column expected by newer
-- inference writers without rewriting immutable historical events.

alter table public.ai_inference_events
    add column if not exists differentials jsonb not null default '[]'::jsonb;

comment on column public.ai_inference_events.differentials is
    'Optional materialized differential distribution. Outcome calibration falls back to output_payload when this array is empty or unavailable.';

notify pgrst, 'reload schema';
