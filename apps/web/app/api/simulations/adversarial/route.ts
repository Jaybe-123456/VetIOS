import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { startSimulationRun } from '@/lib/platform/simulations';

const VALID_CATEGORIES = [
    'jailbreak',
    'injection',
    'gibberish',
    'extreme_length',
    'multilingual',
    'sensitive_topic',
    'rare_species',
    'conflicting_inputs',
] as const;

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
        const modelVersion = readText(body.model_version);
        const promptsPerCategory = readNumber(body.prompts_per_category);
        const evaluationMethod = readText(body.evaluation_method) ?? 'auto';
        const categories = Array.isArray(body.categories)
            ? body.categories.filter((entry): entry is string => typeof entry === 'string')
            : [];

        if (!modelVersion || promptsPerCategory == null || categories.length === 0) {
            throw new PlatformAuthError(400, 'invalid_simulation', 'model_version, categories, and prompts_per_category are required.');
        }
        if (!Number.isInteger(promptsPerCategory) || promptsPerCategory < 5 || promptsPerCategory > 100) {
            throw new PlatformAuthError(400, 'invalid_prompts_per_category', 'prompts_per_category must be an integer between 5 and 100.');
        }
        if (!categories.every((entry) => VALID_CATEGORIES.includes(entry as typeof VALID_CATEGORIES[number]))) {
            throw new PlatformAuthError(400, 'invalid_categories', 'One or more adversarial categories are invalid.');
        }
        if (!['auto', 'human', 'hybrid'].includes(evaluationMethod)) {
            throw new PlatformAuthError(400, 'invalid_evaluation_method', 'evaluation_method must be auto, human, or hybrid.');
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
            mode: 'adversarial',
            scenarioName: 'Adversarial test suite',
            config: {
                model_version: modelVersion,
                categories,
                prompts_per_category: promptsPerCategory,
                evaluation_method: evaluationMethod,
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
                    code: error instanceof PlatformAuthError ? error.code : 'simulation_adversarial_failed',
                    message: error instanceof Error ? error.message : 'Failed to start adversarial simulation.',
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
