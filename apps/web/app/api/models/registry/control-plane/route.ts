import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import {
    getModelRegistryControlPlaneSnapshot,
    refreshRegistryGovernanceForRun,
    refreshModelRegistryControlPlaneSnapshot,
    RegistryControlPlaneError,
    verifyModelRegistryControlPlane,
} from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

type RegistryControlPlaneAction =
    | {
        action?: 'verify_control_plane' | 'refresh_registry' | 'refresh_run_governance';
        run_id?: string;
    };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
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
        if (!authContext || !isRouteAuthorizationGranted(authContext, 'view_governance')) {
            return buildForbiddenRouteResponse({
                client: adminClient,
                requestId,
                context: authContext ?? buildDevBypassAuthorizationContext(),
                route: 'api/models/registry/control-plane:GET',
                requirement: 'view_governance',
            });
        }

        const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
        const snapshot = await getModelRegistryControlPlaneSnapshot(
            createSupabaseExperimentTrackingStore(adminClient),
            tenantId,
            { readOnly: true },
        );
        const response = NextResponse.json({
            snapshot,
            request_id: requestId,
        });
        response.headers.set('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to load registry control plane.', request_id: requestId },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const body = await safeJson<RegistryControlPlaneAction>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    try {
        const adminClient = getSupabaseServer();
        const authContext = await resolveRegistryAuthorizationContext(actor);
        const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
        const action = body.data.action ?? 'verify_control_plane';
        const requirement = action === 'verify_control_plane' ? 'view_governance' : 'manage_models';
        if (!authContext || !isRouteAuthorizationGranted(authContext, requirement)) {
            return buildForbiddenRouteResponse({
                client: adminClient,
                requestId,
                context: authContext ?? buildDevBypassAuthorizationContext(),
                route: `api/models/registry/control-plane:${action}`,
                requirement,
                metadata: {
                    requested_action: action,
                    run_id: body.data.run_id ?? null,
                },
            });
        }

        if (action === 'refresh_registry') {
            const snapshot = await refreshModelRegistryControlPlaneSnapshot(
                createSupabaseExperimentTrackingStore(adminClient),
                tenantId,
            );
            const response = NextResponse.json({
                snapshot,
                request_id: requestId,
            });
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        if (action === 'refresh_run_governance') {
            const runId = body.data.run_id?.trim();
            if (!runId) {
                throw new RegistryControlPlaneError('INVALID_ACTION', 'run_id is required for refresh_run_governance.', {
                    httpStatus: 400,
                });
            }

            const snapshot = await refreshRegistryGovernanceForRun(
                createSupabaseExperimentTrackingStore(adminClient),
                tenantId,
                runId,
                actor?.userId ?? null,
            );
            const response = NextResponse.json({
                snapshot,
                refreshed_run_id: runId,
                request_id: requestId,
            });
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        if (action !== 'verify_control_plane') {
            throw new RegistryControlPlaneError('INVALID_ACTION', 'Unsupported registry control-plane action.', {
                httpStatus: 400,
            });
        }

        const store = createSupabaseExperimentTrackingStore(adminClient);
        const verification = await verifyModelRegistryControlPlane(store, tenantId);
        const response = NextResponse.json({
            verification,
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
                    error: error instanceof Error ? error.message : 'Failed to verify registry control plane.',
                    request_id: requestId,
                },
            { status: error instanceof RegistryControlPlaneError ? error.httpStatus : 500 },
        );
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
