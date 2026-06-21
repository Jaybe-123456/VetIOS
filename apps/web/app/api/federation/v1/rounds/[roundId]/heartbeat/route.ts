import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    FEDERATION_NODE_ENVIRONMENTS,
    FEDERATION_NODE_KINDS,
    FederationNodeRuntimeError,
    OUTCOME_ELIGIBILITY_STATUSES,
    SECURE_AGGREGATION_STATUSES,
    getFederationRoundNodeStatus,
    recordFederationNodeRuntimeEvent,
} from '@/lib/federation/nodeRuntime';
import { FEDERATION_NODE_STATUSES } from '@/lib/federation/nodeProtocol';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});

const HeartbeatSchema = z.object({
    request_id: z.string().uuid().optional(),
    node_ref: z.string().min(3).max(96).optional(),
    partner_ref: z.string().min(3).max(160).optional(),
    node_kind: z.enum(FEDERATION_NODE_KINDS).default('clinic'),
    node_status: z.enum(FEDERATION_NODE_STATUSES).default('online'),
    deployment_environment: z.enum(FEDERATION_NODE_ENVIRONMENTS).default('sandbox'),
    software_version: z.string().max(80).optional(),
    secure_aggregation_status: z.enum(SECURE_AGGREGATION_STATUSES).default('not_ready'),
    outcome_eligibility_snapshot_id: z.string().uuid().optional(),
    outcome_eligibility_status: z.enum(OUTCOME_ELIGIBILITY_STATUSES).default('insufficient_evidence'),
    blockers: z.array(z.string().min(1).max(120)).max(30).default([]),
    evidence: JsonRecordSchema,
    last_heartbeat_at: z.string().datetime().optional(),
    observed_at: z.string().datetime().optional(),
});

export async function POST(
    req: Request,
    context: { params: Promise<{ roundId: string }> },
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
    const parsed = HeartbeatSchema.safeParse(body.data);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten(), request_id: requestId },
            { status: 400 },
        );
    }

    try {
        const { roundId } = await context.params;
        const status = await getFederationRoundNodeStatus(client, {
            actor: auth.actor,
            roundId,
            nodeRef: parsed.data.node_ref,
            partnerRef: parsed.data.partner_ref,
        });
        const runtimeEvent = await recordFederationNodeRuntimeEvent(client, auth.actor, {
            federationKey: status.round.federation_key,
            nodeRef: status.identity.nodeRef,
            partnerRef: status.identity.partnerRef,
            requestId: parsed.data.request_id,
            federationRoundId: status.round.id,
            runtimeEvent: 'heartbeat',
            nodeStatus: parsed.data.node_status,
            nodeKind: parsed.data.node_kind,
            deploymentEnvironment: parsed.data.deployment_environment,
            softwareVersion: parsed.data.software_version,
            secureAggregationStatus: parsed.data.secure_aggregation_status,
            outcomeEligibilitySnapshotId: parsed.data.outcome_eligibility_snapshot_id,
            outcomeEligibilityStatus: parsed.data.outcome_eligibility_status,
            lastHeartbeatAt: parsed.data.last_heartbeat_at,
            blockers: parsed.data.blockers,
            evidence: parsed.data.evidence,
            observedAt: parsed.data.observed_at,
        });

        const response = NextResponse.json({
            runtime_event: runtimeEvent,
            node_assessment: status.assessment,
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
            error: error instanceof Error ? error.message : 'Federation node heartbeat failed.',
            request_id: requestId,
        },
        { status },
    );
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
