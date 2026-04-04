import { NextResponse } from 'next/server';
import { getDeliveryAttempts } from '@/lib/outbox/outbox-service';
import { requireOutboxRouteAuthorization } from '@/lib/outbox/routeAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const auth = await requireOutboxRouteAuthorization({
        req,
        requestId,
        route: 'api/outbox/events/[id]/attempts:GET',
        requirement: 'manage_models',
    });
    if (auth.response) {
        withRequestHeaders(auth.response.headers, requestId, startTime);
        return auth.response;
    }

    try {
        const params = await context.params;
        const attempts = await getDeliveryAttempts(params.id, auth.adminClient);
        const response = NextResponse.json({ attempts, request_id: requestId });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to load outbox delivery attempts.', request_id: requestId },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
