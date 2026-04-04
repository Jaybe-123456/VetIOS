import { dispatchApiWebhook } from '@/lib/outbox/handlers/api-webhook.handler';
import { dispatchOutcomeContribution } from '@/lib/outbox/handlers/outcome-contribution.handler';
import { dispatchPetPassSync } from '@/lib/outbox/handlers/petpass-sync.handler';
import type { DeliveryResult, OutboxEvent } from '@/lib/outbox/types';

type OutboxHandler = (event: OutboxEvent) => Promise<DeliveryResult>;

const HANDLER_REGISTRY: Record<string, OutboxHandler> = {
    petpass_sync: dispatchPetPassSync,
    outcome_contribution: dispatchOutcomeContribution,
    api_webhook: dispatchApiWebhook,
};

export async function dispatchEvent(event: OutboxEvent): Promise<DeliveryResult> {
    const handler = HANDLER_REGISTRY[event.aggregateType];
    if (!handler) {
        return {
            success: false,
            error: `Unsupported aggregate_type: ${event.aggregateType}`,
            durationMs: 0,
            retryable: false,
        };
    }

    try {
        return await handler(event);
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unhandled outbox delivery failure.',
            durationMs: 0,
            retryable: true,
        };
    }
}
