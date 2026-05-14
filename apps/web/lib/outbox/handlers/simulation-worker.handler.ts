import { getSupabaseServer } from '@/lib/supabaseServer';
import { dispatchQueuedSimulationWorkerTask } from '@/lib/platform/simulations';
import type { DeliveryResult, OutboxEvent } from '@/lib/outbox/types';

export async function dispatchSimulationWorker(event: OutboxEvent): Promise<DeliveryResult> {
    const startedAt = Date.now();
    const tenantId = readText(event.metadata.tenant_id)
        ?? readText(event.payload.tenant_id);
    const simulationId = readText(event.metadata.simulation_id)
        ?? readText(event.payload.simulation_id)
        ?? event.aggregateId;

    if (!tenantId || !simulationId) {
        return {
            success: false,
            error: 'Simulation worker event is missing tenant_id or simulation_id.',
            durationMs: Date.now() - startedAt,
            retryable: false,
        };
    }

    const result = await dispatchQueuedSimulationWorkerTask(getSupabaseServer(), {
        tenantId,
        simulationId,
    });

    return {
        success: true,
        statusCode: 200,
        responseBody: JSON.stringify(result),
        durationMs: Date.now() - startedAt,
    };
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
