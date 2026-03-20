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
    getTenantClinicalDataset,
    type ClinicalCaseLiveRecord,
    type ClinicalDatasetStore,
    type DatasetInferenceEventRecord,
} from '../../apps/web/lib/dataset/clinicalDataset.ts';

interface OutcomeEventRecord {
    id: string;
    tenant_id: string;
    case_id: string;
    created_at: string;
}

interface SimulationEventRecord {
    id: string;
    tenant_id: string;
    case_id: string;
    created_at: string;
}

class InMemoryClinicalDatasetStore implements ClinicalCaseStore, ClinicalDatasetStore {
    private readonly clinicalCases = new Map<string, ClinicalCaseRecord>();
    private readonly inferenceEvents = new Map<string, DatasetInferenceEventRecord>();
    private readonly outcomeEvents = new Map<string, OutcomeEventRecord>();
    private readonly simulationEvents = new Map<string, SimulationEventRecord>();
    private idCounter = 1000;

    async findById(tenantId: string, caseId: string): Promise<ClinicalCaseRecord | null> {
        const record = this.clinicalCases.get(caseId);
        if (!record || record.tenant_id !== tenantId) {
            return null;
        }

        return structuredClone(record);
    }

    async findByCaseKey(tenantId: string, caseKey: string): Promise<ClinicalCaseRecord | null> {
        const record = [...this.clinicalCases.values()].find(
            (candidate) =>
                candidate.tenant_id === tenantId &&
                candidate.case_key === caseKey,
        );

        return record ? structuredClone(record) : null;
    }

    async upsert(record: ClinicalCaseUpsertRecord): Promise<ClinicalCaseRecord> {
        const existing = this.findExistingRecord(record);
        const now = new Date().toISOString();

        const nextRecord: ClinicalCaseRecord = {
            id: existing?.id ?? record.id ?? makeUuid(++this.idCounter),
            tenant_id: record.tenant_id,
            user_id: record.user_id,
            clinic_id: record.clinic_id,
            source_module: record.source_module,
            case_key: record.case_key,
            source_case_reference: record.source_case_reference,
            species: record.species,
            species_canonical: record.species_canonical,
            species_display: record.species_display,
            species_raw: record.species_raw,
            breed: record.breed,
            symptoms_raw: record.symptoms_raw,
            symptoms_normalized: [...record.symptoms_normalized],
            symptom_vector: [...record.symptom_vector],
            symptom_summary: record.symptom_summary,
            patient_metadata: structuredClone(record.patient_metadata),
            metadata: structuredClone(record.metadata),
            latest_input_signature: structuredClone(record.latest_input_signature),
            latest_inference_event_id: record.latest_inference_event_id,
            latest_outcome_event_id: record.latest_outcome_event_id,
            latest_simulation_event_id: record.latest_simulation_event_id,
            inference_event_count: record.inference_event_count,
            first_inference_at: record.first_inference_at,
            last_inference_at: record.last_inference_at,
            created_at: existing?.created_at ?? now,
            updated_at: now,
        };

        this.clinicalCases.set(nextRecord.id, nextRecord);
        return structuredClone(nextRecord);
    }

    async updateById(
        tenantId: string,
        caseId: string,
        patch: Partial<ClinicalCaseUpsertRecord>,
    ): Promise<ClinicalCaseRecord> {
        const existing = this.clinicalCases.get(caseId);
        if (!existing || existing.tenant_id !== tenantId) {
            throw new Error(`Clinical case not found: ${caseId}`);
        }

        const updated: ClinicalCaseRecord = {
            ...existing,
            ...patch,
            symptoms_normalized: patch.symptoms_normalized
                ? [...patch.symptoms_normalized]
                : existing.symptoms_normalized,
            symptom_vector: patch.symptom_vector
                ? [...patch.symptom_vector]
                : existing.symptom_vector,
            patient_metadata: patch.patient_metadata
                ? structuredClone(patch.patient_metadata)
                : existing.patient_metadata,
            metadata: patch.metadata
                ? structuredClone(patch.metadata)
                : existing.metadata,
            latest_input_signature: patch.latest_input_signature
                ? structuredClone(patch.latest_input_signature)
                : existing.latest_input_signature,
            updated_at: new Date().toISOString(),
        };

        this.clinicalCases.set(caseId, updated);
        return structuredClone(updated);
    }

    async listClinicalCases(tenantId: string, limit: number): Promise<ClinicalCaseLiveRecord[]> {
        return [...this.clinicalCases.values()]
            .filter((record) => record.tenant_id === tenantId)
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
            .slice(0, limit)
            .map((record) => {
                const inference = record.latest_inference_event_id
                    ? this.inferenceEvents.get(record.latest_inference_event_id) ?? null
                    : null;

                return {
                    case_id: record.id,
                    tenant_id: record.tenant_id,
                    user_id: record.user_id,
                    species: record.species_canonical ?? record.species_display ?? record.species_raw,
                    breed: record.breed,
                    symptoms_summary: record.symptom_summary ?? record.symptoms_raw,
                    latest_inference_event_id: record.latest_inference_event_id,
                    latest_outcome_event_id: record.latest_outcome_event_id,
                    latest_simulation_event_id: record.latest_simulation_event_id,
                    latest_confidence: inference?.confidence_score ?? null,
                    latest_emergency_level: extractEmergencyLevel(inference?.output_payload ?? {}),
                    source_module: record.source_module,
                    updated_at: record.updated_at,
                };
            });
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

    appendOutcomeEvent(record: OutcomeEventRecord): void {
        this.outcomeEvents.set(record.id, structuredClone(record));
    }

    appendSimulationEvent(record: SimulationEventRecord): void {
        this.simulationEvents.set(record.id, structuredClone(record));
    }

    private findExistingRecord(record: ClinicalCaseUpsertRecord): ClinicalCaseRecord | undefined {
        if (record.id) {
            const byId = this.clinicalCases.get(record.id);
            if (byId?.tenant_id === record.tenant_id) {
                return byId;
            }
        }

        return [...this.clinicalCases.values()].find(
            (candidate) =>
                candidate.tenant_id === record.tenant_id &&
                candidate.case_key === record.case_key,
        );
    }
}

async function main() {
    assert.equal(
        normalizeSpeciesValue('Canis lupus'),
        'Canis lupus familiaris',
        'Canis lupus should normalize to the canonical domestic dog species',
    );

    const store = new InMemoryClinicalDatasetStore();
    const tenantAlpha = makeUuid(1);
    const tenantBravo = makeUuid(2);
    const clinicAlpha = makeUuid(3);
    const alphaUserId = tenantAlpha;
    const bravoUserId = tenantBravo;
    const explicitCaseId = makeUuid(10);

    const firstObservedAt = '2026-03-19T18:10:00.000Z';
    const outcomeObservedAt = '2026-03-19T18:14:00.000Z';
    const simulationObservedAt = '2026-03-19T18:16:00.000Z';
    const secondObservedAt = '2026-03-19T18:20:00.000Z';

    // 1. Inference submission creates/upserts a canonical clinical case visible in the dataset.
    const firstCase = await ensureCanonicalClinicalCase(store, {
        tenantId: tenantAlpha,
        userId: alphaUserId,
        clinicId: clinicAlpha,
        requestedCaseId: null,
        sourceModule: 'inference_console',
        observedAt: firstObservedAt,
        inputSignature: {
            species: 'Canis lupus',
            breed: 'retriever',
            symptoms: ['Lethargy', 'Fever'],
            metadata: { raw_note: 'Same patient fingerprint for dataset test.' },
        },
    });
    const firstInferenceId = makeUuid(20);
    const finalizedFirstCase = await finalizeClinicalCaseAfterInference(
        store,
        firstCase,
        firstInferenceId,
        {
            observedAt: firstObservedAt,
            userId: alphaUserId,
            sourceModule: 'inference_console',
            metadataPatch: {
                latest_inference_confidence: 0.91,
            },
        },
    );
    store.appendInferenceEvent({
        id: firstInferenceId,
        tenant_id: tenantAlpha,
        user_id: alphaUserId,
        case_id: finalizedFirstCase.id,
        source_module: 'inference_console',
        model_version: '1.0.0',
        confidence_score: 0.91,
        output_payload: {
            diagnosis: {
                top_differentials: [{ name: 'Parvovirus', probability: 0.91 }],
            },
            risk_assessment: {
                emergency_level: 'HIGH',
            },
        },
        created_at: firstObservedAt,
    });

    const datasetAfterInference = await getTenantClinicalDataset(store, tenantAlpha);
    assert.equal(datasetAfterInference.clinicalCases.length, 1);
    assert.equal(datasetAfterInference.clinicalCases[0].CASE_ID, finalizedFirstCase.id);
    assert.equal(datasetAfterInference.clinicalCases[0].SPECIES, 'Canis lupus familiaris');

    // 2. Outcome injection links back to the same case and keeps the row visible.
    const outcomeEventId = makeUuid(30);
    const caseAfterOutcome = await finalizeClinicalCaseAfterOutcome(
        store,
        finalizedFirstCase,
        outcomeEventId,
        {
            observedAt: outcomeObservedAt,
            userId: alphaUserId,
            sourceModule: 'outcome_learning',
            metadataPatch: {
                latest_outcome_type: 'confirmed_diagnosis',
            },
        },
    );
    store.appendOutcomeEvent({
        id: outcomeEventId,
        tenant_id: tenantAlpha,
        case_id: caseAfterOutcome.id,
        created_at: outcomeObservedAt,
    });

    const liveCaseAfterOutcome = (await store.listClinicalCases(tenantAlpha, 10))[0];
    assert.equal(liveCaseAfterOutcome.latest_outcome_event_id, outcomeEventId);
    assert.equal(liveCaseAfterOutcome.case_id, finalizedFirstCase.id);

    // 3. Adversarial simulation attaches to the same case and updates latest_simulation_event_id.
    const simulationEventId = makeUuid(40);
    const caseAfterSimulation = await finalizeClinicalCaseAfterSimulation(
        store,
        caseAfterOutcome,
        simulationEventId,
        {
            observedAt: simulationObservedAt,
            userId: alphaUserId,
            sourceModule: 'adversarial_simulation',
            metadataPatch: {
                latest_simulation_type: 'adversarial_gdv',
            },
        },
    );
    store.appendSimulationEvent({
        id: simulationEventId,
        tenant_id: tenantAlpha,
        case_id: caseAfterSimulation.id,
        created_at: simulationObservedAt,
    });

    const liveCaseAfterSimulation = (await store.listClinicalCases(tenantAlpha, 10))[0];
    assert.equal(liveCaseAfterSimulation.latest_simulation_event_id, simulationEventId);

    // 4. Tenant isolation keeps other tenants' rows out of the active tenant dataset.
    const explicitCase = await ensureCanonicalClinicalCase(store, {
        tenantId: tenantBravo,
        userId: bravoUserId,
        clinicId: null,
        requestedCaseId: explicitCaseId,
        sourceModule: 'inference_console',
        observedAt: secondObservedAt,
        inputSignature: {
            species: 'Felis catus',
            breed: 'Siamese',
            symptoms: ['vomiting'],
            metadata: { raw_note: 'Explicit upstream case id should be reused.' },
        },
    });
    const bravoInferenceId = makeUuid(50);
    await finalizeClinicalCaseAfterInference(store, explicitCase, bravoInferenceId, {
        observedAt: secondObservedAt,
        userId: bravoUserId,
        sourceModule: 'inference_console',
    });
    store.appendInferenceEvent({
        id: bravoInferenceId,
        tenant_id: tenantBravo,
        user_id: bravoUserId,
        case_id: explicitCase.id,
        source_module: 'inference_console',
        model_version: '2.0.0',
        confidence_score: 0.64,
        output_payload: {
            diagnosis: {
                top_differentials: [{ name: 'Acute Gastroenteritis', probability: 0.64 }],
            },
        },
        created_at: secondObservedAt,
    });

    const alphaDataset = await getTenantClinicalDataset(store, tenantAlpha);
    const bravoDataset = await getTenantClinicalDataset(store, tenantBravo);
    assert.equal(alphaDataset.clinicalCases.length, 1);
    assert.equal(bravoDataset.clinicalCases.length, 1);
    assert.equal(bravoDataset.clinicalCases[0].CASE_ID, explicitCaseId);
    assert.equal(alphaDataset.clinicalCases.some((row) => row.CASE_ID === explicitCaseId), false);

    // 5. Refresh flow: a new inference for the same tenant becomes visible on the next dataset fetch.
    const refreshProbeBefore = await getTenantClinicalDataset(store, tenantAlpha);
    const secondCase = await ensureCanonicalClinicalCase(store, {
        tenantId: tenantAlpha,
        userId: alphaUserId,
        clinicId: clinicAlpha,
        requestedCaseId: null,
        sourceModule: 'inference_console',
        observedAt: secondObservedAt,
        inputSignature: {
            species: 'Canis lupus familiaris',
            breed: 'Retriever',
            symptoms: ['collapse', 'abdominal distension'],
            metadata: { raw_note: 'New acute case should appear after refresh.' },
        },
    });
    const secondInferenceId = makeUuid(60);
    const finalizedSecondCase = await finalizeClinicalCaseAfterInference(
        store,
        secondCase,
        secondInferenceId,
        {
            observedAt: secondObservedAt,
            userId: alphaUserId,
            sourceModule: 'inference_console',
            metadataPatch: {
                latest_inference_confidence: 0.88,
            },
        },
    );
    store.appendInferenceEvent({
        id: secondInferenceId,
        tenant_id: tenantAlpha,
        user_id: alphaUserId,
        case_id: finalizedSecondCase.id,
        source_module: 'inference_console',
        model_version: '1.1.0',
        confidence_score: 0.88,
        output_payload: {
            diagnosis: {
                top_differentials: [{ name: 'Gastric Dilatation-Volvulus', probability: 0.88 }],
            },
            risk_assessment: {
                emergency_level: 'CRITICAL',
            },
        },
        created_at: secondObservedAt,
    });

    const refreshProbeAfter = await getTenantClinicalDataset(store, tenantAlpha);
    assert.equal(refreshProbeBefore.clinicalCases.length, 1);
    assert.equal(refreshProbeAfter.clinicalCases.length, 2);
    assert.equal(refreshProbeAfter.inferenceEvents[0].EVENT_ID, secondInferenceId);
    assert.equal(refreshProbeAfter.clinicalCases.some((row) => row.CASE_ID === finalizedSecondCase.id), true);
    assert.notEqual(refreshProbeBefore.refreshedAt, refreshProbeAfter.refreshedAt);

    console.log('Clinical dataset manager integration tests passed.');
}

function extractEmergencyLevel(outputPayload: Record<string, unknown>): string | null {
    const riskAssessment = outputPayload.risk_assessment;
    if (
        typeof riskAssessment !== 'object' ||
        riskAssessment === null ||
        Array.isArray(riskAssessment)
    ) {
        return null;
    }

    return typeof (riskAssessment as Record<string, unknown>).emergency_level === 'string'
        ? (riskAssessment as Record<string, unknown>).emergency_level as string
        : null;
}

function makeUuid(seed: number): string {
    return `00000000-0000-4000-a000-${String(seed).padStart(12, '0')}`;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
