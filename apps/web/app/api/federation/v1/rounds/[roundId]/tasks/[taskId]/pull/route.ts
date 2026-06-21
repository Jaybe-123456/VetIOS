import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    FederationNodeRuntimeError,
    pullFederationRoundNodeTask,
} from '@/lib/federation/nodeRuntime';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});

const PullTaskSchema = z.object({
    node_ref: z.string().min(3).max(96).optional(),
    partner_ref: z.string().min(3).max(160).optional(),
    evidence: JsonRecordSchema,
});

export async function POST(
    req: Request,
    context: { params: Promise<{ roundId: string; taskId: string }> },
) {
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

    const body = await safeJson<unknown>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }
    const parsed = PullTaskSchema.safeParse(body.data);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten(), request_id: requestId },
            { status: 400 },
        );
    }

    try {
        const { roundId, taskId } = await context.params;
        const result = await pullFederationRoundNodeTask(client, auth.actor, {
            roundId,
            taskId,
            nodeRef: parsed.data.node_ref ?? '',
            partnerRef: parsed.data.partner_ref,
            evidence: parsed.data.evidence,
        });

        const response = NextResponse.json({
            ...result,
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
            error: error instanceof Error ? error.message : 'Federation node task pull failed.',
            request_id: requestId,
        },
        { status },
    );
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
