-- ═══════════════════════════════════════════════════════════════════════════
-- VetIOS Phase 1+2 Intelligence Stack Migration
-- Adds: pgvector case embeddings, longitudinal patient records,
--        RLHF feedback, calibration tuples, active learning queue,
--        population disease signals, outbreak alerts
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 1. Vet Case Vectors (pgvector retrieval store) ──────────────────────────

CREATE TABLE IF NOT EXISTS vet_case_vectors (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    inference_event_id  TEXT        UNIQUE,
    tenant_id           TEXT        NOT NULL,
    species             TEXT        NOT NULL,
    breed               TEXT,
    age_years           NUMERIC(5,2),
    weight_kg           NUMERIC(6,2),
    symptoms            TEXT[]      NOT NULL DEFAULT '{}',
    biomarkers          JSONB,
    region              TEXT,
    diagnosis           TEXT,
    confidence_score    NUMERIC(4,3),
    outcome_confirmed   BOOLEAN     NOT NULL DEFAULT FALSE,
    outcome_confirmed_at TIMESTAMPTZ,
    embedding           vector(1536),
    embedding_model     TEXT        NOT NULL DEFAULT 'text-embedding-3-large',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vet_case_vectors_tenant
    ON vet_case_vectors (tenant_id);

CREATE INDEX IF NOT EXISTS idx_vet_case_vectors_species_diagnosis
    ON vet_case_vectors (species, diagnosis);

CREATE INDEX IF NOT EXISTS idx_vet_case_vectors_outcome_confirmed
    ON vet_case_vectors (outcome_confirmed)
    WHERE outcome_confirmed = TRUE;

-- pgvector HNSW index for fast approximate nearest neighbour search
CREATE INDEX IF NOT EXISTS idx_vet_case_vectors_embedding_hnsw
    ON vet_case_vectors
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

ALTER TABLE vet_case_vectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_vet_case_vectors" ON vet_case_vectors
    USING (tenant_id = current_setting('app.tenant_id', TRUE)
           OR auth.role() = 'service_role');

-- ─── pgvector similarity search RPC ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_vet_case_vectors(
    query_embedding     vector(1536),
    match_threshold     FLOAT          DEFAULT 0.72,
    match_count         INT            DEFAULT 10,
    filter_species      TEXT           DEFAULT NULL,
    confirmed_only      BOOLEAN        DEFAULT FALSE
)
RETURNS TABLE (
    id                  UUID,
    inference_event_id  TEXT,
    tenant_id           TEXT,
    species             TEXT,
    breed               TEXT,
    age_years           NUMERIC(5,2),
    symptoms            TEXT[],
    diagnosis           TEXT,
    confidence_score    NUMERIC(4,3),
    outcome_confirmed   BOOLEAN,
    similarity          FLOAT,
    created_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id,
        v.inference_event_id,
        v.tenant_id,
        v.species,
        v.breed,
        v.age_years,
        v.symptoms,
        v.diagnosis,
        v.confidence_score,
        v.outcome_confirmed,
        1 - (v.embedding <=> query_embedding) AS similarity,
        v.created_at
    FROM vet_case_vectors v
    WHERE
        1 - (v.embedding <=> query_embedding) >= match_threshold
        AND (filter_species IS NULL OR v.species = filter_species)
        AND (NOT confirmed_only OR v.outcome_confirmed = TRUE)
    ORDER BY v.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ─── 2. Patient Longitudinal Records ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patient_longitudinal_records (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id              TEXT        NOT NULL,
    tenant_id               TEXT        NOT NULL,
    visit_date              DATE        NOT NULL,
    species                 TEXT        NOT NULL,
    breed                   TEXT,
    age_years               NUMERIC(5,2),
    weight_kg               NUMERIC(6,2),
    symptoms                TEXT[]      NOT NULL DEFAULT '{}',
    biomarkers              JSONB,
    inference_event_id      TEXT,
    primary_diagnosis       TEXT,
    diagnosis_confidence    NUMERIC(4,3),
    treatment_prescribed    TEXT[],
    outcome_confirmed       BOOLEAN     NOT NULL DEFAULT FALSE,
    confirmed_diagnosis     TEXT,
    outcome_confirmed_at    TIMESTAMPTZ,
    vet_notes               TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_longitudinal_patient_tenant
    ON patient_longitudinal_records (patient_id, tenant_id, visit_date DESC);

CREATE INDEX IF NOT EXISTS idx_longitudinal_tenant_visit
    ON patient_longitudinal_records (tenant_id, visit_date DESC);

CREATE INDEX IF NOT EXISTS idx_longitudinal_inference_event
    ON patient_longitudinal_records (inference_event_id)
    WHERE inference_event_id IS NOT NULL;

ALTER TABLE patient_longitudinal_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_longitudinal" ON patient_longitudinal_records
    USING (tenant_id = current_setting('app.tenant_id', TRUE)
           OR auth.role() = 'service_role');

-- ─── 3. RLHF Feedback Events ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rlhf_feedback_events (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id             TEXT        UNIQUE NOT NULL,
    inference_event_id      TEXT        NOT NULL,
    tenant_id               TEXT        NOT NULL,
    patient_id              TEXT,
    feedback_type           TEXT        NOT NULL,
    predicted_diagnosis     TEXT,
    actual_diagnosis        TEXT,
    predicted_confidence    NUMERIC(4,3),
    vet_confidence          NUMERIC(4,3),
    species                 TEXT        NOT NULL,
    breed                   TEXT,
    age_years               NUMERIC(5,2),
    region                  TEXT,
    extracted_features      JSONB       NOT NULL DEFAULT '{}',
    vet_notes               TEXT,
    label_type              TEXT        NOT NULL DEFAULT 'expert',
    impact_delta            NUMERIC(6,4),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rlhf_tenant_created
    ON rlhf_feedback_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rlhf_inference_event
    ON rlhf_feedback_events (inference_event_id);

CREATE INDEX IF NOT EXISTS idx_rlhf_species_diagnosis
    ON rlhf_feedback_events (species, actual_diagnosis);

ALTER TABLE rlhf_feedback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_rlhf" ON rlhf_feedback_events
    USING (tenant_id = current_setting('app.tenant_id', TRUE)
           OR auth.role() = 'service_role');

-- ─── 4. Calibration Tuples ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calibration_tuples (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tuple_key                   TEXT        UNIQUE NOT NULL,
    species                     TEXT        NOT NULL,
    breed                       TEXT,
    diagnosis                   TEXT        NOT NULL,
    total_cases                 INT         NOT NULL DEFAULT 0,
    correct_cases               INT         NOT NULL DEFAULT 0,
    accuracy_rate               NUMERIC(5,4) NOT NULL DEFAULT 0,
    avg_model_confidence        NUMERIC(5,4) NOT NULL DEFAULT 0,
    calibration_error           NUMERIC(5,4) NOT NULL DEFAULT 0,
    ci_lower                    NUMERIC(5,4),
    ci_upper                    NUMERIC(5,4),
    is_statistically_significant BOOLEAN    NOT NULL DEFAULT FALSE,
    last_updated                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calibration_species_diagnosis
    ON calibration_tuples (species, diagnosis);

CREATE INDEX IF NOT EXISTS idx_calibration_accuracy
    ON calibration_tuples (accuracy_rate DESC)
    WHERE is_statistically_significant = TRUE;

-- Atomic increment RPC for calibration tuples
CREATE OR REPLACE FUNCTION increment_calibration_tuple(
    p_tuple_key         TEXT,
    p_species           TEXT,
    p_breed             TEXT,
    p_diagnosis         TEXT,
    p_is_correct        BOOLEAN,
    p_confidence        NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total     INT;
    v_correct   INT;
    v_avg_conf  NUMERIC;
    v_accuracy  NUMERIC;
    v_cal_err   NUMERIC;
    v_ci_lower  NUMERIC;
    v_ci_upper  NUMERIC;
    v_z         NUMERIC := 1.96;
BEGIN
    INSERT INTO calibration_tuples (
        tuple_key, species, breed, diagnosis, total_cases, correct_cases,
        accuracy_rate, avg_model_confidence, calibration_error,
        ci_lower, ci_upper, is_statistically_significant, last_updated
    ) VALUES (
        p_tuple_key, p_species, p_breed, p_diagnosis,
        1, CASE WHEN p_is_correct THEN 1 ELSE 0 END,
        CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END,
        p_confidence, ABS(CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END - p_confidence),
        0, 1, FALSE, NOW()
    )
    ON CONFLICT (tuple_key) DO UPDATE SET
        total_cases   = calibration_tuples.total_cases + 1,
        correct_cases = calibration_tuples.correct_cases + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
        last_updated  = NOW();

    -- Recompute derived fields
    SELECT total_cases, correct_cases, avg_model_confidence
    INTO v_total, v_correct, v_avg_conf
    FROM calibration_tuples
    WHERE tuple_key = p_tuple_key;

    v_accuracy  := v_correct::NUMERIC / NULLIF(v_total, 0);
    v_avg_conf  := (v_avg_conf * (v_total - 1) + p_confidence) / v_total;
    v_cal_err   := ABS(v_accuracy - v_avg_conf);

    -- Wilson CI
    v_ci_lower  := GREATEST(0, (v_accuracy + v_z*v_z/(2*v_total) - v_z * SQRT(v_accuracy*(1-v_accuracy)/v_total + v_z*v_z/(4*v_total*v_total))) / (1 + v_z*v_z/v_total));
    v_ci_upper  := LEAST(1,   (v_accuracy + v_z*v_z/(2*v_total) + v_z * SQRT(v_accuracy*(1-v_accuracy)/v_total + v_z*v_z/(4*v_total*v_total))) / (1 + v_z*v_z/v_total));

    UPDATE calibration_tuples SET
        accuracy_rate               = v_accuracy,
        avg_model_confidence        = v_avg_conf,
        calibration_error           = v_cal_err,
        ci_lower                    = v_ci_lower,
        ci_upper                    = v_ci_upper,
        is_statistically_significant = (v_total >= 30)
    WHERE tuple_key = p_tuple_key;
END;
$$;

-- ─── 5. Active Learning Queue ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active_learning_queue (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    inference_event_id      TEXT        NOT NULL,
    tenant_id               TEXT        NOT NULL,
    species                 TEXT        NOT NULL,
    breed                   TEXT,
    predicted_diagnosis     TEXT,
    predicted_confidence    NUMERIC(4,3),
    uncertainty_score       NUMERIC(4,3) NOT NULL,
    differential_entropy    NUMERIC(6,4),
    strategy                TEXT        NOT NULL,
    priority                TEXT        NOT NULL DEFAULT 'medium',
    reason                  TEXT        NOT NULL,
    status                  TEXT        NOT NULL DEFAULT 'pending_review',
    assigned_to             TEXT,
    confirmed_diagnosis     TEXT,
    reviewed_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_al_tenant_priority_status
    ON active_learning_queue (tenant_id, priority, status)
    WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_al_uncertainty
    ON active_learning_queue (uncertainty_score DESC)
    WHERE status = 'pending_review';

ALTER TABLE active_learning_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_active_learning" ON active_learning_queue
    USING (tenant_id = current_setting('app.tenant_id', TRUE)
           OR auth.role() = 'service_role');

-- ─── 6. Population Disease Signals ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS population_disease_signals (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           TEXT        NOT NULL,
    disease             TEXT        NOT NULL,
    species             TEXT        NOT NULL,
    region              TEXT        NOT NULL,
    period              TEXT        NOT NULL, -- ISO week "2026-W17"
    inference_event_id  TEXT        UNIQUE NOT NULL,
    confidence          NUMERIC(4,3) NOT NULL DEFAULT 0.7,
    reported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_population_signals_period_disease
    ON population_disease_signals (period, disease, species, region);

CREATE INDEX IF NOT EXISTS idx_population_signals_tenant_period
    ON population_disease_signals (tenant_id, period);

-- No RLS — population signals are aggregated across tenants (anonymised)

-- ─── 7. Population Outbreak Alerts ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS population_outbreak_alerts (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id            TEXT        UNIQUE NOT NULL,
    disease             TEXT        NOT NULL,
    species             TEXT        NOT NULL,
    region              TEXT        NOT NULL,
    alert_type          TEXT        NOT NULL,
    severity            TEXT        NOT NULL,
    baseline_count      INT,
    current_count       INT,
    increase_percent    INT,
    affected_clinics    INT,
    description         TEXT,
    first_detected      TIMESTAMPTZ NOT NULL,
    last_updated        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbreak_severity_updated
    ON population_outbreak_alerts (severity, last_updated DESC);

CREATE INDEX IF NOT EXISTS idx_outbreak_region_disease
    ON population_outbreak_alerts (region, disease);
