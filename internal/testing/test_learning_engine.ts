import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runAdversarialEvaluation } from '../../apps/web/lib/learningEngine/adversarialEvalRunner.ts';
import { runBenchmarkSuite } from '../../apps/web/lib/learningEngine/benchmarkRunner.ts';
import { buildCalibrationReport } from '../../apps/web/lib/learningEngine/calibrationEngine.ts';
import { buildLearningDatasetBundle } from '../../apps/web/lib/learningEngine/datasetBuilder.ts';
import { runLearningCycle } from '../../apps/web/lib/learningEngine/engine.ts';
import { trainDiagnosisModel } from '../../apps/web/lib/learningEngine/diagnosisTrainer.ts';
import { seedDefaultLearningSchedulerJobs } from '../../apps/web/lib/learningEngine/learningScheduler.ts';
import { resolveDiagnosisLabel } from '../../apps/web/lib/learningEngine/labelResolver.ts';
import { registerCandidateModels } from '../../apps/web/lib/learningEngine/modelRegistryConnector.ts';
import { selectChampionChallengerDecision } from '../../apps/web/lib/learningEngine/modelSelector.ts';
import { getLearningDashboardSnapshot } from '../../apps/web/lib/learningEngine/performanceDashboard.ts';
import { evaluateRollbackGuard } from '../../apps/web/lib/learningEngine/rollbackGuard.ts';
import { trainSeverityModel } from '../../apps/web/lib/learningEngine/severityTrainer.ts';
import {
    DEFAULT_FEATURE_SCHEMA_VERSION,
    DEFAULT_LABEL_POLICY_VERSION,
    type LearningAuditEventRecord,
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
    type ModelRegistryEntryRecord,
} from '../../apps/web/lib/learningEngine/types.ts';

class InMemoryLearningEngineStore implements LearningEngineStore {
    clinicalCases: LearningCaseRecord[] = [];
    inferenceEvents: LearningInferenceEvent[] = [];
    outcomeEvents: LearningOutcomeEvent[] = [];
    simulationEvents: LearningSimulationEvent[] = [];
    evaluationEvents: LearningEvaluationEvent[] = [];
    datasetVersions: LearningDatasetVersionRecord[] = [];
    learningCycles: LearningCycleRecord[] = [];
    benchmarkReports: LearningBenchmarkReportRecord[] = [];
    calibrationReports: LearningCalibrationReportRecord[] = [];
    auditEvents: LearningAuditEventRecord[] = [];
    rollbackEvents: LearningRollbackEventRecord[] = [];
    modelRegistryEntries: ModelRegistryEntryRecord[] = [];
    schedulerJobs: LearningSchedulerJobRecord[] = [];

    async listClinicalCases(filters: LearningDatasetFilters): Promise<LearningCaseRecord[]> {
        return this.clinicalCases.filter((record) =>
            record.tenant_id === filters.tenantId &&
            (!filters.from || record.updated_at >= filters.from) &&
            (!filters.to || record.updated_at <= filters.to) &&
            (!filters.species?.length || filters.species.includes(record.species_canonical ?? '')) &&
            (!filters.caseClusters?.length || filters.caseClusters.includes(record.case_cluster ?? '')) &&
            (!filters.labelTypes?.length || filters.labelTypes.includes(record.label_type)) &&
            (filters.includeAdversarial !== false || !record.adversarial_case)
        ).slice(0, filters.limit ?? 2_000).map(clone);
    }

    async listInferenceEvents(filters: LearningDatasetFilters): Promise<LearningInferenceEvent[]> {
        return this.inferenceEvents.filter((record) =>
            record.tenant_id === filters.tenantId &&
            (!filters.from || record.created_at >= filters.from) &&
            (!filters.to || record.created_at <= filters.to)
        ).slice(0, filters.limit ?? 2_000).map(clone);
    }

    async listOutcomeEvents(filters: LearningDatasetFilters): Promise<LearningOutcomeEvent[]> {
        return this.outcomeEvents.filter((record) =>
            record.tenant_id === filters.tenantId &&
            (!filters.from || record.outcome_timestamp >= filters.from) &&
            (!filters.to || record.outcome_timestamp <= filters.to)
        ).slice(0, filters.limit ?? 2_000).map(clone);
    }

    async listSimulationEvents(filters: LearningDatasetFilters): Promise<LearningSimulationEvent[]> {
        return this.simulationEvents.filter((record) =>
            record.tenant_id === filters.tenantId &&
            (!filters.from || record.created_at >= filters.from) &&
            (!filters.to || record.created_at <= filters.to)
        ).slice(0, filters.limit ?? 2_000).map(clone);
    }

    async listEvaluationEvents(filters: LearningDatasetFilters): Promise<LearningEvaluationEvent[]> {
        return this.evaluationEvents.filter((record) =>
            record.tenant_id === filters.tenantId &&
            (!filters.from || record.created_at >= filters.from) &&
            (!filters.to || record.created_at <= filters.to)
        ).slice(0, filters.limit ?? 2_000).map(clone);
    }

    async createDatasetVersion(record: Omit<LearningDatasetVersionRecord, 'id' | 'created_at'>): Promise<LearningDatasetVersionRecord> {
        const created = withIdAndCreated(record);
        this.datasetVersions.push(created);
        return clone(created);
    }

    async createLearningCycle(record: Omit<LearningCycleRecord, 'id' | 'created_at' | 'updated_at'>): Promise<LearningCycleRecord> {
        const now = new Date().toISOString();
        const created: LearningCycleRecord = { ...record, id: randomUUID(), created_at: now, updated_at: now };
        this.learningCycles.push(created);
        return clone(created);
    }

    async updateLearningCycle(id: string, tenantId: string, patch: Partial<Omit<LearningCycleRecord, 'id' | 'tenant_id' | 'created_at'>>): Promise<LearningCycleRecord> {
        const existing = this.learningCycles.find((record) => record.id === id && record.tenant_id === tenantId);
        if (!existing) throw new Error(`Learning cycle not found: ${id}`);
        Object.assign(existing, patch, { updated_at: new Date().toISOString() });
        return clone(existing);
    }

    async createBenchmarkReport(record: Omit<LearningBenchmarkReportRecord, 'id' | 'created_at'>): Promise<LearningBenchmarkReportRecord> {
        const created = withIdAndCreated(record);
        this.benchmarkReports.push(created);
        return clone(created);
    }

    async createCalibrationReport(record: Omit<LearningCalibrationReportRecord, 'id' | 'created_at'>): Promise<LearningCalibrationReportRecord> {
        const created = withIdAndCreated(record);
        this.calibrationReports.push(created);
        return clone(created);
    }

    async createAuditEvent(record: Omit<LearningAuditEventRecord, 'id' | 'created_at'>): Promise<LearningAuditEventRecord> {
        const created = withIdAndCreated(record);
        this.auditEvents.push(created);
        return clone(created);
    }

    async createRollbackEvent(record: Omit<LearningRollbackEventRecord, 'id' | 'created_at'>): Promise<LearningRollbackEventRecord> {
        const created = withIdAndCreated(record);
        this.rollbackEvents.push(created);
        return clone(created);
    }

    async listModelRegistryEntries(tenantId: string, taskType?: LearningTaskType | null): Promise<ModelRegistryEntryRecord[]> {
        return this.modelRegistryEntries.filter((record) =>
            record.tenant_id === tenantId && (!taskType || record.task_type === taskType)
        ).sort((left, right) => right.updated_at.localeCompare(left.updated_at)).map(clone);
    }

    async createModelRegistryEntry(record: Omit<ModelRegistryEntryRecord, 'id' | 'created_at' | 'updated_at'>): Promise<ModelRegistryEntryRecord> {
        const now = new Date().toISOString();
        const created: ModelRegistryEntryRecord = { ...record, id: randomUUID(), created_at: now, updated_at: now };
        this.modelRegistryEntries.push(created);
        return clone(created);
    }

    async updateModelRegistryEntry(id: string, tenantId: string, patch: Partial<Omit<ModelRegistryEntryRecord, 'id' | 'tenant_id' | 'created_at'>>): Promise<ModelRegistryEntryRecord> {
        const existing = this.modelRegistryEntries.find((record) => record.id === id && record.tenant_id === tenantId);
        if (!existing) throw new Error(`Model registry entry not found: ${id}`);
        Object.assign(existing, patch, { updated_at: new Date().toISOString() });
        return clone(existing);
    }

    async listLearningCycles(tenantId: string, limit: number): Promise<LearningCycleRecord[]> {
        return this.learningCycles.filter((record) => record.tenant_id === tenantId)
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, limit)
            .map(clone);
    }

    async listBenchmarkReports(tenantId: string, limit: number): Promise<LearningBenchmarkReportRecord[]> {
        return this.benchmarkReports.filter((record) => record.tenant_id === tenantId)
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, limit)
            .map(clone);
    }

    async listCalibrationReports(tenantId: string, limit: number): Promise<LearningCalibrationReportRecord[]> {
        return this.calibrationReports.filter((record) => record.tenant_id === tenantId)
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, limit)
            .map(clone);
    }

    async listRollbackEvents(tenantId: string, limit: number): Promise<LearningRollbackEventRecord[]> {
        return this.rollbackEvents.filter((record) => record.tenant_id === tenantId)
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, limit)
            .map(clone);
    }

    async listSchedulerJobs(tenantId: string): Promise<LearningSchedulerJobRecord[]> {
        return this.schedulerJobs.filter((record) => record.tenant_id === tenantId)
            .sort((left, right) => left.created_at.localeCompare(right.created_at))
            .map(clone);
    }

    async upsertSchedulerJob(record: Omit<LearningSchedulerJobRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<LearningSchedulerJobRecord> {
        const existing = this.schedulerJobs.find((job) =>
            (record.id && job.id === record.id) ||
            (job.tenant_id === record.tenant_id && job.job_name === record.job_name),
        );
        const now = new Date().toISOString();

        if (existing) {
            Object.assign(existing, record, { updated_at: now });
            return clone(existing);
        }

        const created: LearningSchedulerJobRecord = {
            ...record,
            id: record.id ?? randomUUID(),
            created_at: now,
            updated_at: now,
        };
        this.schedulerJobs.push(created);
        return clone(created);
    }
}

async function main() {
    const tenantId = makeUuid(1);
    const store = buildFixtureStore(tenantId);

    const datasetBundle = await buildLearningDatasetBundle(store, {
        tenantId,
        includeSynthetic: true,
        includeAdversarial: true,
        includeQuarantine: true,
    });
    assert.equal(datasetBundle.summary.total_cases, 6);
    assert.equal(datasetBundle.diagnosis_training_set.length, 4);
    assert.equal(datasetBundle.severity_training_set.length, 4);
    assert.equal(datasetBundle.calibration_eval_set.length, 4);
    assert.equal(datasetBundle.adversarial_benchmark_set.length, 1);
    assert.equal(datasetBundle.quarantine_set.length, 1);

    const inferredOnlyLabel = resolveDiagnosisLabel(store.clinicalCases.find((row) => row.case_id === makeUuid(14))!);
    assert.equal(inferredOnlyLabel.trusted, false);
    const expertLabel = resolveDiagnosisLabel(store.clinicalCases.find((row) => row.case_id === makeUuid(11))!);
    assert.equal(expertLabel.trusted, true);
    assert.equal(expertLabel.labelWeight, 0.85);

    const diagnosisTraining = trainDiagnosisModel(datasetBundle.diagnosis_training_set, {
        datasetVersion: datasetBundle.dataset_version,
        featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
        labelPolicyVersion: DEFAULT_LABEL_POLICY_VERSION,
    });
    assert.ok(diagnosisTraining.metrics.accuracy >= 0.75);
    assert.ok(diagnosisTraining.metrics.macro_f1 >= 0.7);

    const severityTraining = trainSeverityModel(datasetBundle.severity_training_set, {
        datasetVersion: datasetBundle.dataset_version,
        featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
        labelPolicyVersion: DEFAULT_LABEL_POLICY_VERSION,
    });
    assert.ok(severityTraining.metrics.critical_recall >= 0.9);
    assert.ok(severityTraining.metrics.emergency_false_negative_rate <= 0.1);

    const calibrationReport = buildCalibrationReport(datasetBundle.calibration_eval_set);
    assert.ok(calibrationReport.expected_calibration_error !== null);
    assert.equal(calibrationReport.reliability_bins.length, 5);

    const adversarialReport = runAdversarialEvaluation(datasetBundle.adversarial_benchmark_set, {
        diagnosis: diagnosisTraining.artifact,
        severity: severityTraining.artifact,
        candidateModelVersion: diagnosisTraining.artifact.model_version,
    });
    assert.equal(adversarialReport.pass, true);
    assert.ok(adversarialReport.contradiction_detection_rate >= 0.8);

    const benchmarkSummary = runBenchmarkSuite(datasetBundle, {
        diagnosis: diagnosisTraining.artifact,
        severity: severityTraining.artifact,
        candidateModelVersion: diagnosisTraining.artifact.model_version,
    });
    assert.equal(benchmarkSummary.pass, true);

    const championBenchmark = {
        ...benchmarkSummary,
        candidate_model_version: 'champion_v0',
        diagnosis_metrics: benchmarkSummary.diagnosis_metrics
            ? { ...benchmarkSummary.diagnosis_metrics, accuracy: benchmarkSummary.diagnosis_metrics.accuracy - 0.05 }
            : null,
        severity_metrics: benchmarkSummary.severity_metrics
            ? { ...benchmarkSummary.severity_metrics, critical_recall: benchmarkSummary.severity_metrics.critical_recall - 0.05 }
            : null,
        calibration_report: benchmarkSummary.calibration_report
            ? { ...benchmarkSummary.calibration_report, expected_calibration_error: (benchmarkSummary.calibration_report.expected_calibration_error ?? 0) + 0.03 }
            : null,
    };
    const selection = selectChampionChallengerDecision({
        candidateModelVersion: diagnosisTraining.artifact.model_version,
        championModelVersion: 'champion_v0',
        candidateBenchmark: benchmarkSummary,
        championBenchmark,
        candidateAdversarial: adversarialReport,
        championAdversarial: {
            ...adversarialReport,
            candidate_model_version: 'champion_v0',
            contradiction_detection_rate: adversarialReport.contradiction_detection_rate - 0.1,
        },
    });
    assert.equal(selection.decision, 'promote');

    const registeredModels = await registerCandidateModels(store, {
        tenantId,
        diagnosisArtifact: diagnosisTraining.artifact,
        severityArtifact: severityTraining.artifact,
        benchmarkSummary,
        featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
        labelPolicyVersion: DEFAULT_LABEL_POLICY_VERSION,
    });
    assert.equal(registeredModels.length, 2);

    store.evaluationEvents.push(makeEvaluationEvent(tenantId, {
        calibration_error: 0.34,
        drift_score: 0.41,
        simulation_degradation: 0.32,
    }));
    const rollbackEvaluation = await evaluateRollbackGuard(store, tenantId);
    assert.equal(rollbackEvaluation.should_rollback, true);
    assert.ok(rollbackEvaluation.reasons.length >= 2);

    await seedDefaultLearningSchedulerJobs(store, tenantId);
    assert.equal(store.schedulerJobs.length, 4);

    const cycleResult = await runLearningCycle(store, {
        tenantId,
        cycleType: 'manual_review',
        triggerMode: 'dry_run',
        requestPayload: { source: 'test_learning_engine' },
    });
    assert.equal(cycleResult.cycle.status, 'completed');
    assert.ok(cycleResult.dataset_bundle.dataset_version.startsWith('ldv_'));
    assert.equal(cycleResult.registered_models.length, 0);

    const dashboard = await getLearningDashboardSnapshot(store, { tenantId });
    assert.equal(dashboard.dataset_summary.total_cases, 6);
    assert.ok(dashboard.latest_cycles.length >= 1);

    console.log('Learning engine integration tests passed.');
}

function buildFixtureStore(tenantId: string): InMemoryLearningEngineStore {
    const store = new InMemoryLearningEngineStore();
    const ids = {
        gdv: makeUuid(10),
        distemper: makeUuid(11),
        parvo: makeUuid(12),
        pancreatitis: makeUuid(13),
        adversarial: makeUuid(14),
        invalid: makeUuid(15),
    };

    store.clinicalCases = [
        makeCase(tenantId, ids.gdv, 'Gastric Dilatation-Volvulus', 'Mechanical', 0.96, 0.95, 'CRITICAL', 'lab_confirmed', {
            breed: 'Great Dane',
            symptom_text_raw: 'unproductive retching, abdominal distension, collapse',
            symptom_keys: ['retching_unproductive', 'abdominal_distension', 'collapse', 'tachycardia'],
            symptom_vector_normalized: { retching_unproductive: true, abdominal_distension: true, collapse: true, tachycardia: true },
            confirmed_diagnosis: 'Gastric Dilatation-Volvulus',
            case_cluster: 'GDV',
            latest_inference_event_id: makeUuid(101),
            latest_outcome_event_id: makeUuid(201),
            prediction_correct: true,
            confidence_error: 0.04,
            calibration_bucket: '80-100',
        }),
        makeCase(tenantId, ids.distemper, 'Canine Distemper', 'Infectious', 0.94, 0.74, 'HIGH', 'expert_reviewed', {
            symptom_text_raw: 'ocular discharge, nasal discharge, myoclonus, fever',
            symptom_keys: ['ocular_discharge', 'nasal_discharge', 'myoclonus', 'fever'],
            symptom_vector_normalized: { ocular_discharge: true, nasal_discharge: true, myoclonus: true, fever: true },
            confirmed_diagnosis: 'Canine Distemper',
            case_cluster: 'Distemper',
            latest_inference_event_id: makeUuid(102),
            latest_outcome_event_id: makeUuid(202),
            prediction_correct: true,
            confidence_error: 0.06,
            calibration_bucket: '80-100',
        }),
        makeCase(tenantId, ids.parvo, 'Canine Parvovirus', 'Infectious', 0.95, 0.82, 'HIGH', 'synthetic', {
            breed: 'Labrador Retriever',
            symptom_text_raw: 'bloody diarrhea, vomiting, lethargy',
            symptom_keys: ['hemorrhagic_diarrhea', 'vomiting', 'lethargy'],
            symptom_vector_normalized: { hemorrhagic_diarrhea: true, vomiting: true, lethargy: true },
            confirmed_diagnosis: 'Canine Parvovirus',
            case_cluster: 'Parvovirus',
            latest_inference_event_id: makeUuid(103),
            latest_outcome_event_id: makeUuid(203),
            prediction_correct: true,
            confidence_error: 0.05,
            calibration_bucket: '80-100',
        }),
        makeCase(tenantId, ids.pancreatitis, 'Pancreatitis', 'Inflammatory', 0.92, 0.58, 'MODERATE', 'expert_reviewed', {
            breed: 'Bulldog',
            symptom_text_raw: 'vomiting, abdominal pain, fever',
            symptom_keys: ['vomiting', 'abdominal_pain', 'fever'],
            symptom_vector_normalized: { vomiting: true, abdominal_pain: true, fever: true },
            confirmed_diagnosis: 'Pancreatitis',
            contradiction_score: 0.12,
            contradiction_flags: ['temperature metadata mismatch'],
            case_cluster: 'Pancreatitis',
            latest_inference_event_id: makeUuid(104),
            latest_outcome_event_id: makeUuid(204),
            prediction_correct: true,
            confidence_error: 0.08,
            calibration_bucket: '80-100',
        }),
        makeCase(tenantId, ids.adversarial, 'Gastric Dilatation-Volvulus', 'Mechanical', 0.44, 0.93, 'CRITICAL', 'inferred_only', {
            breed: 'Great Dane',
            symptom_text_raw: 'unproductive retching, abdominal distension, dyspnea, pale gums',
            symptom_keys: ['retching_unproductive', 'abdominal_distension', 'dyspnea', 'pale_mucous_membranes'],
            symptom_vector_normalized: { retching_unproductive: true, abdominal_distension: true, dyspnea: true, pale_mucous_membranes: true },
            confirmed_diagnosis: null,
            contradiction_score: 0.69,
            contradiction_flags: ['abdominal distension conflict', 'appetite severity mismatch'],
            adversarial_case: true,
            adversarial_case_type: 'hard_contradiction_noise',
            uncertainty_notes: ['Contradictory metadata reduces certainty.'],
            case_cluster: 'Adversarial Mechanical',
            degraded_confidence: 0.44,
            differential_spread: { top_1_probability: 0.44, top_2_probability: 0.23, spread: 0.21 },
            latest_inference_event_id: makeUuid(105),
            latest_simulation_event_id: makeUuid(301),
            calibration_status: 'pending_outcome',
            prediction_correct: null,
            confidence_error: null,
            calibration_bucket: null,
        }),
        {
            ...makeCase(tenantId, ids.invalid, 'Undifferentiated clinical syndrome', 'Undifferentiated', 0.2, 0.2, 'LOW', 'inferred_only'),
            ingestion_status: 'rejected',
            invalid_case: true,
            validation_error_code: 'MISSING_SPECIES_AND_SYMPTOMS',
            species_canonical: null,
            species_display: null,
            symptom_text_raw: null,
            symptom_keys: [],
            symptom_vector_normalized: {},
            top_diagnosis: null,
            predicted_diagnosis: null,
            confirmed_diagnosis: null,
            severity_score: null,
            emergency_level: null,
        },
    ];

    store.inferenceEvents = [
        makeInferenceEvent(tenantId, ids.gdv, makeUuid(101), 'Gastric Dilatation-Volvulus', 'Mechanical', 0.96, 0.95, 'CRITICAL'),
        makeInferenceEvent(tenantId, ids.distemper, makeUuid(102), 'Canine Distemper', 'Infectious', 0.94, 0.74, 'HIGH'),
        makeInferenceEvent(tenantId, ids.parvo, makeUuid(103), 'Canine Parvovirus', 'Infectious', 0.95, 0.82, 'HIGH'),
        makeInferenceEvent(tenantId, ids.pancreatitis, makeUuid(104), 'Pancreatitis', 'Inflammatory', 0.92, 0.58, 'MODERATE'),
        makeInferenceEvent(tenantId, ids.adversarial, makeUuid(105), 'Gastric Dilatation-Volvulus', 'Mechanical', 0.44, 0.93, 'CRITICAL', {
            contradiction_score: 0.69,
            contradiction_reasons: ['abdominal distension conflict', 'appetite severity mismatch'],
            uncertainty_notes: ['Contradictory metadata reduces certainty.'],
            differential_spread: { top_1_probability: 0.44, top_2_probability: 0.23, spread: 0.21 },
        }),
    ];

    store.outcomeEvents = [
        makeOutcomeEvent(tenantId, ids.gdv, makeUuid(201), 'Gastric Dilatation-Volvulus', 'lab_confirmed'),
        makeOutcomeEvent(tenantId, ids.distemper, makeUuid(202), 'Canine Distemper', 'expert_reviewed'),
        makeOutcomeEvent(tenantId, ids.parvo, makeUuid(203), 'Canine Parvovirus', 'synthetic'),
        makeOutcomeEvent(tenantId, ids.pancreatitis, makeUuid(204), 'Pancreatitis', 'expert_reviewed'),
    ];

    store.simulationEvents = [{
        id: makeUuid(301),
        tenant_id: tenantId,
        case_id: ids.adversarial,
        user_id: tenantId,
        source_module: 'adversarial_simulation',
        simulation_type: 'hard_contradiction_noise',
        simulation_parameters: { family: 'gdv_contradiction' },
        triggered_inference_id: makeUuid(105),
        failure_mode: 'confidence_instability',
        stress_metrics: {
            contradiction_analysis: {
                contradiction_score: 0.69,
                contradiction_reasons: ['abdominal distension conflict', 'appetite severity mismatch'],
            },
            target_evaluation: { target_bias_delta: 0.01 },
            differential_spread: { top_1_probability: 0.44, top_2_probability: 0.23, spread: 0.21 },
        },
        is_real_world: false,
        created_at: '2026-03-20T08:11:00.000Z',
    }];

    return store;
}

function makeCase(
    tenantId: string,
    caseId: string,
    diagnosis: string,
    conditionClass: string,
    confidence: number,
    severityScore: number,
    emergencyLevel: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW',
    labelType: LearningCaseRecord['label_type'],
    overrides: Partial<LearningCaseRecord> = {},
): LearningCaseRecord {
    return {
        case_id: caseId,
        tenant_id: tenantId,
        user_id: tenantId,
        clinic_id: makeUuid(2),
        source_module: 'inference_console',
        species_canonical: 'Canis lupus familiaris',
        species_display: 'Dog',
        breed: 'Mixed',
        symptom_text_raw: 'lethargy',
        symptom_keys: ['lethargy'],
        symptom_vector_normalized: { lethargy: true },
        patient_metadata: { age_years: 4, sex: 'female', environment: 'indoor' },
        latest_input_signature: { telemetry: { persistence_rule_triggers: ['triage_rule'] } },
        ingestion_status: 'accepted',
        invalid_case: false,
        validation_error_code: null,
        primary_condition_class: conditionClass,
        top_diagnosis: diagnosis,
        predicted_diagnosis: diagnosis,
        confirmed_diagnosis: diagnosis,
        label_type: labelType,
        diagnosis_confidence: confidence,
        severity_score: severityScore,
        emergency_level: emergencyLevel,
        triage_priority: emergencyLevel === 'CRITICAL' ? 'immediate' : emergencyLevel === 'HIGH' ? 'urgent' : emergencyLevel === 'MODERATE' ? 'standard' : 'low',
        contradiction_score: 0.02,
        contradiction_flags: [],
        adversarial_case: false,
        adversarial_case_type: null,
        uncertainty_notes: [],
        case_cluster: 'Unknown / Mixed',
        model_version: 'diag_v1',
        telemetry_status: 'learning_ready',
        calibration_status: 'calibrated_match',
        prediction_correct: true,
        confidence_error: 0.05,
        calibration_bucket: '80-100',
        degraded_confidence: null,
        differential_spread: null,
        latest_inference_event_id: null,
        latest_outcome_event_id: null,
        latest_simulation_event_id: null,
        first_inference_at: '2026-03-20T08:00:00.000Z',
        last_inference_at: '2026-03-20T08:00:00.000Z',
        created_at: '2026-03-20T08:00:00.000Z',
        updated_at: '2026-03-20T08:00:00.000Z',
        ...overrides,
    };
}

function makeInferenceEvent(
    tenantId: string,
    caseId: string,
    inferenceId: string,
    diagnosis: string,
    conditionClass: string,
    confidence: number,
    severity: number,
    emergencyLevel: string,
    extra: Record<string, unknown> = {},
): LearningInferenceEvent {
    return {
        id: inferenceId,
        tenant_id: tenantId,
        case_id: caseId,
        user_id: tenantId,
        source_module: 'inference_console',
        model_name: 'vetios_diagnosis_frequency_bayes',
        model_version: 'diag_v1',
        input_signature: { species: 'Dog', symptoms: [] },
        output_payload: {
            diagnosis: {
                primary_condition_class: conditionClass,
                top_differentials: [{ name: diagnosis, probability: confidence }],
            },
            risk_assessment: {
                severity_score: severity,
                emergency_level: emergencyLevel,
            },
            ...extra,
        },
        confidence_score: confidence,
        uncertainty_metrics: null,
        compute_profile: null,
        inference_latency_ms: 42,
        created_at: '2026-03-20T08:05:00.000Z',
    };
}

function makeOutcomeEvent(
    tenantId: string,
    caseId: string,
    outcomeId: string,
    diagnosis: string,
    labelType: string,
): LearningOutcomeEvent {
    return {
        id: outcomeId,
        tenant_id: tenantId,
        case_id: caseId,
        user_id: tenantId,
        source_module: 'outcome_learning',
        inference_event_id: null,
        outcome_type: 'clinical_outcome',
        outcome_payload: { confirmed_diagnosis: diagnosis, label_type: labelType },
        outcome_timestamp: '2026-03-20T08:06:00.000Z',
        label_type: labelType,
        created_at: '2026-03-20T08:06:00.000Z',
    };
}

function makeEvaluationEvent(
    tenantId: string,
    overrides: Partial<LearningEvaluationEvent>,
): LearningEvaluationEvent {
    return {
        id: randomUUID(),
        tenant_id: tenantId,
        trigger_type: 'outcome',
        inference_event_id: null,
        outcome_event_id: null,
        model_name: 'vetios_diagnosis_frequency_bayes',
        model_version: 'diag_v1',
        calibration_error: 0.05,
        drift_score: 0.05,
        outcome_alignment_delta: 0.02,
        simulation_degradation: 0.02,
        calibrated_confidence: 0.9,
        epistemic_uncertainty: 0.1,
        aleatoric_uncertainty: 0.08,
        evaluation_payload: {},
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

function withIdAndCreated<T extends Record<string, unknown>>(record: T): T & { id: string; created_at: string } {
    return {
        ...record,
        id: randomUUID(),
        created_at: new Date().toISOString(),
    };
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
