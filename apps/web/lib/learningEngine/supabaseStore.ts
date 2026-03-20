import type { SupabaseClient } from '@supabase/supabase-js';
import { mapClinicalCaseRow } from '@/lib/clinicalCases/clinicalCaseManager';
import {
    AI_INFERENCE_EVENTS,
    CLINICAL_CASES,
    CLINICAL_OUTCOME_EVENTS,
    EDGE_SIMULATION_EVENTS,
    LEARNING_AUDIT_EVENTS,
    LEARNING_BENCHMARK_REPORTS,
    LEARNING_CALIBRATION_REPORTS,
    LEARNING_CYCLES,
    LEARNING_DATASET_VERSIONS,
    LEARNING_ROLLBACK_EVENTS,
    LEARNING_SCHEDULER_JOBS,
    MODEL_EVALUATION_EVENTS,
    MODEL_REGISTRY_ENTRIES,
} from '@/lib/db/schemaContracts';
import {
    type LearningBenchmarkReportRecord,
    type LearningCalibrationReportRecord,
    type LearningCaseRecord,
    type LearningCycleRecord,
    type LearningDatasetFilters,
    type LearningDatasetVersionRecord,
    type LearningEngineStore,
    type LearningEvaluationEvent,
    type LearningInferenceEvent,
    type LearningOutcomeEvent,
    type LearningRollbackEventRecord,
    type LearningSchedulerJobRecord,
    type LearningSimulationEvent,
    type LearningTaskType,
    type LearningAuditEventRecord,
    type ModelRegistryEntryRecord,
} from '@/lib/learningEngine/types';

const DEFAULT_QUERY_LIMIT = 2_000;

export function createSupabaseLearningEngineStore(
    client: SupabaseClient,
): LearningEngineStore {
    return {
        async listClinicalCases(filters) {
            let query = client
                .from(CLINICAL_CASES.TABLE)
                .select('*')
                .eq(CLINICAL_CASES.COLUMNS.tenant_id, filters.tenantId)
                .order(CLINICAL_CASES.COLUMNS.updated_at, { ascending: false })
                .limit(filters.limit ?? DEFAULT_QUERY_LIMIT);

            query = applyCommonTimeframeFilters(query, CLINICAL_CASES.COLUMNS.updated_at, filters);

            if (filters.species?.length) {
                query = query.in(CLINICAL_CASES.COLUMNS.species_canonical, filters.species);
            }
            if (filters.caseClusters?.length) {
                query = query.in(CLINICAL_CASES.COLUMNS.case_cluster, filters.caseClusters);
            }
            if (filters.labelTypes?.length) {
                query = query.in(CLINICAL_CASES.COLUMNS.label_type, filters.labelTypes);
            }
            if (filters.includeAdversarial === false) {
                query = query.eq(CLINICAL_CASES.COLUMNS.adversarial_case, false);
            }

            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to list learning clinical cases: ${error.message}`);
            }

            return (data ?? []).map((row) => mapLearningCaseRecord(asRecord(row)));
        },

        async listInferenceEvents(filters) {
            let query = client
                .from(AI_INFERENCE_EVENTS.TABLE)
                .select('*')
                .eq(AI_INFERENCE_EVENTS.COLUMNS.tenant_id, filters.tenantId)
                .order(AI_INFERENCE_EVENTS.COLUMNS.created_at, { ascending: false })
                .limit(filters.limit ?? DEFAULT_QUERY_LIMIT);

            query = applyCommonTimeframeFilters(query, AI_INFERENCE_EVENTS.COLUMNS.created_at, filters);

            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to list learning inference events: ${error.message}`);
            }

            return (data ?? []).map((row) => mapInferenceEvent(asRecord(row)));
        },

        async listOutcomeEvents(filters) {
            let query = client
                .from(CLINICAL_OUTCOME_EVENTS.TABLE)
                .select('*')
                .eq(CLINICAL_OUTCOME_EVENTS.COLUMNS.tenant_id, filters.tenantId)
                .order(CLINICAL_OUTCOME_EVENTS.COLUMNS.outcome_timestamp, { ascending: false })
                .limit(filters.limit ?? DEFAULT_QUERY_LIMIT);

            query = applyCommonTimeframeFilters(query, CLINICAL_OUTCOME_EVENTS.COLUMNS.outcome_timestamp, filters);

            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to list learning outcome events: ${error.message}`);
            }

            return (data ?? []).map((row) => mapOutcomeEvent(asRecord(row)));
        },

        async listSimulationEvents(filters) {
            let query = client
                .from(EDGE_SIMULATION_EVENTS.TABLE)
                .select('*')
                .eq(EDGE_SIMULATION_EVENTS.COLUMNS.tenant_id, filters.tenantId)
                .order(EDGE_SIMULATION_EVENTS.COLUMNS.created_at, { ascending: false })
                .limit(filters.limit ?? DEFAULT_QUERY_LIMIT);

            query = applyCommonTimeframeFilters(query, EDGE_SIMULATION_EVENTS.COLUMNS.created_at, filters);

            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to list learning simulation events: ${error.message}`);
            }

            return (data ?? []).map((row) => mapSimulationEvent(asRecord(row)));
        },

        async listEvaluationEvents(filters) {
            let query = client
                .from(MODEL_EVALUATION_EVENTS.TABLE)
                .select('*')
                .eq(MODEL_EVALUATION_EVENTS.COLUMNS.tenant_id, filters.tenantId)
                .order(MODEL_EVALUATION_EVENTS.COLUMNS.created_at, { ascending: false })
                .limit(filters.limit ?? DEFAULT_QUERY_LIMIT);

            query = applyCommonTimeframeFilters(query, MODEL_EVALUATION_EVENTS.COLUMNS.created_at, filters);

            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to list learning evaluation events: ${error.message}`);
            }

            return (data ?? []).map((row) => mapEvaluationEvent(asRecord(row)));
        },

        async createDatasetVersion(record) {
            const { data, error } = await client
                .from(LEARNING_DATASET_VERSIONS.TABLE)
                .insert(record)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create learning dataset version: ${error?.message ?? 'Unknown error'}`);
            }

            return mapDatasetVersionRecord(asRecord(data));
        },

        async createLearningCycle(record) {
            const { data, error } = await client
                .from(LEARNING_CYCLES.TABLE)
                .insert(record)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create learning cycle: ${error?.message ?? 'Unknown error'}`);
            }

            return mapLearningCycleRecord(asRecord(data));
        },

        async updateLearningCycle(id, tenantId, patch) {
            const { data, error } = await client
                .from(LEARNING_CYCLES.TABLE)
                .update(patch)
                .eq(LEARNING_CYCLES.COLUMNS.id, id)
                .eq(LEARNING_CYCLES.COLUMNS.tenant_id, tenantId)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to update learning cycle: ${error?.message ?? 'Unknown error'}`);
            }

            return mapLearningCycleRecord(asRecord(data));
        },

        async createBenchmarkReport(record) {
            const { data, error } = await client
                .from(LEARNING_BENCHMARK_REPORTS.TABLE)
                .insert(record)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create learning benchmark report: ${error?.message ?? 'Unknown error'}`);
            }

            return mapBenchmarkReportRecord(asRecord(data));
        },

        async createCalibrationReport(record) {
            const { data, error } = await client
                .from(LEARNING_CALIBRATION_REPORTS.TABLE)
                .insert(record)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create learning calibration report: ${error?.message ?? 'Unknown error'}`);
            }

            return mapCalibrationReportRecord(asRecord(data));
        },

        async createAuditEvent(record) {
            const { data, error } = await client
                .from(LEARNING_AUDIT_EVENTS.TABLE)
                .insert(record)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create learning audit event: ${error?.message ?? 'Unknown error'}`);
            }

            return mapAuditEventRecord(asRecord(data));
        },

        async createRollbackEvent(record) {
            const { data, error } = await client
                .from(LEARNING_ROLLBACK_EVENTS.TABLE)
                .insert(record)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create learning rollback event: ${error?.message ?? 'Unknown error'}`);
            }

            return mapRollbackEventRecord(asRecord(data));
        },

        async listModelRegistryEntries(tenantId, taskType) {
            let query = client
                .from(MODEL_REGISTRY_ENTRIES.TABLE)
                .select('*')
                .eq(MODEL_REGISTRY_ENTRIES.COLUMNS.tenant_id, tenantId)
                .order(MODEL_REGISTRY_ENTRIES.COLUMNS.updated_at, { ascending: false });

            if (taskType) {
                query = query.eq(MODEL_REGISTRY_ENTRIES.COLUMNS.task_type, taskType);
            }

            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to list model registry entries: ${error.message}`);
            }

            return (data ?? []).map((row) => mapModelRegistryEntry(asRecord(row)));
        },

        async createModelRegistryEntry(record) {
            const { data, error } = await client
                .from(MODEL_REGISTRY_ENTRIES.TABLE)
                .insert(record)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to create model registry entry: ${error?.message ?? 'Unknown error'}`);
            }

            return mapModelRegistryEntry(asRecord(data));
        },

        async updateModelRegistryEntry(id, tenantId, patch) {
            const { data, error } = await client
                .from(MODEL_REGISTRY_ENTRIES.TABLE)
                .update(patch)
                .eq(MODEL_REGISTRY_ENTRIES.COLUMNS.id, id)
                .eq(MODEL_REGISTRY_ENTRIES.COLUMNS.tenant_id, tenantId)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to update model registry entry: ${error?.message ?? 'Unknown error'}`);
            }

            return mapModelRegistryEntry(asRecord(data));
        },

        async listLearningCycles(tenantId, limit) {
            const { data, error } = await client
                .from(LEARNING_CYCLES.TABLE)
                .select('*')
                .eq(LEARNING_CYCLES.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_CYCLES.COLUMNS.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list learning cycles: ${error.message}`);
            }

            return (data ?? []).map((row) => mapLearningCycleRecord(asRecord(row)));
        },

        async listBenchmarkReports(tenantId, limit) {
            const { data, error } = await client
                .from(LEARNING_BENCHMARK_REPORTS.TABLE)
                .select('*')
                .eq(LEARNING_BENCHMARK_REPORTS.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_BENCHMARK_REPORTS.COLUMNS.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list learning benchmark reports: ${error.message}`);
            }

            return (data ?? []).map((row) => mapBenchmarkReportRecord(asRecord(row)));
        },

        async listCalibrationReports(tenantId, limit) {
            const { data, error } = await client
                .from(LEARNING_CALIBRATION_REPORTS.TABLE)
                .select('*')
                .eq(LEARNING_CALIBRATION_REPORTS.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_CALIBRATION_REPORTS.COLUMNS.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list learning calibration reports: ${error.message}`);
            }

            return (data ?? []).map((row) => mapCalibrationReportRecord(asRecord(row)));
        },

        async listRollbackEvents(tenantId, limit) {
            const { data, error } = await client
                .from(LEARNING_ROLLBACK_EVENTS.TABLE)
                .select('*')
                .eq(LEARNING_ROLLBACK_EVENTS.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_ROLLBACK_EVENTS.COLUMNS.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to list learning rollback events: ${error.message}`);
            }

            return (data ?? []).map((row) => mapRollbackEventRecord(asRecord(row)));
        },

        async listSchedulerJobs(tenantId) {
            const { data, error } = await client
                .from(LEARNING_SCHEDULER_JOBS.TABLE)
                .select('*')
                .eq(LEARNING_SCHEDULER_JOBS.COLUMNS.tenant_id, tenantId)
                .order(LEARNING_SCHEDULER_JOBS.COLUMNS.created_at, { ascending: true });

            if (error) {
                throw new Error(`Failed to list learning scheduler jobs: ${error.message}`);
            }

            return (data ?? []).map((row) => mapSchedulerJobRecord(asRecord(row)));
        },

        async upsertSchedulerJob(record) {
            const { data, error } = await client
                .from(LEARNING_SCHEDULER_JOBS.TABLE)
                .upsert(record, {
                    onConflict: `${LEARNING_SCHEDULER_JOBS.COLUMNS.tenant_id},${LEARNING_SCHEDULER_JOBS.COLUMNS.job_name}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert learning scheduler job: ${error?.message ?? 'Unknown error'}`);
            }

            return mapSchedulerJobRecord(asRecord(data));
        },
    };
}

function applyCommonTimeframeFilters<T>(
    query: T,
    timestampColumn: string,
    filters: LearningDatasetFilters,
): T {
    let nextQuery = query as T & {
        gte(column: string, value: string): typeof nextQuery;
        lte(column: string, value: string): typeof nextQuery;
    };

    if (filters.from) {
        nextQuery = nextQuery.gte(timestampColumn, filters.from);
    }
    if (filters.to) {
        nextQuery = nextQuery.lte(timestampColumn, filters.to);
    }
    return nextQuery;
}

function mapLearningCaseRecord(row: Record<string, unknown>): LearningCaseRecord {
    const clinicalCase = mapClinicalCaseRow(row);
    return {
        case_id: clinicalCase.id,
        tenant_id: clinicalCase.tenant_id,
        user_id: clinicalCase.user_id,
        clinic_id: clinicalCase.clinic_id,
        source_module: clinicalCase.source_module,
        species_canonical: clinicalCase.species_canonical,
        species_display: clinicalCase.species_display,
        breed: clinicalCase.breed,
        symptom_text_raw: clinicalCase.symptom_text_raw,
        symptom_keys: clinicalCase.symptoms_normalized,
        symptom_vector_normalized: clinicalCase.symptom_vector_normalized,
        patient_metadata: clinicalCase.patient_metadata,
        latest_input_signature: clinicalCase.latest_input_signature,
        ingestion_status: clinicalCase.ingestion_status,
        invalid_case: clinicalCase.invalid_case,
        validation_error_code: clinicalCase.validation_error_code,
        primary_condition_class: clinicalCase.primary_condition_class,
        top_diagnosis: clinicalCase.top_diagnosis,
        predicted_diagnosis: clinicalCase.predicted_diagnosis,
        confirmed_diagnosis: clinicalCase.confirmed_diagnosis,
        label_type: clinicalCase.label_type,
        diagnosis_confidence: clinicalCase.diagnosis_confidence,
        severity_score: clinicalCase.severity_score,
        emergency_level: clinicalCase.emergency_level,
        triage_priority: clinicalCase.triage_priority,
        contradiction_score: clinicalCase.contradiction_score,
        contradiction_flags: clinicalCase.contradiction_flags,
        adversarial_case: clinicalCase.adversarial_case,
        adversarial_case_type: clinicalCase.adversarial_case_type,
        uncertainty_notes: clinicalCase.uncertainty_notes,
        case_cluster: clinicalCase.case_cluster,
        model_version: clinicalCase.model_version,
        telemetry_status: clinicalCase.telemetry_status,
        calibration_status: clinicalCase.calibration_status,
        prediction_correct: clinicalCase.prediction_correct,
        confidence_error: clinicalCase.confidence_error,
        calibration_bucket: clinicalCase.calibration_bucket,
        degraded_confidence: clinicalCase.degraded_confidence,
        differential_spread: clinicalCase.differential_spread,
        latest_inference_event_id: clinicalCase.latest_inference_event_id,
        latest_outcome_event_id: clinicalCase.latest_outcome_event_id,
        latest_simulation_event_id: clinicalCase.latest_simulation_event_id,
        first_inference_at: clinicalCase.first_inference_at,
        last_inference_at: clinicalCase.last_inference_at,
        created_at: clinicalCase.created_at,
        updated_at: clinicalCase.updated_at,
    };
}

function mapInferenceEvent(row: Record<string, unknown>): LearningInferenceEvent {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        case_id: readString(row.case_id),
        user_id: readString(row.user_id),
        source_module: readString(row.source_module),
        model_name: readString(row.model_name) ?? 'unknown_model',
        model_version: readString(row.model_version) ?? 'unknown_version',
        input_signature: asRecord(row.input_signature),
        output_payload: asRecord(row.output_payload),
        confidence_score: readNumber(row.confidence_score),
        uncertainty_metrics: readNullableRecord(row.uncertainty_metrics),
        compute_profile: readNullableRecord(row.compute_profile),
        inference_latency_ms: readNumber(row.inference_latency_ms),
        created_at: String(row.created_at),
    };
}

function mapOutcomeEvent(row: Record<string, unknown>): LearningOutcomeEvent {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        case_id: readString(row.case_id),
        user_id: readString(row.user_id),
        source_module: readString(row.source_module),
        inference_event_id: readString(row.inference_event_id),
        outcome_type: readString(row.outcome_type) ?? 'outcome_learning',
        outcome_payload: asRecord(row.outcome_payload),
        outcome_timestamp: String(row.outcome_timestamp ?? row.created_at),
        label_type: readString(row.label_type),
        created_at: String(row.created_at),
    };
}

function mapSimulationEvent(row: Record<string, unknown>): LearningSimulationEvent {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        case_id: readString(row.case_id),
        user_id: readString(row.user_id),
        source_module: readString(row.source_module),
        simulation_type: readString(row.simulation_type) ?? 'unknown_simulation',
        simulation_parameters: asRecord(row.simulation_parameters),
        triggered_inference_id: readString(row.triggered_inference_id),
        failure_mode: readString(row.failure_mode),
        stress_metrics: readNullableRecord(row.stress_metrics),
        is_real_world: row.is_real_world === true,
        created_at: String(row.created_at),
    };
}

function mapEvaluationEvent(row: Record<string, unknown>): LearningEvaluationEvent {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        trigger_type: readString(row.trigger_type) ?? 'inference',
        inference_event_id: readString(row.inference_event_id),
        outcome_event_id: readString(row.outcome_event_id),
        model_name: readString(row.model_name),
        model_version: readString(row.model_version),
        calibration_error: readNumber(row.calibration_error),
        drift_score: readNumber(row.drift_score),
        outcome_alignment_delta: readNumber(row.outcome_alignment_delta),
        simulation_degradation: readNumber(row.simulation_degradation),
        calibrated_confidence: readNumber(row.calibrated_confidence),
        epistemic_uncertainty: readNumber(row.epistemic_uncertainty),
        aleatoric_uncertainty: readNumber(row.aleatoric_uncertainty),
        evaluation_payload: readNullableRecord(row.evaluation_payload),
        created_at: String(row.created_at),
    };
}

function mapDatasetVersionRecord(row: Record<string, unknown>): LearningDatasetVersionRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        dataset_version: String(row.dataset_version),
        dataset_kind: row.dataset_kind as LearningDatasetVersionRecord['dataset_kind'],
        feature_schema_version: String(row.feature_schema_version),
        label_policy_version: String(row.label_policy_version),
        row_count: readNumber(row.row_count) ?? 0,
        case_ids: readStringArray(row.case_ids),
        filters: asRecord(row.filters),
        summary: asRecord(row.summary),
        dataset_rows: readRecordArray(row.dataset_rows),
        created_at: String(row.created_at),
    };
}

function mapLearningCycleRecord(row: Record<string, unknown>): LearningCycleRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        cycle_type: row.cycle_type as LearningCycleRecord['cycle_type'],
        trigger_mode: row.trigger_mode as LearningCycleRecord['trigger_mode'],
        status: row.status as LearningCycleRecord['status'],
        request_payload: asRecord(row.request_payload),
        summary: asRecord(row.summary),
        started_at: String(row.started_at),
        completed_at: readString(row.completed_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapBenchmarkReportRecord(row: Record<string, unknown>): LearningBenchmarkReportRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        learning_cycle_id: readString(row.learning_cycle_id),
        model_registry_id: readString(row.model_registry_id),
        benchmark_family: String(row.benchmark_family),
        task_type: String(row.task_type),
        report_payload: asRecord(row.report_payload),
        summary_score: readNumber(row.summary_score),
        pass_status: String(row.pass_status),
        created_at: String(row.created_at),
    };
}

function mapCalibrationReportRecord(row: Record<string, unknown>): LearningCalibrationReportRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        learning_cycle_id: readString(row.learning_cycle_id),
        model_registry_id: readString(row.model_registry_id),
        task_type: String(row.task_type),
        report_payload: asRecord(row.report_payload),
        brier_score: readNumber(row.brier_score),
        ece_score: readNumber(row.ece_score),
        created_at: String(row.created_at),
    };
}

function mapModelRegistryEntry(row: Record<string, unknown>): ModelRegistryEntryRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        model_name: String(row.model_name),
        model_version: String(row.model_version),
        task_type: row.task_type as LearningTaskType,
        training_dataset_version: String(row.training_dataset_version),
        feature_schema_version: String(row.feature_schema_version),
        label_policy_version: String(row.label_policy_version),
        artifact_payload: asRecord(row.artifact_payload),
        benchmark_scorecard: asRecord(row.benchmark_scorecard),
        calibration_report_id: readString(row.calibration_report_id),
        promotion_status: row.promotion_status as ModelRegistryEntryRecord['promotion_status'],
        is_champion: row.is_champion === true,
        latency_profile: readNullableRecord(row.latency_profile),
        resource_profile: readNullableRecord(row.resource_profile),
        parent_model_version: readString(row.parent_model_version),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapSchedulerJobRecord(row: Record<string, unknown>): LearningSchedulerJobRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        job_name: String(row.job_name),
        cron_expression: String(row.cron_expression),
        job_type: String(row.job_type),
        enabled: row.enabled !== false,
        job_config: asRecord(row.job_config),
        last_run_at: readString(row.last_run_at),
        next_run_at: readString(row.next_run_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapRollbackEventRecord(row: Record<string, unknown>): LearningRollbackEventRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        learning_cycle_id: readString(row.learning_cycle_id),
        previous_model_registry_id: readString(row.previous_model_registry_id),
        restored_model_registry_id: readString(row.restored_model_registry_id),
        trigger_reason: String(row.trigger_reason),
        trigger_payload: asRecord(row.trigger_payload),
        created_at: String(row.created_at),
    };
}

function mapAuditEventRecord(row: Record<string, unknown>): LearningAuditEventRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        learning_cycle_id: readString(row.learning_cycle_id),
        event_type: String(row.event_type),
        event_payload: asRecord(row.event_payload),
        created_at: String(row.created_at),
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

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => asRecord(entry));
}
