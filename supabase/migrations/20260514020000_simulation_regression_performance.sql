-- Tighten the regression simulation read path so replay planning does not scan
-- large clinical inference tables during live simulation polling.

create index if not exists idx_ai_inference_events_regression_baseline
    on public.ai_inference_events (tenant_id, created_at desc)
    where simulation_id is null
      and is_synthetic is distinct from true;

create index if not exists idx_ai_inference_events_model_lookup
    on public.ai_inference_events (tenant_id, model_version);

create index if not exists idx_evaluations_tenant_inference_event
    on public.evaluations (tenant_id, inference_event_id);

create index if not exists idx_regression_replays_tenant_simulation
    on public.regression_replays (tenant_id, simulation_id);
