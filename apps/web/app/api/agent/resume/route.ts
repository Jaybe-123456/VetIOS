import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getGaaSPlatform } from '@/lib/gaas';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { handleResumeAgent, type ResumeAgentRequest } from '@vetios/gaas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/resume
 *
 * Resume a paused agent run after HITL interrupt resolution.
 *
 * Body:
 *   run_id:          string
 *   interrupt_id:    string
 *   resolution:      "approved" | "rejected" | "modified"
 *   resolved_by:     string
 *   modified_input?: Record<string, unknown>
 */
export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    try {
        const auth = await resolveClinicalApiActor(req, { client: getSupabaseServer() });
        if (auth.error || !auth.actor || auth.actor.authMode !== 'session' || !auth.actor.userId) {
            const response = NextResponse.json(
                { data: null, error: { code: 'unauthorized', message: 'A clinician session is required.' } },
                { status: 401 },
            );
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        const body = (await req.json()) as ResumeAgentRequest;

        if (!body.run_id || !body.interrupt_id || !body.resolution) {
            const res = NextResponse.json(
                {
                    data: null,
                    meta: { timestamp: new Date().toISOString(), request_id: requestId },
                    error: {
                        code: 'bad_request',
                        message:
                            'Missing required fields: run_id, interrupt_id, resolution',
                    },
                },
                { status: 400 }
            );
            withRequestHeaders(res.headers, requestId, startTime);
            return res;
        }

        const platform = getGaaSPlatform();
        const result = await handleResumeAgent(
            { ...body, resolved_by: auth.actor.userId },
            platform.runtime,
            platform.hitlManager,
            platform.runStore,
            auth.actor.tenantId,
        );

        const res = NextResponse.json({
            data: result,
            meta: {
                timestamp: new Date().toISOString(),
                request_id: requestId,
                tenant_id: auth.actor.tenantId,
            },
            error: null,
        });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    } catch (error) {
        const status = error instanceof Error && error.message.includes('not found')
            ? 404
            : 500;
        const res = NextResponse.json(
            {
                data: null,
                meta: {
                    timestamp: new Date().toISOString(),
                    request_id: requestId,
                },
                error: {
                    code: status === 404 ? 'run_not_found' : 'agent_resume_failed',
                    message:
                        error instanceof Error ? error.message : 'Agent resume failed.',
                },
            },
            { status }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}
