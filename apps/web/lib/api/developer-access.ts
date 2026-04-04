import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { buildPartnerAuthFailureResponse, resolvePartnerApiKeyAccess } from '@/lib/api/auth-middleware';
import { getApiPartnerById, resolvePartnerBySessionTenant } from '@/lib/api/partner-service';
import type { ApiCredential, ApiPartner, PartnerPlan } from '@/lib/api/types';

export interface DeveloperRouteAccess {
    client: ReturnType<typeof getSupabaseServer>;
    partner: ApiPartner;
    credential: ApiCredential | null;
    plan: PartnerPlan | null;
    context: RouteAuthorizationContext | null;
    authMode: 'session' | 'api_key';
}

export async function resolveDeveloperRouteAccess(input: {
    request: Request;
    requestId: string;
    allowApiKey?: boolean;
    requireAdmin?: boolean;
    partnerId?: string | null;
}): Promise<{ access: DeveloperRouteAccess; response: null } | { access: null; response: NextResponse }> {
    const client = getSupabaseServer();
    const session = await resolveSessionTenant();

    if (session) {
        const actor = resolveRequestActor(session);
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        const context = buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'session',
            user,
        });

        if (input.requireAdmin && context.role !== 'admin') {
            return {
                access: null,
                response: await buildForbiddenRouteResponse({
                    client,
                    requestId: input.requestId,
                    context,
                    route: new URL(input.request.url).pathname,
                    requirement: 'admin',
                }),
            };
        }

        const partner = input.partnerId && context.role === 'admin'
            ? await getApiPartnerById(client, input.partnerId)
            : await resolvePartnerBySessionTenant(client, context.tenantId);

        if (!partner) {
            return {
                access: null,
                response: NextResponse.json({ error: 'Partner account not found.', request_id: input.requestId }, { status: 404 }),
            };
        }

        return {
            access: {
                client,
                partner,
                credential: null,
                plan: partner.plan ?? null,
                context,
                authMode: 'session',
            },
            response: null,
        };
    }

    if (input.allowApiKey === false) {
        return {
            access: null,
            response: NextResponse.json({ error: 'Unauthorized', request_id: input.requestId }, { status: 401 }),
        };
    }

    const apiKeyAccess = await resolvePartnerApiKeyAccess(input.request);
    if (!apiKeyAccess.success || !apiKeyAccess.partner || !apiKeyAccess.credential) {
        return {
            access: null,
            response: buildPartnerAuthFailureResponse(apiKeyAccess),
        };
    }

    return {
        access: {
            client,
            partner: apiKeyAccess.partner,
            credential: apiKeyAccess.credential,
            plan: apiKeyAccess.plan ?? null,
            context: null,
            authMode: 'api_key',
        },
        response: null,
    };
}
