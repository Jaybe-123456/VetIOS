import { getSupabaseServer } from '@/lib/supabaseServer';
import type { DeliveryResult, OutboxEvent } from '@/lib/outbox/types';

export async function dispatchEdgeSync(event: OutboxEvent): Promise<DeliveryResult> {
    const startedAt = Date.now();
    const jobId = readText(event.payload.sync_job_id) ?? event.aggregateId;
    const tenantId = readText(event.payload.tenant_id) ?? readText(event.metadata.tenant_id);
    const edgeBoxId = readText(event.payload.edge_box_id) ?? readText(event.metadata.edge_box_id);

    if (!jobId || !tenantId || !edgeBoxId) {
        return {
            success: false,
            error: 'Edge sync outbox event is missing tenant_id, edge_box_id, or sync_job_id.',
            durationMs: Date.now() - startedAt,
            retryable: false,
        };
    }

    const client = getSupabaseServer();
    const { data: edgeBox, error: edgeError } = await client
        .from('edge_boxes')
        .select('id,status')
        .eq('tenant_id', tenantId)
        .eq('id', edgeBoxId)
        .maybeSingle();

    if (edgeError) {
        return {
            success: false,
            error: edgeError.message,
            durationMs: Date.now() - startedAt,
            retryable: true,
        };
    }
    if (!edgeBox) {
        return {
            success: false,
            error: 'Edge box no longer exists for queued sync job.',
            durationMs: Date.now() - startedAt,
            retryable: false,
        };
    }
    if ((edgeBox as Record<string, unknown>).status === 'retired') {
        await client
            .from('edge_sync_jobs')
            .update({
                status: 'canceled',
                completed_at: new Date().toISOString(),
                error_message: 'Edge box retired before job dispatch.',
            })
            .eq('tenant_id', tenantId)
            .eq('id', jobId);
        return {
            success: true,
            statusCode: 200,
            responseBody: JSON.stringify({ job_id: jobId, status: 'canceled' }),
            durationMs: Date.now() - startedAt,
        };
    }

    const { data: job, error: jobError } = await client
        .from('edge_sync_jobs')
        .select('id,status')
        .eq('tenant_id', tenantId)
        .eq('edge_box_id', edgeBoxId)
        .eq('id', jobId)
        .maybeSingle();

    if (jobError) {
        return {
            success: false,
            error: jobError.message,
            durationMs: Date.now() - startedAt,
            retryable: true,
        };
    }

    return {
        success: Boolean(job),
        statusCode: job ? 200 : 404,
        responseBody: JSON.stringify({
            job_id: jobId,
            status: job ? (job as Record<string, unknown>).status : 'missing',
            delivery: 'queued_for_edge_pull',
        }),
        error: job ? undefined : 'Edge sync job no longer exists.',
        durationMs: Date.now() - startedAt,
        retryable: false,
    };
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
