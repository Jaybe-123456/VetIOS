import type { SupabaseClient } from '@supabase/supabase-js';
import { CONTROL_PLANE_ALERTS } from '@/lib/db/schemaContracts';
import { recordPlatformTelemetry } from '@/lib/platform/telemetry';

type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export async function createPlatformAlert(
    client: SupabaseClient,
    input: {
        tenantId: string;
        type: string;
        severity: AlertSeverity;
        title: string;
        message: string;
        nodeId?: string | null;
        metadata?: Record<string, unknown>;
    },
) {
    const C = CONTROL_PLANE_ALERTS.COLUMNS;
    const mappedSeverity = input.severity === 'critical'
        ? 'critical'
        : input.severity === 'high'
            ? 'high'
            : 'warning';

    const { data, error } = await client
        .from(CONTROL_PLANE_ALERTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.severity]: mappedSeverity,
            [C.title]: input.title,
            [C.message]: input.message,
            [C.node_id]: input.nodeId ?? null,
            [C.resolved]: false,
            [C.metadata]: {
                alert_type: input.type,
                ...(input.metadata ?? {}),
            },
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create platform alert: ${error?.message ?? 'Unknown error'}`);
    }

    await recordPlatformTelemetry(client, {
        telemetry_key: `alert:${input.type}:${input.tenantId}:${new Date().toISOString()}`,
        inference_event_id: null,
        tenant_id: input.tenantId,
        pipeline_id: 'alerts',
        model_version: 'platform',
        latency_ms: 0,
        token_count_input: 0,
        token_count_output: 0,
        outcome_linked: false,
        evaluation_score: null,
        flagged: true,
        blocked: false,
        timestamp: new Date().toISOString(),
        metadata: {
            alert_id: (data as Record<string, unknown>).id ?? null,
            alert_type: input.type,
            title: input.title,
            severity: input.severity,
        },
    });

    return data;
}
