import { NextResponse } from 'next/server';
import { POST as runOutcome } from '@/app/api/outcome/route';
import { buildOutcomeTestPayload } from '@/lib/debugTools/payloads';
import { buildJsonProxyRequest } from '@/lib/debugTools/proxy';
import { requireDebugToolsRouteAccess } from '@/lib/debugTools/routeAccess';
import { getLatestInferenceEventId } from '@/lib/debugTools/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
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
        const inferenceEventId = await getLatestInferenceEventId(access.access.client, access.access.tenantId);
        if (!inferenceEventId) {
            const response = NextResponse.json(
                {
                    error: 'No inference event is available yet. Run Test Inference Endpoint first.',
                    request_id: guard.requestId,
                },
                { status: 409 },
            );
            withRequestHeaders(response.headers, guard.requestId, guard.startTime);
            return response;
        }

        return await runOutcome(
            buildJsonProxyRequest(req, '/api/outcome', buildOutcomeTestPayload(inferenceEventId)),
        );
    } catch (error) {
        const response = NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to run outcome test.',
                request_id: guard.requestId,
            },
            { status: 500 },
        );
        withRequestHeaders(response.headers, guard.requestId, guard.startTime);
        return response;
    }
}
