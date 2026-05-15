-- Tighten the Settings / Control Plane read path.
-- These indexes match the tenant-scoped recency, count, and lookup queries
-- used by /api/settings/control-plane, topology snapshots, and model registry
-- governance panels.

create index if not exists idx_telemetry_events_tenant_timestamp
    on public.telemetry_events (tenant_id, "timestamp" desc);

create index if not exists idx_telemetry_events_tenant_type_timestamp
    on public.telemetry_events (tenant_id, event_type, "timestamp" desc);

create index if not exists idx_model_routing_decisions_tenant_created
    on public.model_routing_decisions (tenant_id, created_at desc);

create index if not exists idx_model_routing_decisions_tenant_model_created
    on public.model_routing_decisions (tenant_id, selected_model_id, created_at desc);

create index if not exists idx_model_routing_decisions_tenant_family_created
    on public.model_routing_decisions (tenant_id, model_family, created_at desc);

create index if not exists idx_clinical_cases_tenant_updated
    on public.clinical_cases (tenant_id, updated_at desc);

create index if not exists idx_clinical_cases_ingestion_status
    on public.clinical_cases (tenant_id, ingestion_status, updated_at desc);

create index if not exists idx_clinical_cases_label_type
    on public.clinical_cases (tenant_id, label_type);

create index if not exists idx_clinical_cases_adversarial
    on public.clinical_cases (tenant_id, adversarial_case);

create index if not exists idx_clinical_cases_calibration_status
    on public.clinical_cases (tenant_id, calibration_status);

create index if not exists idx_clinical_cases_prediction_correct
    on public.clinical_cases (tenant_id, prediction_correct);

create index if not exists idx_clinical_cases_tenant_latest_inference_not_null
    on public.clinical_cases (tenant_id)
    where latest_inference_event_id is not null;

create index if not exists idx_ai_inference_events_tenant_case_null
    on public.ai_inference_events (tenant_id, created_at desc)
    where case_id is null;

create index if not exists idx_clinical_outcome_events_tenant_case_null
    on public.clinical_outcome_events (tenant_id, created_at desc)
    where case_id is null;

create index if not exists idx_clinical_outcome_events_tenant_outcome_timestamp
    on public.clinical_outcome_events (tenant_id, outcome_timestamp desc);

create index if not exists idx_edge_simulation_events_tenant_case_null
    on public.edge_simulation_events (tenant_id, created_at desc)
    where case_id is null;

create index if not exists idx_edge_simulation_events_tenant_created
    on public.edge_simulation_events (tenant_id, created_at desc);

create index if not exists idx_model_evaluation_events_tenant_created
    on public.model_evaluation_events (tenant_id, created_at desc);

create index if not exists idx_model_evaluation_events_tenant_trigger_created
    on public.model_evaluation_events (tenant_id, trigger_type, created_at desc);

create index if not exists idx_model_registry_entries_tenant_updated
    on public.model_registry_entries (tenant_id, updated_at desc);

create index if not exists idx_model_registry_entries_tenant_status_updated
    on public.model_registry_entries (tenant_id, promotion_status, updated_at desc);

create index if not exists idx_model_registry_entries_tenant_task_updated
    on public.model_registry_entries (tenant_id, task_type, updated_at desc);

create index if not exists idx_learning_dataset_versions_tenant_created
    on public.learning_dataset_versions (tenant_id, created_at desc);

create index if not exists idx_learning_benchmark_reports_tenant_created
    on public.learning_benchmark_reports (tenant_id, created_at desc);

create index if not exists idx_learning_calibration_reports_tenant_created
    on public.learning_calibration_reports (tenant_id, created_at desc);

create index if not exists idx_experiment_runs_tenant_updated
    on public.experiment_runs (tenant_id, updated_at desc);

create index if not exists idx_experiment_runs_tenant_status_updated
    on public.experiment_runs (tenant_id, status, updated_at desc);

create index if not exists idx_experiment_metrics_tenant_run_timestamp
    on public.experiment_metrics (tenant_id, run_id, metric_timestamp);

create index if not exists idx_experiment_benchmarks_tenant_run_created
    on public.experiment_benchmarks (tenant_id, run_id, created_at desc);

create index if not exists idx_experiment_registry_links_tenant_run_updated
    on public.experiment_registry_links (tenant_id, run_id, updated_at desc);

create index if not exists idx_control_plane_api_keys_tenant_status
    on public.control_plane_api_keys (tenant_id, status, created_at desc);

create index if not exists idx_control_plane_action_log_tenant_created
    on public.control_plane_action_log (tenant_id, created_at desc);

create index if not exists idx_control_plane_action_log_tenant_action
    on public.control_plane_action_log (tenant_id, action_type, created_at desc);
