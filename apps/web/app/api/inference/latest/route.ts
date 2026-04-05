import { NextResponse } from 'next/server';
import { requireDebugToolsRouteAccess } from '@/lib/debugTools/routeAccess';
import { getLatestInferenceEventId } from '@/lib/debugTools/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const access = await requireDebugToolsRouteAccess({
        request: req,
        requestId: guard.requestId,
    });
    if (access.response) {
        withRequestHeaders(access.response.headers, guard.requestId, guard.startTime);
        return access.response;
    }

    try {
        const eventId = await getLatestInferenceEventId(access.access.client, access.access.tenantId);
        const response = NextResponse.json({
            event_id: eventId,
            request_id: guard.requestId,
        });
        withRequestHeaders(response.headers, guard.requestId, guard.startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to load latest inference event.',
                request_id: guard.requestId,
            },
            { status: 500 },
        );
        withRequestHeaders(response.headers, guard.requestId, guard.startTime);
        return response;
    }
}
