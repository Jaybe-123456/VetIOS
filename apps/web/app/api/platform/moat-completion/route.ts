import { NextResponse } from 'next/server';
import { z } from 'zod';
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
import {
    buildMoatCompletionSnapshot,
    loadMoatCompletionEvidence,
    type MoatCompletionDigest,
} from '@/lib/platform/moatCompletion';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SealCompletionSchema = z.object({
    request_id: z.string().uuid(),
    moat_keys: z.array(z.string().min(3).max(96)).max(25).optional(),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const url = new URL(req.url);
    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: url.searchParams.get('tenant_id'),
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const client = getSupabaseServer();
    const context = await resolveMoatCompletionAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(context, 'view_governance')) {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: 'api/platform/moat-completion:GET',
            requirement: 'view_governance',
        });
    }

    const evidence = await loadMoatCompletionEvidence(client, context.tenantId);
    const snapshot = buildMoatCompletionSnapshot(evidence);
    const response = NextResponse.json({
        snapshot,
        de_identified: true,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<unknown>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, { allowInternalToken: true });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const client = getSupabaseServer();
    const context = await resolveMoatCompletionAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(context, 'admin')) {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: 'api/platform/moat-completion:POST',
            requirement: 'admin',
        });
    }

    const parsed = SealCompletionSchema.safeParse(body.data);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten(), request_id: requestId },
            { status: 400 },
        );
    }

    const evidence = await loadMoatCompletionEvidence(client, context.tenantId);
    const snapshot = buildMoatCompletionSnapshot(evidence);
    const allowedKeys = new Set(parsed.data.moat_keys?.map((key) => key.trim().toLowerCase()));
    const moats = allowedKeys.size > 0
        ? snapshot.moats.filter((moat) => allowedKeys.has(moat.moat_key))
        : snapshot.moats;

    if (moats.length === 0) {
        return NextResponse.json(
            { error: 'no_matching_moats', request_id: requestId },
            { status: 400 },
        );
    }

    const payload = moats.map((moat) => toMoatCompletionEventPayload({
        tenantId: context.tenantId,
        requestId: parsed.data.request_id,
        moat,
        observedAt: snapshot.generated_at,
    }));

    const { data, error } = await client
        .from('moat_completion_events')
        .insert(payload)
        .select('id, moat_key, completion_level, claim_posture, completion_score');

    if (error) {
        if (error.code === '23505') {
            const cached = await loadCachedMoatCompletionEvents(client, context.tenantId, parsed.data.request_id);
            if (cached.length > 0) {
                const response = NextResponse.json({
                    sealed_events: cached,
                    snapshot,
                    cached: true,
                    de_identified: true,
                    request_id: requestId,
                });
                withRequestHeaders(response.headers, requestId, startTime);
                return response;
            }
        }
        return NextResponse.json(
            { error: 'moat_completion_event_store_failed', detail: error.message, request_id: requestId },
            { status: 503 },
        );
    }

    const response = NextResponse.json({
        sealed_events: Array.isArray(data) ? data : [],
        snapshot,
        cached: false,
        de_identified: true,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

async function resolveMoatCompletionAuthorizationContext(
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

function toMoatCompletionEventPayload(input: {
    tenantId: string;
    requestId: string;
    moat: MoatCompletionDigest;
    observedAt: string;
}) {
    const moat = input.moat;
    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        moat_key: moat.moat_key,
        moat_name: moat.moat_name,
        value_capture_layer: moat.value_capture_layer,
        completion_level: moat.completion_level,
        completion_score: moat.completion_score,
        claim_posture: moat.claim_posture,
        hard_to_substitute: moat.hard_to_substitute,
        two_quarter_replicability: moat.two_quarter_replicability,
        live_event_count: moat.live_event_count,
        outcome_confirmed_count: moat.outcome_confirmed_count,
        provenance_verified_count: moat.provenance_verified_count,
        trust_scored_count: moat.trust_scored_count,
        external_validation_count: moat.external_validation_count,
        last_signal_at: moat.last_signal_at,
        scarcity_basis: moat.scarcity_basis,
        missing_evidence: moat.missing_evidence,
        evidence_requirements: moat.evidence_requirements,
        evidence: moat.evidence,
        owner_label: moat.owner_label,
        next_unblock_action: moat.next_unblock_action,
        observed_at: input.observedAt,
    };
}

async function loadCachedMoatCompletionEvents(
    client: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
) {
    const { data } = await client
        .from('moat_completion_events')
        .select('id, moat_key, completion_level, claim_posture, completion_score')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .order('moat_key', { ascending: true });
    return Array.isArray(data) ? data : [];
}
