import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { authorizeCronRequest } from '@/lib/http/cronAuth';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { createOutboxEvent } from '@/lib/outbox/outbox-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const cronAuth = authorizeCronRequest(req, 'simulation-watchdog');
    if (!cronAuth.authorized) {
        const response = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const supabase = getSupabaseServer();
    const now = new Date();
    const heartbeatCutoff = new Date(now.getTime() - 60_000).toISOString();
    const nowIso = now.toISOString();

    try {
        const { data, error } = await supabase
            .from('simulations')
            .select('id,tenant_id,scenario_name,started_at,duration_s,heartbeat_at,timeout_at,requests_completed,requests_total')
            .eq('status', 'running');

        if (error) {
            throw error;
        }

        const stuckRuns = (data ?? []).filter((run) => {
            const timeoutAt = readTime(run.timeout_at);
            const heartbeatAt = readTime(run.heartbeat_at);
            const startedAt = readTime(run.started_at);
            return (timeoutAt != null && timeoutAt <= now.getTime())
                || (heartbeatAt != null && heartbeatAt <= Date.parse(heartbeatCutoff))
                || (startedAt != null && startedAt <= now.getTime() - 10 * 60_000);
        });

        for (const run of stuckRuns) {
            const requestsTotal = readNumber(run.requests_total);
            const requestsCompleted = readNumber(run.requests_completed) ?? 0;
            const partialSuccessRate = requestsTotal && requestsTotal > 0
                ? requestsCompleted / requestsTotal
                : null;
            const failureReason = `WATCHDOG_TIMEOUT: Run exceeded timeout at ${nowIso}. Last heartbeat: ${run.heartbeat_at ?? 'never'}. Completed ${requestsCompleted}/${requestsTotal ?? '?'} requests.`;

            await supabase
                .from('simulations')
                .update({
                    status: 'failed',
                    failure_reason: failureReason,
                    error_message: failureReason,
                    success_rate: partialSuccessRate,
                    heartbeat_at: nowIso,
                    updated_at: nowIso,
                })
                .eq('id', run.id);

            await supabase
                .from('simulation_watchdog_log')
                .insert({
                    simulation_run_id: run.id,
                    action_taken: 'marked_failed',
                    last_heartbeat_at: run.heartbeat_at ?? null,
                    expected_timeout_at: run.timeout_at ?? null,
                    notes: `Partial completion: ${requestsCompleted}/${requestsTotal ?? '?'}`,
                });
        }

        const healthyRuns = (data ?? []).filter((run) => !stuckRuns.some((stuck) => stuck.id === run.id));
        if (healthyRuns.length > 0) {
            await supabase
                .from('simulation_watchdog_log')
                .insert(healthyRuns.slice(0, 20).map((run) => ({
                    simulation_run_id: run.id,
                    action_taken: 'heartbeat_ok',
                    last_heartbeat_at: run.heartbeat_at ?? null,
                    expected_timeout_at: run.timeout_at ?? null,
                    notes: 'Active run heartbeat within watchdog window.',
                })));
        }

        await createOutboxEvent({
            aggregateType: 'simulation_watchdog',
            aggregateId: `simulation-watchdog:${nowIso}`,
            eventName: 'simulation.watchdog_ran',
            payload: {
                runs_timed_out: stuckRuns.length,
                active_runs_checked: data?.length ?? 0,
                ran_at: nowIso,
            },
            metadata: {
                tenant_id: 'outbox_system',
                request_id: requestId,
            },
        }, supabase).catch(() => undefined);

        const response = NextResponse.json({
            runs_timed_out: stuckRuns.length,
            active_runs_checked: data?.length ?? 0,
            ran_at: nowIso,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            error: error instanceof Error ? error.message : 'Simulation watchdog failed.',
            request_id: requestId,
        }, { status: 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function readTime(value: unknown) {
    if (typeof value !== 'string') return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
