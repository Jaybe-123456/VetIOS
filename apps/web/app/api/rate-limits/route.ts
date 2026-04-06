import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError, resolveActorTenant } from '@/lib/platform/tenantContext';
import { getTenantRateLimitConfig, updateTenantRateLimitConfig } from '@/lib/platform/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const { actor } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:read'],
            requestedTenantId: new URL(req.url).searchParams.get('tenant_id'),
        });
        const tenantId = resolveActorTenant(actor, new URL(req.url).searchParams.get('tenant_id'));
        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required to load rate limits.');
        }

        const config = await getTenantRateLimitConfig(supabase, tenantId);
        const response = NextResponse.json({
            data: config,
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
                    code: error instanceof PlatformAuthError ? error.code : 'rate_limit_config_failed',
                    message: error instanceof Error ? error.message : 'Failed to load tenant rate limits.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const { actor } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:write'],
        });
        const parsed = await safeJson<{
            tenant_id?: string | null;
            inference_requests_per_minute?: number;
            evaluation_requests_per_minute?: number;
            simulate_requests_per_minute?: number;
        }>(req);

        if (!parsed.ok) {
            return NextResponse.json(
                { error: parsed.error, request_id: requestId },
                { status: 400 },
            );
        }

        const tenantId = resolveActorTenant(actor, parsed.data.tenant_id ?? null);
        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required to update rate limits.');
        }

        const config = await updateTenantRateLimitConfig(supabase, tenantId, {
            inference_requests_per_minute: parsed.data.inference_requests_per_minute,
            evaluation_requests_per_minute: parsed.data.evaluation_requests_per_minute,
            simulate_requests_per_minute: parsed.data.simulate_requests_per_minute,
        });

        const response = NextResponse.json({
            data: config,
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
                    code: error instanceof PlatformAuthError ? error.code : 'rate_limit_update_failed',
                    message: error instanceof Error ? error.message : 'Failed to update tenant rate limits.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
