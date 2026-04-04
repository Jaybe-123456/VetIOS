import { NextResponse } from 'next/server';
import { releaseStaleLeases } from '@/lib/outbox/outbox-service';
import { requireOutboxRouteAuthorization } from '@/lib/outbox/routeAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const auth = await requireOutboxRouteAuthorization({
        req,
        requestId,
        route: 'api/outbox/release-stale-leases:POST',
        requirement: 'admin',
    });
    if (auth.response) {
        withRequestHeaders(auth.response.headers, requestId, startTime);
        return auth.response;
    }

    try {
        const released = await releaseStaleLeases(auth.adminClient);
        const response = NextResponse.json({ released, request_id: requestId });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to release stale outbox leases.', request_id: requestId },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
