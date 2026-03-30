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
import { safeJson } from '@/lib/http/safeJson';
import { seedExperimentTrackingBootstrap } from '@/lib/experiments/bootstrap';
import { getExperimentDashboardSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 5, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<{
        tenant_id?: string;
        created_by?: string | null;
    }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: body.data.tenant_id ?? null,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const adminClient = getSupabaseServer();
    const authContext = await resolveBootstrapAuthorizationContext(actor, tenantId);
    if (!authContext || !isRouteAuthorizationGranted(authContext, 'run_debug_tools')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext ?? buildDevBypassAuthorizationContext(tenantId),
            route: 'api/experiments/bootstrap:POST',
            requirement: 'run_debug_tools',
        });
    }

    const store = createSupabaseExperimentTrackingStore(adminClient);
    const summary = await seedExperimentTrackingBootstrap(store, tenantId, {
        createdBy: body.data.created_by ?? undefined,
    });
    const snapshot = await getExperimentDashboardSnapshot(store, tenantId, {
        selectedRunId: 'run_diag_smoke_v1',
        runLimit: 50,
    });

    const response = NextResponse.json({
        summary,
        snapshot,
        authenticated_user_id: actor?.userId ?? null,
        auth_mode: actor?.authMode ?? 'dev_bypass',
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

async function resolveBootstrapAuthorizationContext(
    actor: Awaited<ReturnType<typeof resolveExperimentApiActor>>,
    tenantId: string,
): Promise<RouteAuthorizationContext | null> {
    if (actor?.authMode === 'internal_token') {
        return buildRouteAuthorizationContext({
            tenantId,
            userId: actor.userId,
            authMode: 'internal_token',
            user: null,
        });
    }

    const session = await resolveSessionTenant();
    if (session) {
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId,
            userId: actor?.userId ?? session.userId,
            authMode: 'session',
            user,
        });
    }

    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        return buildDevBypassAuthorizationContext(tenantId);
    }

    return null;
}

function buildDevBypassAuthorizationContext(tenantId: string): RouteAuthorizationContext {
    return buildRouteAuthorizationContext({
        tenantId,
        userId: process.env.VETIOS_DEV_USER_ID ?? null,
        authMode: 'dev_bypass',
        user: null,
    });
}
