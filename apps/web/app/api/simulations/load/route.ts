import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { startSimulationRun } from '@/lib/platform/simulations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['simulation:write'],
            rateLimitKind: 'simulate',
        });
        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required to run simulations.');
        }

        const parsed = await safeJson<Record<string, unknown>>(req);
        if (!parsed.ok) {
            return NextResponse.json({ data: null, meta: { tenant_id: tenantId, timestamp: new Date().toISOString(), request_id: requestId }, error: { code: 'invalid_json', message: parsed.error } }, { status: 400 });
        }

        const body = parsed.data;
        const scenarioName = readText(body.scenario_name);
        const modelVersion = readText(body.model_version);
        const agentCount = readNumber(body.agent_count);
        const requestsPerAgent = readNumber(body.requests_per_agent);
        const ratePerSecond = readNumber(body.rate_per_second) ?? readNumber(body.request_rate_per_second);
        const durationSeconds = readNumber(body.duration_seconds);
        const promptDistribution = asRecord(body.prompt_distribution);
        const sum = ['canine', 'feline', 'equine', 'other'].reduce((acc, key) => acc + (readNumber(promptDistribution[key]) ?? 0), 0);

        if (!scenarioName || !modelVersion || agentCount == null || requestsPerAgent == null || ratePerSecond == null || durationSeconds == null) {
            throw new PlatformAuthError(400, 'invalid_simulation', 'scenario_name, model_version, agent_count, requests_per_agent, rate_per_second, and duration_seconds are required.');
        }
        if (!Number.isInteger(agentCount) || agentCount < 1 || agentCount > 500) {
            throw new PlatformAuthError(400, 'invalid_agent_count', 'agent_count must be an integer between 1 and 500.');
        }
        if (!Number.isInteger(requestsPerAgent) || requestsPerAgent < 1 || requestsPerAgent > 100) {
            throw new PlatformAuthError(400, 'invalid_requests_per_agent', 'requests_per_agent must be an integer between 1 and 100.');
        }
        if (ratePerSecond < 1 || ratePerSecond > 500) {
            throw new PlatformAuthError(400, 'invalid_rate_per_second', 'rate_per_second must be between 1 and 500.');
        }
        if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 300) {
            throw new PlatformAuthError(400, 'invalid_duration_seconds', 'duration_seconds must be an integer between 10 and 300.');
        }
        if (Math.abs(sum - 100) > 0.01) {
            throw new PlatformAuthError(400, 'invalid_prompt_distribution', 'prompt_distribution must sum to 100.');
        }

        const { data: modelRows, error: modelError } = await supabase
            .from('model_registry')
            .select('model_version')
            .eq('tenant_id', tenantId)
            .eq('model_version', modelVersion);
        if (modelError) {
            throw new Error(modelError.message);
        }
        if ((modelRows ?? []).length === 0) {
            throw new PlatformAuthError(404, 'model_not_found', `Model version ${modelVersion} was not found in model_registry.`);
        }

        const simulation = await startSimulationRun(supabase, {
            actor,
            tenantId,
            mode: 'load',
            scenarioName,
            config: {
                scenario_name: scenarioName,
                model_version: modelVersion,
                agent_count: agentCount,
                requests_per_agent: requestsPerAgent,
                rate_per_second: ratePerSecond,
                duration_seconds: durationSeconds,
                prompt_distribution: promptDistribution,
            },
        });

        const response = NextResponse.json({
            data: {
                simulation_id: simulation.id,
                status: 'running',
                sse_url: `/api/simulations/${simulation.id}/progress`,
            },
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                simulation_id: simulation.id,
                request_id: requestId,
            },
            error: null,
        }, { status: 202 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = error instanceof PlatformRateLimitError
            ? NextResponse.json({
                data: buildRateLimitErrorPayload(error),
                meta: { tenant_id: error.tenantId, timestamp: new Date().toISOString(), request_id: requestId },
                error: { code: error.code, message: error.message },
            }, { status: error.status })
            : NextResponse.json({
                data: null,
                meta: { tenant_id: null, timestamp: new Date().toISOString(), request_id: requestId },
                error: {
                    code: error instanceof PlatformAuthError ? error.code : 'simulation_load_failed',
                    message: error instanceof Error ? error.message : 'Failed to start load simulation.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
