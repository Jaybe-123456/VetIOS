import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { countInferenceEventsForScope, getActiveModelVersion, startSimulationRun } from '@/lib/platform/simulations';

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
        const baselineModel = readText(body.baseline_model);
        const candidateModel = readText(body.candidate_model);
        const replayN = readNumber(body.replay_n);
        const thresholdPct = readNumber(body.threshold_pct);
        const autoBlock = readBoolean(body.auto_block);
        const requestedTenantScope = readText(body.tenant_scope);
        if (requestedTenantScope === 'all' && actor.role !== 'system_admin') {
            throw new PlatformAuthError(403, 'system_admin_required', 'tenant_scope=all requires a system_admin actor.');
        }
        const tenantScope = requestedTenantScope === 'all' && actor.role === 'system_admin' ? 'all' : 'own';

        if (!baselineModel || !candidateModel || replayN == null || thresholdPct == null || autoBlock == null) {
            throw new PlatformAuthError(400, 'invalid_simulation', 'baseline_model, candidate_model, replay_n, threshold_pct, and auto_block are required.');
        }
        if (!Number.isInteger(replayN) || replayN < 10 || replayN > 200) {
            throw new PlatformAuthError(400, 'invalid_replay_n', 'replay_n must be an integer between 10 and 200.');
        }
        if (!Number.isInteger(thresholdPct) || thresholdPct < 1 || thresholdPct > 30) {
            throw new PlatformAuthError(400, 'invalid_threshold_pct', 'threshold_pct must be an integer between 1 and 30.');
        }

        const activeModel = await getActiveModelVersion(supabase, tenantId);
        if (!activeModel || activeModel !== baselineModel) {
            throw new PlatformAuthError(400, 'invalid_baseline', 'baseline_model must be the current active production model.');
        }
        if (candidateModel === baselineModel) {
            throw new PlatformAuthError(400, 'invalid_candidate', 'candidate_model must differ from the baseline_model.');
        }

        const { data: modelRows, error: modelError } = await supabase
            .from('model_registry')
            .select('model_version')
            .eq('tenant_id', tenantId)
            .eq('model_version', candidateModel);
        if (modelError) {
            throw new Error(modelError.message);
        }
        if ((modelRows ?? []).length === 0) {
            throw new PlatformAuthError(404, 'model_not_found', `Candidate model ${candidateModel} was not found in model_registry.`);
        }

        const simulation = await startSimulationRun(supabase, {
            actor,
            tenantId,
            mode: 'regression',
            scenarioName: 'Regression simulation',
            candidateModelVersion: candidateModel,
            config: {
                baseline_model: baselineModel,
                candidate_model: candidateModel,
                replay_n: replayN,
                threshold_pct: thresholdPct,
                auto_block: autoBlock,
                tenant_scope: tenantScope,
                available_inference_events: await countInferenceEventsForScope(supabase, { tenantId, scope: tenantScope, actor }),
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
                    code: error instanceof PlatformAuthError ? error.code : 'simulation_regression_failed',
                    message: error instanceof Error ? error.message : 'Failed to start regression simulation.',
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

function readBoolean(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return null;
}
