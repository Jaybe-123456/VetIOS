import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
    type RouteAuthorizationRequirement,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export async function requireOutboxRouteAuthorization(input: {
    req: Request;
    requestId: string;
    route: string;
    requirement: RouteAuthorizationRequirement;
}): Promise<{
    adminClient: ReturnType<typeof getSupabaseServer>;
    context: RouteAuthorizationContext;
    response: null;
} | {
    adminClient: ReturnType<typeof getSupabaseServer>;
    context: null;
    response: NextResponse;
}> {
    const actor = await resolveExperimentApiActor(input.req, { allowInternalToken: true });
    const adminClient = getSupabaseServer();

    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return {
            adminClient,
            context: null,
            response: NextResponse.json({ error: 'Unauthorized', request_id: input.requestId }, { status: 401 }),
        };
    }

    const context = await resolveOutboxAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(context, input.requirement)) {
        return {
            adminClient,
            context: null,
            response: await buildForbiddenRouteResponse({
                client: adminClient,
                requestId: input.requestId,
                context,
                route: input.route,
                requirement: input.requirement,
            }),
        };
    }

    return {
        adminClient,
        context,
        response: null,
    };
}

async function resolveOutboxAuthorizationContext(
    actor: Awaited<ReturnType<typeof resolveExperimentApiActor>>,
): Promise<RouteAuthorizationContext> {
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
            tenantId: session.tenantId,
            userId: session.userId,
            authMode: 'session',
            user,
        });
    }

    return buildRouteAuthorizationContext({
        tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        userId: process.env.VETIOS_DEV_USER_ID ?? null,
        authMode: process.env.VETIOS_DEV_BYPASS === 'true' ? 'dev_bypass' : 'session',
        user: null,
    });
}
