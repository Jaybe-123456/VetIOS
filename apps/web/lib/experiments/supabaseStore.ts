import type { SupabaseClient } from '@supabase/supabase-js';
import {
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
    MODEL_REGISTRY_ENTRIES,
} from '@/lib/db/schemaContracts';
import type {
    ExperimentArtifactRecord,
    ExperimentBenchmarkRecord,
    ExperimentFailureRecord,
    ExperimentMetricRecord,
    ExperimentRegistryLinkRecord,
    ExperimentRunRecord,
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
        dataset_name: readString(row.dataset_name) ?? 'Unknown dataset',
        dataset_version: readString(row.dataset_version),
        feature_schema_version: readString(row.feature_schema_version),
        label_policy_version: readString(row.label_policy_version),
        epochs_planned: readNumber(row.epochs_planned),
        epochs_completed: readNumber(row.epochs_completed),
        metric_primary_name: readString(row.metric_primary_name),
        metric_primary_value: readNumber(row.metric_primary_value),
        status: String(row.status) as ExperimentRunRecord['status'],
        status_reason: readString(row.status_reason),
        progress_percent: readNumber(row.progress_percent),
        summary_only: row.summary_only === true,
        created_by: readString(row.created_by),
        hyperparameters: asRecord(row.hyperparameters),
        dataset_lineage: asRecord(row.dataset_lineage),
        config_snapshot: asRecord(row.config_snapshot),
        safety_metrics: asRecord(row.safety_metrics),
        resource_usage: asRecord(row.resource_usage),
        registry_context: asRecord(row.registry_context),
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
        deployment_eligibility: readString(row.deployment_eligibility),
        linked_at: String(row.linked_at),
        updated_at: String(row.updated_at),
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

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as T;
}
