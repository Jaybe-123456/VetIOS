import type { SupabaseClient } from '@supabase/supabase-js';
import {
    AI_INFERENCE_EVENTS,
    CLINICAL_CASE_LIVE_VIEW,
    CLINICAL_OUTCOME_EVENTS,
    EDGE_SIMULATION_EVENTS,
} from '@/lib/db/schemaContracts';

export interface ClinicalDatasetReadLog {
    source: string;
    authenticatedUserId: string | null;
    resolvedTenantId: string;
    datasetQueryTenantId: string;
    rowCount: number;
    inferenceRowCount: number;
}

export interface ClinicalDatasetMutationLog {
    source: string;
    mutationType: 'inference' | 'outcome' | 'simulation';
    authenticatedUserId: string | null;
    resolvedTenantId: string;
    writeTenantId: string;
    caseId: string | null;
    inferenceEventId?: string | null;
    outcomeEventId?: string | null;
    simulationEventId?: string | null;
}

export interface ClinicalDatasetDebugSnapshot {
    authenticated_user_id: string | null;
    resolved_tenant_id: string;
    dataset_query_tenant_id: string;
    dataset_row_count: number;
    orphan_counts: {
        inference_events_missing_case_id: number;
        outcome_events_missing_case_id: number;
        simulation_events_missing_case_id: number;
    };
    recent_inference_writes: Array<Record<string, unknown>>;
    recent_outcome_writes: Array<Record<string, unknown>>;
    recent_simulation_writes: Array<Record<string, unknown>>;
    generated_at: string;
}

export function logClinicalDatasetRead(input: ClinicalDatasetReadLog): void {
    console.info(
        '[clinical-dataset] read',
        JSON.stringify({
            source: input.source,
            authenticated_user_id: input.authenticatedUserId,
            resolved_tenant_id: input.resolvedTenantId,
            dataset_query_tenant_id: input.datasetQueryTenantId,
            row_count: input.rowCount,
            inference_row_count: input.inferenceRowCount,
        }),
    );
}

export function logClinicalDatasetMutation(input: ClinicalDatasetMutationLog): void {
    console.info(
        '[clinical-dataset] write',
        JSON.stringify({
            source: input.source,
            mutation_type: input.mutationType,
            authenticated_user_id: input.authenticatedUserId,
            resolved_tenant_id: input.resolvedTenantId,
            write_tenant_id: input.writeTenantId,
            case_id: input.caseId,
            inference_event_id: input.inferenceEventId ?? null,
            outcome_event_id: input.outcomeEventId ?? null,
            simulation_event_id: input.simulationEventId ?? null,
        }),
    );
}

export async function collectClinicalDatasetDebugSnapshot(
    client: SupabaseClient,
    tenantId: string,
    userId: string | null,
): Promise<ClinicalDatasetDebugSnapshot> {
    const inferenceColumns = AI_INFERENCE_EVENTS.COLUMNS;
    const outcomeColumns = CLINICAL_OUTCOME_EVENTS.COLUMNS;
    const simulationColumns = EDGE_SIMULATION_EVENTS.COLUMNS;
    const liveCaseColumns = CLINICAL_CASE_LIVE_VIEW.COLUMNS;

    const [
        recentInferenceWrites,
        recentOutcomeWrites,
        recentSimulationWrites,
        liveCaseRows,
        orphanInferenceCount,
        orphanOutcomeCount,
        orphanSimulationCount,
    ] = await Promise.all([
        client
            .from(AI_INFERENCE_EVENTS.TABLE)
            .select([
                inferenceColumns.id,
                inferenceColumns.tenant_id,
                inferenceColumns.user_id,
                inferenceColumns.case_id,
                inferenceColumns.source_module,
                inferenceColumns.model_version,
                inferenceColumns.created_at,
            ].join(', '))
            .eq(inferenceColumns.tenant_id, tenantId)
            .order(inferenceColumns.created_at, { ascending: false })
            .limit(20),
        client
            .from(CLINICAL_OUTCOME_EVENTS.TABLE)
            .select([
                outcomeColumns.id,
                outcomeColumns.tenant_id,
                outcomeColumns.user_id,
                outcomeColumns.case_id,
                outcomeColumns.source_module,
                outcomeColumns.inference_event_id,
                outcomeColumns.created_at,
            ].join(', '))
            .eq(outcomeColumns.tenant_id, tenantId)
            .order(outcomeColumns.created_at, { ascending: false })
            .limit(20),
        client
            .from(EDGE_SIMULATION_EVENTS.TABLE)
            .select([
                simulationColumns.id,
                simulationColumns.tenant_id,
                simulationColumns.user_id,
                simulationColumns.case_id,
                simulationColumns.source_module,
                simulationColumns.triggered_inference_id,
                simulationColumns.created_at,
            ].join(', '))
            .eq(simulationColumns.tenant_id, tenantId)
            .order(simulationColumns.created_at, { ascending: false })
            .limit(20),
        client
            .from(CLINICAL_CASE_LIVE_VIEW.TABLE)
            .select(liveCaseColumns.case_id, { count: 'exact', head: true })
            .eq(liveCaseColumns.tenant_id, tenantId),
        client
            .from(AI_INFERENCE_EVENTS.TABLE)
            .select(inferenceColumns.id, { count: 'exact', head: true })
            .eq(inferenceColumns.tenant_id, tenantId)
            .is(inferenceColumns.case_id, null),
        client
            .from(CLINICAL_OUTCOME_EVENTS.TABLE)
            .select(outcomeColumns.id, { count: 'exact', head: true })
            .eq(outcomeColumns.tenant_id, tenantId)
            .is(outcomeColumns.case_id, null),
        client
            .from(EDGE_SIMULATION_EVENTS.TABLE)
            .select(simulationColumns.id, { count: 'exact', head: true })
            .eq(simulationColumns.tenant_id, tenantId)
            .is(simulationColumns.case_id, null),
    ]);

    const errors = [
        recentInferenceWrites.error,
        recentOutcomeWrites.error,
        recentSimulationWrites.error,
        liveCaseRows.error,
        orphanInferenceCount.error,
        orphanOutcomeCount.error,
        orphanSimulationCount.error,
    ].filter(Boolean);

    if (errors.length > 0) {
        throw new Error(`Failed to collect dataset diagnostics: ${errors[0]?.message ?? 'Unknown error'}`);
    }

    return {
        authenticated_user_id: userId,
        resolved_tenant_id: tenantId,
        dataset_query_tenant_id: tenantId,
        dataset_row_count: liveCaseRows.count ?? 0,
        orphan_counts: {
            inference_events_missing_case_id: orphanInferenceCount.count ?? 0,
            outcome_events_missing_case_id: orphanOutcomeCount.count ?? 0,
            simulation_events_missing_case_id: orphanSimulationCount.count ?? 0,
        },
        recent_inference_writes: toDebugRecords(recentInferenceWrites.data),
        recent_outcome_writes: toDebugRecords(recentOutcomeWrites.data),
        recent_simulation_writes: toDebugRecords(recentSimulationWrites.data),
        generated_at: new Date().toISOString(),
    };
}

function toDebugRecords(rows: unknown[] | null): Array<Record<string, unknown>> {
    return (rows ?? []).map((row) =>
        typeof row === 'object' && row !== null && !Array.isArray(row)
            ? { ...(row as Record<string, unknown>) }
            : { value: String(row) },
    );
}
