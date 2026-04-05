import { NextResponse } from 'next/server';
import { POST as runInference } from '@/app/api/inference/route';
import { buildInferenceTestPayload } from '@/lib/debugTools/payloads';
import { buildJsonProxyRequest } from '@/lib/debugTools/proxy';
import { requireDebugToolsRouteAccess } from '@/lib/debugTools/routeAccess';
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
        return await runInference(
            buildJsonProxyRequest(req, '/api/inference', buildInferenceTestPayload()),
        );
    } catch (error) {
        const response = NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to run inference test.',
                request_id: guard.requestId,
            },
            { status: 500 },
        );
        withRequestHeaders(response.headers, guard.requestId, guard.startTime);
        return response;
    }
}
