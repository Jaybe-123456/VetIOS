import assert from 'node:assert/strict';
import {
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterInference,
    finalizeClinicalCaseAfterOutcome,
    finalizeClinicalCaseAfterSimulation,
    normalizeSpeciesValue,
    type ClinicalCaseRecord,
    type ClinicalCaseStore,
    type ClinicalCaseUpsertRecord,
} from '../../apps/web/lib/clinicalCases/clinicalCaseManager.ts';
import {
    backfillClinicalCaseLearningState,
    type ClinicalCaseHistoryInferenceEvent,
    type ClinicalCaseHistoryOutcomeEvent,
    type ClinicalCaseHistorySimulationEvent,
} from '../../apps/web/lib/clinicalCases/clinicalCaseBackfill.ts';
import {
    buildClinicalDatasetExport,
    getTenantClinicalDataset,
    type ClinicalCaseLiveRecord,
    type ClinicalDatasetStore,
    type DatasetInferenceEventRecord,
} from '../../apps/web/lib/dataset/clinicalDataset.ts';

class InMemoryClinicalDatasetStore implements ClinicalCaseStore, ClinicalDatasetStore {
    private readonly clinicalCases = new Map<string, ClinicalCaseRecord>();
    private readonly inferenceEvents = new Map<string, DatasetInferenceEventRecord>();
    private idCounter = 1000;

    async findById(tenantId: string, caseId: string): Promise<ClinicalCaseRecord | null> {
        const record = this.clinicalCases.get(caseId);
        return record && record.tenant_id === tenantId ? structuredClone(record) : null;
    }

    async findByCaseKey(tenantId: string, caseKey: string): Promise<ClinicalCaseRecord | null> {
        const record = [...this.clinicalCases.values()].find((candidate) =>
            candidate.tenant_id === tenantId && candidate.case_key === caseKey,
        );
        return record ? structuredClone(record) : null;
    }

    async upsert(record: ClinicalCaseUpsertRecord): Promise<ClinicalCaseRecord> {
        const existing = this.findExistingRecord(record);
        const now = new Date().toISOString();
        const nextRecord: ClinicalCaseRecord = {
            ...structuredClone(existing ?? {}),
            ...structuredClone(record),
            id: existing?.id ?? record.id ?? makeUuid(++this.idCounter),
            created_at: existing?.created_at ?? now,
            updated_at: now,
        } as ClinicalCaseRecord;

        this.clinicalCases.set(nextRecord.id, nextRecord);
        return structuredClone(nextRecord);
    }

    async updateById(tenantId: string, caseId: string, patch: Partial<ClinicalCaseUpsertRecord>): Promise<ClinicalCaseRecord> {
        const existing = this.clinicalCases.get(caseId);
        if (!existing || existing.tenant_id !== tenantId) {
            throw new Error(`Clinical case not found: ${caseId}`);
        }

        const updated: ClinicalCaseRecord = {
            ...existing,
            ...structuredClone(patch),
            id: existing.id,
            created_at: existing.created_at,
            updated_at: new Date().toISOString(),
        };

        this.clinicalCases.set(caseId, updated);
        return structuredClone(updated);
    }

    async listClinicalCases(tenantId: string, limit: number): Promise<ClinicalCaseLiveRecord[]> {
        return [...this.clinicalCases.values()]
            .filter((record) => record.tenant_id === tenantId && !record.invalid_case && record.ingestion_status === 'accepted')
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
            .slice(0, limit)
            .map((record) => this.toLiveRecord(record));
    }

    async listQuarantinedCases(tenantId: string, limit: number): Promise<ClinicalCaseLiveRecord[]> {
        return [...this.clinicalCases.values()]
            .filter((record) => record.tenant_id === tenantId && (record.invalid_case || record.ingestion_status !== 'accepted'))
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
            .slice(0, limit)
            .map((record) => this.toLiveRecord(record));
    }

    async listInferenceEvents(tenantId: string, limit: number): Promise<DatasetInferenceEventRecord[]> {
        return [...this.inferenceEvents.values()]
            .filter((record) => record.tenant_id === tenantId)
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
            .slice(0, limit)
            .map((record) => structuredClone(record));
    }

    appendInferenceEvent(record: DatasetInferenceEventRecord): void {
        this.inferenceEvents.set(record.id, structuredClone(record));
    }

    private findExistingRecord(record: ClinicalCaseUpsertRecord): ClinicalCaseRecord | undefined {
        if (record.id) {
            const byId = this.clinicalCases.get(record.id);
            if (byId?.tenant_id === record.tenant_id) {
                return byId;
            }
        }

        return [...this.clinicalCases.values()].find(
            (candidate) => candidate.tenant_id === record.tenant_id && candidate.case_key === record.case_key,
        );
    }

    private toLiveRecord(record: ClinicalCaseRecord): ClinicalCaseLiveRecord {
        const inference = record.latest_inference_event_id
            ? this.inferenceEvents.get(record.latest_inference_event_id) ?? null
            : null;

        return {
            case_id: record.id,
            tenant_id: record.tenant_id,
            user_id: record.user_id,
            species: record.species_display ?? record.species_canonical ?? record.species,
            breed: record.breed,
            symptoms_summary: record.symptom_summary ?? record.symptom_text_raw,
            symptom_vector_normalized: structuredClone(record.symptom_vector_normalized),
            primary_condition_class: record.primary_condition_class,
            top_diagnosis: record.top_diagnosis,
            predicted_diagnosis: record.predicted_diagnosis,
            confirmed_diagnosis: record.confirmed_diagnosis,
            label_type: record.label_type,
            diagnosis_confidence: record.diagnosis_confidence ?? inference?.confidence_score ?? null,
            severity_score: record.severity_score,
            latest_emergency_level: record.emergency_level,
            triage_priority: record.triage_priority,
            contradiction_score: record.contradiction_score,
            contradiction_flags: [...record.contradiction_flags],
            uncertainty_notes: [...record.uncertainty_notes],
            case_cluster: record.case_cluster,
            model_version: record.model_version,
            telemetry_status: record.telemetry_status,
            calibration_status: record.calibration_status,
            prediction_correct: record.prediction_correct,
            confidence_error: record.confidence_error,
            calibration_bucket: record.calibration_bucket,
            degraded_confidence: record.degraded_confidence,
            differential_spread: structuredClone(record.differential_spread),
            ingestion_status: record.ingestion_status,
            invalid_case: record.invalid_case,
            validation_error_code: record.validation_error_code,
            adversarial_case: record.adversarial_case,
            adversarial_case_type: record.adversarial_case_type,
            latest_inference_event_id: record.latest_inference_event_id,
            latest_outcome_event_id: record.latest_outcome_event_id,
            latest_simulation_event_id: record.latest_simulation_event_id,
            latest_confidence: inference?.confidence_score ?? record.diagnosis_confidence,
            source_module: record.source_module,
            updated_at: record.updated_at,
        };
    }
}

async function main() {
    assert.equal(normalizeSpeciesValue('Canis lupus'), 'Canis lupus familiaris');

    const store = new InMemoryClinicalDatasetStore();
    const tenantId = makeUuid(1);
    const userId = tenantId;
    const clinicId = makeUuid(2);
    const historicalInferenceEvents: ClinicalCaseHistoryInferenceEvent[] = [];
    const historicalOutcomeEvents: ClinicalCaseHistoryOutcomeEvent[] = [];
    const historicalSimulationEvents: ClinicalCaseHistorySimulationEvent[] = [];

    // 1. Clean GDV case
    const gdvCase = await ensureCanonicalClinicalCase(store, {
        tenantId,
        userId,
        clinicId,
        sourceModule: 'inference_console',
        observedAt: '2026-03-19T18:00:00.000Z',
        inputSignature: {
            species: 'Canis lupus familiaris',
            breed: 'Great Dane',
            symptoms: ['unproductive retching', 'abdominal distension', 'collapse', 'tachycardia'],
            metadata: { raw_note: 'Acute bloat presentation.' },
        },
    });
    const gdvInferenceId = makeUuid(10);
    const gdvAfterInference = await finalizeClinicalCaseAfterInference(store, gdvCase, gdvInferenceId, {
        observedAt: '2026-03-19T18:00:00.000Z',
        userId,
        sourceModule: 'inference_console',
        confidenceScore: 0.92,
        modelVersion: 'risk_model_v2',
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Mechanical',
                top_differentials: [
                    { name: 'Gastric Dilatation-Volvulus', probability: 0.92 },
                ],
            },
            risk_assessment: {
                severity_score: 0.94,
                emergency_level: 'CRITICAL',
            },
            uncertainty_notes: [],
            contradiction_score: 0,
            contradiction_reasons: [],
        },
    });
    store.appendInferenceEvent(buildInferenceEvent({
        id: gdvInferenceId,
        tenantId,
        caseId: gdvAfterInference.id,
        modelVersion: 'risk_model_v2',
        confidence: 0.92,
        outputPayload: {
            diagnosis: { top_differentials: [{ name: 'Gastric Dilatation-Volvulus', probability: 0.92 }] },
            risk_assessment: { emergency_level: 'CRITICAL' },
        },
        createdAt: '2026-03-19T18:00:00.000Z',
    }));
    historicalInferenceEvents.push(buildHistoryInferenceEvent({
        id: gdvInferenceId,
        tenantId,
        userId,
        caseId: gdvAfterInference.id,
        sourceModule: 'inference_console',
        modelVersion: 'risk_model_v2',
        confidence: 0.92,
        inputSignature: {
            species: 'Canis lupus familiaris',
            breed: 'Great Dane',
            symptoms: ['unproductive retching', 'abdominal distension', 'collapse', 'tachycardia'],
            metadata: { raw_note: 'Acute bloat presentation.' },
        },
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Mechanical',
                top_differentials: [{ name: 'Gastric Dilatation-Volvulus', probability: 0.92 }],
            },
            risk_assessment: { severity_score: 0.94, emergency_level: 'CRITICAL' },
            contradiction_score: 0,
            contradiction_reasons: [],
            uncertainty_notes: [],
        },
        createdAt: '2026-03-19T18:00:00.000Z',
    }));

    const gdvDataset = await getTenantClinicalDataset(store, tenantId);
    assert.equal(gdvDataset.clinicalCases.length, 1);
    assert.equal(gdvDataset.clinicalCases[0].primary_condition_class, 'Mechanical');
    assert.equal(gdvDataset.clinicalCases[0].case_cluster, 'GDV');
    assert.equal(gdvDataset.clinicalCases[0].latest_emergency_level, 'CRITICAL');
    assert.equal(gdvDataset.clinicalCases[0].invalid_case, false);

    // 2. Distemper case with normalized symptom vector
    const distemperCase = await ensureCanonicalClinicalCase(store, {
        tenantId,
        userId,
        clinicId,
        sourceModule: 'inference_console',
        observedAt: '2026-03-19T18:10:00.000Z',
        inputSignature: {
            species: 'Dog',
            breed: 'Mixed',
            symptoms: ['ocular discharge', 'nasal discharge', 'myoclonus', 'fever'],
            metadata: { raw_note: 'Neuro-respiratory infectious presentation.' },
        },
    });
    await finalizeClinicalCaseAfterInference(store, distemperCase, makeUuid(11), {
        observedAt: '2026-03-19T18:10:00.000Z',
        userId,
        sourceModule: 'inference_console',
        confidenceScore: 0.81,
        modelVersion: 'risk_model_v2',
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Infectious',
                top_differentials: [{ name: 'Canine Distemper', probability: 0.81 }],
            },
            risk_assessment: {
                severity_score: 0.72,
                emergency_level: 'HIGH',
            },
            contradiction_score: 0.1,
            contradiction_reasons: [],
        },
    });
    historicalInferenceEvents.push(buildHistoryInferenceEvent({
        id: makeUuid(11),
        tenantId,
        userId,
        caseId: distemperCase.id,
        sourceModule: 'inference_console',
        modelVersion: 'risk_model_v2',
        confidence: 0.81,
        inputSignature: {
            species: 'Dog',
            breed: 'Mixed',
            symptoms: ['ocular discharge', 'nasal discharge', 'myoclonus', 'fever'],
            metadata: { raw_note: 'Neuro-respiratory infectious presentation.' },
        },
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Infectious',
                top_differentials: [{ name: 'Canine Distemper', probability: 0.81 }],
            },
            risk_assessment: { severity_score: 0.72, emergency_level: 'HIGH' },
            contradiction_score: 0.1,
            contradiction_reasons: [],
        },
        createdAt: '2026-03-19T18:10:00.000Z',
    }));
    const distemperDataset = await getTenantClinicalDataset(store, tenantId);
    const distemperRow = distemperDataset.clinicalCases.find((row) => row.case_id === distemperCase.id);
    assert.ok(distemperRow);
    assert.equal(distemperRow.case_cluster, 'Distemper');
    assert.equal(distemperRow.primary_condition_class, 'Infectious');
    assert.equal(distemperRow.symptom_vector_normalized.ocular_discharge, true);
    assert.equal(distemperRow.symptom_vector_normalized.myoclonus, true);

    // 3. Parvo case with hemorrhagic diarrhea normalization
    const parvoCase = await ensureCanonicalClinicalCase(store, {
        tenantId,
        userId,
        clinicId,
        sourceModule: 'inference_console',
        observedAt: '2026-03-19T18:20:00.000Z',
        inputSignature: {
            species: 'Canis lupus familiaris',
            breed: 'Labrador',
            symptoms: ['bloody diarrhea', 'vomiting', 'lethargy'],
            metadata: { raw_note: 'Classic parvo pattern.' },
        },
    });
    const parvoAfterInference = await finalizeClinicalCaseAfterInference(store, parvoCase, makeUuid(12), {
        observedAt: '2026-03-19T18:20:00.000Z',
        userId,
        sourceModule: 'inference_console',
        confidenceScore: 0.88,
        modelVersion: 'risk_model_v2',
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Infectious',
                top_differentials: [{ name: 'Canine Parvovirus', probability: 0.88 }],
            },
            risk_assessment: {
                severity_score: 0.83,
                emergency_level: 'HIGH',
            },
            contradiction_score: 0,
            contradiction_reasons: [],
        },
    });
    const parvoAfterOutcome = await finalizeClinicalCaseAfterOutcome(store, parvoAfterInference, makeUuid(30), {
        observedAt: '2026-03-19T18:22:00.000Z',
        userId,
        sourceModule: 'outcome_learning',
        outcomeType: 'synthetic_outcome',
        outcomePayload: {
            diagnosis: 'Canine Parvovirus',
            primary_condition_class: 'Infectious',
            label_type: 'synthetic',
            severity_score: 0.84,
            emergency_level: 'HIGH',
        },
    });
    historicalInferenceEvents.push(buildHistoryInferenceEvent({
        id: makeUuid(12),
        tenantId,
        userId,
        caseId: parvoAfterInference.id,
        sourceModule: 'inference_console',
        modelVersion: 'risk_model_v2',
        confidence: 0.88,
        inputSignature: {
            species: 'Canis lupus familiaris',
            breed: 'Labrador',
            symptoms: ['bloody diarrhea', 'vomiting', 'lethargy'],
            metadata: { raw_note: 'Classic parvo pattern.' },
        },
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Infectious',
                top_differentials: [{ name: 'Canine Parvovirus', probability: 0.88 }],
            },
            risk_assessment: { severity_score: 0.83, emergency_level: 'HIGH' },
            contradiction_score: 0,
            contradiction_reasons: [],
        },
        createdAt: '2026-03-19T18:20:00.000Z',
    }));
    historicalOutcomeEvents.push({
        id: makeUuid(30),
        tenant_id: tenantId,
        user_id: userId,
        case_id: parvoAfterOutcome.id,
        source_module: 'outcome_learning',
        outcome_type: 'synthetic_outcome',
        outcome_payload: {
            diagnosis: 'Canine Parvovirus',
            primary_condition_class: 'Infectious',
            label_type: 'synthetic',
            severity_score: 0.84,
            emergency_level: 'HIGH',
        },
        outcome_timestamp: '2026-03-19T18:22:00.000Z',
        created_at: '2026-03-19T18:22:00.000Z',
    });
    const parvoDataset = await getTenantClinicalDataset(store, tenantId);
    const parvoRow = parvoDataset.clinicalCases.find((row) => row.case_id === parvoAfterOutcome.id);
    assert.ok(parvoRow);
    assert.equal(parvoRow.symptom_vector_normalized.hemorrhagic_diarrhea, true);
    assert.equal(parvoRow.label_type, 'synthetic');

    // 4. Invalid empty case should quarantine and stay out of live dataset
    const invalidCase = await ensureCanonicalClinicalCase(store, {
        tenantId,
        userId,
        clinicId,
        sourceModule: 'inference_console',
        observedAt: '2026-03-19T18:30:00.000Z',
        inputSignature: {
            species: 'Unknown',
            breed: '-',
            symptoms: ['-'],
            metadata: {},
        },
    });
    const datasetAfterInvalid = await getTenantClinicalDataset(store, tenantId);
    assert.equal(invalidCase.invalid_case, true);
    assert.equal(invalidCase.ingestion_status, 'rejected');
    assert.equal(datasetAfterInvalid.clinicalCases.some((row) => row.case_id === invalidCase.id), false);
    assert.equal(datasetAfterInvalid.quarantinedCases.some((row) => row.case_id === invalidCase.id), true);

    // 5. Adversarial GDV case should preserve contradiction metadata and remain visible
    const adversarialCase = await ensureCanonicalClinicalCase(store, {
        tenantId,
        userId,
        clinicId,
        sourceModule: 'adversarial_simulation',
        observedAt: '2026-03-19T18:40:00.000Z',
        inputSignature: {
            species: 'Dog',
            breed: 'Great Dane',
            symptoms: ['unproductive retching', 'abdominal distension', 'collapse', 'dyspnea', 'pale gums'],
            metadata: { raw_note: 'Hard contradiction noise case.' },
        },
    });
    const adversarialAfterInference = await finalizeClinicalCaseAfterInference(store, adversarialCase, makeUuid(13), {
        observedAt: '2026-03-19T18:40:00.000Z',
        userId,
        sourceModule: 'adversarial_simulation',
        confidenceScore: 0.42,
        modelVersion: 'risk_model_v2',
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Mechanical',
                top_differentials: [{ name: 'Gastric Dilatation-Volvulus', probability: 0.42 }],
            },
            risk_assessment: {
                severity_score: 0.93,
                emergency_level: 'CRITICAL',
            },
            contradiction_score: 0.68,
            contradiction_reasons: ['abdominal distension conflict', 'appetite severity mismatch'],
            uncertainty_notes: ['Contradictory metadata reduces diagnostic certainty.'],
        },
    });
    const adversarialAfterSimulation = await finalizeClinicalCaseAfterSimulation(store, adversarialAfterInference, makeUuid(40), {
        observedAt: '2026-03-19T18:41:00.000Z',
        userId,
        sourceModule: 'adversarial_simulation',
        simulationType: 'hard_contradiction_noise',
        stressMetrics: {
            contradiction_analysis: {
                contradiction_score: 0.68,
                contradiction_reasons: ['abdominal distension conflict', 'appetite severity mismatch'],
            },
            differential_spread: {
                top_1_probability: 0.42,
                top_2_probability: 0.21,
                spread: 0.21,
            },
        },
    });
    historicalInferenceEvents.push(buildHistoryInferenceEvent({
        id: makeUuid(13),
        tenantId,
        userId,
        caseId: adversarialAfterInference.id,
        sourceModule: 'adversarial_simulation',
        modelVersion: 'risk_model_v2',
        confidence: 0.42,
        inputSignature: {
            species: 'Dog',
            breed: 'Great Dane',
            symptoms: ['unproductive retching', 'abdominal distension', 'collapse', 'dyspnea', 'pale gums'],
            metadata: { raw_note: 'Hard contradiction noise case.' },
        },
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Mechanical',
                top_differentials: [{ name: 'Gastric Dilatation-Volvulus', probability: 0.42 }],
            },
            risk_assessment: { severity_score: 0.93, emergency_level: 'CRITICAL' },
            contradiction_score: 0.68,
            contradiction_reasons: ['abdominal distension conflict', 'appetite severity mismatch'],
            uncertainty_notes: ['Contradictory metadata reduces diagnostic certainty.'],
            differential_spread: { top_1_probability: 0.42, top_2_probability: 0.21, spread: 0.21 },
        },
        createdAt: '2026-03-19T18:40:00.000Z',
    }));
    historicalSimulationEvents.push({
        id: makeUuid(40),
        tenant_id: tenantId,
        user_id: userId,
        case_id: adversarialAfterSimulation.id,
        source_module: 'adversarial_simulation',
        simulation_type: 'hard_contradiction_noise',
        stress_metrics: {
            contradiction_analysis: {
                contradiction_score: 0.68,
                contradiction_reasons: ['abdominal distension conflict', 'appetite severity mismatch'],
            },
            differential_spread: { top_1_probability: 0.42, top_2_probability: 0.21, spread: 0.21 },
        },
        created_at: '2026-03-19T18:41:00.000Z',
    });
    const adversarialDataset = await getTenantClinicalDataset(store, tenantId);
    const adversarialRow = adversarialDataset.clinicalCases.find((row) => row.case_id === adversarialAfterSimulation.id);
    assert.ok(adversarialRow);
    assert.equal(adversarialRow.adversarial_case, true);
    assert.equal(adversarialRow.case_cluster, 'Adversarial Mechanical');
    assert.ok((adversarialRow.contradiction_score ?? 0) > 0);
    assert.ok(adversarialRow.contradiction_flags.length >= 2);
    assert.ok(adversarialRow.differential_spread);
    assert.equal(adversarialRow.model_version, 'risk_model_v2');

    // 6. Outcome-linked case upgrades the label and confirmed diagnosis
    assert.equal(parvoAfterOutcome.confirmed_diagnosis, 'Canine Parvovirus');
    assert.equal(parvoAfterOutcome.label_type, 'synthetic');
    assert.equal(parvoAfterOutcome.primary_condition_class, 'Infectious');
    assert.equal(parvoAfterOutcome.prediction_correct, true);
    assert.equal(parvoAfterOutcome.calibration_status, 'calibrated_match');
    assert.ok((parvoAfterOutcome.confidence_error ?? 1) < 0.2);

    const exportPayload = buildClinicalDatasetExport(adversarialDataset, 'adversarial_benchmark_set');
    assert.ok(exportPayload.length >= 1);
    assert.equal((exportPayload[0] as Record<string, unknown>).adversarial_case, true);
    const calibrationExport = buildClinicalDatasetExport(parvoDataset, 'calibration_audit_set');
    assert.ok(calibrationExport.length >= 1);

    // 7. Low-signal case should not remain blank
    const lowSignalCase = await ensureCanonicalClinicalCase(store, {
        tenantId,
        userId,
        clinicId,
        sourceModule: 'inference_console',
        observedAt: '2026-03-19T18:50:00.000Z',
        inputSignature: {
            species: 'canine',
            breed: 'mixed',
            symptoms: ['lethargy'],
            metadata: { raw_note: 'Single weak symptom only.' },
        },
    });
    const lowSignalAfterInference = await finalizeClinicalCaseAfterInference(store, lowSignalCase, makeUuid(14), {
        observedAt: '2026-03-19T18:50:00.000Z',
        userId,
        sourceModule: 'inference_console',
        confidenceScore: null,
        modelVersion: 'risk_model_v2',
        outputPayload: {},
    });
    assert.equal(lowSignalAfterInference.primary_condition_class, 'Undifferentiated');
    assert.equal(lowSignalAfterInference.top_diagnosis, 'Undifferentiated low-signal presentation');
    assert.equal(lowSignalAfterInference.emergency_level, 'LOW');

    // 8. Historical backfill should repair empty legacy rows from inference history
    const legacyCase = await ensureCanonicalClinicalCase(store, {
        tenantId,
        userId,
        clinicId,
        sourceModule: 'inference_console',
        observedAt: '2026-03-18T08:00:00.000Z',
        inputSignature: {
            species: 'dog',
            breed: 'bulldog',
            symptoms: ['vomiting', 'abdominal pain', 'fever'],
            metadata: { raw_note: 'Legacy case needing history sync.' },
        },
    });
    await store.updateById(tenantId, legacyCase.id, {
        primary_condition_class: null,
        top_diagnosis: null,
        predicted_diagnosis: null,
        severity_score: null,
        emergency_level: null,
        contradiction_score: null,
        contradiction_flags: [],
        diagnosis_confidence: null,
        model_version: null,
        calibration_status: null,
        prediction_correct: null,
        confidence_error: null,
        calibration_bucket: null,
        degraded_confidence: null,
        differential_spread: null,
        latest_inference_event_id: null,
    });
    historicalInferenceEvents.push(buildHistoryInferenceEvent({
        id: makeUuid(50),
        tenantId,
        userId,
        caseId: legacyCase.id,
        sourceModule: 'inference_console',
        modelVersion: 'risk_model_v2',
        confidence: 0.61,
        inputSignature: {
            species: 'dog',
            breed: 'bulldog',
            symptoms: ['vomiting', 'abdominal pain', 'fever'],
            metadata: { raw_note: 'Legacy case needing history sync.' },
        },
        outputPayload: {
            diagnosis: {
                primary_condition_class: 'Inflammatory',
                top_differentials: [{ name: 'Pancreatitis', probability: 0.61 }],
            },
            risk_assessment: {
                severity_score: 0.58,
                emergency_level: 'MODERATE',
            },
            contradiction_score: 0.12,
            contradiction_reasons: ['temperature metadata mismatch'],
        },
        createdAt: '2026-03-18T08:00:00.000Z',
    }));
    const backfillResult = await backfillClinicalCaseLearningState({
        tenantId,
        store,
        clinicalCases: await collectCases(store, tenantId),
        inferenceEvents: historicalInferenceEvents,
        outcomeEvents: historicalOutcomeEvents,
        simulationEvents: historicalSimulationEvents,
    });
    const legacyAfterBackfill = await store.findById(tenantId, legacyCase.id);
    assert.ok(legacyAfterBackfill);
    assert.equal(legacyAfterBackfill.top_diagnosis, 'Pancreatitis');
    assert.equal(legacyAfterBackfill.primary_condition_class, 'Inflammatory');
    assert.equal(legacyAfterBackfill.emergency_level, 'MODERATE');
    assert.ok((legacyAfterBackfill.contradiction_score ?? 0) > 0);
    assert.ok(backfillResult.summary.cases_backfilled >= 1);
    assert.equal(legacyAfterBackfill.species_canonical, 'Canis lupus familiaris');
    assert.equal(legacyAfterBackfill.species_display, 'Dog');

    console.log('Structured clinical dataset manager integration tests passed.');
}

function buildInferenceEvent(input: {
    id: string;
    tenantId: string;
    caseId: string;
    modelVersion: string;
    confidence: number;
    outputPayload: Record<string, unknown>;
    createdAt: string;
}): DatasetInferenceEventRecord {
    return {
        id: input.id,
        tenant_id: input.tenantId,
        user_id: input.tenantId,
        case_id: input.caseId,
        source_module: 'inference_console',
        model_version: input.modelVersion,
        confidence_score: input.confidence,
        output_payload: input.outputPayload,
        created_at: input.createdAt,
    };
}

function buildHistoryInferenceEvent(input: {
    id: string;
    tenantId: string;
    userId: string;
    caseId: string;
    sourceModule: string;
    modelVersion: string;
    confidence: number | null;
    inputSignature: Record<string, unknown>;
    outputPayload: Record<string, unknown>;
    createdAt: string;
}): ClinicalCaseHistoryInferenceEvent {
    return {
        id: input.id,
        tenant_id: input.tenantId,
        user_id: input.userId,
        case_id: input.caseId,
        source_module: input.sourceModule,
        model_version: input.modelVersion,
        input_signature: input.inputSignature,
        output_payload: input.outputPayload,
        confidence_score: input.confidence,
        created_at: input.createdAt,
    };
}

async function collectCases(store: InMemoryClinicalDatasetStore, tenantId: string): Promise<ClinicalCaseRecord[]> {
    const caseIds = new Set<string>();
    for (const row of await store.listClinicalCases(tenantId, 100)) caseIds.add(row.case_id);
    for (const row of await store.listQuarantinedCases(tenantId, 100)) caseIds.add(row.case_id);

    const records = await Promise.all(
        [...caseIds].map(async (caseId) => store.findById(tenantId, caseId)),
    );
    return records.filter((record): record is ClinicalCaseRecord => Boolean(record));
}

function makeUuid(seed: number): string {
    return `00000000-0000-4000-a000-${String(seed).padStart(12, '0')}`;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
