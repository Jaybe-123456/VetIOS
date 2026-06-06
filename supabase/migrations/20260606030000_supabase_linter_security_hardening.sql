-- Supabase database linter hardening.
-- Fixes:
-- 0011 function_search_path_mutable
-- 0028 anon_security_definer_function_executable
-- 0029 authenticated_security_definer_function_executable
-- pg_graphql_*_table_exposed for non-public internal tables/views
-- materialized_view_in_api for treatment_performance_by_source

-- 1) Pin search_path on flagged public functions.
do $$
declare
    fn_name text;
    fn_oid oid;
begin
    foreach fn_name in array array[
        'handle_updated_at',
        'prevent_vet_graph_mutation',
        'vetios_set_event_hash',
        'prevent_product_usage_mutation',
        'increment_causal_node_count',
        'prevent_model_evidence_ingestion_mutation',
        'enforce_immutability',
        'prevent_core_event_mutation',
        'touch_causal_updated_at',
        'increment_living_node_inference_count',
        'vetios_prevent_event_mutation',
        'refresh_treatment_performance_view',
        'vetios_current_tenant_uuid'
    ]
    loop
        for fn_oid in
            select p.oid
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = fn_name
        loop
            execute format(
                'alter function %s set search_path = public, extensions',
                fn_oid::regprocedure
            );
        end loop;
    end loop;
end $$;

-- 2) Block direct API/RPC execution of SECURITY DEFINER helpers.
-- Server-side service-role code can still execute these functions.
do $$
declare
    fn_name text;
    fn_oid oid;
begin
    foreach fn_name in array array[
        'consume_product_usage_event',
        'increment_causal_node_count',
        'increment_living_node_inference_count',
        'match_rag_chunks',
        'refresh_treatment_performance_view',
        'search_rag_chunks_lexical'
    ]
    loop
        for fn_oid in
            select p.oid
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = fn_name
        loop
            execute format(
                'revoke execute on function %s from public, anon, authenticated',
                fn_oid::regprocedure
            );
        end loop;
    end loop;
end $$;

-- 3) Remove direct GraphQL/REST SELECT grants from internal tables/views.
-- Keep access through VetIOS server routes and service-role clients.
do $$
declare
    relation_name text;
    relation_regclass regclass;
begin
    foreach relation_name in array array[
        'account_entitlements',
        'adversarial_failure_modes',
        'adverse_event_signals',
        'analyte_reference_ranges',
        'audit_chain_checkpoints',
        'audit_licensees',
        'calibration_drift_reports',
        'calibration_runs',
        'causal_dag_edges',
        'causal_dag_nodes',
        'causal_observations',
        'clinical_case_cards',
        'counterfactual_diagnostic_sessions',
        'counterfactual_records',
        'cpg_finding_scores',
        'cron_run_log',
        'diagnosis_records',
        'flywheel_export_events',
        'imaging_studies',
        'inference_console_reports',
        'intake_sessions',
        'lab_recommendations',
        'lab_reports',
        'lab_results',
        'living_case_nodes',
        'model_evidence_ingestion_events',
        'one_health_signals',
        'outbreak_subscribers',
        'pharma_licensees',
        'pharma_webhook_subscriptions',
        'platform_alerts',
        'population_signals',
        'product_monthly_usage',
        'product_plan_limits',
        'product_usage_events',
        'qivs_screening_events',
        'rag_chunks',
        'rag_documents',
        'rag_queries',
        'rag_source_refresh_runs',
        'rag_sources',
        'regression_fixtures',
        'regression_results',
        'rna_folding_events',
        'simulation_watchdog_log',
        'species_knowledge_graph',
        'symptom_cluster_snapshots',
        'teleconsult_triage_events',
        'telemetry_anomaly_events',
        'telemetry_streams_default',
        'treatment_performance_by_source',
        'upload_hashes',
        'vet_disease_nodes',
        'vet_graph_edges',
        'vet_symptom_nodes',
        'vet_target_pathogens',
        'vkg_edges',
        'vkg_nodes',
        'zoonotic_bridge_alerts'
    ]
    loop
        relation_regclass := to_regclass(format('public.%I', relation_name));
        if relation_regclass is not null then
            execute format(
                'revoke select on table %s from public, anon, authenticated',
                relation_regclass
            );
        end if;
    end loop;
end $$;

-- 4) Preserve the earlier security_invoker fix for the monthly usage view.
alter view if exists public.product_monthly_usage
    set (security_invoker = true);

comment on view public.product_monthly_usage is
    'Monthly product usage aggregation. Runs with security_invoker=true so caller/RLS semantics are preserved.';

notify pgrst, 'reload schema';
