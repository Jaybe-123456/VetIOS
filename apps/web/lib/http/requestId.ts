/**
 * Request ID — structured tracing through all API routes.
 *
 * Reads `x-request-id` from incoming request headers (set by load balancers
 * or clients), or generates a new one. The ID is propagated to response
 * headers and should be included in all log messages.
 */

import { randomUUID } from 'crypto';

/**
 * Extract or generate a request ID from the incoming request.
 */
export function getRequestId(req: Request): string {
    return req.headers.get('x-request-id') || `req_${randomUUID().slice(0, 12)}`;
}

/**
 * Add the request ID and standard timing headers to a NextResponse.
 */
export function withRequestHeaders(
    headers: Headers,
    requestId: string,
    startTime?: number,
): void {
    headers.set('x-request-id', requestId);
    if (startTime) {
        headers.set('x-response-time', `${Date.now() - startTime}ms`);
    }
}
