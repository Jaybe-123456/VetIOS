CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.accuracy_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    window_id TEXT NOT NULL,
    model_version TEXT,
    top1_accuracy DOUBLE PRECISION,
    top3_accuracy DOUBLE PRECISION,
    calibration_gap DOUBLE PRECISION,
    overconfidence_rate DOUBLE PRECISION,
    abstention_rate DOUBLE PRECISION,
    sample_size INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT accuracy_metrics_tenant_window_unique UNIQUE (tenant_id, window_id)
);

CREATE TABLE IF NOT EXISTS public.disease_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    window_id TEXT NOT NULL,
    disease_name TEXT NOT NULL,
    precision DOUBLE PRECISION,
    recall DOUBLE PRECISION,
    false_positive_rate DOUBLE PRECISION,
    false_negative_rate DOUBLE PRECISION,
    top1_accuracy DOUBLE PRECISION,
    top3_recall DOUBLE PRECISION,
    support_n INTEGER NOT NULL DEFAULT 0,
    misclassification_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT disease_performance_tenant_window_disease_unique UNIQUE (tenant_id, window_id, disease_name)
);

CREATE TABLE IF NOT EXISTS public.failure_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL,
    inference_event_id TEXT,
    outcome_event_id TEXT,
    evaluation_event_id TEXT,
    model_version TEXT,
    predicted TEXT,
    actual TEXT,
    error_type TEXT NOT NULL CHECK (error_type IN ('wrong_top1', 'near_miss', 'abstention_trigger')),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    failure_classification TEXT NOT NULL CHECK (failure_classification IN ('diagnostic_error', 'feature_weighting_error', 'ontology_violation', 'data_sparsity_issue', 'abstention')),
    confidence DOUBLE PRECISION,
    contradiction_score DOUBLE PRECISION,
    actual_in_top3 BOOLEAN NOT NULL DEFAULT FALSE,
    abstained BOOLEAN NOT NULL DEFAULT FALSE,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.memory_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    metric_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    memory_usage DOUBLE PRECISION,
    rss_mb DOUBLE PRECISION,
    heap_used_mb DOUBLE PRECISION,
    heap_total_mb DOUBLE PRECISION,
    external_mb DOUBLE PRECISION,
    buffer_size INTEGER NOT NULL DEFAULT 0,
    log_queue_depth INTEGER NOT NULL DEFAULT 0,
    retention_tier TEXT NOT NULL DEFAULT 'hot' CHECK (retention_tier IN ('hot', 'warm', 'cold')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accuracy_metrics_tenant_window_computed
    ON public.accuracy_metrics (tenant_id, window_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_disease_performance_tenant_window_support
    ON public.disease_performance (tenant_id, window_id, support_n DESC, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_failure_events_tenant_created
    ON public.failure_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_failure_events_tenant_error_created
    ON public.failure_events (tenant_id, error_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_metrics_tenant_timestamp
    ON public.memory_metrics (tenant_id, metric_timestamp DESC);

ALTER TABLE public.accuracy_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disease_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accuracy_metrics_select_own ON public.accuracy_metrics;
DROP POLICY IF EXISTS accuracy_metrics_insert_own ON public.accuracy_metrics;
DROP POLICY IF EXISTS accuracy_metrics_update_own ON public.accuracy_metrics;

CREATE POLICY accuracy_metrics_select_own
    ON public.accuracy_metrics
    FOR SELECT USING (tenant_id = public.current_tenant_id()::text);

CREATE POLICY accuracy_metrics_insert_own
    ON public.accuracy_metrics
    FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id()::text);

CREATE POLICY accuracy_metrics_update_own
    ON public.accuracy_metrics
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id()::text)
    WITH CHECK (tenant_id = public.current_tenant_id()::text);

DROP POLICY IF EXISTS disease_performance_select_own ON public.disease_performance;
DROP POLICY IF EXISTS disease_performance_insert_own ON public.disease_performance;
DROP POLICY IF EXISTS disease_performance_update_own ON public.disease_performance;

CREATE POLICY disease_performance_select_own
    ON public.disease_performance
    FOR SELECT USING (tenant_id = public.current_tenant_id()::text);

CREATE POLICY disease_performance_insert_own
    ON public.disease_performance
    FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id()::text);

CREATE POLICY disease_performance_update_own
    ON public.disease_performance
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id()::text)
    WITH CHECK (tenant_id = public.current_tenant_id()::text);

DROP POLICY IF EXISTS failure_events_select_own ON public.failure_events;
DROP POLICY IF EXISTS failure_events_insert_own ON public.failure_events;
DROP POLICY IF EXISTS failure_events_update_own ON public.failure_events;

CREATE POLICY failure_events_select_own
    ON public.failure_events
    FOR SELECT USING (tenant_id = public.current_tenant_id()::text);

CREATE POLICY failure_events_insert_own
    ON public.failure_events
    FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id()::text);

CREATE POLICY failure_events_update_own
    ON public.failure_events
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id()::text)
    WITH CHECK (tenant_id = public.current_tenant_id()::text);

DROP POLICY IF EXISTS memory_metrics_select_own ON public.memory_metrics;
DROP POLICY IF EXISTS memory_metrics_insert_own ON public.memory_metrics;
DROP POLICY IF EXISTS memory_metrics_update_own ON public.memory_metrics;

CREATE POLICY memory_metrics_select_own
    ON public.memory_metrics
    FOR SELECT USING (tenant_id = public.current_tenant_id()::text);

CREATE POLICY memory_metrics_insert_own
    ON public.memory_metrics
    FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id()::text);

CREATE POLICY memory_metrics_update_own
    ON public.memory_metrics
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id()::text)
    WITH CHECK (tenant_id = public.current_tenant_id()::text);
