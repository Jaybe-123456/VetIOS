create index if not exists idx_ai_inference_events_orphan_scan
    on public.ai_inference_events (created_at asc)
    where blocked = false and orphaned = false;

create index if not exists idx_outcomes_inference_event_id
    on public.outcomes (inference_event_id);
