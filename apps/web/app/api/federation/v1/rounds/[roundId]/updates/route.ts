import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    FEDERATED_UPDATE_ROLES,
    FederationNodeRuntimeError,
    submitFederatedUpdate,
} from '@/lib/federation/nodeRuntime';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});

const UpdateSubmissionSchema = z.object({
    request_id: z.string().uuid().optional(),
    node_ref: z.string().min(3).max(96).optional(),
    partner_ref: z.string().min(3).max(160).optional(),
    round_node_task_id: z.string().uuid().optional(),
    outcome_eligibility_snapshot_id: z.string().uuid().optional(),
    contribution_role: z.enum(FEDERATED_UPDATE_ROLES).optional(),
    payload_commitment_hash: HashSchema,
    mask_commitment_hash: HashSchema.optional(),
    signed_payload_hash: HashSchema.optional(),
    signature_algorithm: z.string().min(1).max(80).optional(),
    signature_hash: HashSchema.optional(),
    signing_key_fingerprint: z.string().min(6).max(160).optional(),
    masked_update_summary: JsonRecordSchema,
    public_summary: JsonRecordSchema,
    evidence: JsonRecordSchema,
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
        requiredScopes: ['federation:node', 'secure_aggregation:write'],
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
    const parsed = UpdateSubmissionSchema.safeParse(body.data);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten(), request_id: requestId },
            { status: 400 },
        );
    }

    try {
        const { roundId } = await context.params;
        const result = await submitFederatedUpdate(client, auth.actor, {
            roundId,
            body: {
                requestId: parsed.data.request_id,
                nodeRef: parsed.data.node_ref ?? '',
                partnerRef: parsed.data.partner_ref,
                roundNodeTaskId: parsed.data.round_node_task_id,
                outcomeEligibilitySnapshotId: parsed.data.outcome_eligibility_snapshot_id,
                contributionRole: parsed.data.contribution_role,
                payloadCommitmentHash: parsed.data.payload_commitment_hash,
                maskCommitmentHash: parsed.data.mask_commitment_hash,
                signedPayloadHash: parsed.data.signed_payload_hash,
                signatureAlgorithm: parsed.data.signature_algorithm,
                signatureHash: parsed.data.signature_hash,
                signingKeyFingerprint: parsed.data.signing_key_fingerprint,
                maskedUpdateSummary: parsed.data.masked_update_summary,
                publicSummary: parsed.data.public_summary,
                evidence: parsed.data.evidence,
                observedAt: parsed.data.observed_at,
            },
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
            error: error instanceof Error ? error.message : 'Federated update submission failed.',
            request_id: requestId,
        },
        { status },
    );
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
