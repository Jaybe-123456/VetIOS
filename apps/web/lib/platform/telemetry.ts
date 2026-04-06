import type { SupabaseClient } from '@supabase/supabase-js';
import { publishPlatformTelemetry } from '@/lib/platform/eventBus';
import type { PlatformTelemetryRecord } from '@/lib/platform/types';

export async function recordPlatformTelemetry(
    client: SupabaseClient,
    input: PlatformTelemetryRecord,
): Promise<PlatformTelemetryRecord> {
    const payload = {
        telemetry_key: input.telemetry_key,
        inference_event_id: input.inference_event_id,
        tenant_id: input.tenant_id,
        pipeline_id: input.pipeline_id,
        model_version: input.model_version,
        latency_ms: Math.max(0, Math.round(input.latency_ms)),
        token_count_input: Math.max(0, Math.round(input.token_count_input)),
        token_count_output: Math.max(0, Math.round(input.token_count_output)),
        outcome_linked: input.outcome_linked,
        evaluation_score: input.evaluation_score,
        flagged: input.flagged,
        blocked: input.blocked,
        timestamp: input.timestamp,
        metadata: input.metadata ?? {},
    };

    const { data, error } = await client
        .from('platform_telemetry')
        .upsert(payload, { onConflict: 'telemetry_key' })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to record platform telemetry: ${error?.message ?? 'Unknown error'}`);
    }

    const record = data as unknown as PlatformTelemetryRecord;
    publishPlatformTelemetry(record);
    return record;
}

export async function listRecentPlatformTelemetry(
    client: SupabaseClient,
    tenantId: string,
    limit: number = 100,
): Promise<PlatformTelemetryRecord[]> {
    const { data, error } = await client
        .from('platform_telemetry')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('timestamp', { ascending: false })
        .limit(Math.max(1, Math.min(limit, 200)));

    if (error) {
        throw new Error(`Failed to list platform telemetry: ${error.message}`);
    }

    return (data ?? []) as PlatformTelemetryRecord[];
}
