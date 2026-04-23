import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getGaaSPlatform } from '@/lib/gaas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/interrupts/[interruptId]/resolve
 *
 * Resolves a specific HITL interrupt — approved, rejected, or modified.
 * Called by the operator dashboard approve/reject/modify buttons.
 */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ interruptId: string }> }
) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const { interruptId } = await params;

    if (!interruptId) {
        const res = NextResponse.json(
            {
                data: null,
                meta: { timestamp: new Date().toISOString(), request_id: requestId },
                error: { code: 'bad_request', message: 'interruptId is required.' },
            },
            { status: 400 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    let body: { resolution?: string; resolved_by?: string; modified_input?: Record<string, unknown> };
    try {
        body = await req.json() as typeof body;
    } catch {
        const res = NextResponse.json(
            {
                data: null,
                meta: { timestamp: new Date().toISOString(), request_id: requestId },
                error: { code: 'bad_request', message: 'Invalid JSON body.' },
            },
            { status: 400 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    const validResolutions = ['approved', 'rejected', 'modified'] as const;
    type Resolution = typeof validResolutions[number];

    const resolution = body.resolution as Resolution;
    if (!resolution || !validResolutions.includes(resolution)) {
        const res = NextResponse.json(
            {
                data: null,
                meta: { timestamp: new Date().toISOString(), request_id: requestId },
                error: {
                    code: 'bad_request',
                    message: `resolution must be one of: ${validResolutions.join(', ')}`,
                },
            },
            { status: 400 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    try {
        const platform = getGaaSPlatform();
        const resolved = await platform.hitlManager.resolve(
            interruptId,
            resolution,
            body.resolved_by ?? 'operator',
            body.modified_input
        );

        const res = NextResponse.json({
            data: {
                interrupt_id: resolved.interrupt_id,
                agent_run_id: resolved.agent_run_id,
                resolution: resolved.resolution,
                resolved_by: resolved.resolved_by,
                resolved_at: resolved.resolved_at,
            },
            meta: { timestamp: new Date().toISOString(), request_id: requestId },
            error: null,
        });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    } catch (err) {
        const res = NextResponse.json(
            {
                data: null,
                meta: { timestamp: new Date().toISOString(), request_id: requestId },
                error: {
                    code: 'resolve_failed',
                    message: err instanceof Error ? err.message : 'Failed to resolve interrupt.',
                },
            },
            { status: 500 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}
