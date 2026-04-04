import { getSupabaseServer } from '@/lib/supabaseServer';
import { reportBillableUsageToStripe } from '@/lib/billing/stripe-service';

interface UsageRecordInput {
    partnerId: string;
    credentialId: string;
    endpoint: string;
    method: string;
    statusCode: number;
    responseTimeMs: number;
    requestSizeBytes?: number;
    responseSizeBytes?: number;
    region?: string;
    aggregateType?: string;
    isBillable?: boolean;
}

export async function recordUsageEvent(params: UsageRecordInput): Promise<void> {
    defer(async () => {
        try {
            const client = getSupabaseServer();
            const { data, error } = await client
                .from('api_usage_events')
                .insert({
                    partner_id: params.partnerId,
                    credential_id: params.credentialId,
                    endpoint: params.endpoint,
                    method: params.method,
                    status_code: params.statusCode,
                    response_time_ms: Math.max(0, Math.round(params.responseTimeMs)),
                    request_size_bytes: params.requestSizeBytes ?? null,
                    response_size_bytes: params.responseSizeBytes ?? null,
                    region: params.region ?? null,
                    aggregate_type: params.aggregateType ?? null,
                    is_billable: params.isBillable ?? true,
                })
                .select('id')
                .single();

            if (error || !data) {
                return;
            }

            if (params.isBillable !== false) {
                void syncBillableEventToStripe(String((data as Record<string, unknown>).id));
            }
        } catch {
            // Usage recording is intentionally best-effort.
        }
    });
}

export async function syncBillableEventToStripe(usageEventId: string): Promise<void> {
    try {
        await reportBillableUsageToStripe(usageEventId);
    } catch {
        // Billing sync must never surface to caller-facing request paths.
    }
}

function defer(callback: () => Promise<void> | void) {
    if (typeof setImmediate === 'function') {
        setImmediate(() => {
            void callback();
        });
        return;
    }

    setTimeout(() => {
        void callback();
    }, 0);
}
