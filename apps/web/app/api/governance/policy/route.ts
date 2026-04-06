import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { createGovernancePolicy, listGovernancePolicies } from '@/lib/platform/governance';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError, resolveActorTenant } from '@/lib/platform/tenantContext';
import type { GovernancePolicyRules } from '@/lib/platform/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const { actor } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:read'],
            requestedTenantId: new URL(req.url).searchParams.get('tenant_id'),
        });
        const tenantId = resolveActorTenant(actor, new URL(req.url).searchParams.get('tenant_id'));
        const policies = await listGovernancePolicies(supabase, tenantId ?? actor.tenantId ?? '');

        const response = NextResponse.json({
            data: policies,
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
                    code: error instanceof PlatformAuthError ? error.code : 'policy_list_failed',
                    message: error instanceof Error ? error.message : 'Failed to load governance policies.',
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
        const { actor } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:write'],
        });
        const parsed = await safeJson<{
            tenant_id?: string | null;
            name?: string;
            rules?: GovernancePolicyRules;
            metadata?: Record<string, unknown>;
        }>(req);

        if (!parsed.ok) {
            return NextResponse.json(
                { error: parsed.error, request_id: requestId },
                { status: 400 },
            );
        }

        const tenantId = resolveActorTenant(actor, parsed.data.tenant_id ?? null);
        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required to create a governance policy.');
        }

        const policy = await createGovernancePolicy(supabase, {
            tenantId,
            actor: actor.userId,
            name: parsed.data.name ?? 'Tenant policy',
            rules: parsed.data.rules ?? {},
            metadata: parsed.data.metadata ?? {},
        });

        const response = NextResponse.json({
            data: policy,
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
                request_id: requestId,
            },
            error: null,
        }, { status: 201 });
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
                    code: error instanceof PlatformAuthError ? error.code : 'policy_create_failed',
                    message: error instanceof Error ? error.message : 'Failed to create governance policy.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
