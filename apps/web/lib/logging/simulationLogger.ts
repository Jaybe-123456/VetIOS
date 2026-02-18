/**
 * Simulation Logger
 *
 * Inserts into edge_simulation_events.
 * Returns inserted row ID.
 *
 * Every simulation must call the inference pipeline —
 * otherwise you don't generate adversarial inference data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
    const { data, error } = await client
        .from('edge_simulation_events')
        .insert({
            tenant_id: input.tenant_id,
            simulation_type: input.simulation_type,
            simulation_parameters: input.simulation_parameters,
            scenario: input.scenario,
            triggered_inference_id: input.triggered_inference_id,
            inference_output: input.inference_output ?? null,
            failure_mode: input.failure_mode ?? null,
        })
        .select('id')
        .single();

    if (error || !data) {
        throw new Error(`Failed to log simulation event: ${error?.message ?? 'Unknown error'}`);
    }

    return data.id as string;
}
