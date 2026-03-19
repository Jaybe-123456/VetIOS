import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_INFERENCE_EVENTS, CLINICAL_CASES } from '@/lib/db/schemaContracts';
import type { ClinicalCaseRecord } from '@/lib/clinicalCases/clinicalCaseManager';

export interface DatasetInferenceEventRecord {
    id: string;
    tenant_id: string;
    case_id: string | null;
    model_version: string;
    confidence_score: number | null;
    output_payload: Record<string, unknown>;
    created_at: string;
}

export interface ClinicalDatasetStore {
    listClinicalCases(tenantId: string, limit: number): Promise<ClinicalCaseRecord[]>;
    listInferenceEvents(tenantId: string, limit: number): Promise<DatasetInferenceEventRecord[]>;
}

export interface TenantClinicalDataset {
    clinicalCases: Array<Record<string, string>>;
    inferenceEvents: Array<Record<string, string>>;
    refreshedAt: string;
}

export async function getTenantClinicalDataset(
    store: ClinicalDatasetStore,
    tenantId: string,
    limit = 50,
): Promise<TenantClinicalDataset> {
    const [clinicalCases, inferenceEvents] = await Promise.all([
        store.listClinicalCases(tenantId, limit),
        store.listInferenceEvents(tenantId, limit),
    ]);

    return {
        clinicalCases: mapClinicalCasesToDatasetRows(clinicalCases),
        inferenceEvents: mapInferenceEventsToDatasetRows(inferenceEvents),
        refreshedAt: new Date().toISOString(),
    };
}

export function mapClinicalCasesToDatasetRows(
    rows: ClinicalCaseRecord[],
): Array<Record<string, string>> {
    return rows.map((row) => ({
        CASE_ID: row.id,
        SPECIES: row.species ?? row.species_raw ?? 'Unknown',
        BREED: row.breed ?? '-',
        SYMPTOMS:
            row.symptom_summary ??
            (row.symptom_vector.length > 0 ? row.symptom_vector.slice(0, 8).join(', ') : '-') ??
            '-',
        TIMESTAMP: formatDatasetTimestamp(row.last_inference_at),
    }));
}

export function mapInferenceEventsToDatasetRows(
    rows: DatasetInferenceEventRecord[],
): Array<Record<string, string>> {
    return rows.map((row) => ({
        EVENT_ID: row.id,
        CASE_ID: row.case_id ?? '-',
        TOP_PRED: extractTopPrediction(row.output_payload) ?? 'Unknown',
        CONFIDENCE: formatConfidenceScore(row.confidence_score),
        MODEL_V: row.model_version,
    }));
}

export function createSupabaseClinicalDatasetStore(client: SupabaseClient): ClinicalDatasetStore {
    const caseColumns = CLINICAL_CASES.COLUMNS;
    const inferenceColumns = AI_INFERENCE_EVENTS.COLUMNS;

    return {
        async listClinicalCases(tenantId, limit) {
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .select([
                    caseColumns.id,
                    caseColumns.tenant_id,
                    caseColumns.clinic_id,
                    caseColumns.case_key,
                    caseColumns.source_case_reference,
                    caseColumns.species,
                    caseColumns.species_raw,
                    caseColumns.breed,
                    caseColumns.symptom_vector,
                    caseColumns.symptom_summary,
                    caseColumns.metadata,
                    caseColumns.latest_input_signature,
                    caseColumns.latest_inference_event_id,
                    caseColumns.inference_event_count,
                    caseColumns.first_inference_at,
                    caseColumns.last_inference_at,
                    caseColumns.created_at,
                    caseColumns.updated_at,
                ].join(', '))
                .eq(caseColumns.tenant_id, tenantId)
                .order(caseColumns.last_inference_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to query canonical clinical cases: ${error.message}`);
            }

            const caseRows = (data ?? []) as unknown as Array<Record<string, unknown>>;
            return caseRows.map((row) => ({
                id: String(row.id),
                tenant_id: String(row.tenant_id),
                clinic_id: typeof row.clinic_id === 'string' ? row.clinic_id : null,
                case_key: String(row.case_key),
                source_case_reference:
                    typeof row.source_case_reference === 'string' ? row.source_case_reference : null,
                species: typeof row.species === 'string' ? row.species : null,
                species_raw: typeof row.species_raw === 'string' ? row.species_raw : null,
                breed: typeof row.breed === 'string' ? row.breed : null,
                symptom_vector: Array.isArray(row.symptom_vector)
                    ? row.symptom_vector.filter((value): value is string => typeof value === 'string')
                    : [],
                symptom_summary: typeof row.symptom_summary === 'string' ? row.symptom_summary : null,
                metadata:
                    typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
                        ? row.metadata as Record<string, unknown>
                        : {},
                latest_input_signature:
                    typeof row.latest_input_signature === 'object' &&
                        row.latest_input_signature !== null &&
                        !Array.isArray(row.latest_input_signature)
                        ? row.latest_input_signature as Record<string, unknown>
                        : {},
                latest_inference_event_id:
                    typeof row.latest_inference_event_id === 'string' ? row.latest_inference_event_id : null,
                inference_event_count:
                    typeof row.inference_event_count === 'number' ? row.inference_event_count : 0,
                first_inference_at: String(row.first_inference_at),
                last_inference_at: String(row.last_inference_at),
                created_at: String(row.created_at),
                updated_at: String(row.updated_at),
            }));
        },

        async listInferenceEvents(tenantId, limit) {
            const { data, error } = await client
                .from(AI_INFERENCE_EVENTS.TABLE)
                .select([
                    inferenceColumns.id,
                    inferenceColumns.tenant_id,
                    inferenceColumns.case_id,
                    inferenceColumns.model_version,
                    inferenceColumns.confidence_score,
                    inferenceColumns.output_payload,
                    inferenceColumns.created_at,
                ].join(', '))
                .eq(inferenceColumns.tenant_id, tenantId)
                .order(inferenceColumns.created_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to query inference events for dataset manager: ${error.message}`);
            }

            const inferenceRows = (data ?? []) as unknown as Array<Record<string, unknown>>;
            return inferenceRows.map((row) => ({
                id: String(row.id),
                tenant_id: String(row.tenant_id),
                case_id: typeof row.case_id === 'string' ? row.case_id : null,
                model_version: String(row.model_version),
                confidence_score: typeof row.confidence_score === 'number' ? row.confidence_score : null,
                output_payload:
                    typeof row.output_payload === 'object' && row.output_payload !== null && !Array.isArray(row.output_payload)
                        ? row.output_payload as Record<string, unknown>
                        : {},
                created_at: String(row.created_at),
            }));
        },
    };
}

function extractTopPrediction(outputPayload: Record<string, unknown>): string | null {
    const diagnosis = outputPayload.diagnosis;
    if (
        typeof diagnosis !== 'object' ||
        diagnosis === null ||
        Array.isArray(diagnosis)
    ) {
        return null;
    }

    const topDifferentials = (diagnosis as Record<string, unknown>).top_differentials;
    if (!Array.isArray(topDifferentials) || topDifferentials.length === 0) {
        return null;
    }

    const topDifferential = topDifferentials[0];
    if (
        typeof topDifferential !== 'object' ||
        topDifferential === null ||
        Array.isArray(topDifferential)
    ) {
        return null;
    }

    return typeof (topDifferential as Record<string, unknown>).name === 'string'
        ? (topDifferential as Record<string, unknown>).name as string
        : null;
}

function formatConfidenceScore(value: number | null): string {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    return `${Math.round(value * 100)}%`;
}

function formatDatasetTimestamp(value: string): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}
