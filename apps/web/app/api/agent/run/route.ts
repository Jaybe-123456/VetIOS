import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getGaaSPlatform } from '@/lib/gaas';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { handleRunAgent, type RunAgentRequest } from '@vetios/gaas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/run
 *
 * Start a new GaaS agent run.
 *
 * Body:
 *   tenant_id:        string
 *   agent_role:       AgentRole
 *   patient_context:  PatientContext
 *   goal?:            Partial<AgentGoal>
 *   policy_overrides?: Partial<AgentPolicy>
 */
export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    try {
        const auth = await resolveClinicalApiActor(req, {
            client: getSupabaseServer(),
            requiredScopes: ['inference:write'],
        });
        if (auth.error || !auth.actor) {
            return authError(auth.error?.status ?? 401, requestId, startTime);
        }

        const body = (await req.json()) as RunAgentRequest;

        if (!body.agent_role || !body.patient_context) {
            const res = NextResponse.json(
                {
                    data: null,
                    meta: { timestamp: new Date().toISOString(), request_id: requestId },
                    error: {
                        code: 'bad_request',
                        message:
                            'Missing required fields: agent_role, patient_context',
                    },
                },
                { status: 400 }
            );
            withRequestHeaders(res.headers, requestId, startTime);
            return res;
        }

        if (body.tenant_id && body.tenant_id !== auth.actor.tenantId) {
            return authError(403, requestId, startTime, 'Tenant mismatch');
        }

        const tenantBoundBody: RunAgentRequest = {
            ...body,
            tenant_id: auth.actor.tenantId,
        };

        const platform = getGaaSPlatform();
        const result = await handleRunAgent(tenantBoundBody, platform.runtime);

        // Persist in the in-memory run store for resume operations
        platform.runStore.set(result.run_id, {
            run_id: result.run_id,
            status: result.status,
            agent_role: result.agent_role,
            patient_context: body.patient_context,
            steps: [],
            memory_context: [],
            current_interrupt: result.current_interrupt,
            result: result.result,
            started_at: new Date().toISOString(),
            goal: {
                description: `Perform ${result.agent_role} assessment`,
                success_criteria: [],
                max_steps: 10,
            },
            policy: {
                allowed_tools: [],
                confidence_threshold_for_escalation: 0.5,
                max_autonomous_actions: 8,
                require_human_approval_for: [],
                safe_terminal_states: [],
            },
            tenant_id: auth.actor.tenantId,
        });

        platform.usageMeter.record({
            tenant_id: auth.actor.tenantId,
            event_type: 'agent_run',
            agent_role: body.agent_role,
            timestamp: new Date().toISOString(),
        });

        const res = NextResponse.json({
            data: result,
            meta: {
                tenant_id: auth.actor.tenantId,
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
                    code: 'agent_run_failed',
                    message:
                        error instanceof Error ? error.message : 'Agent run failed.',
                },
            },
            { status: 500 }
        );
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}

function authError(
    status: number,
    requestId: string,
    startTime: number,
    message = 'Unauthorized',
) {
    const response = NextResponse.json(
        { data: null, error: { code: status === 403 ? 'forbidden' : 'unauthorized', message } },
        { status },
    );
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
