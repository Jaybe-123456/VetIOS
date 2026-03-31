CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.treatment_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    inference_event_id UUID NOT NULL,
    case_id UUID,
    episode_id UUID,
    disease TEXT NOT NULL,
    diagnosis_confidence DOUBLE PRECISION,
    species_applicability TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    treatment_pathway TEXT NOT NULL CHECK (treatment_pathway IN ('gold_standard', 'resource_constrained', 'supportive_only')),
    treatment_type TEXT NOT NULL CHECK (treatment_type IN ('medical', 'surgical', 'supportive care')),
    intervention_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    indication_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
    contraindications JSONB NOT NULL DEFAULT '[]'::jsonb,
    detected_contraindications JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'moderate', 'high', 'critical')),
    urgency_level TEXT NOT NULL CHECK (urgency_level IN ('routine', 'urgent', 'emergent')),
    evidence_level TEXT NOT NULL CHECK (evidence_level IN ('low', 'moderate', 'high')),
    environment_constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
    expected_outcome_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    uncertainty_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    risks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    regulatory_notes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    supporting_signals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    rationale TEXT,
    clinician_validation_required BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, inference_event_id, treatment_pathway, disease)
);

CREATE TABLE IF NOT EXISTS public.treatment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    inference_event_id UUID NOT NULL,
    case_id UUID,
    episode_id UUID,
    treatment_candidate_id UUID,
    disease TEXT NOT NULL,
    selected_treatment JSONB NOT NULL DEFAULT '{}'::jsonb,
    clinician_override BOOLEAN NOT NULL DEFAULT FALSE,
    clinician_validation_status TEXT NOT NULL CHECK (clinician_validation_status IN ('pending', 'confirmed', 'overridden')),
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.treatment_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE,
    tenant_id UUID NOT NULL,
    outcome_status TEXT NOT NULL CHECK (outcome_status IN ('planned', 'ongoing', 'improved', 'resolved', 'complication', 'deteriorated', 'deceased', 'unknown')),
    recovery_time_days DOUBLE PRECISION,
    complications TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    notes TEXT,
    short_term_response TEXT,
    outcome_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF to_regclass('public.ai_inference_events') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatment_candidates_inference_event_id_fkey') THEN
            ALTER TABLE public.treatment_candidates
                ADD CONSTRAINT treatment_candidates_inference_event_id_fkey
                FOREIGN KEY (inference_event_id) REFERENCES public.ai_inference_events(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatment_events_inference_event_id_fkey') THEN
            ALTER TABLE public.treatment_events
                ADD CONSTRAINT treatment_events_inference_event_id_fkey
                FOREIGN KEY (inference_event_id) REFERENCES public.ai_inference_events(id);
        END IF;
    END IF;

    IF to_regclass('public.clinical_cases') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatment_candidates_case_id_fkey') THEN
            ALTER TABLE public.treatment_candidates
                ADD CONSTRAINT treatment_candidates_case_id_fkey
                FOREIGN KEY (case_id) REFERENCES public.clinical_cases(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatment_events_case_id_fkey') THEN
            ALTER TABLE public.treatment_events
                ADD CONSTRAINT treatment_events_case_id_fkey
                FOREIGN KEY (case_id) REFERENCES public.clinical_cases(id);
        END IF;
    END IF;

    IF to_regclass('public.patient_episodes') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatment_candidates_episode_id_fkey') THEN
            ALTER TABLE public.treatment_candidates
                ADD CONSTRAINT treatment_candidates_episode_id_fkey
                FOREIGN KEY (episode_id) REFERENCES public.patient_episodes(id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatment_events_episode_id_fkey') THEN
            ALTER TABLE public.treatment_events
                ADD CONSTRAINT treatment_events_episode_id_fkey
                FOREIGN KEY (episode_id) REFERENCES public.patient_episodes(id);
        END IF;
    END IF;

    IF to_regclass('public.treatment_candidates') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatment_events_treatment_candidate_id_fkey') THEN
            ALTER TABLE public.treatment_events
                ADD CONSTRAINT treatment_events_treatment_candidate_id_fkey
                FOREIGN KEY (treatment_candidate_id) REFERENCES public.treatment_candidates(id);
        END IF;
    END IF;

    IF to_regclass('public.treatment_events') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treatment_outcomes_event_id_fkey') THEN
            ALTER TABLE public.treatment_outcomes
                ADD CONSTRAINT treatment_outcomes_event_id_fkey
                FOREIGN KEY (event_id) REFERENCES public.treatment_events(id);
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_treatment_candidates_lookup
    ON public.treatment_candidates (tenant_id, inference_event_id, treatment_pathway, disease);

CREATE INDEX IF NOT EXISTS idx_treatment_events_lookup
    ON public.treatment_events (tenant_id, disease, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_treatment_events_inference
    ON public.treatment_events (tenant_id, inference_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_treatment_outcomes_lookup
    ON public.treatment_outcomes (tenant_id, outcome_status, observed_at DESC);
