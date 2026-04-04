import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/outbox/outbox-service';
import { requireOutboxRouteAuthorization } from '@/lib/outbox/routeAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import type { OutboxStatus } from '@/lib/outbox/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const auth = await requireOutboxRouteAuthorization({
        req,
        requestId,
        route: 'api/outbox/events:GET',
        requirement: 'manage_models',
    });
    if (auth.response) {
        withRequestHeaders(auth.response.headers, requestId, startTime);
        return auth.response;
    }

    try {
        const url = new URL(req.url);
        const status = normalizeStatusFilter(url.searchParams.get('status'));
        const aggregateType = normalizeOptionalText(url.searchParams.get('aggregateType'));
        const limit = readPositiveInteger(url.searchParams.get('limit'), 50);
        const offset = Math.max(0, readPositiveInteger(url.searchParams.get('offset'), 0));
        const result = await getEvents({
            status: status ?? undefined,
            aggregateType: aggregateType ?? undefined,
            limit,
            offset,
        }, auth.adminClient);

        const response = NextResponse.json({
            events: result.events,
            total: result.total,
            filters: {
                status: status ?? 'all',
                aggregateType,
                limit,
                offset,
            },
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to list outbox events.', request_id: requestId },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function normalizeStatusFilter(value: string | null): OutboxStatus | null {
    return value === 'pending' || value === 'processing' || value === 'retryable' || value === 'dead_letter' || value === 'delivered'
        ? value
        : null;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInteger(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.floor(parsed);
        }
    }
    return fallback;
}
