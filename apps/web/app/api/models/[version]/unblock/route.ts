import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { writeGovernanceAuditEvent } from '@/lib/platform/governance';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
    req: Request,
    context: { params: Promise<{ version: string }> },
) {
    const params = await context.params;
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    try {
        const adminClient = getSupabaseServer();
        const authContext = await resolveRegistryAuthorizationContext(actor);
        if (!authContext || !isRouteAuthorizationGranted(authContext, 'manage_models')) {
            return buildForbiddenRouteResponse({
                client: adminClient,
                requestId,
                context: authContext ?? buildDevBypassAuthorizationContext(),
                route: 'api/models/[version]/unblock:PATCH',
                requirement: 'manage_models',
                metadata: {
                    model_version: params.version,
                },
            });
        }

        const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
        const { data, error } = await adminClient
            .from('model_registry')
            .update({
                blocked: false,
                block_reason: null,
                blocked_at: null,
                blocked_by_simulation_id: null,
            })
            .eq('tenant_id', tenantId)
            .eq('model_version', params.version)
            .select('model_version,blocked,block_reason,blocked_at,blocked_by_simulation_id')
            .single();

        if (error || !data) {
            return NextResponse.json({
                data: null,
                meta: {
                    tenant_id: tenantId,
                    timestamp: new Date().toISOString(),
                    request_id: requestId,
                },
                error: {
                    code: 'model_unblock_failed',
                    message: error?.message ?? 'Failed to unblock model.',
                },
            }, { status: error?.code === 'PGRST116' ? 404 : 500 });
        }

        await writeGovernanceAuditEvent(adminClient, {
            tenantId,
            actor: actor?.userId ?? authContext.userId ?? null,
            eventType: 'model_unblocked',
            payload: {
                model_version: params.version,
            },
        }).catch(() => undefined);

        const response = NextResponse.json({
            data,
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                request_id: requestId,
            },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            data: null,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
                request_id: requestId,
            },
            error: {
                code: 'model_unblock_failed',
                message: error instanceof Error ? error.message : 'Failed to unblock model.',
            },
        }, { status: 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolveRegistryAuthorizationContext(
    actor: Awaited<ReturnType<typeof resolveExperimentApiActor>>,
): Promise<RouteAuthorizationContext | null> {
    if (actor?.authMode === 'internal_token') {
        return buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'internal_token',
            user: null,
        });
    }

    const session = await resolveSessionTenant();
    if (session) {
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId: actor?.tenantId ?? session.tenantId,
            userId: actor?.userId ?? session.userId,
            authMode: 'session',
            user,
        });
    }

    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        return buildDevBypassAuthorizationContext();
    }

    return null;
}

function buildDevBypassAuthorizationContext(): RouteAuthorizationContext {
    return buildRouteAuthorizationContext({
        tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        userId: process.env.VETIOS_DEV_USER_ID ?? null,
        authMode: 'dev_bypass',
        user: null,
    });
}
