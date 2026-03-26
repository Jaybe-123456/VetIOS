-- =============================================================================
-- Migration 032: Control Plane Query Performance
-- Tightens the hot tenant/time indexes used by telemetry and topology observers.
-- =============================================================================

create index if not exists idx_clinical_cases_tenant_updated
    on public.clinical_cases (tenant_id, updated_at desc);

create index if not exists idx_clinical_outcome_events_tenant_outcome_timestamp
    on public.clinical_outcome_events (tenant_id, outcome_timestamp desc);

create index if not exists idx_edge_simulation_events_tenant_created
    on public.edge_simulation_events (tenant_id, created_at desc);

create index if not exists idx_model_evaluation_events_tenant_created
    on public.model_evaluation_events (tenant_id, created_at desc);

create index if not exists idx_model_evaluation_events_tenant_trigger_created
    on public.model_evaluation_events (tenant_id, trigger_type, created_at desc);
