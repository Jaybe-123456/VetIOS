import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { RegistryControlPlaneError } from '@/lib/experiments/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { applyExperimentRegistryAction, backfillSummaryExperimentRuns } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export async function GET(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req);
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolveRegistryRunAuthorizationContext(actor);
    if (!authContext || !isRouteAuthorizationGranted(authContext, 'view_governance')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext ?? buildDevBypassAuthorizationContext(),
            route: 'api/experiments/runs/[runId]/registry:GET',
            requirement: 'view_governance',
        });
    }

    const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(adminClient);
    await backfillSummaryExperimentRuns(store, tenantId);
    const registry = await store.getExperimentRegistryLink(tenantId, runId);

    const response = NextResponse.json({ registry, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<{
        action?: 'promote_to_staging' | 'promote_to_production' | 'set_manual_approval' | 'archive' | 'rollback';
        manual_approval?: boolean;
        reason?: string;
        incident_id?: string | null;
    }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    if (!body.data.action) {
        return NextResponse.json({ error: 'action is required', request_id: requestId }, { status: 400 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolveRegistryRunAuthorizationContext(actor);
    if (!authContext || !isRouteAuthorizationGranted(authContext, 'manage_models')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext ?? buildDevBypassAuthorizationContext(),
            route: 'api/experiments/runs/[runId]/registry:POST',
            requirement: 'manage_models',
            metadata: {
                requested_action: body.data.action,
            },
        });
    }

    const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(adminClient);
    try {
        const registry = await applyExperimentRegistryAction(
            store,
            tenantId,
            runId,
            body.data.action,
            actor?.userId ?? null,
            {
                manualApproval: body.data.manual_approval,
                reason: body.data.reason,
                incidentId: body.data.incident_id ?? null,
            },
        );

        const response = NextResponse.json({
            registry,
            authenticated_user_id: actor?.userId ?? null,
            auth_mode: actor?.authMode ?? 'dev_bypass',
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            error instanceof RegistryControlPlaneError
                ? {
                    error: error.message,
                    code: error.code,
                    details: error.details,
                    request_id: requestId,
                }
                : {
                    error: error instanceof Error ? error.message : 'Registry action failed.',
                    request_id: requestId,
                },
            { status: error instanceof RegistryControlPlaneError ? error.httpStatus : 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolveRegistryRunAuthorizationContext(
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
