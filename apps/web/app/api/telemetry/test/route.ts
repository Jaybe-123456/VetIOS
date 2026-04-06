import { NextResponse } from 'next/server';
import { requireDebugToolsRouteAccess } from '@/lib/debugTools/routeAccess';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { recordPlatformTelemetry } from '@/lib/platform/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
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
        const event = await recordPlatformTelemetry(access.access.client, {
            telemetry_key: `telemetry-test:${access.access.tenantId}:${Date.now()}`,
            inference_event_id: null,
            tenant_id: access.access.tenantId,
            pipeline_id: 'telemetry-test',
            model_version: 'platform',
            latency_ms: 1,
            token_count_input: 1,
            token_count_output: 1,
            outcome_linked: false,
            evaluation_score: null,
            flagged: false,
            blocked: false,
            timestamp: new Date().toISOString(),
            metadata: {
                source: 'debug_tools',
                request_id: guard.requestId,
            },
        });

        const response = NextResponse.json({
            event,
            request_id: guard.requestId,
        });
        withRequestHeaders(response.headers, guard.requestId, guard.startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to run telemetry stream test.',
                request_id: guard.requestId,
            },
            { status: 500 },
        );
        withRequestHeaders(response.headers, guard.requestId, guard.startTime);
        return response;
    }
}
