-- Outcome Value Metrics schema compatibility.
--
-- Some long-lived installations predate the explicit outcome-learning and
-- simulation-provenance columns. Keep the public aggregate migration
-- self-contained without rewriting historical outcome rows.

alter table public.ai_inference_events
    add column if not exists simulation_id uuid,
    add column if not exists is_synthetic boolean not null default false;

alter table public.clinical_outcome_events
    add column if not exists source_module text,
    add column if not exists label_type text not null default 'synthetic',
    add column if not exists actual_label text,
    add column if not exists actual_confidence double precision,
    add column if not exists calibration_delta double precision,
    add column if not exists "timestamp" timestamptz,
    add column if not exists simulation_id uuid,
    add column if not exists is_synthetic boolean not null default false;

comment on column public.clinical_outcome_events.label_type is
    'Outcome authority class. Legacy rows default to synthetic and require explicit review before evidence-grade use.';

notify pgrst, 'reload schema';
