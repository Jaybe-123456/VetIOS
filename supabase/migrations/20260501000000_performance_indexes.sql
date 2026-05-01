-- VetIOS production performance indexes.
-- These statements use CONCURRENTLY so production writes are not blocked.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_inference_events_tenant_id
  ON public.ai_inference_events (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_inference_events_created_at
  ON public.ai_inference_events (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_inference_events_tenant_created
  ON public.ai_inference_events (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inference_top_diagnosis
  ON public.ai_inference_events (top_diagnosis)
  WHERE top_diagnosis IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inference_tenant_outcome
  ON public.ai_inference_events (tenant_id, outcome_confirmed, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_inference_events_outcome_created
  ON public.ai_inference_events (outcome_confirmed, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_population_disease_signals_tenant_id
  ON public.population_disease_signals (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_population_signals_period
  ON public.population_disease_signals (period);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_population_signals_species_period
  ON public.population_disease_signals (species, period);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_population_signals_period_region
  ON public.population_disease_signals (period, region);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vet_override_signals_tenant_id
  ON public.vet_override_signals (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vet_override_signals_status
  ON public.vet_override_signals (status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vet_override_signals_tenant_created
  ON public.vet_override_signals (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_passive_signal_events_tenant_id
  ON public.passive_signal_events (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_passive_signal_events_created_at
  ON public.passive_signal_events (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_passive_signals_tenant
  ON public.passive_signal_events (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_learning_queue_tenant_id
  ON public.active_learning_queue (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_learning_queue_status
  ON public.active_learning_queue (status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_learning_queue_created_at
  ON public.active_learning_queue (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_learning_queue_status_created
  ON public.active_learning_queue (status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rlhf_feedback_events_tenant_id
  ON public.rlhf_feedback_events (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rlhf_feedback_events_created_at
  ON public.rlhf_feedback_events (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rlhf_feedback_events_feedback_type
  ON public.rlhf_feedback_events (feedback_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vet_case_vectors_tenant_id
  ON public.vet_case_vectors (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vet_case_vectors_created_at
  ON public.vet_case_vectors (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vet_case_vectors_tenant_created
  ON public.vet_case_vectors (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vet_embeddings_vector
  ON public.vet_case_vectors USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_longitudinal_records_tenant_id
  ON public.patient_longitudinal_records (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_longitudinal_records_created_at
  ON public.patient_longitudinal_records (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_longitudinal_records_tenant_created
  ON public.patient_longitudinal_records (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_cases_tenant_id
  ON public.clinical_cases (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_cases_created_at
  ON public.clinical_cases (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_cases_tenant_created
  ON public.clinical_cases (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_cases_status
  ON public.clinical_cases (ingestion_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_outcome_events_tenant_id
  ON public.clinical_outcome_events (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_outcome_events_created_at
  ON public.clinical_outcome_events (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clinical_outcome_events_tenant_created
  ON public.clinical_outcome_events (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outcome_inferences_tenant_id
  ON public.outcome_inferences (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outcome_inferences_created_at
  ON public.outcome_inferences (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outcome_inferences_tenant_created
  ON public.outcome_inferences (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_episodes_tenant_id
  ON public.patient_episodes (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_episodes_status
  ON public.patient_episodes (status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_episodes_created_at
  ON public.patient_episodes (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_episodes_tenant_created
  ON public.patient_episodes (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_sources_tenant_id
  ON public.signal_sources (tenant_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_sources_status
  ON public.signal_sources (status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_sources_created_at
  ON public.signal_sources (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signal_sources_tenant_created
  ON public.signal_sources (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_alerts_resolved
  ON public.platform_alerts (resolved, updated_at DESC);
