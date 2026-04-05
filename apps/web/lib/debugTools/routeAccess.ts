import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationRequirement,
} from '@/lib/auth/authorization';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export interface DebugToolsRouteAccess {
    client: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    userId: string | null;
}

export async function requireDebugToolsRouteAccess(input: {
    request: Request;
    requestId: string;
    requirement?: RouteAuthorizationRequirement;
}) {
    const session = await resolveSessionTenant();
    const client = getSupabaseServer();

    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return {
            access: null,
            response: NextResponse.json(
                { error: 'Unauthorized', request_id: input.requestId },
                { status: 401 },
            ),
        };
    }

    const actor = resolveRequestActor(session);
    const user = session ? (await session.supabase.auth.getUser()).data.user ?? null : null;
    const context = buildRouteAuthorizationContext({
        tenantId: actor.tenantId,
        userId: actor.userId,
        authMode: session ? 'session' : 'dev_bypass',
        user,
    });
    const requirement = input.requirement ?? 'run_debug_tools';

    if (!isRouteAuthorizationGranted(context, requirement)) {
        return {
            access: null,
            response: await buildForbiddenRouteResponse({
                client,
                requestId: input.requestId,
                context,
                route: new URL(input.request.url).pathname,
                requirement,
            }),
        };
    }

    return {
        access: {
            client,
            tenantId: actor.tenantId,
            userId: actor.userId,
        } satisfies DebugToolsRouteAccess,
        response: null,
    };
}
