-- Migration: Structured panel ingest columns for V2 encounter payload.
-- Adds structured_input_text and active_systems to ai_inference_events
-- for multisystemic panel-based inference audit and filtering.

ALTER TABLE public.ai_inference_events
    ADD COLUMN IF NOT EXISTS structured_input_text TEXT,
    ADD COLUMN IF NOT EXISTS active_systems TEXT[],
    ADD COLUMN IF NOT EXISTS species TEXT;

-- Index on species for Clinical Dataset and Outcome Learning views.
CREATE INDEX IF NOT EXISTS idx_inference_events_species
    ON public.ai_inference_events (species);

-- GIN index on active_systems for array containment queries
-- e.g. WHERE active_systems @> ARRAY['haematology','endocrine']
CREATE INDEX IF NOT EXISTS idx_inference_events_active_systems
    ON public.ai_inference_events USING GIN (active_systems);

-- Composite index for species + active_systems filtered queries.
CREATE INDEX IF NOT EXISTS idx_inference_events_species_systems
    ON public.ai_inference_events (species)
    WHERE active_systems IS NOT NULL;

NOTIFY pgrst, 'reload schema';
