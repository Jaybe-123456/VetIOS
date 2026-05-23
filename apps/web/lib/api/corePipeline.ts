import { NextResponse } from 'next/server';

const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseWriteError extends Error {
    readonly errorCode: string;
    readonly originalError: unknown;

    constructor(message: string, errorCode: string, originalError: unknown) {
        super(message);
        this.name = 'SupabaseWriteError';
        this.errorCode = errorCode;
        this.originalError = originalError;
    }
}

export function isUuidV4(value: unknown): value is string {
    return typeof value === 'string' && UUID_V4_PATTERN.test(value.trim());
}

export function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

export function logApiReceived(input: {
    event: string;
    route: string;
    tenantId: string | null;
    requestId: string | null;
}): void {
    console.log(JSON.stringify({
        event: input.event,
        route: input.route,
        tenant_id: input.tenantId,
        request_id: input.requestId,
        timestamp: new Date().toISOString(),
    }));
}

export function logApiCompleted(input: {
    event: string;
    route: string;
    tenantId: string | null;
    requestId: string | null;
    startTime: number;
    confidenceScore?: number | null;
    error?: string | null;
    cached?: boolean;
}): void {
    console.log(JSON.stringify({
        event: input.event,
        route: input.route,
        tenant_id: input.tenantId,
        request_id: input.requestId,
        latency_ms: Date.now() - input.startTime,
        confidence_score: input.confidenceScore ?? null,
        cached: input.cached === true,
        error: input.error ?? null,
        timestamp: new Date().toISOString(),
    }));
}

export function logSupabaseFailure(input: {
    route: string;
    requestId: string | null;
    tenantId: string | null;
    errorCode: string;
    error: unknown;
}): void {
    console.error(JSON.stringify({
        event: 'supabase.write_failed',
        route: input.route,
        request_id: input.requestId,
        tenant_id: input.tenantId,
        error_code: input.errorCode,
        detail: readErrorMessage(input.error),
        timestamp: new Date().toISOString(),
    }));
}

export function retryAfterResponse(input: {
    requestId: string | null;
    errorCode: string;
    detail?: string;
}): NextResponse {
    const response = NextResponse.json(
        {
            error: input.errorCode,
            error_code: input.errorCode,
            detail: input.detail ?? 'A retryable persistence dependency is unavailable.',
            request_id: input.requestId,
        },
        { status: 503 },
    );
    response.headers.set('Retry-After', '5');
    return response;
}

export function readErrorCode(error: unknown, fallback: string): string {
    const record = asRecord(error);
    const code = record.code;
    return typeof code === 'string' && code.trim().length > 0 ? code.trim() : fallback;
}

export function readErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    const record = asRecord(error);
    const message = record.message;
    return typeof message === 'string' && message.trim().length > 0
        ? message.trim()
        : 'Unknown error';
}

export function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
