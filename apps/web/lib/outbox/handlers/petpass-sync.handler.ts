import type { DeliveryResult, OutboxEvent } from '@/lib/outbox/types';

const PETPASS_SYNC_URL = 'https://api.vetios.tech/v1/petpass/sync';

export async function dispatchPetPassSync(event: OutboxEvent): Promise<DeliveryResult> {
    const startedAt = Date.now();

    try {
        const response = await fetch(PETPASS_SYNC_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-idempotency-key': event.id,
                'x-vetios-event-id': event.id,
                'x-vetios-event-name': event.eventName,
            },
            body: JSON.stringify(event.payload),
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
            error: readProviderError(responseBody, `PetPass sync failed with status ${response.status}.`),
            durationMs,
            responseBody,
            retryable: response.status >= 500,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'PetPass sync request failed.',
            durationMs: Date.now() - startedAt,
            retryable: true,
        };
    }
}

function readProviderError(responseBody: string | null, fallback: string): string {
    return responseBody && responseBody.length > 0 ? responseBody : fallback;
}

function truncateText(value: string, maxLength: number): string | null {
    const normalized = value.trim();
    if (!normalized) return null;
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}
