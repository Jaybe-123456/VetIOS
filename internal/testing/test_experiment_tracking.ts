import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seedExperimentTrackingBootstrap } from '../../apps/web/lib/experiments/bootstrap.ts';
import {
    applyExperimentRegistryAction,
    backfillSummaryExperimentRuns,
    buildExperimentMetricSeries,
    createExperimentRun,
    getEmptyMetricStateMessage,
    getExperimentComparison,
    getExperimentDashboardSnapshot,
    getExperimentRunDetail,
    logExperimentMetrics,
    recordExperimentFailure,
    upsertAdversarialEvaluation,
    upsertCalibrationEvaluation,
    updateExperimentHeartbeat,
} from '../../apps/web/lib/experiments/service.ts';
import type {
    AdversarialMetricRecord,
    CalibrationMetricRecord,
    DeploymentDecisionRecord,
    ExperimentArtifactRecord,
    ExperimentAuditEventRecord,
    ExperimentBenchmarkRecord,
    ExperimentFailureRecord,
    ExperimentMetricRecord,
    ExperimentRegistryLinkRecord,
    ExperimentRunRecord,
    ExperimentTrackingStore,
    ModelRegistryRecord,
    SubgroupMetricRecord,
} from '../../apps/web/lib/experiments/types.ts';

class InMemoryExperimentTrackingStore implements ExperimentTrackingStore {
    runs: ExperimentRunRecord[] = [];
    metrics: ExperimentMetricRecord[] = [];
    artifacts: ExperimentArtifactRecord[] = [];
    failures: ExperimentFailureRecord[] = [];
    benchmarks: ExperimentBenchmarkRecord[] = [];
    registryLinks: ExperimentRegistryLinkRecord[] = [];
    modelRegistry: ModelRegistryRecord[] = [];
    calibrationMetrics: CalibrationMetricRecord[] = [];
    adversarialMetrics: AdversarialMetricRecord[] = [];
    deploymentDecisions: DeploymentDecisionRecord[] = [];
    subgroupMetrics: SubgroupMetricRecord[] = [];
    auditEvents: ExperimentAuditEventRecord[] = [];
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

    async getModelRegistryForRun(tenantId: string, runId: string) {
        const record = this.modelRegistry.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async upsertModelRegistry(record: Omit<ModelRegistryRecord, 'created_at' | 'updated_at'>) {
        const existing = this.modelRegistry.find((row) => row.registry_id === record.registry_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: ModelRegistryRecord = {
            ...record,
            created_at: now,
            updated_at: now,
        };
        this.modelRegistry.push(created);
        return clone(created);
    }

    async getCalibrationMetrics(tenantId: string, runId: string) {
        const record = this.calibrationMetrics.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async upsertCalibrationMetrics(record: Omit<CalibrationMetricRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.calibrationMetrics.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: CalibrationMetricRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.calibrationMetrics.push(created);
        return clone(created);
    }

    async getAdversarialMetrics(tenantId: string, runId: string) {
        const record = this.adversarialMetrics.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async upsertAdversarialMetrics(record: Omit<AdversarialMetricRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.adversarialMetrics.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: AdversarialMetricRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.adversarialMetrics.push(created);
        return clone(created);
    }

    async getDeploymentDecision(tenantId: string, runId: string) {
        const record = this.deploymentDecisions.find((row) => row.tenant_id === tenantId && row.run_id === runId);
        return record ? clone(record) : null;
    }

    async upsertDeploymentDecision(record: Omit<DeploymentDecisionRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
        const existing = this.deploymentDecisions.find((row) => row.tenant_id === record.tenant_id && row.run_id === record.run_id);
        if (existing) {
            Object.assign(existing, record, { updated_at: new Date().toISOString() });
            return clone(existing);
        }
        const now = new Date().toISOString();
        const created: DeploymentDecisionRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.deploymentDecisions.push(created);
        return clone(created);
    }

    async listSubgroupMetrics(tenantId: string, runId: string) {
        return this.subgroupMetrics
            .filter((row) => row.tenant_id === tenantId && row.run_id === runId)
            .map(clone);
    }

    async upsertSubgroupMetric(record: Omit<SubgroupMetricRecord, 'id' | 'created_at'> & { id?: string }) {
        const existing = this.subgroupMetrics.find((row) =>
            row.tenant_id === record.tenant_id &&
            row.run_id === record.run_id &&
            row.group === record.group &&
            row.group_value === record.group_value &&
            row.metric === record.metric,
        );
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: SubgroupMetricRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: new Date().toISOString(),
        };
        this.subgroupMetrics.push(created);
        return clone(created);
    }

    async listAuditLog(tenantId: string, limit = 200) {
        return this.auditEvents
            .filter((row) => row.tenant_id === tenantId)
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, limit)
            .map(clone);
    }

    async createAuditLog(record: Omit<ExperimentAuditEventRecord, 'created_at'>) {
        const existing = this.auditEvents.find((row) => row.event_id === record.event_id);
        if (existing) {
            Object.assign(existing, record);
            return clone(existing);
        }
        const created: ExperimentAuditEventRecord = {
            ...record,
            created_at: new Date().toISOString(),
        };
        this.auditEvents.push(created);
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
    await testExperimentTrackingServiceFlow();
    await testExperimentBootstrapSeed();

    console.log('Experiment tracking integration tests passed.');
}

async function testExperimentTrackingServiceFlow() {
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
        {
            epoch: 1,
            global_step: 100,
            train_loss: 0.82,
            val_accuracy: 0.71,
            learning_rate: 0.0001,
            gradient_norm: 1.8,
            recall_critical: 0.8,
            false_negative_critical_rate: 0.12,
            dangerous_false_reassurance_rate: 0.05,
            abstain_accuracy: 0.74,
            contradiction_detection_rate: 0.68,
        },
        {
            epoch: 2,
            global_step: 200,
            train_loss: 0.61,
            val_accuracy: 0.78,
            learning_rate: 0.00008,
            gradient_norm: 1.2,
            macro_f1: 0.75,
            recall_critical: 0.86,
            false_negative_critical_rate: 0.08,
            dangerous_false_reassurance_rate: 0.03,
            abstain_accuracy: 0.8,
            contradiction_detection_rate: 0.72,
        },
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
    assert.equal(detail?.deployment_decision?.decision, 'rejected');
    assert.ok((detail?.audit_history.length ?? 0) > 0);

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
}

async function testExperimentBootstrapSeed() {
    const tenantId = makeUuid(2);
    const store = new InMemoryExperimentTrackingStore();

    const summary = await seedExperimentTrackingBootstrap(store, tenantId);
    assert.equal(summary.total_runs, 3);
    assert.equal(summary.active_runs, 1);
    assert.equal(summary.failed_runs, 1);
    assert.equal(summary.summary_only_runs, 0);
    assert.ok(summary.telemetry_coverage_pct > 0);

    const runs = await store.listExperimentRuns(tenantId, { limit: 10, includeSummaryOnly: true });
    assert.equal(runs.length, 3);
    assert.equal(runs.some((run) => run.run_id === 'run_diag_smoke_v1' && run.status === 'training'), true);
    assert.equal(runs.some((run) => run.run_id === 'run_diag_complete_v1' && run.status === 'completed'), true);
    assert.equal(runs.some((run) => run.run_id === 'run_diag_fail_v1' && run.status === 'failed'), true);

    const smokeRun = await store.getExperimentRun(tenantId, 'run_diag_smoke_v1');
    assert.ok(smokeRun);
    assert.equal(smokeRun?.last_heartbeat_at, '2026-03-20T03:55:00Z');

    for (const runId of ['run_diag_smoke_v1', 'run_diag_complete_v1', 'run_diag_fail_v1']) {
        const metrics = await store.listExperimentMetrics(tenantId, runId, 100);
        assert.ok(metrics.length > 0, `expected telemetry for ${runId}`);
        const series = buildExperimentMetricSeries(metrics);
        assert.equal(series.length, metrics.length);
    }

    const failedDetail = await getExperimentRunDetail(store, tenantId, 'run_diag_fail_v1');
    assert.ok(failedDetail?.failure);
    assert.equal(failedDetail?.failure?.failure_reason, 'exploded_gradient');
    assert.equal(failedDetail?.failure?.nan_detected, true);

    const completeDetail = await getExperimentRunDetail(store, tenantId, 'run_diag_complete_v1');
    assert.ok(completeDetail?.model_registry);
    assert.ok(completeDetail?.calibration_metrics);
    assert.ok(completeDetail?.adversarial_metrics);
    assert.ok(completeDetail?.deployment_decision);
    assert.ok((completeDetail?.subgroup_metrics.length ?? 0) > 0);
    assert.ok((completeDetail?.audit_history.length ?? 0) > 0);

    const calibration = await upsertCalibrationEvaluation(store, tenantId, 'run_diag_complete_v1', {
        ece: 0.03,
        brierScore: 0.06,
        reliabilityBins: [
            { confidence: 0.2, accuracy: 0.18, count: 12 },
            { confidence: 0.5, accuracy: 0.52, count: 18 },
            { confidence: 0.8, accuracy: 0.82, count: 14 },
        ],
        calibrationPass: true,
        calibrationNotes: 'Manual QA override for governance validation.',
    }, 'qa_user');
    assert.equal(calibration.calibration_pass, true);

    const adversarial = await upsertAdversarialEvaluation(store, tenantId, 'run_diag_complete_v1', {
        degradationScore: 0.14,
        contradictionRobustness: 0.88,
        criticalCaseRecall: 0.93,
        falseReassuranceRate: 0.04,
        adversarialPass: true,
    }, 'qa_user');
    assert.equal(adversarial.adversarial_pass, true);

    await logExperimentMetrics(store, tenantId, 'run_diag_complete_v1', [{
        epoch: 8,
        global_step: 97,
        train_loss: 0.47,
        val_loss: 0.45,
        val_accuracy: 0.85,
        learning_rate: 0.00005,
        gradient_norm: 0.6,
        macro_f1: 0.82,
        recall_critical: 0.95,
        false_negative_critical_rate: 0.05,
        dangerous_false_reassurance_rate: 0.03,
        abstain_accuracy: 0.84,
        contradiction_detection_rate: 0.88,
    }]);

    const stagingRegistry = await applyExperimentRegistryAction(store, tenantId, 'run_diag_complete_v1', 'promote_to_staging', 'qa_user');
    assert.equal(stagingRegistry.status, 'staging');

    const decision = await store.getDeploymentDecision(tenantId, 'run_diag_complete_v1');
    assert.equal(decision?.decision, 'approved');

    const productionRegistry = await applyExperimentRegistryAction(store, tenantId, 'run_diag_complete_v1', 'promote_to_production', 'qa_user');
    assert.equal(productionRegistry.status, 'production');
    assert.equal(productionRegistry.role, 'champion');

    const promotedRun = await store.getExperimentRun(tenantId, 'run_diag_complete_v1');
    assert.equal(promotedRun?.status, 'promoted');
    assert.ok(promotedRun?.registry_id);

    const dashboard = await getExperimentDashboardSnapshot(store, tenantId, { runLimit: 10 });
    assert.equal(dashboard.summary.total_runs, 3);
    assert.equal(dashboard.summary.active_runs, 1);
    assert.equal(dashboard.summary.failed_runs, 1);
    assert.equal(dashboard.summary.summary_only_runs, 0);
    assert.equal(dashboard.selected_run_id, 'run_diag_smoke_v1');
    assert.ok(dashboard.selected_run_detail);
    assert.equal(dashboard.selected_run_detail?.metrics.length, 5);
    assert.ok(dashboard.summary.registry_link_coverage_pct > 0);
    assert.ok(dashboard.summary.safety_metric_coverage_pct > 0);
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
