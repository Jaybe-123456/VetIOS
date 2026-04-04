import { createHmac } from 'crypto';
import type { DeliveryResult, OutboxEvent } from '@/lib/outbox/types';

export async function dispatchApiWebhook(event: OutboxEvent): Promise<DeliveryResult> {
    const startedAt = Date.now();

    try {
        const webhookUrl = readWebhookUrl(event.payload);
        if (!webhookUrl) {
            return {
                success: false,
                error: 'api_webhook payload must include webhookUrl.',
                durationMs: Date.now() - startedAt,
                retryable: false,
            };
        }

        const signingSecret = resolveSigningSecret();
        if (!signingSecret) {
            return {
                success: false,
                error: 'Webhook signing secret is not configured. Set OUTBOX_WEBHOOK_SIGNING_SECRET.',
                durationMs: Date.now() - startedAt,
                retryable: false,
            };
        }

        const requestBody = buildWebhookBody(event.payload);
        const requestText = JSON.stringify(requestBody);
        const signature = createHmac('sha256', signingSecret).update(requestText).digest('hex');
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-idempotency-key': event.id,
                'x-vetios-signature': signature,
                'x-vetios-event-id': event.id,
                'x-vetios-event-name': event.eventName,
                ...readHeaderOverrides(event.payload),
            },
            body: requestText,
            signal: AbortSignal.timeout(10_000),
        });

        const responseBody = truncateText(await response.text(), 4_000);
        const durationMs = Date.now() - startedAt;
        if (response.ok) {
            return {
                success: true,
                statusCode: response.status,
                durationMs,
                responseBody,
                retryable: false,
            };
        }

        return {
            success: false,
            statusCode: response.status,
            error: responseBody ?? `Webhook delivery failed with status ${response.status}.`,
            durationMs,
            responseBody,
            retryable: response.status >= 500,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Webhook delivery request failed.',
            durationMs: Date.now() - startedAt,
            retryable: true,
        };
    }
}

function readWebhookUrl(payload: Record<string, unknown>): string | null {
    const direct = payload.webhookUrl;
    return typeof direct === 'string' && direct.trim().length > 0 ? direct.trim() : null;
}

function resolveSigningSecret(): string | null {
    const candidates = [
        process.env.OUTBOX_WEBHOOK_SIGNING_SECRET,
        process.env.VETIOS_INTERNAL_API_TOKEN,
        process.env.CRON_SECRET,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    return null;
}

function buildWebhookBody(payload: Record<string, unknown>): Record<string, unknown> {
    const nestedBody = payload.body;
    if (nestedBody && typeof nestedBody === 'object' && !Array.isArray(nestedBody)) {
        return nestedBody as Record<string, unknown>;
    }

    const nextPayload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        if (key === 'webhookUrl' || key === 'headers') continue;
        nextPayload[key] = value;
    }
    return nextPayload;
}

function readHeaderOverrides(payload: Record<string, unknown>): HeadersInit {
    const headers = payload.headers;
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(headers as Record<string, unknown>)
            .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
            .map(([key, value]) => [key, String(value)]),
    );
}

function truncateText(value: string, maxLength: number): string | null {
    const normalized = value.trim();
    if (!normalized) return null;
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}
