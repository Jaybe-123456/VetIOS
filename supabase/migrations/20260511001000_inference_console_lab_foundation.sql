-- VetIOS Inference Console lab-analysis foundation.
-- Uses loose UUID/text links so this can be applied before tenant/session wiring is finalized.

CREATE TABLE IF NOT EXISTS public.clinical_case_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id text,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    species text NOT NULL,
    breed text,
    presenting_complaint text NOT NULL,
    confirmed_diagnosis text,
    key_findings jsonb NOT NULL DEFAULT '[]',
    treatment jsonb NOT NULL DEFAULT '[]',
    outcome text,
    learning_points jsonb NOT NULL DEFAULT '[]',
    rarity_score float,
    source text CHECK (source IN ('video_upload', 'document_upload', 'manual_entry')),
    source_file_hash text,
    is_flagged_for_kb boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lab_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inference_event_id text,
    session_id text,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    species text NOT NULL,
    panel_types text[] NOT NULL DEFAULT '{}',
    analyte_results jsonb NOT NULL,
    critical_values jsonb NOT NULL DEFAULT '[]',
    pattern_matches jsonb NOT NULL DEFAULT '[]',
    key_abnormalities_summary text,
    model_version text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inference_console_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inference_event_id text,
    session_id text,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    patient jsonb NOT NULL,
    imaging_report_ids uuid[] NOT NULL DEFAULT '{}',
    lab_report_id uuid REFERENCES public.lab_reports(id) ON DELETE SET NULL,
    differentials jsonb NOT NULL DEFAULT '[]',
    primary_assessment text,
    critical_flags jsonb NOT NULL DEFAULT '{}',
    recommended_diagnostics jsonb NOT NULL DEFAULT '[]',
    confidence_overall float,
    uncertainty_flags text[] NOT NULL DEFAULT '{}',
    outcome_submitted boolean NOT NULL DEFAULT false,
    confirmed_diagnosis text,
    clinician_confidence integer,
    model_version text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.analyte_reference_ranges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    analyte text NOT NULL,
    species text NOT NULL,
    lower float NOT NULL,
    upper float NOT NULL,
    unit text NOT NULL,
    age_class text NOT NULL DEFAULT 'adult',
    breed_specific text NOT NULL DEFAULT 'all',
    source text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (analyte, species, age_class, breed_specific)
);

CREATE INDEX IF NOT EXISTS idx_clinical_case_cards_session
    ON public.clinical_case_cards (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lab_reports_session
    ON public.lab_reports (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inference_console_reports_session
    ON public.inference_console_reports (session_id, created_at DESC);

ALTER TABLE public.clinical_case_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inference_console_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyte_reference_ranges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'clinical_case_cards'
          AND policyname = 'service_role_only_clinical_case_cards'
    ) THEN
        CREATE POLICY "service_role_only_clinical_case_cards"
            ON public.clinical_case_cards
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'lab_reports'
          AND policyname = 'service_role_only_lab_reports'
    ) THEN
        CREATE POLICY "service_role_only_lab_reports"
            ON public.lab_reports
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'inference_console_reports'
          AND policyname = 'service_role_only_inference_console_reports'
    ) THEN
        CREATE POLICY "service_role_only_inference_console_reports"
            ON public.inference_console_reports
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'analyte_reference_ranges'
          AND policyname = 'service_role_only_analyte_reference_ranges'
    ) THEN
        CREATE POLICY "service_role_only_analyte_reference_ranges"
            ON public.analyte_reference_ranges
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');
    END IF;
END;
$$;

INSERT INTO public.analyte_reference_ranges (analyte, species, lower, upper, unit, source)
VALUES
    ('white_blood_cell_count', 'canine', 6, 17, '10^9/L', 'VetIOS seed reference range'),
    ('neutrophil_count', 'canine', 3, 11.5, '10^9/L', 'VetIOS seed reference range'),
    ('lymphocyte_count', 'canine', 1, 4.8, '10^9/L', 'VetIOS seed reference range'),
    ('platelet_count', 'canine', 200, 500, '10^9/L', 'VetIOS seed reference range'),
    ('blood_urea_nitrogen', 'canine', 7, 27, 'mg/dL', 'VetIOS seed reference range'),
    ('creatinine', 'canine', 0.5, 1.8, 'mg/dL', 'VetIOS seed reference range'),
    ('sodium', 'canine', 140, 155, 'mmol/L', 'VetIOS seed reference range'),
    ('potassium', 'canine', 3.5, 5.8, 'mmol/L', 'VetIOS seed reference range'),
    ('white_blood_cell_count', 'feline', 5.5, 19.5, '10^9/L', 'VetIOS seed reference range'),
    ('platelet_count', 'feline', 200, 600, '10^9/L', 'VetIOS seed reference range'),
    ('blood_urea_nitrogen', 'feline', 16, 36, 'mg/dL', 'VetIOS seed reference range'),
    ('creatinine', 'feline', 0.8, 2.4, 'mg/dL', 'VetIOS seed reference range')
ON CONFLICT (analyte, species, age_class, breed_specific) DO NOTHING;
