export type OutboxStatus = 'pending' | 'processing' | 'retryable' | 'dead_letter' | 'delivered';

export interface OutboxEvent {
    id: string;
    aggregateType: string;
    aggregateId: string;
    eventName: string;
    payload: Record<string, unknown>;
    status: OutboxStatus;
    attemptCount: number;
    maxAttempts: number;
    lastAttemptedAt: Date | null;
    nextRetryAt: Date | null;
    leasedUntil: Date | null;
    leasedBy: string | null;
    errorDetail: string | null;
    createdAt: Date;
    deliveredAt: Date | null;
    metadata: Record<string, unknown>;
}

export interface OutboxEventListItem extends OutboxEvent {
    deliveryAttemptCount: number;
}

export interface OutboxDeliveryAttempt {
    id: string;
    eventId: string;
    attemptedAt: Date;
    success: boolean;
    statusCode: number | null;
    responseBody: string | null;
    errorDetail: string | null;
    durationMs: number | null;
}

export interface OutboxSnapshot {
    pending: number;
    processing: number;
    retryable: number;
    deadLetter: number;
    delivered: number;
    total: number;
}

export interface DispatchResult {
    workerId: string;
    dispatched: number;
    delivered: number;
    failed: number;
    deadLettered: number;
    durationMs: number;
}

export interface RetryResult {
    reset: number;
}

export interface DeliveryResult {
    success: boolean;
    statusCode?: number;
    error?: string;
    durationMs: number;
    responseBody?: string | null;
    retryable?: boolean;
}
