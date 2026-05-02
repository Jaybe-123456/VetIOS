-- Fix pgvector operator search path issue (extensions schema vs public schema)
DROP FUNCTION IF EXISTS match_vet_case_vectors(vector, double precision, integer, text, boolean);

CREATE FUNCTION match_vet_case_vectors(
    query_embedding extensions.vector,
    match_threshold float,
    match_count int,
    filter_species text,
    confirmed_only boolean
)
RETURNS TABLE (
    id uuid,
    inference_event_id uuid,
    tenant_id text,
    species text,
    breed text,
    age_years numeric,
    symptoms text[],
    diagnosis text,
    confidence_score numeric,
    outcome_confirmed boolean,
    similarity float,
    created_at timestamptz
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT v.id, v.inference_event_id, v.tenant_id, v.species, v.breed,
           v.age_years, v.symptoms, v.diagnosis, v.confidence_score,
           v.outcome_confirmed,
           1 - (v.embedding <=> query_embedding) AS similarity,
           v.created_at
    FROM vet_case_vectors v
    WHERE 1 - (v.embedding <=> query_embedding) >= match_threshold
      AND (filter_species IS NULL OR v.species = filter_species)
      AND (NOT confirmed_only OR v.outcome_confirmed = TRUE)
    ORDER BY v.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
