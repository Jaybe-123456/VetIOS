import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { createAdversarialPrompt, listAdversarialPrompts, updateAdversarialPrompt } from '@/lib/platform/simulations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const url = new URL(req.url);
        const requestedTenantId = url.searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['simulation:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });
        const resolvedTenantId = tenantId ?? actor.tenantId;
        if (!resolvedTenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const category = url.searchParams.get('category');
        const active = url.searchParams.get('active');
        const library = await listAdversarialPrompts(supabase, {
            tenantId: resolvedTenantId,
            category: category ? category as never : null,
            active: active == null ? true : active === 'true',
        });

        const response = NextResponse.json({
            data: library.prompts,
            meta: {
                tenant_id: resolvedTenantId,
                timestamp: new Date().toISOString(),
                request_id: requestId,
                counts_by_category: library.counts_by_category,
                total_active: library.total_active,
            },
            error: null,
        });
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
                    code: error instanceof PlatformAuthError ? error.code : 'simulation_prompts_failed',
                    message: error instanceof Error ? error.message : 'Failed to load adversarial prompts.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['simulation:write'],
            requireSystemAdmin: true,
        });
        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const parsed = await safeJson<Record<string, unknown>>(req);
        if (!parsed.ok) {
            return NextResponse.json({ data: null, meta: { tenant_id: tenantId, timestamp: new Date().toISOString(), request_id: requestId }, error: { code: 'invalid_json', message: parsed.error } }, { status: 400 });
        }

        const prompt = await createAdversarialPrompt(supabase, {
            tenantId,
            actor: actor.userId,
            category: String(parsed.data.category ?? '') as never,
            prompt: String(parsed.data.prompt ?? ''),
            expectedBehavior: String(parsed.data.expected_behavior ?? ''),
            severity: (typeof parsed.data.severity === 'string' ? parsed.data.severity : 'medium') as never,
            active: typeof parsed.data.active === 'boolean' ? parsed.data.active : true,
        });

        const response = NextResponse.json({
            data: prompt,
            meta: { tenant_id: tenantId, timestamp: new Date().toISOString(), request_id: requestId },
            error: null,
        }, { status: 201 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            data: null,
            meta: { tenant_id: null, timestamp: new Date().toISOString(), request_id: requestId },
            error: {
                code: error instanceof PlatformAuthError ? error.code : 'simulation_prompt_create_failed',
                message: error instanceof Error ? error.message : 'Failed to create adversarial prompt.',
            },
        }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

export async function PATCH(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const { tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['simulation:write'],
            requireSystemAdmin: true,
        });
        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const parsed = await safeJson<Record<string, unknown>>(req);
        if (!parsed.ok) {
            return NextResponse.json({ data: null, meta: { tenant_id: tenantId, timestamp: new Date().toISOString(), request_id: requestId }, error: { code: 'invalid_json', message: parsed.error } }, { status: 400 });
        }

        const updated = await updateAdversarialPrompt(supabase, {
            tenantId,
            promptId: String(parsed.data.id ?? ''),
            patch: {
                active: typeof parsed.data.active === 'boolean' ? parsed.data.active : undefined,
                expected_behavior: typeof parsed.data.expected_behavior === 'string' ? parsed.data.expected_behavior : undefined,
                severity: typeof parsed.data.severity === 'string' ? parsed.data.severity as never : undefined,
            },
        });

        const response = NextResponse.json({
            data: updated,
            meta: { tenant_id: tenantId, timestamp: new Date().toISOString(), request_id: requestId },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            data: null,
            meta: { tenant_id: null, timestamp: new Date().toISOString(), request_id: requestId },
            error: {
                code: error instanceof PlatformAuthError ? error.code : 'simulation_prompt_update_failed',
                message: error instanceof Error ? error.message : 'Failed to update adversarial prompt.',
            },
        }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
