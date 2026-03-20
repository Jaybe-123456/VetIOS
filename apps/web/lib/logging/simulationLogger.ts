/**
 * Simulation Logger
 *
 * Inserts into edge_simulation_events using schema contracts.
 * Returns inserted row ID.
 *
 * Inserts into the tenant-scoped simulation event stream and links the
 * simulation back to the canonical clinical case when available.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { EDGE_SIMULATION_EVENTS } from '@/lib/db/schemaContracts';

export interface SimulationLogInput {
    id?: string;
    tenant_id: string;
    user_id?: string | null;
    clinic_id?: string | null;
    case_id?: string | null;
    source_module?: string | null;
    simulation_type: string;
    simulation_parameters: Record<string, unknown>;
    triggered_inference_id: string | null;
    failure_mode?: string | null;
    stress_metrics?: Record<string, unknown> | null;
    is_real_world: boolean;
}

export async function logSimulation(
    client: SupabaseClient,
    input: SimulationLogInput,
): Promise<string> {
    const C = EDGE_SIMULATION_EVENTS.COLUMNS;

    const { data, error } = await client
        .from(EDGE_SIMULATION_EVENTS.TABLE)
        .insert({
            [C.id]: input.id,
            [C.tenant_id]: input.tenant_id,
            [C.user_id]: input.user_id ?? null,
            [C.clinic_id]: input.clinic_id ?? null,
            [C.case_id]: input.case_id ?? null,
            [C.source_module]: input.source_module ?? null,
            [C.simulation_type]: input.simulation_type,
            [C.simulation_parameters]: input.simulation_parameters,
            [C.triggered_inference_id]: input.triggered_inference_id,
            [C.failure_mode]: input.failure_mode ?? null,
            [C.stress_metrics]: input.stress_metrics ?? null,
            [C.is_real_world]: input.is_real_world,
        })
        .select('id')
        .single();

    if (error || !data) {
        throw new Error(`Failed to log simulation event: ${error?.message ?? 'Unknown error'}`);
    }

    return data.id as string;
}
