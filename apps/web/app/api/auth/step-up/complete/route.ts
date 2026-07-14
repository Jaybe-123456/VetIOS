import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildRouteAuthorizationContext } from '@/lib/auth/authorization';
import {
    authorizeVetiosAction,
    writeAuthorizationDecisionEvent,
    writeHighRiskOperationChallengeEvent,
    writeHighRiskOperationChallengeSatisfiedEvent,
} from '@/lib/auth/authTrustFabric';
import { buildAuthTrustSubjectFromRouteContext } from '@/lib/auth/authTrustRouteGate';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { resolveStepUpAssurance } from '@/lib/auth/stepUpCompletion';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const StepUpCompletionSchema = z.object({
    action_key: z.string().trim().min(1).max(160),
    resource_type: z.string().trim().min(1).max(160),
    resource_id: z.string().trim().min(1).max(240).optional().nullable(),
    resource_tenant_id: z.string().trim().min(1).max(160).optional().nullable(),
    challenge_id: z.string().trim().min(1).max(240).optional().nullable(),
}).strict();

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        return withHeaders(
            NextResponse.json({ error: parsedJson.error, request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const parsed = StepUpCompletionSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const user = (await session.supabase.auth.getUser()).data.user ?? null;
    const actor = resolveRequestActor(session);
    const context = buildRouteAuthorizationContext({
        tenantId: actor.tenantId,
        userId: actor.userId,
        authMode: 'session',
        user,
    });
    const assurance = await resolveStepUpAssurance({ supabase: session.supabase, user });
    const subject = {
        ...buildAuthTrustSubjectFromRouteContext(context),
        assuranceLevel: assurance.assuranceLevel,
    };

    const packet = authorizeVetiosAction({
        tenantId: context.tenantId,
        requestId,
        subject,
        actionKey: parsed.data.action_key,
        resource: {
            type: parsed.data.resource_type,
            id: parsed.data.resource_id ?? null,
            tenantId: parsed.data.resource_tenant_id ?? context.tenantId,
        },
        permissionSnapshot: context.permissionSet as unknown as Record<string, unknown>,
        evidence: {
            route: 'api/auth/step-up/complete',
            challenge_id: parsed.data.challenge_id ?? null,
            step_up_assurance_source: assurance.source,
            supabase_current_level: assurance.supabaseCurrentLevel,
            supabase_next_level: assurance.supabaseNextLevel,
            authentication_methods: assurance.authenticationMethods,
        },
    });

    const client = getSupabaseServer();
    await writeAuthorizationDecisionEvent(client, packet).catch(() => null);

    if (packet.decision === 'allow') {
        await writeHighRiskOperationChallengeSatisfiedEvent(client, packet, {
            evidence: {
                challenge_id: parsed.data.challenge_id ?? null,
                step_up_assurance_source: assurance.source,
                supabase_current_level: assurance.supabaseCurrentLevel,
                authentication_methods: assurance.authenticationMethods,
            },
        }).catch(() => null);

        return withHeaders(
            NextResponse.json({
                step_up_satisfied: true,
                request_id: requestId,
                auth_trust: {
                    decision: packet.decision,
                    action_key: packet.actionKey,
                    assurance_level: packet.assuranceLevel,
                    required_assurance_level: packet.requiredAssuranceLevel,
                    challenge_status: 'satisfied',
                },
            }),
            requestId,
            startTime,
        );
    }

    if (packet.decision === 'challenge') {
        await writeHighRiskOperationChallengeEvent(client, packet, {
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            evidence: {
                route: 'api/auth/step-up/complete',
                challenge_id: parsed.data.challenge_id ?? null,
                step_up_assurance_source: assurance.source,
            },
        }).catch(() => null);
    }

    const status = packet.decision === 'challenge' ? 428 : 403;
    const response = NextResponse.json(
        {
            error: packet.decision === 'challenge' ? 'step_up_required' : 'authorization_denied',
            code: packet.decision === 'challenge' ? 'VETIOS_STEP_UP_REQUIRED' : 'VETIOS_AUTH_TRUST_DENIED',
            request_id: requestId,
            auth_trust: {
                decision: packet.decision,
                action_key: packet.actionKey,
                assurance_level: packet.assuranceLevel,
                required_assurance_level: packet.requiredAssuranceLevel,
                challenge_type: packet.challengeType,
                blockers: packet.blockers,
                reasons: packet.reasons,
            },
        },
        { status },
    );
    response.headers.set('x-vetios-auth-trust-decision', packet.decision);
    response.headers.set('x-vetios-auth-trust-action', packet.actionKey);
    if (packet.challengeType) {
        response.headers.set('x-vetios-step-up-type', packet.challengeType);
    }
    return withHeaders(response, requestId, startTime);
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
