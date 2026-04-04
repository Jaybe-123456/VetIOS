import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { dispatchBatch } from '@/lib/outbox/outbox-service';
import { requireOutboxRouteAuthorization } from '@/lib/outbox/routeAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const auth = await requireOutboxRouteAuthorization({
        req,
        requestId,
        route: 'api/outbox/dispatch:POST',
        requirement: 'admin',
    });
    if (auth.response) {
        withRequestHeaders(auth.response.headers, requestId, startTime);
        return auth.response;
    }

    const body = await safeJson<{ batchSize?: number }>(req);
    const batchSize = body.ok ? readPositiveInteger(body.data.batchSize, 25) : 25;

    try {
        const result = await dispatchBatch({
            batchSize,
            workerId: `manual-outbox:${randomUUID()}`,
        }, auth.adminClient);
        const response = NextResponse.json({ result, request_id: requestId });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Manual outbox dispatch failed.', request_id: requestId },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function readPositiveInteger(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return fallback;
}
