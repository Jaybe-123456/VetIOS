import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
    backfillSummaryExperimentRuns,
    buildExperimentMetricSeries,
    createExperimentRun,
    getEmptyMetricStateMessage,
    getExperimentComparison,
    getExperimentDashboardSnapshot,
    getExperimentRunDetail,
    logExperimentMetrics,
    recordExperimentFailure,
    updateExperimentHeartbeat,
} from '../../apps/web/lib/experiments/service.ts';
import type {
    ExperimentArtifactRecord,
    ExperimentBenchmarkRecord,
    ExperimentFailureRecord,
    ExperimentMetricRecord,
    ExperimentRegistryLinkRecord,
    ExperimentRunRecord,
    ExperimentTrackingStore,
} from '../../apps/web/lib/experiments/types.ts';

class InMemoryExperimentTrackingStore implements ExperimentTrackingStore {
    runs: ExperimentRunRecord[] = [];
    metrics: ExperimentMetricRecord[] = [];
    artifacts: ExperimentArtifactRecord[] = [];
    failures: ExperimentFailureRecord[] = [];
    benchmarks: ExperimentBenchmarkRecord[] = [];
    registryLinks: ExperimentRegistryLinkRecord[] = [];
    registryEntries: Array<Awaited<ReturnType<ExperimentTrackingStore['listModelRegistryEntries']>>[number]> = [];
    datasetVersions: Array<Awaited<ReturnType<ExperimentTrackingStore['listLearningDatasetVersions']>>[number]> = [];
    learningBenchmarks: Array<Awaited<ReturnType<ExperimentTrackingStore['listLearningBenchmarkReports']>>[number]> = [];
    learningCalibrations: Array<Awaited<ReturnType<ExperimentTrackingStore['listLearningCalibrationReports']>>[number]> = [];
    learningAudits: Array<Awaited<ReturnType<ExperimentTrackingStore['listLearningAuditEvents']>>[number]> = [];

    async listExperimentRuns(tenantId: string, options = {}) {
        let rows = this.runs.filter((run) => run.tenant_id === tenantId);
        if (options.includeSummaryOnly === false) {
            rows = rows.filter((run) => !run.summary_only);
        }
        if (options.statuses?.length) {
            rows = rows.filter((run) => options.statuses?.includes(run.status));
        }
        return rows
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
            .slice(0, options.limit ?? 200)
            .map(clone);
    }

    async getExperimentRun(tenantId: string, runId: string) {
        const run = this.runs.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return run ? clone(run) : null;
    }

    async createExperimentRun(record: Omit<ExperimentRunRecord, 'id' | 'created_at' | 'updated_at'>) {
        const now = new Date().toISOString();
        const created: ExperimentRunRecord = {
            ...record,
            id: randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.runs.push(created);
        return clone(created);
    }

    async updateExperimentRun(runId: string, tenantId: string, patch: Partial<Omit<ExperimentRunRecord, 'id' | 'tenant_id' | 'run_id' | 'created_at'>>) {
        const run = this.runs.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        if (!run) throw new Error(`Experiment run not found: ${runId}`);
        Object.assign(run, patch, { updated_at: new Date().toISOString() });
        return clone(run);
    }

    async listExperimentMetrics(tenantId: string, runId: string, limit = 1_000) {
        return this.metrics
            .filter((row) => row.tenant_id === tenantId && row.run_id === runId)
            .sort((left, right) => left.metric_timestamp.localeCompare(right.metric_timestamp))
            .slice(0, limit)
            .map(clone);
    }

    async createExperimentMetrics(records: Array<Omit<ExperimentMetricRecord, 'id' | 'created_at'>>) {
        const created = records.map((record) => ({
            ...record,
            id: randomUUID(),
            created_at: new Date().toISOString(),
        }));
        this.metrics.push(...created);
        return created.map(clone);
    }

    async listExperimentArtifacts(tenantId: string, runId: string) {
        return this.artifacts.filter((row) => row.tenant_id === tenantId && row.run_id === runId).map(clone);
    }

    async upsertExperimentArtifact(record: Omit<ExperimentArtifactRecord, 'id' | 'created_at'> & { id?: string }) {
        const existing = record.id
            ? this.artifacts.find((row) => row.id === record.id)
            : undefined;
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: ExperimentArtifactRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: new Date().toISOString(),
        };
        this.artifacts.push(created);
        return clone(created);
    }

    async getExperimentFailure(tenantId: string, runId: string) {
        const failure = this.failures.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return failure ? clone(failure) : null;
    }

    async upsertExperimentFailure(record: Omit<ExperimentFailureRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.failures.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: ExperimentFailureRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.failures.push(created);
        return clone(created);
    }

    async listExperimentBenchmarks(tenantId: string, runId: string) {
        return this.benchmarks.filter((row) => row.tenant_id === tenantId && row.run_id === runId).map(clone);
    }

    async upsertExperimentBenchmark(record: Omit<ExperimentBenchmarkRecord, 'id' | 'created_at'> & { id?: string }) {
        const existing = this.benchmarks.find((row) =>
            row.tenant_id === record.tenant_id &&
            row.run_id === record.run_id &&
            row.benchmark_family === record.benchmark_family,
        );
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: ExperimentBenchmarkRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: new Date().toISOString(),
        };
        this.benchmarks.push(created);
        return clone(created);
    }

    async getExperimentRegistryLink(tenantId: string, runId: string) {
        const link = this.registryLinks.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return link ? clone(link) : null;
    }

    async upsertExperimentRegistryLink(record: Omit<ExperimentRegistryLinkRecord, 'id' | 'linked_at' | 'updated_at'> & { id?: string }) {
        const existing = this.registryLinks.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: ExperimentRegistryLinkRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            linked_at: now,
            updated_at: now,
        };
        this.registryLinks.push(created);
        return clone(created);
    }

    async listModelRegistryEntries(tenantId: string) {
        return this.registryEntries.filter((entry) => entry.tenant_id === tenantId).map(clone);
    }

    async listLearningDatasetVersions(tenantId: string) {
        return this.datasetVersions.filter((entry) => entry.id.startsWith(tenantId)).map(clone);
    }

    async listLearningBenchmarkReports(tenantId: string) {
        return this.learningBenchmarks.filter((entry) => entry.id.startsWith(tenantId)).map(clone);
    }

    async listLearningCalibrationReports(tenantId: string) {
        return this.learningCalibrations.filter((entry) => entry.id.startsWith(tenantId)).map(clone);
    }

    async listLearningAuditEvents(tenantId: string) {
        return this.learningAudits.filter((entry) => entry.id.startsWith(tenantId)).map(clone);
    }
}

async function main() {
    const tenantId = makeUuid(1);
    const store = buildStore(tenantId);

    const run = await createExperimentRun(store, {
        tenantId,
        runId: 'run_diag_live_001',
        taskType: 'clinical_diagnosis',
        modality: 'tabular_clinical',
        targetType: 'diagnosis',
        modelArch: 'Transformer-Clinical-XL',
        modelVersion: 'diag_live_v2',
        datasetName: 'ldv_diag_2026_03_20',
        datasetVersion: 'ldv_diag_2026_03_20',
        epochsPlanned: 5,
        hyperparameters: { optimizer: 'adamw', learning_rate_init: 0.0001 },
    });
    assert.equal(run.run_id, 'run_diag_live_001');

    const metrics = await logExperimentMetrics(store, tenantId, run.run_id, [
        { epoch: 1, global_step: 100, train_loss: 0.82, val_accuracy: 0.71, learning_rate: 0.0001, gradient_norm: 1.8 },
        { epoch: 2, global_step: 200, train_loss: 0.61, val_accuracy: 0.78, learning_rate: 0.00008, gradient_norm: 1.2, macro_f1: 0.75 },
    ]);
    assert.equal(metrics.length, 2);
    const series = buildExperimentMetricSeries(metrics);
    assert.equal(series.length, 2);
    assert.equal(series[1].val_accuracy, 0.78);

    const heartbeat = await updateExperimentHeartbeat(store, tenantId, run.run_id, {
        status: 'validating',
        progressPercent: 60,
        epochsCompleted: 3,
        resourceUsage: { gpu_utilization: 0.72 },
    });
    assert.equal(heartbeat.status, 'validating');
    assert.equal(heartbeat.epochs_completed, 3);

    const failure = await recordExperimentFailure(store, tenantId, run.run_id, {
        failureReason: 'exploded_gradient',
        failureEpoch: 4,
        failureStep: 412,
        lastTrainLoss: 1.92,
        lastGradientNorm: 1123.4,
        nanDetected: true,
    });
    assert.equal(failure.failure_reason, 'exploded_gradient');

    const detail = await getExperimentRunDetail(store, tenantId, run.run_id);
    assert.ok(detail);
    assert.equal(detail?.failure?.nan_detected, true);
    assert.equal(detail?.run.status, 'failed');

    await backfillSummaryExperimentRuns(store, tenantId);
    const dashboard = await getExperimentDashboardSnapshot(store, tenantId, { runLimit: 20 });
    assert.ok(dashboard.summary.total_runs >= 2);
    assert.ok(dashboard.runs.some((row) => row.summary_only));

    const summaryOnlyRun = dashboard.runs.find((row) => row.summary_only)!;
    const summaryOnlyDetail = await getExperimentRunDetail(store, tenantId, summaryOnlyRun.run_id);
    assert.ok(summaryOnlyDetail);
    assert.equal(getEmptyMetricStateMessage(summaryOnlyDetail!.run, summaryOnlyDetail!.metrics).includes('summary-only historical run'), true);

    const comparison = await getExperimentComparison(store, tenantId, [run.run_id, summaryOnlyRun.run_id]);
    assert.ok(comparison);
    assert.equal(comparison?.runs.length, 2);

    console.log('Experiment tracking integration tests passed.');
}

function buildStore(tenantId: string) {
    const store = new InMemoryExperimentTrackingStore();

    store.registryEntries = [{
        id: `${tenantId}_registry_diag`,
        tenant_id: tenantId,
        model_name: 'vetios_diagnosis_frequency_bayes',
        model_version: 'diag_registry_v1',
        task_type: 'diagnosis',
        training_dataset_version: 'ldv_diag_2026_03_20',
        feature_schema_version: 'clinical-case-vector-v1',
        label_policy_version: 'learning-label-policy-v1',
        artifact_payload: {
            model_name: 'Frequency Bayes Diagnosis',
            hyperparameters: { optimizer: 'adamw', batch_size: 32 },
            best_checkpoint_uri: 's3://artifacts/diag_registry_v1/best.ckpt',
            final_checkpoint_uri: 's3://artifacts/diag_registry_v1/final.ckpt',
            benchmark_report_uri: 's3://reports/diag_registry_v1/benchmark.json',
            training_summary: { epochs: 12, parameter_scale: '7B' },
        },
        benchmark_scorecard: { diagnosis_macro_f1: 0.82, diagnosis_accuracy: 0.86 },
        calibration_report_id: `${tenantId}_calibration_diag`,
        promotion_status: 'challenger',
        is_champion: false,
        latency_profile: { p95_ms: 120 },
        resource_profile: { gpu_memory_gb: 24 },
        parent_model_version: null,
        created_at: '2026-03-20T08:00:00.000Z',
        updated_at: '2026-03-20T08:20:00.000Z',
    }];

    store.datasetVersions = [{
        id: `${tenantId}_dataset_diag`,
        dataset_version: 'ldv_diag_2026_03_20',
        dataset_kind: 'diagnosis_training_set',
        row_count: 48,
        summary: {
            total_cases: 52,
            severity_training_cases: 31,
            adversarial_cases: 6,
            quarantined_cases: 2,
            label_composition: { expert_reviewed: 20, lab_confirmed: 18, synthetic: 10 },
        },
        created_at: '2026-03-20T08:00:00.000Z',
    }];

    store.learningBenchmarks = [{
        id: `${tenantId}_benchmark_diag`,
        model_registry_id: `${tenantId}_registry_diag`,
        benchmark_family: 'clean_labeled_diagnosis',
        task_type: 'diagnosis',
        summary_score: 0.86,
        pass_status: 'pass',
        report_payload: { accuracy: 0.86, macro_f1: 0.82 },
        created_at: '2026-03-20T08:21:00.000Z',
    }];

    store.learningCalibrations = [{
        id: `${tenantId}_calibration_diag`,
        model_registry_id: `${tenantId}_registry_diag`,
        task_type: 'diagnosis',
        brier_score: 0.08,
        ece_score: 0.04,
        report_payload: {
            recommendation: { status: 'pass' },
            expected_calibration_error: 0.04,
        },
        created_at: '2026-03-20T08:22:00.000Z',
    }];

    store.learningAudits = [{
        id: `${tenantId}_audit_diag`,
        event_type: 'promotion_reviewed',
        event_payload: { candidate_model_version: 'diag_registry_v1' },
        created_at: '2026-03-20T08:30:00.000Z',
    }];

    return store;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function makeUuid(seed: number): string {
    return `00000000-0000-4000-a000-${String(seed).padStart(12, '0')}`;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
