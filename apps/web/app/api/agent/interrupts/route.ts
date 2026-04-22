import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getGaaSPlatform } from '@/lib/gaas';
import { handleListInterrupts } from '@vetios/gaas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/interrupts
 *
 * List all pending HITL interrupts awaiting human review.
 */
export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    try {
        const platform = getGaaSPlatform();
        const result = await handleListInterrupts(platform.hitlManager);

        const res = NextResponse.json({
            data: result,
            meta: {
                timestamp: new Date().toISOString(),
                request_id: requestId,
            },
            error: null,
        });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    } catch (error) {
        const res = NextResponse.json(
            {
                data: null,
                meta: {
                    timestamp: new Date().toISOString(),
                    request_id: requestId,
                },
                error: {
                    code: 'interrupts_fetch_failed',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Failed to fetch HITL interrupts.',
                },
            },
            { status: 500 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}
