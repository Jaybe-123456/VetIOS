import { createHmac, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordPlatformTelemetry } from '@/lib/platform/telemetry';
import type { WebhookDeliveryRecord, WebhookSubscriptionRecord } from '@/lib/platform/types';

export const SUPPORTED_WEBHOOK_EVENTS = [
    'inference.completed',
    'inference.blocked',
    'evaluation.scored',
    'evaluation.failed',
    'pipeline.started',
    'pipeline.failed',
    'drift.detected',
    'orphan.detected',
] as const;

type SupportedWebhookEvent = typeof SUPPORTED_WEBHOOK_EVENTS[number];

const DELIVERY_BACKOFF_MS = [1000, 4000, 16000];

export async function createWebhookSubscription(
    client: SupabaseClient,
    input: {
        tenantId: string;
        url: string;
        events: string[];
        secret?: string | null;
        active?: boolean;
    },
) {
    const events = normalizeWebhookEvents(input.events);
    if (events.length === 0) {
        throw new Error('At least one supported webhook event is required.');
    }

    const { data, error } = await client
        .from('webhook_subscriptions')
        .insert({
            tenant_id: input.tenantId,
            url: input.url.trim(),
            events,
            secret: input.secret?.trim() || randomUUID().replace(/-/g, ''),
            active: input.active !== false,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create webhook subscription: ${error?.message ?? 'Unknown error'}`);
    }

    return data as WebhookSubscriptionRecord;
}

export async function listWebhookSubscriptions(
    client: SupabaseClient,
    tenantId: string,
) {
    const { data, error } = await client
        .from('webhook_subscriptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

    if (error) {
        throw new Error(`Failed to list webhook subscriptions: ${error.message}`);
    }

    return (data ?? []) as WebhookSubscriptionRecord[];
}

export async function deleteWebhookSubscription(
    client: SupabaseClient,
    tenantId: string,
    id: string,
) {
    const { data, error } = await client
        .from('webhook_subscriptions')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select('*')
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to delete webhook subscription: ${error.message}`);
    }

    return data as WebhookSubscriptionRecord | null;
}

export async function dispatchWebhookEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        eventType: SupportedWebhookEvent;
        payload: Record<string, unknown>;
    },
) {
    const { data, error } = await client
        .from('webhook_subscriptions')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .eq('active', true)
        .contains('events', [input.eventType]);

    if (error) {
        throw new Error(`Failed to load webhook subscriptions for dispatch: ${error.message}`);
    }

    const deliveries: WebhookDeliveryRecord[] = [];
    for (const row of (data ?? []) as WebhookSubscriptionRecord[]) {
        const delivery = await deliverWebhookWithRetry(client, row, input.eventType, input.payload);
        deliveries.push(delivery);
    }

    return deliveries;
}

async function deliverWebhookWithRetry(
    client: SupabaseClient,
    subscription: WebhookSubscriptionRecord,
    eventType: SupportedWebhookEvent,
    payload: Record<string, unknown>,
) {
    let lastDelivery: WebhookDeliveryRecord | null = null;

    for (let index = 0; index < DELIVERY_BACKOFF_MS.length; index += 1) {
        const attemptNo = index + 1;
        const requestPayload = {
            event: eventType,
            tenant_id: subscription.tenant_id,
            timestamp: new Date().toISOString(),
            payload,
        };
        const signature = signWebhookPayload(subscription.secret, requestPayload);

        try {
            const response = await fetch(subscription.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Vetios-Signature': signature,
                },
                body: JSON.stringify(requestPayload),
            });
            const responseText = await response.text();

            lastDelivery = await logWebhookDelivery(client, {
                subscriptionId: subscription.id,
                tenantId: subscription.tenant_id,
                eventType,
                attemptNo,
                statusCode: response.status,
                success: response.ok,
                requestPayload,
                responsePayload: parseWebhookResponse(responseText),
                errorMessage: response.ok ? null : responseText || response.statusText,
            });

            if (response.ok) {
                return lastDelivery;
            }
        } catch (error) {
            lastDelivery = await logWebhookDelivery(client, {
                subscriptionId: subscription.id,
                tenantId: subscription.tenant_id,
                eventType,
                attemptNo,
                statusCode: null,
                success: false,
                requestPayload,
                responsePayload: {},
                errorMessage: error instanceof Error ? error.message : 'Webhook delivery failed.',
            });
        }

        const backoff = DELIVERY_BACKOFF_MS[index];
        if (backoff) {
            await wait(backoff);
        }
    }

    if (!lastDelivery) {
        throw new Error('Webhook delivery did not record any attempt.');
    }

    return lastDelivery;
}

async function logWebhookDelivery(
    client: SupabaseClient,
    input: {
        subscriptionId: string;
        tenantId: string;
        eventType: string;
        attemptNo: number;
        statusCode: number | null;
        success: boolean;
        requestPayload: Record<string, unknown>;
        responsePayload: Record<string, unknown>;
        errorMessage: string | null;
    },
) {
    const { data, error } = await client
        .from('webhook_deliveries')
        .insert({
            subscription_id: input.subscriptionId,
            tenant_id: input.tenantId,
            event_type: input.eventType,
            attempt_no: input.attemptNo,
            status_code: input.statusCode,
            success: input.success,
            request_payload: input.requestPayload,
            response_payload: input.responsePayload,
            error_message: input.errorMessage,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to log webhook delivery: ${error?.message ?? 'Unknown error'}`);
    }

    await recordPlatformTelemetry(client, {
        telemetry_key: `webhook:${input.subscriptionId}:${input.eventType}:${input.attemptNo}:${Date.now()}`,
        inference_event_id: readText(asRecord(input.requestPayload.payload).inference_event_id),
        tenant_id: input.tenantId,
        pipeline_id: 'webhooks',
        model_version: 'platform',
        latency_ms: 0,
        token_count_input: 0,
        token_count_output: 0,
        outcome_linked: false,
        evaluation_score: null,
        flagged: !input.success,
        blocked: false,
        timestamp: new Date().toISOString(),
        metadata: {
            subscription_id: input.subscriptionId,
            event_type: input.eventType,
            attempt_no: input.attemptNo,
            status_code: input.statusCode,
            success: input.success,
            error_message: input.errorMessage,
        },
    });

    return data as WebhookDeliveryRecord;
}

function signWebhookPayload(secret: string, payload: Record<string, unknown>) {
    return createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
}

function normalizeWebhookEvents(events: string[]) {
    const supported = new Set<string>(SUPPORTED_WEBHOOK_EVENTS);
    return [...new Set(events.filter((event) => supported.has(event)))];
}

function wait(durationMs: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, durationMs);
    });
}

function parseWebhookResponse(value: string) {
    if (!value || value.trim().length === 0) {
        return {};
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : { body: value };
    } catch {
        return { body: value };
    }
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
