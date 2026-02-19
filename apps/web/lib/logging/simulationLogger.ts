/**
 * Simulation Logger
 *
 * Inserts into edge_simulation_events using schema contracts.
 * Returns inserted row ID.
 *
 * Every simulation must call the inference pipeline.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { EDGE_SIMULATION_EVENTS } from '@/lib/db/schemaContracts';

export interface SimulationLogInput {
    tenant_id: string;
    simulation_type: string;
    simulation_parameters: Record<string, unknown>;
    scenario: Record<string, unknown>;
    triggered_inference_id: string | null;
    inference_output?: Record<string, unknown> | null;
    failure_mode?: string | null;
}

export async function logSimulation(
    client: SupabaseClient,
    input: SimulationLogInput,
): Promise<string> {
    const C = EDGE_SIMULATION_EVENTS.COLUMNS;

    const { data, error } = await client
        .from(EDGE_SIMULATION_EVENTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenant_id,
            [C.simulation_type]: input.simulation_type,
            [C.simulation_parameters]: input.simulation_parameters,
            [C.scenario]: input.scenario,
            [C.triggered_inference_id]: input.triggered_inference_id,
            [C.inference_output]: input.inference_output ?? null,
            [C.failure_mode]: input.failure_mode ?? null,
        })
        .select('id')
        .single();

    if (error || !data) {
        throw new Error(`Failed to log simulation event: ${error?.message ?? 'Unknown error'}`);
    }

    return data.id as string;
}
