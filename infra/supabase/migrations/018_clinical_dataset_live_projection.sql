-- =============================================================================
-- Migration 018: Clinical Dataset Live Projection
--
-- Expands canonical case linkage so inference, outcome, and simulation events
-- all resolve to a tenant-visible clinical case row. Also creates the unified
-- live dataset view consumed by the Clinical Dataset Manager.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_species_label(raw_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN raw_value IS NULL OR btrim(raw_value) = '' THEN NULL
        WHEN lower(regexp_replace(raw_value, '\s+', ' ', 'g')) IN ('dog', 'canine', 'puppy', 'canis lupus', 'canis lupus familiaris')
            THEN 'Canis lupus familiaris'
        WHEN lower(regexp_replace(raw_value, '\s+', ' ', 'g')) IN ('cat', 'feline', 'kitten', 'felis catus')
            THEN 'Felis catus'
        WHEN lower(regexp_replace(raw_value, '\s+', ' ', 'g')) IN ('horse', 'equine', 'equus ferus caballus')
            THEN 'Equus ferus caballus'
        WHEN lower(regexp_replace(raw_value, '\s+', ' ', 'g')) IN ('cow', 'bovine', 'bos taurus')
            THEN 'Bos taurus'
        ELSE initcap(split_part(regexp_replace(raw_value, '\s+', ' ', 'g'), ' ', 1)) ||
            CASE
                WHEN strpos(regexp_replace(raw_value, '\s+', ' ', 'g'), ' ') > 0
                    THEN ' ' || lower(substring(regexp_replace(raw_value, '\s+', ' ', 'g') from strpos(regexp_replace(raw_value, '\s+', ' ', 'g'), ' ') + 1))
                ELSE ''
            END
    END;
$$;

ALTER TABLE public.clinical_cases
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS source_module text,
    ADD COLUMN IF NOT EXISTS species_canonical text,
    ADD COLUMN IF NOT EXISTS species_display text,
    ADD COLUMN IF NOT EXISTS symptoms_raw text,
    ADD COLUMN IF NOT EXISTS symptoms_normalized text[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS patient_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS latest_outcome_event_id uuid,
    ADD COLUMN IF NOT EXISTS latest_simulation_event_id uuid;

ALTER TABLE public.ai_inference_events
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS source_module text;

ALTER TABLE public.clinical_outcome_events
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS source_module text;

ALTER TABLE public.edge_simulation_events
    ADD COLUMN IF NOT EXISTS tenant_id uuid,
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS clinic_id uuid,
    ADD COLUMN IF NOT EXISTS case_id uuid,
    ADD COLUMN IF NOT EXISTS source_module text;

UPDATE public.clinical_cases
SET
    user_id = COALESCE(user_id, tenant_id),
    species_canonical = COALESCE(species_canonical, public.normalize_species_label(species), public.normalize_species_label(species_raw)),
    species_display = COALESCE(species_display, species_raw, species, public.normalize_species_label(species)),
    symptoms_raw = COALESCE(symptoms_raw, symptom_summary, NULLIF(array_to_string(symptom_vector, ', '), '')),
    symptoms_normalized = CASE
        WHEN coalesce(array_length(symptoms_normalized, 1), 0) > 0 THEN symptoms_normalized
        ELSE COALESCE(symptom_vector, '{}'::text[])
    END,
    patient_metadata = CASE
        WHEN patient_metadata = '{}'::jsonb THEN COALESCE(metadata, '{}'::jsonb)
        ELSE patient_metadata
    END,
    metadata = COALESCE(patient_metadata, metadata, '{}'::jsonb),
    latest_input_signature = COALESCE(latest_input_signature, '{}'::jsonb),
    source_module = COALESCE(source_module, 'dataset_backfill');

UPDATE public.ai_inference_events
SET
    user_id = COALESCE(user_id, tenant_id),
    source_module = COALESCE(source_module, 'inference_console');

UPDATE public.clinical_outcome_events
SET
    user_id = COALESCE(user_id, tenant_id),
    source_module = COALESCE(source_module, 'outcome_learning');

UPDATE public.edge_simulation_events ese
SET
    tenant_id = COALESCE(ese.tenant_id, aie.tenant_id),
    user_id = COALESCE(ese.user_id, aie.user_id, aie.tenant_id),
    clinic_id = COALESCE(ese.clinic_id, aie.clinic_id),
    case_id = COALESCE(ese.case_id, aie.case_id),
    source_module = COALESCE(ese.source_module, 'adversarial_simulation')
FROM public.ai_inference_events aie
WHERE ese.triggered_inference_id = aie.id;

WITH orphan_inference_events AS (
    SELECT
        aie.id AS inference_id,
        aie.tenant_id,
        aie.user_id,
        aie.clinic_id,
        aie.case_id AS existing_case_id,
        aie.input_signature,
        aie.created_at,
        NULLIF(BTRIM(aie.input_signature ->> 'species'), '') AS species_raw,
        NULLIF(BTRIM(aie.input_signature ->> 'breed'), '') AS breed_raw,
        COALESCE(aie.input_signature -> 'metadata', '{}'::jsonb) AS metadata_json,
        COALESCE(
            (
                SELECT array_agg(LOWER(BTRIM(symptom_value)))
                FROM jsonb_array_elements_text(COALESCE(aie.input_signature -> 'symptoms', '[]'::jsonb)) AS symptom_value
                WHERE BTRIM(symptom_value) <> ''
            ),
            '{}'::text[]
        ) AS symptoms_normalized,
        NULLIF(array_to_string(
            COALESCE(
                (
                    SELECT array_agg(LOWER(BTRIM(symptom_value)))
                    FROM jsonb_array_elements_text(COALESCE(aie.input_signature -> 'symptoms', '[]'::jsonb)) AS symptom_value
                    WHERE BTRIM(symptom_value) <> ''
                ),
                '{}'::text[]
            ),
            ', '
        ), '') AS symptoms_raw
    FROM public.ai_inference_events aie
    LEFT JOIN public.clinical_cases cc
        ON cc.id = aie.case_id
    WHERE aie.case_id IS NULL OR cc.id IS NULL
),
normalized_orphans AS (
    SELECT
        inference_id,
        tenant_id,
        COALESCE(user_id, tenant_id) AS user_id,
        clinic_id,
        existing_case_id AS preferred_case_id,
        public.normalize_species_label(species_raw) AS species_canonical,
        COALESCE(species_raw, public.normalize_species_label(species_raw)) AS species_display,
        species_raw,
        breed_raw AS breed,
        symptoms_raw,
        symptoms_normalized,
        NULLIF(array_to_string(symptoms_normalized[1:8], ', '), '') AS symptom_summary,
        metadata_json AS patient_metadata,
        input_signature AS latest_input_signature,
        CASE
            WHEN existing_case_id IS NOT NULL THEN 'case:' || existing_case_id::text
            ELSE 'fingerprint:' || encode(
                digest(
                    CONCAT_WS(
                        '|',
                        COALESCE(clinic_id::text, ''),
                        COALESCE(public.normalize_species_label(species_raw), ''),
                        LOWER(COALESCE(breed_raw, '')),
                        COALESCE(
                            (
                                SELECT string_agg(symptom_item, ',' ORDER BY symptom_item)
                                FROM unnest(symptoms_normalized) AS symptom_item
                            ),
                            ''
                        ),
                        COALESCE(regexp_replace(COALESCE(metadata_json ->> 'raw_note', ''), '\s+', ' ', 'g'), '')
                    ),
                    'sha256'
                ),
                'hex'
            )
        END AS case_key,
        created_at
    FROM orphan_inference_events
),
ranked_orphans AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY tenant_id, case_key ORDER BY created_at DESC, inference_id DESC) AS recency_rank,
        COUNT(*) OVER (PARTITION BY tenant_id, case_key) AS grouped_event_count,
        MIN(created_at) OVER (PARTITION BY tenant_id, case_key) AS first_inference_at,
        MAX(created_at) OVER (PARTITION BY tenant_id, case_key) AS last_inference_at
    FROM normalized_orphans
)
INSERT INTO public.clinical_cases (
    id,
    tenant_id,
    user_id,
    clinic_id,
    source_module,
    case_key,
    source_case_reference,
    species,
    species_canonical,
    species_display,
    species_raw,
    breed,
    symptoms_raw,
    symptoms_normalized,
    symptom_vector,
    symptom_summary,
    patient_metadata,
    metadata,
    latest_input_signature,
    latest_inference_event_id,
    inference_event_count,
    first_inference_at,
    last_inference_at
)
SELECT
    COALESCE(preferred_case_id, gen_random_uuid()),
    tenant_id,
    user_id,
    clinic_id,
    'dataset_backfill',
    case_key,
    NULL,
    species_canonical,
    species_canonical,
    species_display,
    species_raw,
    breed,
    symptoms_raw,
    symptoms_normalized,
    symptoms_normalized,
    symptom_summary,
    patient_metadata,
    patient_metadata,
    latest_input_signature,
    NULL,
    grouped_event_count,
    first_inference_at,
    last_inference_at
FROM ranked_orphans
WHERE recency_rank = 1
ON CONFLICT (tenant_id, case_key) DO UPDATE
SET
    user_id = COALESCE(EXCLUDED.user_id, public.clinical_cases.user_id),
    clinic_id = COALESCE(EXCLUDED.clinic_id, public.clinical_cases.clinic_id),
    source_module = COALESCE(public.clinical_cases.source_module, EXCLUDED.source_module),
    species = COALESCE(EXCLUDED.species, public.clinical_cases.species),
    species_canonical = COALESCE(EXCLUDED.species_canonical, public.clinical_cases.species_canonical),
    species_display = COALESCE(EXCLUDED.species_display, public.clinical_cases.species_display),
    species_raw = COALESCE(EXCLUDED.species_raw, public.clinical_cases.species_raw),
    breed = COALESCE(EXCLUDED.breed, public.clinical_cases.breed),
    symptoms_raw = COALESCE(EXCLUDED.symptoms_raw, public.clinical_cases.symptoms_raw),
    symptoms_normalized = CASE
        WHEN COALESCE(array_length(EXCLUDED.symptoms_normalized, 1), 0) > 0
            THEN EXCLUDED.symptoms_normalized
        ELSE public.clinical_cases.symptoms_normalized
    END,
    symptom_vector = CASE
        WHEN COALESCE(array_length(EXCLUDED.symptom_vector, 1), 0) > 0
            THEN EXCLUDED.symptom_vector
        ELSE public.clinical_cases.symptom_vector
    END,
    symptom_summary = COALESCE(EXCLUDED.symptom_summary, public.clinical_cases.symptom_summary),
    patient_metadata = public.clinical_cases.patient_metadata || EXCLUDED.patient_metadata,
    metadata = public.clinical_cases.metadata || EXCLUDED.metadata,
    latest_input_signature = EXCLUDED.latest_input_signature,
    inference_event_count = GREATEST(public.clinical_cases.inference_event_count, EXCLUDED.inference_event_count),
    first_inference_at = LEAST(public.clinical_cases.first_inference_at, EXCLUDED.first_inference_at),
    last_inference_at = GREATEST(public.clinical_cases.last_inference_at, EXCLUDED.last_inference_at);

WITH normalized_orphans AS (
    SELECT
        aie.id AS inference_id,
        aie.tenant_id,
        CASE
            WHEN aie.case_id IS NOT NULL THEN 'case:' || aie.case_id::text
            ELSE 'fingerprint:' || encode(
                digest(
                    CONCAT_WS(
                        '|',
                        COALESCE(aie.clinic_id::text, ''),
                        COALESCE(public.normalize_species_label(NULLIF(BTRIM(aie.input_signature ->> 'species'), '')), ''),
                        LOWER(COALESCE(NULLIF(BTRIM(aie.input_signature ->> 'breed'), ''), '')),
                        COALESCE(
                            (
                                SELECT string_agg(LOWER(BTRIM(symptom_value)), ',' ORDER BY LOWER(BTRIM(symptom_value)))
                                FROM jsonb_array_elements_text(COALESCE(aie.input_signature -> 'symptoms', '[]'::jsonb)) AS symptom_value
                                WHERE BTRIM(symptom_value) <> ''
                            ),
                            ''
                        ),
                        COALESCE(regexp_replace(COALESCE(aie.input_signature -> 'metadata' ->> 'raw_note', ''), '\s+', ' ', 'g'), '')
                    ),
                    'sha256'
                ),
                'hex'
            )
        END AS case_key
    FROM public.ai_inference_events aie
)
UPDATE public.ai_inference_events aie
SET case_id = cc.id
FROM normalized_orphans no
JOIN public.clinical_cases cc
    ON cc.tenant_id = no.tenant_id
   AND cc.case_key = no.case_key
WHERE aie.id = no.inference_id
  AND aie.case_id IS DISTINCT FROM cc.id;

UPDATE public.clinical_outcome_events coe
SET
    case_id = aie.case_id,
    user_id = COALESCE(coe.user_id, aie.user_id, aie.tenant_id),
    clinic_id = COALESCE(coe.clinic_id, aie.clinic_id),
    source_module = COALESCE(coe.source_module, 'outcome_learning')
FROM public.ai_inference_events aie
WHERE coe.inference_event_id = aie.id
  AND aie.case_id IS NOT NULL
  AND (
      coe.case_id IS DISTINCT FROM aie.case_id OR
      coe.user_id IS NULL OR
      coe.clinic_id IS NULL OR
      coe.source_module IS NULL
  );

UPDATE public.edge_simulation_events ese
SET
    tenant_id = COALESCE(ese.tenant_id, aie.tenant_id),
    user_id = COALESCE(ese.user_id, aie.user_id, aie.tenant_id),
    clinic_id = COALESCE(ese.clinic_id, aie.clinic_id),
    case_id = COALESCE(ese.case_id, aie.case_id),
    source_module = COALESCE(ese.source_module, 'adversarial_simulation')
FROM public.ai_inference_events aie
WHERE ese.triggered_inference_id = aie.id;

WITH latest_case_inference AS (
    SELECT DISTINCT ON (aie.case_id)
        aie.case_id,
        aie.id AS inference_id,
        aie.created_at
    FROM public.ai_inference_events aie
    WHERE aie.case_id IS NOT NULL
    ORDER BY aie.case_id, aie.created_at DESC, aie.id DESC
),
latest_case_outcome AS (
    SELECT DISTINCT ON (coe.case_id)
        coe.case_id,
        coe.id AS outcome_id,
        coe.created_at
    FROM public.clinical_outcome_events coe
    WHERE coe.case_id IS NOT NULL
    ORDER BY coe.case_id, coe.created_at DESC, coe.id DESC
),
latest_case_simulation AS (
    SELECT DISTINCT ON (ese.case_id)
        ese.case_id,
        ese.id AS simulation_id,
        ese.created_at
    FROM public.edge_simulation_events ese
    WHERE ese.case_id IS NOT NULL
    ORDER BY ese.case_id, ese.created_at DESC, ese.id DESC
),
case_counts AS (
    SELECT
        aie.case_id,
        COUNT(*) AS inference_event_count,
        MIN(aie.created_at) AS first_inference_at,
        MAX(aie.created_at) AS last_inference_at
    FROM public.ai_inference_events aie
    WHERE aie.case_id IS NOT NULL
    GROUP BY aie.case_id
)
UPDATE public.clinical_cases cc
SET
    latest_inference_event_id = latest_case_inference.inference_id,
    latest_outcome_event_id = latest_case_outcome.outcome_id,
    latest_simulation_event_id = latest_case_simulation.simulation_id,
    inference_event_count = COALESCE(case_counts.inference_event_count, cc.inference_event_count),
    first_inference_at = COALESCE(case_counts.first_inference_at, cc.first_inference_at),
    last_inference_at = COALESCE(case_counts.last_inference_at, cc.last_inference_at),
    user_id = COALESCE(cc.user_id, cc.tenant_id),
    source_module = COALESCE(
        CASE
            WHEN latest_case_simulation.simulation_id IS NOT NULL THEN 'adversarial_simulation'
            WHEN latest_case_outcome.outcome_id IS NOT NULL THEN 'outcome_learning'
            WHEN latest_case_inference.inference_id IS NOT NULL THEN 'inference_console'
            ELSE cc.source_module
        END,
        cc.source_module,
        'dataset_backfill'
    )
FROM case_counts
LEFT JOIN latest_case_inference
    ON latest_case_inference.case_id = case_counts.case_id
LEFT JOIN latest_case_outcome
    ON latest_case_outcome.case_id = case_counts.case_id
LEFT JOIN latest_case_simulation
    ON latest_case_simulation.case_id = case_counts.case_id
WHERE cc.id = case_counts.case_id;

CREATE INDEX IF NOT EXISTS idx_clinical_cases_latest_outcome
    ON public.clinical_cases (latest_outcome_event_id)
    WHERE latest_outcome_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_cases_latest_simulation
    ON public.clinical_cases (latest_simulation_event_id)
    WHERE latest_simulation_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_inference_events_tenant_case
    ON public.ai_inference_events (tenant_id, case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_outcome_events_tenant_case
    ON public.clinical_outcome_events (tenant_id, case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_edge_simulation_events_tenant_case
    ON public.edge_simulation_events (tenant_id, case_id, created_at DESC);

ALTER TABLE public.clinical_cases
    DROP CONSTRAINT IF EXISTS clinical_cases_latest_outcome_event_id_fkey;

ALTER TABLE public.clinical_cases
    ADD CONSTRAINT clinical_cases_latest_outcome_event_id_fkey
    FOREIGN KEY (latest_outcome_event_id)
    REFERENCES public.clinical_outcome_events(id)
    ON DELETE SET NULL;

ALTER TABLE public.clinical_cases
    DROP CONSTRAINT IF EXISTS clinical_cases_latest_simulation_event_id_fkey;

ALTER TABLE public.clinical_cases
    ADD CONSTRAINT clinical_cases_latest_simulation_event_id_fkey
    FOREIGN KEY (latest_simulation_event_id)
    REFERENCES public.edge_simulation_events(id)
    ON DELETE SET NULL;

ALTER TABLE public.edge_simulation_events
    DROP CONSTRAINT IF EXISTS edge_simulation_events_tenant_id_fkey;

ALTER TABLE public.edge_simulation_events
    ADD CONSTRAINT edge_simulation_events_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE;

ALTER TABLE public.edge_simulation_events
    DROP CONSTRAINT IF EXISTS edge_simulation_events_case_id_fkey;

ALTER TABLE public.edge_simulation_events
    ADD CONSTRAINT edge_simulation_events_case_id_fkey
    FOREIGN KEY (case_id)
    REFERENCES public.clinical_cases(id)
    ON DELETE SET NULL;

CREATE OR REPLACE VIEW public.clinical_case_live_view AS
SELECT
    cc.id AS case_id,
    cc.tenant_id,
    cc.user_id,
    COALESCE(cc.species_canonical, cc.species, cc.species_display, cc.species_raw) AS species,
    cc.breed,
    COALESCE(
        cc.symptom_summary,
        NULLIF(cc.symptoms_raw, ''),
        NULLIF(array_to_string(cc.symptoms_normalized, ', '), ''),
        NULLIF(array_to_string(cc.symptom_vector, ', '), '')
    ) AS symptoms_summary,
    cc.latest_inference_event_id,
    cc.latest_outcome_event_id,
    cc.latest_simulation_event_id,
    aie.confidence_score AS latest_confidence,
    CASE
        WHEN jsonb_typeof(aie.output_payload -> 'risk_assessment') = 'object'
            THEN aie.output_payload -> 'risk_assessment' ->> 'emergency_level'
        ELSE NULL
    END AS latest_emergency_level,
    cc.source_module,
    cc.updated_at
FROM public.clinical_cases cc
LEFT JOIN public.ai_inference_events aie
    ON aie.id = cc.latest_inference_event_id;

NOTIFY pgrst, 'reload schema';
