import type { SupabaseClient } from '@supabase/supabase-js';
import {
    ADVERSARIAL_METRICS,
    AUDIT_LOG,
    CALIBRATION_METRICS,
    DEPLOYMENT_DECISIONS,
    EXPERIMENT_ARTIFACTS,
    EXPERIMENT_BENCHMARKS,
    EXPERIMENT_FAILURES,
    EXPERIMENT_METRICS,
    EXPERIMENT_REGISTRY_LINKS,
    EXPERIMENT_RUNS,
    LEARNING_AUDIT_EVENTS,
    LEARNING_BENCHMARK_REPORTS,
    LEARNING_CALIBRATION_REPORTS,
    LEARNING_DATASET_VERSIONS,
    MODEL_REGISTRY,
    MODEL_REGISTRY_ROUTING,
    MODEL_REGISTRY_ENTRIES,
    PROMOTION_REQUIREMENTS,
    REGISTRY_AUDIT_LOG,
    SUBGROUP_METRICS,
} from '@/lib/db/schemaContracts';
import type {
    AdversarialMetricRecord,
    CalibrationMetricRecord,
    ClinicalMetricsRecord,
    DeploymentDecisionRecord,
    ExperimentArtifactRecord,
    ExperimentAuditEventRecord,
    ExperimentBenchmarkRecord,
    ExperimentFailureRecord,
    ExperimentMetricRecord,
    ExperimentRegistryLinkRecord,
    ExperimentRunRecord,
    ModelRegistryRecord,
    PromotionRequirementsRecord,
    RegistryAuditLogRecord,
    RegistryLineageRecord,
    RegistryRoutingPointerRecord,
    RollbackMetadataRecord,
    SubgroupMetricRecord,
    ExperimentTrackingStore,
    ListExperimentRunsOptions,
} from '@/lib/experiments/types';

const DEFAULT_LIMIT = 200;

export function createSupabaseExperimentTrackingStore(
    client: SupabaseClient,
): ExperimentTrackingStore {
    return {
        async listExperimentRuns(tenantId, options = {}) {
            let query = client
                .from(EXPERIMENT_RUNS.TABLE)
                .select('*')
                .eq(EXPERIMENT_RUNS.COLUMNS.tenant_id, tenantId)
                .order(EXPERIMENT_RUNS.COLUMNS.updated_at, { ascending: false })
                .limit(options.limit ?? DEFAULT_LIMIT);

            if (options.includeSummaryOnly === false) {
                query = query.eq(EXPERIMENT_RUNS.COLUMNS.summary_only, false);
            }
            if (options.statuses?.length) {
                query = query.in(EXPERIMENT_RUNS.COLUMNS.status, options.statuses);
            }

            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to list experiment runs: ${error.message}`);
            }

            return (data ?? []).map((row) => mapExperimentRun(asRecord(row)));
        },

        async getExperimentRun(tenantId, runId) {
            const { data, error } = await client
                .from(EXPERIMENT_RUNS.TABLE)
                .select('*')
                .eq(EXPERIMENT_RUNS.COLUMNS.tenant_id, tenantId)
                .eq(EXPERIMENT_RUNS.COLUMNS.run_id, runId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to load experiment run: ${error.message}`);
            }

            return data ? mapExperimentRun(asRecord(data)) : null;
        },

        async createExperimentRun(record) {
            const { data, error } = await client
                .from(EXPERIMENT_RUNS.TABLE)
                .insert(record)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create experiment run: ${error?.message ?? 'Unknown error'}`);
            }

            return mapExperimentRun(asRecord(data));
        },

        async updateExperimentRun(runId, tenantId, patch) {
            const { data, error } = await client
                .from(EXPERIMENT_RUNS.TABLE)
                .update(patch)
                .eq(EXPERIMENT_RUNS.COLUMNS.tenant_id, tenantId)
                .eq(EXPERIMENT_RUNS.COLUMNS.run_id, runId)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to update experiment run: ${error?.message ?? 'Unknown error'}`);
            }

            return mapExperimentRun(asRecord(data));
        },

        async listExperimentMetrics(tenantId, runId, limit = 1_000) {
            const { data, error } = await client
                .from(EXPERIMENT_METRICS.TABLE)
                .select('*')
                .eq(EXPERIMENT_METRICS.COLUMNS.tenant_id, tenantId)
                .eq(EXPERIMENT_METRICS.COLUMNS.run_id, runId)
                .order(EXPERIMENT_METRICS.COLUMNS.metric_timestamp, { ascending: true })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list experiment metrics: ${error.message}`);
            }

            return (data ?? []).map((row) => mapExperimentMetric(asRecord(row)));
        },

        async createExperimentMetrics(records) {
            if (records.length === 0) return [];

            const { data, error } = await client
                .from(EXPERIMENT_METRICS.TABLE)
                .insert(records)
                .select('*');

            if (error) {
                throw new Error(`Failed to create experiment metrics: ${error.message}`);
            }

            return (data ?? []).map((row) => mapExperimentMetric(asRecord(row)));
        },

        async listExperimentArtifacts(tenantId, runId) {
            const { data, error } = await client
                .from(EXPERIMENT_ARTIFACTS.TABLE)
                .select('*')
                .eq(EXPERIMENT_ARTIFACTS.COLUMNS.tenant_id, tenantId)
                .eq(EXPERIMENT_ARTIFACTS.COLUMNS.run_id, runId)
                .order(EXPERIMENT_ARTIFACTS.COLUMNS.created_at, { ascending: true });

            if (error) {
                throw new Error(`Failed to list experiment artifacts: ${error.message}`);
            }

            return (data ?? []).map((row) => mapExperimentArtifact(asRecord(row)));
        },

        async upsertExperimentArtifact(record) {
            const operation = record.id
                ? client
                    .from(EXPERIMENT_ARTIFACTS.TABLE)
                    .update(stripUndefined(record))
                    .eq(EXPERIMENT_ARTIFACTS.COLUMNS.id, record.id)
                : client.from(EXPERIMENT_ARTIFACTS.TABLE).insert(stripUndefined(record));

            const { data, error } = await operation.select('*').single();

            if (error || !data) {
                throw new Error(`Failed to upsert experiment artifact: ${error?.message ?? 'Unknown error'}`);
            }

            return mapExperimentArtifact(asRecord(data));
        },

        async getExperimentFailure(tenantId, runId) {
            const { data, error } = await client
                .from(EXPERIMENT_FAILURES.TABLE)
                .select('*')
                .eq(EXPERIMENT_FAILURES.COLUMNS.tenant_id, tenantId)
                .eq(EXPERIMENT_FAILURES.COLUMNS.run_id, runId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to load experiment failure: ${error.message}`);
            }

            return data ? mapExperimentFailure(asRecord(data)) : null;
        },

        async upsertExperimentFailure(record) {
            const { data, error } = await client
                .from(EXPERIMENT_FAILURES.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${EXPERIMENT_FAILURES.COLUMNS.tenant_id},${EXPERIMENT_FAILURES.COLUMNS.run_id}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert experiment failure: ${error?.message ?? 'Unknown error'}`);
            }

            return mapExperimentFailure(asRecord(data));
        },

        async listExperimentBenchmarks(tenantId, runId) {
            const { data, error } = await client
                .from(EXPERIMENT_BENCHMARKS.TABLE)
                .select('*')
                .eq(EXPERIMENT_BENCHMARKS.COLUMNS.tenant_id, tenantId)
                .eq(EXPERIMENT_BENCHMARKS.COLUMNS.run_id, runId)
                .order(EXPERIMENT_BENCHMARKS.COLUMNS.created_at, { ascending: false });

            if (error) {
                throw new Error(`Failed to list experiment benchmarks: ${error.message}`);
            }

            return (data ?? []).map((row) => mapExperimentBenchmark(asRecord(row)));
        },

        async upsertExperimentBenchmark(record) {
            const { data, error } = await client
                .from(EXPERIMENT_BENCHMARKS.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${EXPERIMENT_BENCHMARKS.COLUMNS.tenant_id},${EXPERIMENT_BENCHMARKS.COLUMNS.run_id},${EXPERIMENT_BENCHMARKS.COLUMNS.benchmark_family}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert experiment benchmark: ${error?.message ?? 'Unknown error'}`);
            }

            return mapExperimentBenchmark(asRecord(data));
        },

        async getExperimentRegistryLink(tenantId, runId) {
            const { data, error } = await client
                .from(EXPERIMENT_REGISTRY_LINKS.TABLE)
                .select('*')
                .eq(EXPERIMENT_REGISTRY_LINKS.COLUMNS.tenant_id, tenantId)
                .eq(EXPERIMENT_REGISTRY_LINKS.COLUMNS.run_id, runId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to load experiment registry link: ${error.message}`);
            }

            return data ? mapExperimentRegistryLink(asRecord(data)) : null;
        },

        async upsertExperimentRegistryLink(record) {
            const { data, error } = await client
                .from(EXPERIMENT_REGISTRY_LINKS.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${EXPERIMENT_REGISTRY_LINKS.COLUMNS.tenant_id},${EXPERIMENT_REGISTRY_LINKS.COLUMNS.run_id}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert experiment registry link: ${error?.message ?? 'Unknown error'}`);
            }

            return mapExperimentRegistryLink(asRecord(data));
        },

        async listModelRegistry(tenantId) {
            const { data, error } = await client
                .from(MODEL_REGISTRY.TABLE)
                .select('*')
                .eq(MODEL_REGISTRY.COLUMNS.tenant_id, tenantId)
                .order(MODEL_REGISTRY.COLUMNS.model_family, { ascending: true })
                .order(MODEL_REGISTRY.COLUMNS.updated_at, { ascending: false });

            if (error) {
                throw new Error(`Failed to list model registry records: ${error.message}`);
            }

            return (data ?? []).map((row) => mapModelRegistry(asRecord(row)));
        },

        async getModelRegistryForRun(tenantId, runId) {
            const { data, error } = await client
                .from(MODEL_REGISTRY.TABLE)
                .select('*')
                .eq(MODEL_REGISTRY.COLUMNS.tenant_id, tenantId)
                .eq(MODEL_REGISTRY.COLUMNS.run_id, runId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to load model registry record: ${error.message}`);
            }

            return data ? mapModelRegistry(asRecord(data)) : null;
        },

        async upsertModelRegistry(record) {
            const normalizedRecord = {
                ...record,
                clinical_metrics: record.clinical_metrics ?? {},
                lineage: record.lineage ?? {},
                rollback_metadata: record.rollback_metadata ?? {},
            };
            const { data, error } = await client
                .from(MODEL_REGISTRY.TABLE)
                .upsert(stripUndefined(normalizedRecord), {
                    onConflict: `${MODEL_REGISTRY.COLUMNS.registry_id}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert model registry record: ${error?.message ?? 'Unknown error'}`);
            }

            return mapModelRegistry(asRecord(data));
        },

        async getPromotionRequirements(tenantId, runId) {
            const { data, error } = await client
                .from(PROMOTION_REQUIREMENTS.TABLE)
                .select('*')
                .eq(PROMOTION_REQUIREMENTS.COLUMNS.tenant_id, tenantId)
                .eq(PROMOTION_REQUIREMENTS.COLUMNS.run_id, runId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to load promotion requirements: ${error.message}`);
            }

            return data ? mapPromotionRequirements(asRecord(data)) : null;
        },

        async listPromotionRequirements(tenantId) {
            const { data, error } = await client
                .from(PROMOTION_REQUIREMENTS.TABLE)
                .select('*')
                .eq(PROMOTION_REQUIREMENTS.COLUMNS.tenant_id, tenantId)
                .order(PROMOTION_REQUIREMENTS.COLUMNS.updated_at, { ascending: false });

            if (error) {
                throw new Error(`Failed to list promotion requirements: ${error.message}`);
            }

            return (data ?? []).map((row) => mapPromotionRequirements(asRecord(row)));
        },

        async upsertPromotionRequirements(record) {
            const { data, error } = await client
                .from(PROMOTION_REQUIREMENTS.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${PROMOTION_REQUIREMENTS.COLUMNS.tenant_id},${PROMOTION_REQUIREMENTS.COLUMNS.registry_id}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert promotion requirements: ${error?.message ?? 'Unknown error'}`);
            }

            return mapPromotionRequirements(asRecord(data));
        },

        async getCalibrationMetrics(tenantId, runId) {
            const { data, error } = await client
                .from(CALIBRATION_METRICS.TABLE)
                .select('*')
                .eq(CALIBRATION_METRICS.COLUMNS.tenant_id, tenantId)
                .eq(CALIBRATION_METRICS.COLUMNS.run_id, runId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to load calibration metrics: ${error.message}`);
            }

            return data ? mapCalibrationMetrics(asRecord(data)) : null;
        },

        async upsertCalibrationMetrics(record) {
            const { data, error } = await client
                .from(CALIBRATION_METRICS.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${CALIBRATION_METRICS.COLUMNS.tenant_id},${CALIBRATION_METRICS.COLUMNS.run_id}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert calibration metrics: ${error?.message ?? 'Unknown error'}`);
            }

            return mapCalibrationMetrics(asRecord(data));
        },

        async getAdversarialMetrics(tenantId, runId) {
            const { data, error } = await client
                .from(ADVERSARIAL_METRICS.TABLE)
                .select('*')
                .eq(ADVERSARIAL_METRICS.COLUMNS.tenant_id, tenantId)
                .eq(ADVERSARIAL_METRICS.COLUMNS.run_id, runId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to load adversarial metrics: ${error.message}`);
            }

            return data ? mapAdversarialMetrics(asRecord(data)) : null;
        },

        async upsertAdversarialMetrics(record) {
            const { data, error } = await client
                .from(ADVERSARIAL_METRICS.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${ADVERSARIAL_METRICS.COLUMNS.tenant_id},${ADVERSARIAL_METRICS.COLUMNS.run_id}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert adversarial metrics: ${error?.message ?? 'Unknown error'}`);
            }

            return mapAdversarialMetrics(asRecord(data));
        },

        async getDeploymentDecision(tenantId, runId) {
            const { data, error } = await client
                .from(DEPLOYMENT_DECISIONS.TABLE)
                .select('*')
                .eq(DEPLOYMENT_DECISIONS.COLUMNS.tenant_id, tenantId)
                .eq(DEPLOYMENT_DECISIONS.COLUMNS.run_id, runId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to load deployment decision: ${error.message}`);
            }

            return data ? mapDeploymentDecision(asRecord(data)) : null;
        },

        async upsertDeploymentDecision(record) {
            const { data, error } = await client
                .from(DEPLOYMENT_DECISIONS.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${DEPLOYMENT_DECISIONS.COLUMNS.tenant_id},${DEPLOYMENT_DECISIONS.COLUMNS.run_id}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert deployment decision: ${error?.message ?? 'Unknown error'}`);
            }

            return mapDeploymentDecision(asRecord(data));
        },

        async listSubgroupMetrics(tenantId, runId) {
            const { data, error } = await client
                .from(SUBGROUP_METRICS.TABLE)
                .select('*')
                .eq(SUBGROUP_METRICS.COLUMNS.tenant_id, tenantId)
                .eq(SUBGROUP_METRICS.COLUMNS.run_id, runId)
                .order(SUBGROUP_METRICS.COLUMNS.group, { ascending: true });

            if (error) {
                throw new Error(`Failed to list subgroup metrics: ${error.message}`);
            }

            return (data ?? []).map((row) => mapSubgroupMetric(asRecord(row)));
        },

        async upsertSubgroupMetric(record) {
            const { data, error } = await client
                .from(SUBGROUP_METRICS.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${SUBGROUP_METRICS.COLUMNS.tenant_id},${SUBGROUP_METRICS.COLUMNS.run_id},${SUBGROUP_METRICS.COLUMNS.group},${SUBGROUP_METRICS.COLUMNS.group_value},${SUBGROUP_METRICS.COLUMNS.metric}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert subgroup metric: ${error?.message ?? 'Unknown error'}`);
            }

            return mapSubgroupMetric(asRecord(data));
        },

        async listAuditLog(tenantId, limit = 200) {
            const { data, error } = await client
                .from(AUDIT_LOG.TABLE)
                .select('*')
                .eq(AUDIT_LOG.COLUMNS.tenant_id, tenantId)
                .order(AUDIT_LOG.COLUMNS.timestamp, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list experiment audit log: ${error.message}`);
            }

            return (data ?? []).map((row) => mapAuditLog(asRecord(row)));
        },

        async createAuditLog(record) {
            const timestamp = new Date().toISOString();
            const insertPayload = {
                event_id: record.event_id,
                tenant_id: record.tenant_id,
                run_id: record.run_id,
                event_type: record.event_type,
                actor: record.actor,
                metadata: record.payload,
                timestamp,
            };

            // audit_log is append-only (UPDATE/DELETE blocked by DB trigger).
            // Use insert; if a duplicate event_id exists, fetch the existing row.
            const { data, error } = await client
                .from(AUDIT_LOG.TABLE)
                .insert(insertPayload)
                .select('*')
                .single();

            if (error) {
                // Duplicate key → row already exists, fetch it instead of crashing
                if (error.code === '23505') {
                    const { data: existing, error: fetchError } = await client
                        .from(AUDIT_LOG.TABLE)
                        .select('*')
                        .eq(AUDIT_LOG.COLUMNS.event_id, record.event_id)
                        .single();

                    if (fetchError || !existing) {
                        throw new Error(`Failed to retrieve existing audit log event: ${fetchError?.message ?? 'Unknown error'}`);
                    }

                    return mapAuditLog(asRecord(existing));
                }

                throw new Error(`Failed to create experiment audit log event: ${error.message}`);
            }

            return mapAuditLog(asRecord(data));
        },

        async listRegistryAuditLog(tenantId, limit = 200) {
            const { data, error } = await client
                .from(REGISTRY_AUDIT_LOG.TABLE)
                .select('*')
                .eq(REGISTRY_AUDIT_LOG.COLUMNS.tenant_id, tenantId)
                .order(REGISTRY_AUDIT_LOG.COLUMNS.timestamp, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list registry audit log: ${error.message}`);
            }

            return (data ?? []).map((row) => mapRegistryAuditLog(asRecord(row)));
        },

        async createRegistryAuditLog(record) {
            const { data, error } = await client
                .from(REGISTRY_AUDIT_LOG.TABLE)
                .upsert({
                    event_id: record.event_id,
                    tenant_id: record.tenant_id,
                    registry_id: record.registry_id,
                    run_id: record.run_id,
                    event_type: record.event_type,
                    actor: record.actor,
                    metadata: record.metadata,
                    timestamp: record.timestamp,
                }, {
                    onConflict: `${REGISTRY_AUDIT_LOG.COLUMNS.event_id}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create registry audit log event: ${error?.message ?? 'Unknown error'}`);
            }

            return mapRegistryAuditLog(asRecord(data));
        },

        async listRegistryRoutingPointers(tenantId) {
            const { data, error } = await client
                .from(MODEL_REGISTRY_ROUTING.TABLE)
                .select('*')
                .eq(MODEL_REGISTRY_ROUTING.COLUMNS.tenant_id, tenantId)
                .order(MODEL_REGISTRY_ROUTING.COLUMNS.model_family, { ascending: true });

            if (error) {
                throw new Error(`Failed to list registry routing pointers: ${error.message}`);
            }

            return (data ?? []).map((row) => mapRegistryRoutingPointer(asRecord(row)));
        },

        async upsertRegistryRoutingPointer(record) {
            const { data, error } = await client
                .from(MODEL_REGISTRY_ROUTING.TABLE)
                .upsert(stripUndefined(record), {
                    onConflict: `${MODEL_REGISTRY_ROUTING.COLUMNS.tenant_id},${MODEL_REGISTRY_ROUTING.COLUMNS.model_family}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert registry routing pointer: ${error?.message ?? 'Unknown error'}`);
            }

            return mapRegistryRoutingPointer(asRecord(data));
        },

        async promoteRegistryToProduction({ tenantId, runId, actor }) {
            const { data, error } = await client.rpc('promote_registry_model_to_production' as never, {
                p_tenant_id: tenantId,
                p_run_id: runId,
                p_actor: actor,
            });

            const row = Array.isArray(data) ? data[0] : data;
            if (error || !row) {
                throw new Error(`Failed to promote registry record to production: ${error?.message ?? 'Unknown error'}`);
            }

            return mapModelRegistry(asRecord(row));
        },

        async rollbackRegistryToTarget({ tenantId, runId, actor, reason, incidentId }) {
            const { data, error } = await client.rpc('rollback_registry_model_to_target' as never, {
                p_tenant_id: tenantId,
                p_run_id: runId,
                p_actor: actor,
                p_reason: reason,
                p_incident_id: incidentId ?? null,
            });

            const row = Array.isArray(data) ? data[0] : data;
            if (error || !row) {
                throw new Error(`Failed to roll back registry record: ${error?.message ?? 'Unknown error'}`);
            }

            return mapModelRegistry(asRecord(row));
        },

        async listModelRegistryEntries(tenantId) {
            const { data, error } = await client
                .from(MODEL_REGISTRY_ENTRIES.TABLE)
                .select('*')
                .eq(MODEL_REGISTRY_ENTRIES.COLUMNS.tenant_id, tenantId)
                .order(MODEL_REGISTRY_ENTRIES.COLUMNS.updated_at, { ascending: false });

            if (error) {
                throw new Error(`Failed to list model registry entries for experiments: ${error.message}`);
            }

            return (data ?? []).map((row) => mapRegistryEntry(asRecord(row)));
        },

        async listLearningDatasetVersions(tenantId, limit = 100) {
            const { data, error } = await client
                .from(LEARNING_DATASET_VERSIONS.TABLE)
                .select('*')
                .eq(LEARNING_DATASET_VERSIONS.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_DATASET_VERSIONS.COLUMNS.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list learning dataset versions for experiments: ${error.message}`);
            }

            return (data ?? []).map((row) => ({
                id: String(row.id),
                dataset_version: String(row.dataset_version),
                dataset_kind: String(row.dataset_kind),
                row_count: readNumber(row.row_count) ?? 0,
                summary: asRecord(row.summary),
                created_at: String(row.created_at),
            }));
        },

        async listLearningBenchmarkReports(tenantId, limit = 200) {
            const { data, error } = await client
                .from(LEARNING_BENCHMARK_REPORTS.TABLE)
                .select('*')
                .eq(LEARNING_BENCHMARK_REPORTS.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_BENCHMARK_REPORTS.COLUMNS.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list learning benchmark reports for experiments: ${error.message}`);
            }

            return (data ?? []).map((row) => ({
                id: String(row.id),
                model_registry_id: readString(row.model_registry_id),
                benchmark_family: String(row.benchmark_family),
                task_type: String(row.task_type),
                summary_score: readNumber(row.summary_score),
                pass_status: String(row.pass_status),
                report_payload: asRecord(row.report_payload),
                created_at: String(row.created_at),
            }));
        },

        async listLearningCalibrationReports(tenantId, limit = 200) {
            const { data, error } = await client
                .from(LEARNING_CALIBRATION_REPORTS.TABLE)
                .select('*')
                .eq(LEARNING_CALIBRATION_REPORTS.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_CALIBRATION_REPORTS.COLUMNS.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list learning calibration reports for experiments: ${error.message}`);
            }

            return (data ?? []).map((row) => ({
                id: String(row.id),
                model_registry_id: readString(row.model_registry_id),
                task_type: String(row.task_type),
                brier_score: readNumber(row.brier_score),
                ece_score: readNumber(row.ece_score),
                report_payload: asRecord(row.report_payload),
                created_at: String(row.created_at),
            }));
        },

        async listLearningAuditEvents(tenantId, limit = 200) {
            const { data, error } = await client
                .from(LEARNING_AUDIT_EVENTS.TABLE)
                .select('*')
                .eq(LEARNING_AUDIT_EVENTS.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_AUDIT_EVENTS.COLUMNS.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list learning audit events for experiments: ${error.message}`);
            }

            return (data ?? []).map((row) => ({
                id: String(row.id),
                event_type: String(row.event_type),
                event_payload: asRecord(row.event_payload),
                created_at: String(row.created_at),
            }));
        },
    };
}

function mapExperimentRun(row: Record<string, unknown>): ExperimentRunRecord {
    const registryContext = asRecord(row.registry_context);
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        experiment_group_id: readString(row.experiment_group_id),
        sweep_id: readString(row.sweep_id),
        parent_run_id: readString(row.parent_run_id),
        baseline_run_id: readString(row.baseline_run_id),
        task_type: String(row.task_type) as ExperimentRunRecord['task_type'],
        modality: String(row.modality) as ExperimentRunRecord['modality'],
        target_type: readString(row.target_type),
        model_arch: readString(row.model_arch) ?? 'Unknown architecture',
        model_size: readString(row.model_size),
        model_version: readString(row.model_version),
        registry_id: readString(row.registry_id),
        dataset_name: readString(row.dataset_name) ?? 'Unknown dataset',
        dataset_version: readString(row.dataset_version),
        feature_schema_version: readString(row.feature_schema_version),
        label_policy_version: readString(row.label_policy_version),
        epochs_planned: readNumber(row.epochs_planned),
        epochs_completed: readNumber(row.epochs_completed),
        metric_primary_name: readString(row.metric_primary_name),
        metric_primary_value: readNumber(row.metric_primary_value),
        status: normalizeExperimentRunStatus(row.status, registryContext),
        status_reason: readString(row.status_reason),
        progress_percent: readNumber(row.progress_percent),
        summary_only: row.summary_only === true,
        created_by: readString(row.created_by),
        hyperparameters: asRecord(row.hyperparameters),
        dataset_lineage: asRecord(row.dataset_lineage),
        config_snapshot: asRecord(row.config_snapshot),
        safety_metrics: asRecord(row.safety_metrics),
        resource_usage: asRecord(row.resource_usage),
        registry_context: registryContext,
        last_heartbeat_at: readString(row.last_heartbeat_at),
        started_at: readString(row.started_at),
        ended_at: readString(row.ended_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapExperimentMetric(row: Record<string, unknown>): ExperimentMetricRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        epoch: readNumber(row.epoch),
        global_step: readNumber(row.global_step),
        train_loss: readNumber(row.train_loss),
        val_loss: readNumber(row.val_loss),
        train_accuracy: readNumber(row.train_accuracy),
        val_accuracy: readNumber(row.val_accuracy),
        learning_rate: readNumber(row.learning_rate),
        gradient_norm: readNumber(row.gradient_norm),
        macro_f1: readNumber(row.macro_f1),
        recall_critical: readNumber(row.recall_critical),
        calibration_error: readNumber(row.calibration_error),
        adversarial_score: readNumber(row.adversarial_score),
        false_negative_critical_rate: readNumber(row.false_negative_critical_rate),
        dangerous_false_reassurance_rate: readNumber(row.dangerous_false_reassurance_rate),
        abstain_accuracy: readNumber(row.abstain_accuracy),
        contradiction_detection_rate: readNumber(row.contradiction_detection_rate),
        wall_clock_time_seconds: readNumber(row.wall_clock_time_seconds),
        steps_per_second: readNumber(row.steps_per_second),
        gpu_utilization: readNumber(row.gpu_utilization),
        cpu_utilization: readNumber(row.cpu_utilization),
        memory_utilization: readNumber(row.memory_utilization),
        metric_timestamp: String(row.metric_timestamp),
        created_at: String(row.created_at),
    };
}

function mapExperimentArtifact(row: Record<string, unknown>): ExperimentArtifactRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        artifact_type: readString(row.artifact_type) ?? 'artifact',
        label: readString(row.label),
        uri: readString(row.uri),
        metadata: asRecord(row.metadata),
        is_primary: row.is_primary === true,
        created_at: String(row.created_at),
    };
}

function mapExperimentFailure(row: Record<string, unknown>): ExperimentFailureRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        failure_reason: readString(row.failure_reason) ?? 'unknown_failure',
        failure_epoch: readNumber(row.failure_epoch),
        failure_step: readNumber(row.failure_step),
        last_train_loss: readNumber(row.last_train_loss),
        last_val_loss: readNumber(row.last_val_loss),
        last_learning_rate: readNumber(row.last_learning_rate),
        last_gradient_norm: readNumber(row.last_gradient_norm),
        nan_detected: row.nan_detected === true,
        checkpoint_recovery_attempted: row.checkpoint_recovery_attempted === true,
        stack_trace_excerpt: readString(row.stack_trace_excerpt),
        error_summary: readString(row.error_summary),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapExperimentBenchmark(row: Record<string, unknown>): ExperimentBenchmarkRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        benchmark_family: readString(row.benchmark_family) ?? 'benchmark',
        task_type: readString(row.task_type) ?? 'unknown',
        summary_score: readNumber(row.summary_score),
        pass_status: readString(row.pass_status) ?? 'unknown',
        report_payload: asRecord(row.report_payload),
        created_at: String(row.created_at),
    };
}

function mapExperimentRegistryLink(row: Record<string, unknown>): ExperimentRegistryLinkRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        model_registry_entry_id: readString(row.model_registry_entry_id),
        registry_candidate_id: readString(row.registry_candidate_id),
        champion_or_challenger: readString(row.champion_or_challenger) as ExperimentRegistryLinkRecord['champion_or_challenger'],
        promotion_status: readString(row.promotion_status),
        calibration_status: readString(row.calibration_status),
        adversarial_gate_status: readString(row.adversarial_gate_status),
        benchmark_status: readString(row.benchmark_status),
        manual_approval_status: readString(row.manual_approval_status),
        deployment_eligibility: readString(row.deployment_eligibility),
        linked_at: String(row.linked_at),
        updated_at: String(row.updated_at),
    };
}

function mapModelRegistry(row: Record<string, unknown>): ModelRegistryRecord {
    const lifecycleStatus = (readString(row.lifecycle_status) ?? readString(row.status) ?? 'candidate') as ModelRegistryRecord['lifecycle_status'];
    const registryRole = (readString(row.registry_role) ?? readString(row.role) ?? 'experimental') as ModelRegistryRecord['registry_role'];
    return {
        registry_id: String(row.registry_id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        model_name: readString(row.model_name) ?? readString(row.model_version) ?? 'unknown_model',
        model_version: readString(row.model_version) ?? 'unknown_model_version',
        model_family: (readString(row.model_family) ?? 'diagnostics') as ModelRegistryRecord['model_family'],
        artifact_uri: readString(row.artifact_uri) ?? readString(row.artifact_path),
        dataset_version: readString(row.dataset_version),
        feature_schema_version: readString(row.feature_schema_version),
        label_policy_version: readString(row.label_policy_version),
        lifecycle_status: lifecycleStatus,
        registry_role: registryRole,
        deployed_at: readString(row.deployed_at),
        archived_at: readString(row.archived_at),
        promoted_from: readString(row.promoted_from),
        rollback_target: readString(row.rollback_target),
        clinical_metrics: asClinicalMetricsRecord(row.clinical_metrics),
        lineage: asRegistryLineageRecord(row.lineage, String(row.run_id)),
        rollback_metadata: asRollbackMetadataRecord(row.rollback_metadata),
        artifact_path: readString(row.artifact_path) ?? readString(row.artifact_uri),
        blocked: row.blocked === true,
        block_reason: readString(row.block_reason),
        blocked_at: readString(row.blocked_at),
        blocked_by_simulation_id: readString(row.blocked_by_simulation_id),
        status: lifecycleStatus,
        role: registryRole,
        created_at: String(row.created_at),
        created_by: readString(row.created_by),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapCalibrationMetrics(row: Record<string, unknown>): CalibrationMetricRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        ece: readNumber(row.ece),
        brier_score: readNumber(row.brier_score),
        reliability_bins: Array.isArray(row.reliability_bins)
            ? row.reliability_bins.map((entry) => asReliabilityBin(entry)).filter(Boolean) as CalibrationMetricRecord['reliability_bins']
            : [],
        confidence_histogram: Array.isArray(row.confidence_histogram)
            ? row.confidence_histogram.map((entry) => asConfidenceHistogramBin(entry)).filter(Boolean) as CalibrationMetricRecord['confidence_histogram']
            : [],
        calibration_pass: typeof row.calibration_pass === 'boolean' ? row.calibration_pass : null,
        calibration_notes: readString(row.calibration_notes),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapAdversarialMetrics(row: Record<string, unknown>): AdversarialMetricRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        degradation_score: readNumber(row.degradation_score),
        contradiction_robustness: readNumber(row.contradiction_robustness),
        critical_case_recall: readNumber(row.critical_case_recall),
        false_reassurance_rate: readNumber(row.false_reassurance_rate),
        dangerous_false_reassurance_rate: readNumber(row.dangerous_false_reassurance_rate) ?? readNumber(row.false_reassurance_rate),
        adversarial_pass: typeof row.adversarial_pass === 'boolean' ? row.adversarial_pass : null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapDeploymentDecision(row: Record<string, unknown>): DeploymentDecisionRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        decision: (readString(row.decision) ?? 'pending') as DeploymentDecisionRecord['decision'],
        reason: readString(row.reason),
        calibration_pass: typeof row.calibration_pass === 'boolean' ? row.calibration_pass : null,
        adversarial_pass: typeof row.adversarial_pass === 'boolean' ? row.adversarial_pass : null,
        safety_pass: typeof row.safety_pass === 'boolean' ? row.safety_pass : null,
        benchmark_pass: typeof row.benchmark_pass === 'boolean' ? row.benchmark_pass : null,
        manual_approval: typeof row.manual_approval === 'boolean' ? row.manual_approval : null,
        approved_by: readString(row.approved_by),
        timestamp: String(row.timestamp ?? row.created_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapPromotionRequirements(row: Record<string, unknown>): PromotionRequirementsRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        registry_id: String(row.registry_id),
        run_id: String(row.run_id),
        calibration_pass: typeof row.calibration_pass === 'boolean' ? row.calibration_pass : null,
        adversarial_pass: typeof row.adversarial_pass === 'boolean' ? row.adversarial_pass : null,
        safety_pass: typeof row.safety_pass === 'boolean' ? row.safety_pass : null,
        benchmark_pass: typeof row.benchmark_pass === 'boolean' ? row.benchmark_pass : null,
        manual_approval: typeof row.manual_approval === 'boolean' ? row.manual_approval : null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapRegistryAuditLog(row: Record<string, unknown>): RegistryAuditLogRecord {
    return {
        event_id: String(row.event_id),
        tenant_id: String(row.tenant_id),
        registry_id: String(row.registry_id),
        run_id: readString(row.run_id),
        event_type: readString(row.event_type) ?? 'unknown_event',
        timestamp: String(row.timestamp ?? row.created_at),
        actor: readString(row.actor),
        metadata: asRecord(row.metadata),
        created_at: String(row.created_at ?? row.timestamp),
    };
}

function mapRegistryRoutingPointer(row: Record<string, unknown>): RegistryRoutingPointerRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        model_family: (readString(row.model_family) ?? 'diagnostics') as RegistryRoutingPointerRecord['model_family'],
        active_registry_id: readString(row.active_registry_id),
        active_run_id: readString(row.active_run_id),
        updated_at: String(row.updated_at ?? row.created_at),
        updated_by: readString(row.updated_by),
    };
}

function mapSubgroupMetric(row: Record<string, unknown>): SubgroupMetricRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        run_id: String(row.run_id),
        group: readString(row.group) ?? 'unknown_group',
        group_value: readString(row.group_value) ?? 'unknown_value',
        metric: readString(row.metric) ?? 'unknown_metric',
        value: readNumber(row.value) ?? 0,
        created_at: String(row.created_at),
    };
}

function mapAuditLog(row: Record<string, unknown>): ExperimentAuditEventRecord {
    return {
        event_id: String(row.event_id),
        tenant_id: String(row.tenant_id),
        run_id: readString(row.run_id),
        event_type: readString(row.event_type) ?? 'unknown_event',
        actor: readString(row.actor),
        created_at: String(row.timestamp ?? row.created_at),
        payload: asRecord(row.metadata),
    };
}

function mapRegistryEntry(row: Record<string, unknown>) {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        model_name: readString(row.model_name) ?? 'unknown_model',
        model_version: readString(row.model_version) ?? 'unknown_version',
        task_type: readString(row.task_type) ?? 'diagnosis',
        training_dataset_version: readString(row.training_dataset_version) ?? 'unknown_dataset_version',
        feature_schema_version: readString(row.feature_schema_version) ?? 'unknown_feature_schema',
        label_policy_version: readString(row.label_policy_version) ?? 'unknown_label_policy',
        artifact_payload: asRecord(row.artifact_payload),
        benchmark_scorecard: asRecord(row.benchmark_scorecard),
        calibration_report_id: readString(row.calibration_report_id),
        promotion_status: readString(row.promotion_status) ?? 'candidate',
        is_champion: row.is_champion === true,
        latency_profile: readNullableRecord(row.latency_profile),
        resource_profile: readNullableRecord(row.resource_profile),
        parent_model_version: readString(row.parent_model_version),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readNullableRecord(value: unknown): Record<string, unknown> | null {
    const record = asRecord(value);
    return Object.keys(record).length > 0 ? record : null;
}

function readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeExperimentRunStatus(
    value: unknown,
    registryContext: Record<string, unknown>,
): ExperimentRunRecord['status'] {
    const raw = readString(value)?.toLowerCase();
    const registryRole = readString(registryContext.registry_role)?.toLowerCase();
    const registryStatus = readString(registryContext.registry_status ?? registryContext.promotion_status)?.toLowerCase();

    if (raw === 'rolled_back' || raw === 'rollback' || raw === 'rolledback') return 'rolled_back';
    if (raw === 'promoted' || raw === 'production' || raw === 'deployed' || raw === 'live') return 'promoted';
    if (raw === 'completed' || raw === 'complete' || raw === 'completed_successfully' || raw === 'succeeded' || raw === 'success' || raw === 'done' || raw === 'finished' || raw === 'ready' || raw === 'staging' || raw === 'candidate' || raw === 'archived') {
        return registryStatus === 'production' && registryRole === 'champion' ? 'promoted' : 'completed';
    }
    if (raw === 'failed' || raw === 'error' || raw === 'errored') return 'failed';
    if (raw === 'aborted' || raw === 'canceled' || raw === 'cancelled' || raw === 'terminated') return 'aborted';
    if (raw === 'queued' || raw === 'pending' || raw === 'scheduled') return 'queued';
    if (raw === 'initializing' || raw === 'starting' || raw === 'booting') return 'initializing';
    if (raw === 'training' || raw === 'running' || raw === 'in_progress' || raw === 'active') return 'training';
    if (raw === 'validating' || raw === 'evaluation' || raw === 'evaluating') return 'validating';
    if (raw === 'checkpointing' || raw === 'saving') return 'checkpointing';
    if (raw === 'stalled' || raw === 'paused') return 'stalled';
    if (raw === 'interrupted') return 'interrupted';

    if (registryStatus === 'production' && registryRole === 'champion') return 'promoted';
    if (registryStatus === 'staging' || registryRole === 'challenger' || registryRole === 'rollback_target') return 'completed';
    return 'queued';
}

function asReliabilityBin(value: unknown): CalibrationMetricRecord['reliability_bins'][number] | null {
    const record = asRecord(value);
    const confidence = readNumber(record.confidence);
    const accuracy = readNumber(record.accuracy);
    const count = readNumber(record.count);
    if (confidence == null || accuracy == null) {
        return null;
    }
    return {
        confidence,
        accuracy,
        count: count ?? 0,
    };
}

function asConfidenceHistogramBin(value: unknown): CalibrationMetricRecord['confidence_histogram'][number] | null {
    if (!value || typeof value !== 'object') return null;
    const entry = value as Record<string, unknown>;
    const confidence = readNumber(entry.confidence);
    const count = readNumber(entry.count);
    if (confidence == null || count == null) return null;
    return {
        confidence,
        count,
    };
}

function asClinicalMetricsRecord(value: unknown): ClinicalMetricsRecord {
    const record = asRecord(value);
    return {
        global_accuracy: readNumber(record.global_accuracy),
        macro_f1: readNumber(record.macro_f1),
        critical_recall: readNumber(record.critical_recall),
        false_reassurance_rate: readNumber(record.false_reassurance_rate),
        fn_critical_rate: readNumber(record.fn_critical_rate),
        ece: readNumber(record.ece),
        brier_score: readNumber(record.brier_score),
        adversarial_degradation: readNumber(record.adversarial_degradation),
        latency_p99: readNumber(record.latency_p99),
    };
}

function asRegistryLineageRecord(value: unknown, runId: string): RegistryLineageRecord {
    const record = asRecord(value);
    return {
        run_id: readString(record.run_id) ?? runId,
        experiment_group: readString(record.experiment_group),
        dataset_version: readString(record.dataset_version),
        benchmark_id: readString(record.benchmark_id),
        calibration_report_uri: readString(record.calibration_report_uri),
        adversarial_report_uri: readString(record.adversarial_report_uri),
    };
}

function asRollbackMetadataRecord(value: unknown): RollbackMetadataRecord | null {
    const record = asRecord(value);
    const triggeredAt = readString(record.triggered_at);
    const reason = readString(record.reason);
    if (!triggeredAt || !reason) {
        return null;
    }

    return {
        triggered_at: triggeredAt,
        triggered_by: readString(record.triggered_by),
        reason,
        incident_id: readString(record.incident_id),
    };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as T;
}
