const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const serviceSourcePath = path.join(appRoot, 'lib', 'experiments', 'service.ts');
const generatedDir = path.join(appRoot, '.generated-tests');
const generatedServicePath = path.join(generatedDir, 'experiments.service.cjs');

function compileServiceModule() {
    fs.mkdirSync(generatedDir, { recursive: true });
    const source = fs.readFileSync(serviceSourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: serviceSourcePath,
    });
    fs.writeFileSync(generatedServicePath, transpiled.outputText, 'utf8');
    delete require.cache[generatedServicePath];
    return require(generatedServicePath);
}

function cleanupGeneratedArtifacts() {
    fs.rmSync(generatedDir, { recursive: true, force: true });
}

function createRun({ tenantId, runId, modelVersion, registryId, role = 'experimental', lifecycle = 'candidate' }) {
    const now = '2026-03-29T00:00:00.000Z';
    return {
        id: `row_${runId}`,
        tenant_id: tenantId,
        run_id: runId,
        experiment_group_id: 'registry_regression',
        sweep_id: null,
        parent_run_id: null,
        baseline_run_id: null,
        task_type: 'clinical_diagnosis',
        modality: 'tabular_clinical',
        target_type: 'diagnostics',
        model_arch: 'diag-net',
        model_size: 'medium',
        model_version: modelVersion,
        registry_id: registryId,
        dataset_name: 'clinical_cases',
        dataset_version: 'ds_v1',
        feature_schema_version: 'schema_v1',
        label_policy_version: 'labels_v1',
        epochs_planned: 12,
        epochs_completed: 12,
        metric_primary_name: 'macro_f1',
        metric_primary_value: 0.91,
        status: lifecycle === 'production' ? 'promoted' : 'completed',
        status_reason: null,
        progress_percent: 100,
        summary_only: false,
        created_by: 'registry:test',
        hyperparameters: {},
        dataset_lineage: {},
        config_snapshot: {},
        safety_metrics: {},
        resource_usage: {},
        registry_context: {
            model_family: 'diagnostics',
            registry_role: role,
            registry_status: lifecycle,
        },
        last_heartbeat_at: now,
        started_at: now,
        ended_at: now,
        created_at: now,
        updated_at: now,
    };
}

function createRegistry({
    tenantId,
    runId,
    registryId,
    modelVersion,
    lifecycle,
    role,
    rollbackTarget = null,
    artifactUri = `s3://vetios-models/${registryId}.bin`,
    datasetVersion = 'ds_v1',
    featureSchemaVersion = 'schema_v1',
    deployedAt = null,
    archivedAt = null,
    rollbackMetadata = null,
}) {
    const now = '2026-03-29T00:00:00.000Z';
    return {
        registry_id: registryId,
        tenant_id: tenantId,
        run_id: runId,
        model_name: 'VetIOS Diagnostic Model',
        model_version: modelVersion,
        model_family: 'diagnostics',
        artifact_uri: artifactUri,
        dataset_version: datasetVersion,
        feature_schema_version: featureSchemaVersion,
        label_policy_version: 'labels_v1',
        lifecycle_status: lifecycle,
        registry_role: role,
        deployed_at: deployedAt,
        archived_at: archivedAt,
        promoted_from: null,
        rollback_target: rollbackTarget,
        clinical_metrics: {
            global_accuracy: 0.92,
            macro_f1: 0.91,
            critical_recall: 0.9,
            false_reassurance_rate: 0.03,
            fn_critical_rate: 0.02,
            ece: 0.04,
            brier_score: 0.09,
            adversarial_degradation: 0.07,
            latency_p99: 110,
        },
        lineage: {
            run_id: runId,
            experiment_group: 'registry_regression',
            dataset_version: datasetVersion,
            benchmark_id: null,
            calibration_report_uri: null,
            adversarial_report_uri: null,
        },
        rollback_metadata: rollbackMetadata,
        artifact_path: artifactUri,
        status: lifecycle,
        role,
        created_at: now,
        created_by: 'registry:test',
        updated_at: now,
    };
}

function createMetric({
    tenantId,
    runId,
    timestamp = '2026-03-29T00:00:00.000Z',
    macroF1 = 0.91,
    recallCritical = 0.93,
    falseNegativeCriticalRate = null,
    dangerousFalseReassuranceRate = null,
    abstainAccuracy = null,
    contradictionDetectionRate = null,
}) {
    return {
        id: `${runId}_${timestamp}`,
        tenant_id: tenantId,
        run_id: runId,
        epoch: 8,
        global_step: 96,
        train_loss: 0.42,
        val_loss: 0.39,
        train_accuracy: 0.88,
        val_accuracy: 0.9,
        learning_rate: 0.00005,
        gradient_norm: 0.62,
        macro_f1: macroF1,
        recall_critical: recallCritical,
        calibration_error: 0.04,
        adversarial_score: 0.08,
        false_negative_critical_rate: falseNegativeCriticalRate,
        dangerous_false_reassurance_rate: dangerousFalseReassuranceRate,
        abstain_accuracy: abstainAccuracy,
        contradiction_detection_rate: contradictionDetectionRate,
        wall_clock_time_seconds: 3200,
        steps_per_second: 2.1,
        gpu_utilization: 0.58,
        cpu_utilization: 0.35,
        memory_utilization: 0.42,
        metric_timestamp: timestamp,
        created_at: timestamp,
    };
}

function createPromotionRequirements({
    tenantId,
    registryId,
    runId,
    calibrationPass = true,
    adversarialPass = null,
    safetyPass = null,
    benchmarkPass = true,
    manualApproval = true,
}) {
    const now = '2026-03-29T00:00:00.000Z';
    return {
        id: `${runId}_requirements`,
        tenant_id: tenantId,
        registry_id: registryId,
        run_id: runId,
        calibration_pass: calibrationPass,
        adversarial_pass: adversarialPass,
        safety_pass: safetyPass,
        benchmark_pass: benchmarkPass,
        manual_approval: manualApproval,
        created_at: now,
        updated_at: now,
    };
}

function createAdversarialMetrics({
    tenantId,
    runId,
    adversarialPass,
}) {
    const now = '2026-03-29T00:00:00.000Z';
    return {
        id: `${runId}_adversarial`,
        tenant_id: tenantId,
        run_id: runId,
        degradation_score: adversarialPass ? 0.11 : 0.34,
        contradiction_robustness: adversarialPass ? 0.9 : 0.61,
        critical_case_recall: adversarialPass ? 0.95 : 0.79,
        false_reassurance_rate: adversarialPass ? 0.03 : 0.18,
        dangerous_false_reassurance_rate: adversarialPass ? 0.03 : 0.18,
        adversarial_pass: adversarialPass,
        created_at: now,
        updated_at: now,
    };
}

function createStore({
    runs,
    registryRecords,
    metrics = [],
    promotionRequirements = [],
    adversarialMetrics = [],
    calibrationMetrics = [],
    deploymentDecisions = [],
}) {
    return {
        async listExperimentRuns() {
            return runs;
        },
        async listModelRegistryEntries() {
            return [];
        },
        async listLearningDatasetVersions() {
            return [];
        },
        async listLearningBenchmarkReports() {
            return [];
        },
        async listLearningCalibrationReports() {
            return [];
        },
        async listExperimentBenchmarks() {
            return [];
        },
        async getExperimentRegistryLink() {
            return null;
        },
        async listExperimentMetrics(tenantId, runId) {
            return metrics.filter((entry) => entry.tenant_id === tenantId && entry.run_id === runId);
        },
        async listModelRegistry() {
            return registryRecords;
        },
        async listPromotionRequirements() {
            return promotionRequirements;
        },
        async listRegistryRoutingPointers() {
            return [];
        },
        async listRegistryAuditLog() {
            return [];
        },
        async getCalibrationMetrics(tenantId, runId) {
            return calibrationMetrics.find((entry) => entry.tenant_id === tenantId && entry.run_id === runId) ?? null;
        },
        async getAdversarialMetrics(tenantId, runId) {
            return adversarialMetrics.find((entry) => entry.tenant_id === tenantId && entry.run_id === runId) ?? null;
        },
        async getDeploymentDecision(tenantId, runId) {
            return deploymentDecisions.find((entry) => entry.tenant_id === tenantId && entry.run_id === runId) ?? null;
        },
    };
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function runScenario(name, buildScenario, verifyScenario, getSnapshot) {
    const scenario = buildScenario();
    const store = createStore(scenario);
    const snapshot = await getSnapshot(store, scenario.tenantId, { readOnly: true });
    verifyScenario(snapshot);
    const family = snapshot.families.find((entry) => entry.model_family === 'diagnostics');
    const activeRegistryId = family?.active_registry_id ?? 'n/a';
    console.log(`PASS ${name} -> health=${snapshot.registry_health}, active=${activeRegistryId}`);
}

async function main() {
    const serviceModule = compileServiceModule();
    const getModelRegistryControlPlaneSnapshot = serviceModule.getModelRegistryControlPlaneSnapshot;
    if (typeof getModelRegistryControlPlaneSnapshot !== 'function') {
        throw new Error('Failed to load getModelRegistryControlPlaneSnapshot from experiments service module.');
    }

    await runScenario(
        'archived fallback clears critical rollback degradation',
        () => {
            const tenantId = 'tenant_archived_fallback';
            const championRun = createRun({
                tenantId,
                runId: 'run_champion',
                modelVersion: 'diag_complete_v1',
                registryId: 'reg_run_diag_complete_v1',
                role: 'champion',
                lifecycle: 'production',
            });
            const archivedRun = createRun({
                tenantId,
                runId: 'run_prev',
                modelVersion: 'diag_complete_v0',
                registryId: 'reg_run_diag_complete_v0',
                role: 'experimental',
                lifecycle: 'archived',
            });

            return {
                tenantId,
                runs: [championRun, archivedRun],
                registryRecords: [
                    createRegistry({
                        tenantId,
                        runId: championRun.run_id,
                        registryId: 'reg_run_diag_complete_v1',
                        modelVersion: championRun.model_version,
                        lifecycle: 'production',
                        role: 'champion',
                        rollbackTarget: null,
                        deployedAt: '2026-03-28T00:00:00.000Z',
                    }),
                    createRegistry({
                        tenantId,
                        runId: archivedRun.run_id,
                        registryId: 'reg_run_diag_complete_v0',
                        modelVersion: archivedRun.model_version,
                        lifecycle: 'archived',
                        role: 'experimental',
                        deployedAt: '2026-03-20T00:00:00.000Z',
                        archivedAt: '2026-03-28T00:00:00.000Z',
                    }),
                ],
            };
        },
        (snapshot) => {
            assert(snapshot.registry_health === 'healthy', 'Expected healthy registry health when an archived rollback fallback exists.');
            const family = snapshot.families.find((entry) => entry.model_family === 'diagnostics');
            assert(family?.last_stable_model?.registry_id === 'reg_run_diag_complete_v0', 'Expected archived previous model to become last_stable_model.');
            const championEntry = family?.entries.find((entry) => entry.registry.registry_id === 'reg_run_diag_complete_v1');
            assert(championEntry?.rollback_readiness.ready === true, 'Expected rollback readiness to be ready with archived fallback.');
            const rollbackIssue = snapshot.consistency_issues.find((issue) => issue.code === 'missing_rollback_target');
            assert(rollbackIssue?.severity === 'warning', 'Expected missing rollback target to downgrade to warning when inferred fallback exists.');
        },
        getModelRegistryControlPlaneSnapshot,
    );

    await runScenario(
        'missing fallback remains degraded',
        () => {
            const tenantId = 'tenant_missing_fallback';
            const championRun = createRun({
                tenantId,
                runId: 'run_champion_only',
                modelVersion: 'diag_complete_v1',
                registryId: 'reg_run_diag_complete_v1',
                role: 'champion',
                lifecycle: 'production',
            });

            return {
                tenantId,
                runs: [championRun],
                registryRecords: [
                    createRegistry({
                        tenantId,
                        runId: championRun.run_id,
                        registryId: 'reg_run_diag_complete_v1',
                        modelVersion: championRun.model_version,
                        lifecycle: 'production',
                        role: 'champion',
                        rollbackTarget: null,
                        deployedAt: '2026-03-28T00:00:00.000Z',
                    }),
                ],
            };
        },
        (snapshot) => {
            assert(snapshot.registry_health === 'degraded', 'Expected degraded registry health when no rollback fallback exists.');
            const family = snapshot.families.find((entry) => entry.model_family === 'diagnostics');
            const championEntry = family?.entries.find((entry) => entry.registry.registry_id === 'reg_run_diag_complete_v1');
            assert(championEntry?.rollback_readiness.ready === false, 'Expected rollback readiness to fail when no fallback exists.');
            const rollbackIssue = snapshot.consistency_issues.find((issue) => issue.code === 'missing_rollback_target');
            assert(rollbackIssue?.severity === 'critical', 'Expected missing rollback target to remain critical without a fallback.');
        },
        getModelRegistryControlPlaneSnapshot,
    );

    await runScenario(
        'stale explicit pointer falls back to valid archived target',
        () => {
            const tenantId = 'tenant_stale_pointer';
            const championRun = createRun({
                tenantId,
                runId: 'run_champion_stale',
                modelVersion: 'diag_complete_v2',
                registryId: 'reg_run_diag_complete_v2',
                role: 'champion',
                lifecycle: 'production',
            });
            const archivedRun = createRun({
                tenantId,
                runId: 'run_prev_valid',
                modelVersion: 'diag_complete_v1',
                registryId: 'reg_run_diag_complete_v1',
                role: 'experimental',
                lifecycle: 'archived',
            });

            return {
                tenantId,
                runs: [championRun, archivedRun],
                registryRecords: [
                    createRegistry({
                        tenantId,
                        runId: championRun.run_id,
                        registryId: 'reg_run_diag_complete_v2',
                        modelVersion: championRun.model_version,
                        lifecycle: 'production',
                        role: 'champion',
                        rollbackTarget: 'reg_missing_target',
                        deployedAt: '2026-03-29T00:00:00.000Z',
                    }),
                    createRegistry({
                        tenantId,
                        runId: archivedRun.run_id,
                        registryId: 'reg_run_diag_complete_v1',
                        modelVersion: archivedRun.model_version,
                        lifecycle: 'archived',
                        role: 'experimental',
                        deployedAt: '2026-03-20T00:00:00.000Z',
                        archivedAt: '2026-03-28T00:00:00.000Z',
                    }),
                ],
            };
        },
        (snapshot) => {
            const family = snapshot.families.find((entry) => entry.model_family === 'diagnostics');
            const championEntry = family?.entries.find((entry) => entry.registry.registry_id === 'reg_run_diag_complete_v2');
            assert(championEntry?.rollback_readiness.ready === true, 'Expected rollback readiness to use the archived fallback when explicit pointer is stale.');
            assert(championEntry?.rollback_readiness.target_registry_id === 'reg_run_diag_complete_v1', 'Expected archived valid fallback to outrank stale explicit pointer.');
            assert(snapshot.registry_health === 'healthy', 'Expected healthy registry health when stale explicit pointer can be replaced by archived fallback.');
        },
        getModelRegistryControlPlaneSnapshot,
    );

    await runScenario(
        'live champion clears adversarial and safety watchlist when telemetry is complete',
        () => {
            const tenantId = 'tenant_live_watchlist_clear';
            const championRun = createRun({
                tenantId,
                runId: 'run_live_clear',
                modelVersion: 'diag_live_clear_v1',
                registryId: 'reg_live_clear_v1',
                role: 'champion',
                lifecycle: 'production',
            });

            return {
                tenantId,
                runs: [championRun],
                registryRecords: [
                    createRegistry({
                        tenantId,
                        runId: championRun.run_id,
                        registryId: 'reg_live_clear_v1',
                        modelVersion: championRun.model_version,
                        lifecycle: 'production',
                        role: 'champion',
                        rollbackTarget: 'reg_live_clear_prev',
                        deployedAt: '2026-03-29T00:00:00.000Z',
                    }),
                ],
                metrics: [
                    createMetric({
                        tenantId,
                        runId: championRun.run_id,
                        falseNegativeCriticalRate: 0.05,
                        dangerousFalseReassuranceRate: 0.03,
                        abstainAccuracy: 0.87,
                        contradictionDetectionRate: 0.9,
                    }),
                ],
                promotionRequirements: [
                    createPromotionRequirements({
                        tenantId,
                        registryId: 'reg_live_clear_v1',
                        runId: championRun.run_id,
                        calibrationPass: true,
                        benchmarkPass: true,
                        manualApproval: true,
                    }),
                ],
                adversarialMetrics: [
                    createAdversarialMetrics({
                        tenantId,
                        runId: championRun.run_id,
                        adversarialPass: true,
                    }),
                ],
            };
        },
        (snapshot) => {
            const family = snapshot.families.find((entry) => entry.model_family === 'diagnostics');
            const championEntry = family?.entries.find((entry) => entry.registry.registry_id === 'reg_live_clear_v1');
            const blockers = championEntry?.promotion_gating.blockers ?? [];
            assert(!blockers.includes('Adversarial gate has not passed.'), 'Expected adversarial warning to clear once adversarial metrics pass.');
            assert(!blockers.includes('Clinical safety evaluation is still pending.'), 'Expected clinical safety pending warning to clear once full safety telemetry exists.');
            assert(championEntry?.promotion_gating.gates.adversarial === 'pass', 'Expected adversarial gate to pass with passing adversarial metrics.');
            assert(championEntry?.promotion_gating.gates.safety === 'pass', 'Expected safety gate to pass with full safety telemetry.');
        },
        getModelRegistryControlPlaneSnapshot,
    );

    await runScenario(
        'live champion keeps adversarial and safety watchlist when telemetry is incomplete or failed',
        () => {
            const tenantId = 'tenant_live_watchlist_blocked';
            const championRun = createRun({
                tenantId,
                runId: 'run_live_blocked',
                modelVersion: 'diag_live_blocked_v1',
                registryId: 'reg_live_blocked_v1',
                role: 'champion',
                lifecycle: 'production',
            });

            return {
                tenantId,
                runs: [championRun],
                registryRecords: [
                    createRegistry({
                        tenantId,
                        runId: championRun.run_id,
                        registryId: 'reg_live_blocked_v1',
                        modelVersion: championRun.model_version,
                        lifecycle: 'production',
                        role: 'champion',
                        rollbackTarget: 'reg_live_blocked_prev',
                        deployedAt: '2026-03-29T00:00:00.000Z',
                    }),
                ],
                metrics: [
                    createMetric({
                        tenantId,
                        runId: championRun.run_id,
                        falseNegativeCriticalRate: null,
                        dangerousFalseReassuranceRate: null,
                        abstainAccuracy: null,
                        contradictionDetectionRate: null,
                    }),
                ],
                promotionRequirements: [
                    createPromotionRequirements({
                        tenantId,
                        registryId: 'reg_live_blocked_v1',
                        runId: championRun.run_id,
                        calibrationPass: true,
                        benchmarkPass: true,
                        manualApproval: true,
                    }),
                ],
                adversarialMetrics: [
                    createAdversarialMetrics({
                        tenantId,
                        runId: championRun.run_id,
                        adversarialPass: false,
                    }),
                ],
            };
        },
        (snapshot) => {
            const family = snapshot.families.find((entry) => entry.model_family === 'diagnostics');
            const championEntry = family?.entries.find((entry) => entry.registry.registry_id === 'reg_live_blocked_v1');
            const blockers = championEntry?.promotion_gating.blockers ?? [];
            assert(blockers.includes('Adversarial gate has not passed.'), 'Expected adversarial warning to remain when adversarial metrics fail.');
            assert(blockers.includes('Clinical safety evaluation is still pending.'), 'Expected clinical safety pending warning to remain with partial safety telemetry.');
            assert(championEntry?.promotion_gating.gates.adversarial === 'fail', 'Expected adversarial gate to fail with failing adversarial metrics.');
            assert(championEntry?.promotion_gating.gates.safety === 'pending', 'Expected safety gate to stay pending without full safety telemetry.');
        },
        getModelRegistryControlPlaneSnapshot,
    );

    console.log('All registry control plane regression scenarios passed.');
    cleanupGeneratedArtifacts();
}

main().catch((error) => {
    cleanupGeneratedArtifacts();
    console.error('Registry control plane regression failed.');
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
});
