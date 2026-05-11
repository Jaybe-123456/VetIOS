-- Ask Vetios multimodal upload security support.
-- RAG tables already exist in 20260510000000_agentic_rag_service.sql; this
-- migration only adds content-hash dedupe for the upload security gate.

CREATE TABLE IF NOT EXISTS public.upload_hashes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_hash text UNIQUE NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    source_type text,
    detected_mime text,
    first_seen_file_name_hash text,
    upload_status text NOT NULL DEFAULT 'validated',
    rag_source_id uuid REFERENCES public.rag_sources(id) ON DELETE SET NULL,
    rag_document_id uuid REFERENCES public.rag_documents(id) ON DELETE SET NULL,
    chunks_indexed integer NOT NULL DEFAULT 0,
    processing_error text,
    processed_at timestamptz,
    flagged boolean NOT NULL DEFAULT false,
    flagged_reason text,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_hashes_flagged
    ON public.upload_hashes (flagged, created_at DESC)
    WHERE flagged = true;

CREATE INDEX IF NOT EXISTS idx_upload_hashes_rag_document
    ON public.upload_hashes (rag_document_id)
    WHERE rag_document_id IS NOT NULL;

ALTER TABLE public.upload_hashes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'upload_hashes'
          AND policyname = 'service_role_only_upload_hashes'
    ) THEN
        CREATE POLICY "service_role_only_upload_hashes"
            ON public.upload_hashes
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');
    END IF;
END;
$$;

COMMENT ON TABLE public.upload_hashes IS
    'Content-hash registry for Ask Vetios upload deduplication and flagged-content rejection.';
