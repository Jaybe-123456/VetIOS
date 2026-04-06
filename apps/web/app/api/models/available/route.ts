import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['inference:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });

        const versions = new Set<string>();

        let registryQuery = supabase
            .from('model_registry')
            .select('model_name,model_version');
        let inferenceQuery = supabase
            .from('ai_inference_events')
            .select('model_name,model_version')
            .order('created_at', { ascending: false })
            .limit(100);

        if (actor.role !== 'system_admin' || tenantId) {
            registryQuery = registryQuery.eq('tenant_id', tenantId);
            inferenceQuery = inferenceQuery.eq('tenant_id', tenantId);
        }

        const [{ data: registryRows, error: registryError }, { data: inferenceRows, error: inferenceError }] = await Promise.all([
            registryQuery,
            inferenceQuery,
        ]);

        if (registryError) {
            throw registryError;
        }
        if (inferenceError) {
            throw inferenceError;
        }

        for (const row of [...(registryRows ?? []), ...(inferenceRows ?? [])]) {
            const record = row as Record<string, unknown>;
            const modelVersion = typeof record.model_version === 'string' ? record.model_version.trim() : '';
            if (modelVersion) {
                versions.add(modelVersion);
            }
        }

        const response = NextResponse.json({
            data: Array.from(versions).sort((left, right) => left.localeCompare(right)).map((modelVersion) => ({
                model_version: modelVersion,
            })),
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
                request_id: requestId,
            },
            error: null,
        });
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
                    code: error instanceof PlatformAuthError ? error.code : 'models_available_failed',
                    message: error instanceof Error ? error.message : 'Failed to load available model versions.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
