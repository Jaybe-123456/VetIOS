import assert from 'node:assert/strict';
import {
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterInference,
    normalizeSpeciesValue,
    type ClinicalCaseRecord,
    type ClinicalCaseStore,
    type ClinicalCaseUpsertRecord,
} from '../../apps/web/lib/clinicalCases/clinicalCaseManager.ts';
import {
    getTenantClinicalDataset,
    type ClinicalDatasetStore,
    type DatasetInferenceEventRecord,
} from '../../apps/web/lib/dataset/clinicalDataset.ts';

class InMemoryClinicalDatasetStore implements ClinicalCaseStore, ClinicalDatasetStore {
    private readonly clinicalCases = new Map<string, ClinicalCaseRecord>();
    private readonly inferenceEvents = new Map<string, DatasetInferenceEventRecord>();
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
            clinic_id: record.clinic_id,
            case_key: record.case_key,
            source_case_reference: record.source_case_reference,
            species: record.species,
            species_raw: record.species_raw,
            breed: record.breed,
            symptom_vector: [...record.symptom_vector],
            symptom_summary: record.symptom_summary,
            metadata: structuredClone(record.metadata),
            latest_input_signature: structuredClone(record.latest_input_signature),
            latest_inference_event_id: record.latest_inference_event_id,
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
            symptom_vector: patch.symptom_vector ? [...patch.symptom_vector] : existing.symptom_vector,
            metadata: patch.metadata ? structuredClone(patch.metadata) : existing.metadata,
            latest_input_signature: patch.latest_input_signature
                ? structuredClone(patch.latest_input_signature)
                : existing.latest_input_signature,
            updated_at: new Date().toISOString(),
        };

        this.clinicalCases.set(caseId, updated);
        return structuredClone(updated);
    }

    async listClinicalCases(tenantId: string, limit: number): Promise<ClinicalCaseRecord[]> {
        return [...this.clinicalCases.values()]
            .filter((record) => record.tenant_id === tenantId)
            .sort((left, right) => right.last_inference_at.localeCompare(left.last_inference_at))
            .slice(0, limit)
            .map((record) => structuredClone(record));
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
    assert.equal(
        normalizeSpeciesValue('Canis lupus familiaris'),
        'Canis lupus familiaris',
        'Canonical dog species should remain stable',
    );

    const store = new InMemoryClinicalDatasetStore();
    const tenantAlpha = makeUuid(1);
    const tenantBravo = makeUuid(2);
    const clinicAlpha = makeUuid(3);
    const explicitCaseId = makeUuid(10);

    const firstObservedAt = '2026-03-19T18:10:00.000Z';
    const secondObservedAt = '2026-03-19T18:15:00.000Z';
    const explicitObservedAt = '2026-03-19T18:20:00.000Z';

    const firstCase = await ensureCanonicalClinicalCase(store, {
        tenantId: tenantAlpha,
        clinicId: clinicAlpha,
        requestedCaseId: null,
        observedAt: firstObservedAt,
        inputSignature: {
            species: 'Canis lupus',
            breed: 'retriever',
            symptoms: ['Lethargy', 'Fever'],
            metadata: { raw_note: 'Same patient fingerprint for dataset test.' },
        },
    });
    assert.equal(firstCase.species, 'Canis lupus familiaris');

    const firstEventId = makeUuid(20);
    const finalizedFirstCase = await finalizeClinicalCaseAfterInference(
        store,
        firstCase,
        firstEventId,
        firstObservedAt,
    );
    store.appendInferenceEvent({
        id: firstEventId,
        tenant_id: tenantAlpha,
        case_id: finalizedFirstCase.id,
        model_version: '1.0.0',
        confidence_score: 0.91,
        output_payload: {
            diagnosis: {
                top_differentials: [{ name: 'Parvovirus', probability: 0.91 }],
            },
        },
        created_at: firstObservedAt,
    });

    const secondCase = await ensureCanonicalClinicalCase(store, {
        tenantId: tenantAlpha,
        clinicId: clinicAlpha,
        requestedCaseId: null,
        observedAt: secondObservedAt,
        inputSignature: {
            species: 'Canis lupus familiaris',
            breed: 'Retriever',
            symptoms: ['fever', 'lethargy'],
            metadata: { raw_note: 'Same patient fingerprint for dataset test.' },
        },
    });
    assert.equal(
        secondCase.id,
        finalizedFirstCase.id,
        'Species synonyms with the same fingerprint should upsert the same canonical clinical case',
    );

    const secondEventId = makeUuid(21);
    const finalizedSecondCase = await finalizeClinicalCaseAfterInference(
        store,
        secondCase,
        secondEventId,
        secondObservedAt,
    );
    assert.equal(finalizedSecondCase.inference_event_count, 2);

    store.appendInferenceEvent({
        id: secondEventId,
        tenant_id: tenantAlpha,
        case_id: finalizedSecondCase.id,
        model_version: '1.0.1',
        confidence_score: 0.73,
        output_payload: {
            diagnosis: {
                top_differentials: [{ name: 'Foreign Body Obstruction', probability: 0.73 }],
            },
        },
        created_at: secondObservedAt,
    });

    const explicitCase = await ensureCanonicalClinicalCase(store, {
        tenantId: tenantBravo,
        clinicId: null,
        requestedCaseId: explicitCaseId,
        observedAt: explicitObservedAt,
        inputSignature: {
            species: 'Felis catus',
            breed: 'Siamese',
            symptoms: ['vomiting'],
            metadata: { raw_note: 'Explicit upstream case id should be reused.' },
        },
    });
    assert.equal(explicitCase.id, explicitCaseId);
    assert.equal(explicitCase.tenant_id, tenantBravo);

    const explicitEventId = makeUuid(22);
    await finalizeClinicalCaseAfterInference(store, explicitCase, explicitEventId, explicitObservedAt);
    store.appendInferenceEvent({
        id: explicitEventId,
        tenant_id: tenantBravo,
        case_id: explicitCase.id,
        model_version: '2.0.0',
        confidence_score: 0.64,
        output_payload: {
            diagnosis: {
                top_differentials: [{ name: 'Acute Gastroenteritis', probability: 0.64 }],
            },
        },
        created_at: explicitObservedAt,
    });

    const alphaDataset = await getTenantClinicalDataset(store, tenantAlpha);
    assert.equal(alphaDataset.clinicalCases.length, 1);
    assert.equal(alphaDataset.clinicalCases[0].CASE_ID, finalizedSecondCase.id);
    assert.equal(alphaDataset.clinicalCases[0].SPECIES, 'Canis lupus familiaris');
    assert.equal(alphaDataset.clinicalCases[0].BREED, 'Retriever');
    assert.equal(alphaDataset.clinicalCases[0].SYMPTOMS, 'fever, lethargy');
    assert.equal(alphaDataset.inferenceEvents[0].EVENT_ID, secondEventId);
    assert.equal(alphaDataset.inferenceEvents[0].CASE_ID, finalizedSecondCase.id);
    assert.equal(alphaDataset.inferenceEvents[0].TOP_PRED, 'Foreign Body Obstruction');
    assert.equal(alphaDataset.inferenceEvents[0].CONFIDENCE, '73%');

    const bravoDataset = await getTenantClinicalDataset(store, tenantBravo);
    assert.equal(bravoDataset.clinicalCases.length, 1);
    assert.equal(bravoDataset.clinicalCases[0].CASE_ID, explicitCaseId);
    assert.equal(bravoDataset.inferenceEvents[0].CASE_ID, explicitCaseId);
    assert.equal(bravoDataset.inferenceEvents[0].TOP_PRED, 'Acute Gastroenteritis');
    assert.equal(alphaDataset.clinicalCases.some((row) => row.CASE_ID === explicitCaseId), false);

    console.log('Clinical dataset manager integration tests passed.');
}

function makeUuid(seed: number): string {
    return `00000000-0000-4000-a000-${String(seed).padStart(12, '0')}`;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
