import type { SupabaseClient } from '@supabase/supabase-js';
import { collectClinicalDatasetDebugSnapshot } from '@/lib/dataset/clinicalDatasetDiagnostics';
import { AI_INFERENCE_EVENTS } from '@/lib/db/schemaContracts';
import { getOrphanCounter } from '@/lib/platform/flywheel';

export async function getLatestInferenceEventId(client: SupabaseClient, tenantId: string) {
    const columns = AI_INFERENCE_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(AI_INFERENCE_EVENTS.TABLE)
        .select(columns.id)
        .eq(columns.tenant_id, tenantId)
        .order(columns.created_at, { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load latest inference event: ${error.message}`);
    }

    return readText((data as Record<string, unknown> | null)?.id);
}

export async function getLatestEvaluationEventId(client: SupabaseClient, tenantId: string) {
    const { data, error } = await client
        .from('evaluations')
        .select('id')
        .eq('tenant_id', tenantId)
        .order('evaluated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load latest evaluation event: ${error.message}`);
    }

    return readText((data as Record<string, unknown> | null)?.id);
}

export async function getDatasetRowCount(client: SupabaseClient, tenantId: string, userId: string | null) {
    const snapshot = await collectClinicalDatasetDebugSnapshot(client, tenantId, userId);
    return snapshot.dataset_row_count;
}

export async function getOrphanEventCount(client: SupabaseClient, tenantId: string, userId: string | null) {
    void userId;
    return getOrphanCounter(client, tenantId);
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
