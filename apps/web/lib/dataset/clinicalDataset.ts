import type { SupabaseClient } from '@supabase/supabase-js';
import {
    AI_INFERENCE_EVENTS,
    CLINICAL_CASE_LIVE_VIEW,
} from '@/lib/db/schemaContracts';
import { logClinicalDatasetRead } from '@/lib/dataset/clinicalDatasetDiagnostics';

export interface ClinicalCaseLiveRecord {
    case_id: string;
    tenant_id: string;
    user_id: string | null;
    species: string | null;
    breed: string | null;
    symptoms_summary: string | null;
    latest_inference_event_id: string | null;
    latest_outcome_event_id: string | null;
    latest_simulation_event_id: string | null;
    latest_confidence: number | null;
    latest_emergency_level: string | null;
    source_module: string | null;
    updated_at: string;
}

export interface DatasetInferenceEventRecord {
    id: string;
    tenant_id: string;
    user_id: string | null;
    case_id: string | null;
    source_module: string | null;
    model_version: string;
    confidence_score: number | null;
    output_payload: Record<string, unknown>;
    created_at: string;
}

export interface ClinicalDatasetStore {
    listClinicalCases(tenantId: string, limit: number): Promise<ClinicalCaseLiveRecord[]>;
    listInferenceEvents(tenantId: string, limit: number): Promise<DatasetInferenceEventRecord[]>;
}

export interface TenantClinicalDataset {
    clinicalCases: Array<Record<string, string>>;
    inferenceEvents: Array<Record<string, string>>;
    refreshedAt: string;
}

export interface TenantClinicalDatasetOptions {
    authenticatedUserId?: string | null;
    source?: string;
}

export async function getTenantClinicalDataset(
    store: ClinicalDatasetStore,
    tenantId: string,
    limit = 50,
    options: TenantClinicalDatasetOptions = {},
): Promise<TenantClinicalDataset> {
    const [clinicalCases, inferenceEvents] = await Promise.all([
        store.listClinicalCases(tenantId, limit),
        store.listInferenceEvents(tenantId, limit),
    ]);

    logClinicalDatasetRead({
        source: options.source ?? 'dataset_manager',
        authenticatedUserId: options.authenticatedUserId ?? null,
        resolvedTenantId: tenantId,
        datasetQueryTenantId: tenantId,
        rowCount: clinicalCases.length,
        inferenceRowCount: inferenceEvents.length,
    });

    return {
        clinicalCases: mapClinicalCasesToDatasetRows(clinicalCases),
        inferenceEvents: mapInferenceEventsToDatasetRows(inferenceEvents),
        refreshedAt: new Date().toISOString(),
    };
}

export function mapClinicalCasesToDatasetRows(
    rows: ClinicalCaseLiveRecord[],
): Array<Record<string, string>> {
    return rows.map((row) => ({
        CASE_ID: row.case_id,
        SPECIES: row.species ?? 'Unknown',
        BREED: row.breed ?? '-',
        SYMPTOMS: row.symptoms_summary ?? '-',
        TIMESTAMP: formatDatasetTimestamp(row.updated_at),
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
    const liveCaseColumns = CLINICAL_CASE_LIVE_VIEW.COLUMNS;
    const inferenceColumns = AI_INFERENCE_EVENTS.COLUMNS;

    return {
        async listClinicalCases(tenantId, limit) {
            const { data, error } = await client
                .from(CLINICAL_CASE_LIVE_VIEW.TABLE)
                .select([
                    liveCaseColumns.case_id,
                    liveCaseColumns.tenant_id,
                    liveCaseColumns.user_id,
                    liveCaseColumns.species,
                    liveCaseColumns.breed,
                    liveCaseColumns.symptoms_summary,
                    liveCaseColumns.latest_inference_event_id,
                    liveCaseColumns.latest_outcome_event_id,
                    liveCaseColumns.latest_simulation_event_id,
                    liveCaseColumns.latest_confidence,
                    liveCaseColumns.latest_emergency_level,
                    liveCaseColumns.source_module,
                    liveCaseColumns.updated_at,
                ].join(', '))
                .eq(liveCaseColumns.tenant_id, tenantId)
                .order(liveCaseColumns.updated_at, { ascending: false })
                .limit(limit);

            if (error) {
                throw new Error(`Failed to query clinical case live view: ${error.message}`);
            }

            const liveRows = (data ?? []) as unknown as Array<Record<string, unknown>>;
            return liveRows.map((row) => ({
                case_id: String(row.case_id),
                tenant_id: String(row.tenant_id),
                user_id: typeof row.user_id === 'string' ? row.user_id : null,
                species: typeof row.species === 'string' ? row.species : null,
                breed: typeof row.breed === 'string' ? row.breed : null,
                symptoms_summary: typeof row.symptoms_summary === 'string' ? row.symptoms_summary : null,
                latest_inference_event_id:
                    typeof row.latest_inference_event_id === 'string' ? row.latest_inference_event_id : null,
                latest_outcome_event_id:
                    typeof row.latest_outcome_event_id === 'string' ? row.latest_outcome_event_id : null,
                latest_simulation_event_id:
                    typeof row.latest_simulation_event_id === 'string' ? row.latest_simulation_event_id : null,
                latest_confidence: typeof row.latest_confidence === 'number' ? row.latest_confidence : null,
                latest_emergency_level:
                    typeof row.latest_emergency_level === 'string' ? row.latest_emergency_level : null,
                source_module: typeof row.source_module === 'string' ? row.source_module : null,
                updated_at: String(row.updated_at),
            }));
        },

        async listInferenceEvents(tenantId, limit) {
            const { data, error } = await client
                .from(AI_INFERENCE_EVENTS.TABLE)
                .select([
                    inferenceColumns.id,
                    inferenceColumns.tenant_id,
                    inferenceColumns.user_id,
                    inferenceColumns.case_id,
                    inferenceColumns.source_module,
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
                user_id: typeof row.user_id === 'string' ? row.user_id : null,
                case_id: typeof row.case_id === 'string' ? row.case_id : null,
                source_module: typeof row.source_module === 'string' ? row.source_module : null,
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
