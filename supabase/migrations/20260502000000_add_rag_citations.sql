ALTER TABLE ai_inference_events
    ADD COLUMN IF NOT EXISTS rag_grounded    BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS rag_citations   JSONB   DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS retrieval_stats JSONB   DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_ai_inference_events_rag_grounded
    ON ai_inference_events (rag_grounded)
    WHERE rag_grounded = true;
