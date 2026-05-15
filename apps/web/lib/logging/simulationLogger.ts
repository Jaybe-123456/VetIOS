/**
 * Simulation Logger
 *
 * Inserts into edge_simulation_events using schema contracts.
 * Returns inserted row ID.
 *
 * Inserts into the tenant-scoped simulation event stream and links the
 * simulation back to the canonical clinical case when available.
 */

import { randomUUID } from 'crypto';
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
    const simulationId = isCanonicalUuid(input.id) ? input.id : randomUUID();
    const tenantId = normalizeRequiredUuid(input.tenant_id, 'tenant_id');

    const { data, error } = await client
        .from(EDGE_SIMULATION_EVENTS.TABLE)
        .insert({
            [C.id]: simulationId,
            [C.tenant_id]: tenantId,
            [C.user_id]: normalizeOptionalUuid(input.user_id),
            [C.clinic_id]: normalizeOptionalUuid(input.clinic_id),
            [C.case_id]: normalizeOptionalUuid(input.case_id),
            [C.source_module]: input.source_module ?? null,
            [C.simulation_type]: input.simulation_type,
            [C.simulation_parameters]: input.simulation_parameters,
            [C.triggered_inference_id]: normalizeOptionalUuid(input.triggered_inference_id),
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

function isCanonicalUuid(value: string | undefined): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeOptionalUuid(value: string | null | undefined): string | null {
    return isCanonicalUuid(value ?? undefined) ? value!.toLowerCase() : null;
}

function normalizeRequiredUuid(value: string, fieldName: string): string {
    if (isCanonicalUuid(value)) return value.toLowerCase();
    throw new Error(`Failed to log simulation event: ${fieldName} must be a canonical UUID.`);
}
