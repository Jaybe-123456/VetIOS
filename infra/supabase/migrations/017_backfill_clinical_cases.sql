-- =============================================================================
-- Migration 017: Backfill Canonical Clinical Cases
--
-- Creates canonical clinical_cases for historical inference events that do not
-- have a valid linked case and then enforces the event -> case foreign keys.
-- =============================================================================

WITH orphan_inference_events AS (
    SELECT
        aie.id AS inference_id,
        aie.tenant_id,
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
        ) AS symptom_vector
    FROM public.ai_inference_events aie
    LEFT JOIN public.clinical_cases cc
        ON cc.id = aie.case_id
    WHERE aie.case_id IS NULL OR cc.id IS NULL
),
normalized_orphans AS (
    SELECT
        inference_id,
        tenant_id,
        clinic_id,
        existing_case_id AS preferred_case_id,
        CASE
            WHEN LOWER(COALESCE(species_raw, '')) IN ('dog', 'canine', 'puppy', 'canis lupus', 'canis lupus familiaris')
                THEN 'Canis lupus familiaris'
            WHEN LOWER(COALESCE(species_raw, '')) IN ('cat', 'feline', 'kitten', 'felis catus')
                THEN 'Felis catus'
            WHEN LOWER(COALESCE(species_raw, '')) IN ('horse', 'equine', 'equus ferus caballus')
                THEN 'Equus ferus caballus'
            WHEN LOWER(COALESCE(species_raw, '')) IN ('cow', 'bovine', 'bos taurus')
                THEN 'Bos taurus'
            ELSE species_raw
        END AS species,
        species_raw,
        breed_raw AS breed,
        symptom_vector,
        NULLIF(array_to_string(symptom_vector[1:8], ', '), '') AS symptom_summary,
        metadata_json AS metadata,
        input_signature AS latest_input_signature,
        CASE
            WHEN existing_case_id IS NOT NULL THEN 'case:' || existing_case_id::text
            ELSE 'fingerprint:' || encode(
                digest(
                    CONCAT_WS(
                        '|',
                        COALESCE(clinic_id::text, ''),
                        COALESCE(
                            CASE
                                WHEN LOWER(COALESCE(species_raw, '')) IN ('dog', 'canine', 'puppy', 'canis lupus', 'canis lupus familiaris')
                                    THEN 'Canis lupus familiaris'
                                WHEN LOWER(COALESCE(species_raw, '')) IN ('cat', 'feline', 'kitten', 'felis catus')
                                    THEN 'Felis catus'
                                WHEN LOWER(COALESCE(species_raw, '')) IN ('horse', 'equine', 'equus ferus caballus')
                                    THEN 'Equus ferus caballus'
                                WHEN LOWER(COALESCE(species_raw, '')) IN ('cow', 'bovine', 'bos taurus')
                                    THEN 'Bos taurus'
                                ELSE species_raw
                            END,
                            ''
                        ),
                        LOWER(COALESCE(breed_raw, '')),
                        COALESCE(
                            (
                                SELECT string_agg(symptom_item, ',' ORDER BY symptom_item)
                                FROM unnest(symptom_vector) AS symptom_item
                            ),
                            ''
                        ),
                        COALESCE(
                            regexp_replace(COALESCE(metadata_json ->> 'raw_note', ''), '\s+', ' ', 'g'),
                            ''
                        )
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
),
upserted_cases AS (
    INSERT INTO public.clinical_cases (
        id,
        tenant_id,
        clinic_id,
        case_key,
        source_case_reference,
        species,
        species_raw,
        breed,
        symptom_vector,
        symptom_summary,
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
        clinic_id,
        case_key,
        NULL,
        species,
        species_raw,
        breed,
        symptom_vector,
        symptom_summary,
        metadata,
        latest_input_signature,
        NULL,
        grouped_event_count,
        first_inference_at,
        last_inference_at
    FROM ranked_orphans
    WHERE recency_rank = 1
    ON CONFLICT (tenant_id, case_key) DO UPDATE
    SET
        clinic_id = COALESCE(EXCLUDED.clinic_id, public.clinical_cases.clinic_id),
        species = COALESCE(EXCLUDED.species, public.clinical_cases.species),
        species_raw = COALESCE(EXCLUDED.species_raw, public.clinical_cases.species_raw),
        breed = COALESCE(EXCLUDED.breed, public.clinical_cases.breed),
        symptom_vector = CASE
            WHEN COALESCE(array_length(EXCLUDED.symptom_vector, 1), 0) > 0
                THEN EXCLUDED.symptom_vector
            ELSE public.clinical_cases.symptom_vector
        END,
        symptom_summary = COALESCE(EXCLUDED.symptom_summary, public.clinical_cases.symptom_summary),
        metadata = public.clinical_cases.metadata || EXCLUDED.metadata,
        latest_input_signature = EXCLUDED.latest_input_signature,
        inference_event_count = GREATEST(public.clinical_cases.inference_event_count, EXCLUDED.inference_event_count),
        first_inference_at = LEAST(public.clinical_cases.first_inference_at, EXCLUDED.first_inference_at),
        last_inference_at = GREATEST(public.clinical_cases.last_inference_at, EXCLUDED.last_inference_at)
    RETURNING id, tenant_id, case_key
)
UPDATE public.ai_inference_events aie
SET case_id = cc.id
FROM normalized_orphans no
JOIN public.clinical_cases cc
    ON cc.tenant_id = no.tenant_id
   AND cc.case_key = no.case_key
WHERE aie.id = no.inference_id
  AND aie.case_id IS DISTINCT FROM cc.id;

WITH latest_case_events AS (
    SELECT DISTINCT ON (aie.case_id)
        aie.case_id,
        aie.id AS inference_id,
        aie.created_at
    FROM public.ai_inference_events aie
    WHERE aie.case_id IS NOT NULL
    ORDER BY aie.case_id, aie.created_at DESC, aie.id DESC
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
    latest_inference_event_id = latest_case_events.inference_id,
    inference_event_count = case_counts.inference_event_count,
    first_inference_at = case_counts.first_inference_at,
    last_inference_at = case_counts.last_inference_at
FROM latest_case_events
JOIN case_counts
    ON case_counts.case_id = latest_case_events.case_id
WHERE cc.id = latest_case_events.case_id;

UPDATE public.clinical_outcome_events coe
SET case_id = aie.case_id
FROM public.ai_inference_events aie
WHERE coe.inference_event_id = aie.id
  AND aie.case_id IS NOT NULL
  AND coe.case_id IS DISTINCT FROM aie.case_id;

ALTER TABLE public.ai_inference_events
    DROP CONSTRAINT IF EXISTS ai_inference_events_case_id_fkey;

ALTER TABLE public.ai_inference_events
    ADD CONSTRAINT ai_inference_events_case_id_fkey
    FOREIGN KEY (case_id)
    REFERENCES public.clinical_cases(id)
    ON DELETE SET NULL;

ALTER TABLE public.clinical_outcome_events
    DROP CONSTRAINT IF EXISTS clinical_outcome_events_case_id_fkey;

ALTER TABLE public.clinical_outcome_events
    ADD CONSTRAINT clinical_outcome_events_case_id_fkey
    FOREIGN KEY (case_id)
    REFERENCES public.clinical_cases(id)
    ON DELETE SET NULL;
