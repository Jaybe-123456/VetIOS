import type { SupabaseClient } from '@supabase/supabase-js';
import { ADVERSARIAL_SIMULATION_RUNS } from '@/lib/db/schemaContracts';
import type { SimulationStep } from '@/lib/simulation/simulationTypes';

export interface AdversarialSimulationRunRowInput {
    simulation_event_id: string;
    tenant_id: string;
    base_case_id: string | null;
    step_index: number;
    m: number;
    perturbation_vector: Record<string, unknown>;
    input_variant: Record<string, unknown>;
    output_summary: Record<string, unknown>;
    global_phi: number;
    state: string;
    collapse_risk: number;
    precliff_flag: boolean;
    instability: Record<string, unknown>;
}

export async function logAdversarialSimulationRunSteps(
    client: SupabaseClient,
    rows: AdversarialSimulationRunRowInput[],
) {
    if (rows.length === 0) return;

    const C = ADVERSARIAL_SIMULATION_RUNS.COLUMNS;
    const { error } = await client
        .from(ADVERSARIAL_SIMULATION_RUNS.TABLE)
        .insert(rows.map((row) => ({
            [C.simulation_event_id]: row.simulation_event_id,
            [C.tenant_id]: row.tenant_id,
            [C.base_case_id]: row.base_case_id,
            [C.step_index]: row.step_index,
            [C.m]: row.m,
            [C.perturbation_vector]: row.perturbation_vector,
            [C.input_variant]: row.input_variant,
            [C.output_summary]: row.output_summary,
            [C.global_phi]: row.global_phi,
            [C.state]: row.state,
            [C.collapse_risk]: row.collapse_risk,
            [C.precliff_flag]: row.precliff_flag,
            [C.instability]: row.instability,
        })));

    if (error) {
        throw new Error(`Failed to log adversarial simulation run steps: ${error.message}`);
    }
}

export function mapSimulationStepsToRows(
    simulationEventId: string,
    tenantId: string,
    baseCaseId: string | null,
    steps: SimulationStep[],
): AdversarialSimulationRunRowInput[] {
    return steps.map((step, index) => ({
        simulation_event_id: simulationEventId,
        tenant_id: tenantId,
        base_case_id: baseCaseId,
        step_index: index,
        m: step.m,
        perturbation_vector: step.perturbation_vector as unknown as Record<string, unknown>,
        input_variant: step.input_variant,
        output_summary: step.output,
        global_phi: step.integrity.global_phi,
        state: step.integrity.state,
        collapse_risk: step.integrity.collapse_risk,
        precliff_flag: step.integrity.precliff_detected,
        instability: step.integrity.instability as unknown as Record<string, unknown>,
    }));
}
