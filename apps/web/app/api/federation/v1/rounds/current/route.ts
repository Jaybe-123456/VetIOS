import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    FederationNodeRuntimeError,
    getCurrentFederationRoundForNode,
} from '@/lib/federation/nodeRuntime';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CurrentRoundQuerySchema = z.object({
    federation_key: z.string().min(3).max(64),
    node_ref: z.string().min(3).max(96).optional(),
    partner_ref: z.string().min(3).max(160).optional(),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['federation:node'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const url = new URL(req.url);
    const parsed = CurrentRoundQuerySchema.safeParse({
        federation_key: url.searchParams.get('federation_key'),
        node_ref: url.searchParams.get('node_ref') ?? undefined,
        partner_ref: url.searchParams.get('partner_ref') ?? undefined,
    });
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_query', detail: parsed.error.flatten(), request_id: requestId },
            { status: 400 },
        );
    }

    try {
        const result = await getCurrentFederationRoundForNode(client, {
            actor: auth.actor,
            federationKey: parsed.data.federation_key,
            nodeRef: parsed.data.node_ref,
            partnerRef: parsed.data.partner_ref,
        });

        const response = NextResponse.json({
            ...result,
            auth_mode: auth.actor.authMode,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        return nodeRuntimeErrorResponse(error, requestId, startTime);
    }
}

function nodeRuntimeErrorResponse(error: unknown, requestId: string, startTime: number): Response {
    const status = error instanceof FederationNodeRuntimeError ? error.status : 500;
    const response = NextResponse.json(
        {
            error: error instanceof Error ? error.message : 'Federation node current-round lookup failed.',
            request_id: requestId,
        },
        { status },
    );
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
