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
            return NextResponse.json(
                { error: parsed.error, request_id: requestId },
                { status: 400 },
            );
        }

        const mode = readMode(parsed.data.mode);
        const simulation = await startSimulationRun(supabase, {
            actor,
            tenantId,
            mode,
            scenarioName: readText(parsed.data.scenario_name) ?? `${mode}_simulation`,
            config: parsed.data,
            candidateModelVersion: readText(parsed.data.candidate_model_version),
        });

        const response = NextResponse.json({
            data: simulation,
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
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
                meta: {
                    tenant_id: error.tenantId,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error.code,
                    message: error.message,
                },
            }, { status: error.status })
            : NextResponse.json({
                data: null,
                meta: {
                    tenant_id: null,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error instanceof PlatformAuthError ? error.code : 'simulation_run_failed',
                    message: error instanceof Error ? error.message : 'Failed to start simulation.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function readMode(value: unknown) {
    return value === 'adversarial' || value === 'regression' ? value : 'scenario_load';
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
