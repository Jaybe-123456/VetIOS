import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import {
    FEDERATION_ACTIVATION_STAGES,
    FEDERATION_ATTESTATION_STATUSES,
    FEDERATION_DATA_POLICY_STATUSES,
    FEDERATION_DEPLOYMENT_ENVIRONMENTS,
    FEDERATION_HEARTBEAT_STATUSES,
    FEDERATION_NODE_KINDS,
    FEDERATION_SECURE_AGGREGATION_STATUSES,
    buildFederationActivationAssessment,
    latestFederationActivationRows,
    normalizeBlockers,
    normalizeFederationKey,
    normalizeFederationRef,
    summarizeFederationActivation,
    type FederationActivationEventRow,
} from '@/lib/federation/activation';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});

const FederationActivationSchema = z.object({
    request_id: z.string().uuid(),
    federation_key: z.string().min(3).max(64),
    partner_ref: z.string().min(3).max(128),
    membership_id: z.string().uuid().optional(),
    node_kind: z.enum(FEDERATION_NODE_KINDS).default('clinic'),
    deployment_environment: z.enum(FEDERATION_DEPLOYMENT_ENVIRONMENTS).default('sandbox'),
    data_residency_region: z.string().max(64).optional(),
    activation_stage: z.enum(FEDERATION_ACTIVATION_STAGES).default('invited'),
    data_policy_status: z.enum(FEDERATION_DATA_POLICY_STATUSES).default('not_reviewed'),
    attestation_status: z.enum(FEDERATION_ATTESTATION_STATUSES).default('not_attested'),
    secure_aggregation_status: z.enum(FEDERATION_SECURE_AGGREGATION_STATUSES).default('not_ready'),
    heartbeat_status: z.enum(FEDERATION_HEARTBEAT_STATUSES).default('not_seen'),
    last_heartbeat_at: z.string().datetime().optional(),
    blockers: z.array(z.string().min(1).max(160)).max(25).default([]),
    evidence: JsonRecordSchema,
    observed_at: z.string().datetime().optional(),
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

    const supabase = getSupabaseServer();
    const authContext = await resolveFederationActivationAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: supabase,
            requestId,
            context: authContext,
            route: 'api/platform/federation/activation:GET',
            requirement: 'admin',
        });
    }

    const federationKey = normalizeFederationKey(url.searchParams.get('federation_key'));
    const sinceDays = clampDays(Number(url.searchParams.get('days') ?? 90));
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
        .from('federation_activation_events')
        .select('tenant_id, request_id, federation_key, partner_ref, membership_id, node_kind, deployment_environment, data_residency_region, activation_stage, activation_status, data_policy_status, attestation_status, secure_aggregation_status, heartbeat_status, last_heartbeat_at, readiness_score, blockers, observed_at, created_at')
        .eq('tenant_id', authContext.tenantId)
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(5_000);

    if (federationKey) query = query.eq('federation_key', federationKey);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json(
            { error: 'federation_activation_events_unavailable', request_id: requestId },
            { status: 503 },
        );
    }

    const rows = (Array.isArray(data) ? data : []) as FederationActivationEventRow[];
    const latestNodes = latestFederationActivationRows(rows);
    const response = NextResponse.json({
        period: `last_${sinceDays}_days`,
        summary: summarizeFederationActivation(rows),
        latest_nodes: latestNodes.slice(0, 100).map(toActivationNodeDigest),
        de_identified: true,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
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

    const supabase = getSupabaseServer();
    const authContext = await resolveFederationActivationAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: supabase,
            requestId,
            context: authContext,
            route: 'api/platform/federation/activation:POST',
            requirement: 'admin',
        });
    }

    const parsed = FederationActivationSchema.safeParse(body.data);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten(), request_id: requestId },
            { status: 400 },
        );
    }

    const input = parsed.data;
    const federationKey = normalizeFederationKey(input.federation_key);
    const partnerRef = normalizeFederationRef(input.partner_ref);
    if (!federationKey || !partnerRef) {
        return NextResponse.json(
            { error: 'invalid_federation_or_partner_ref', request_id: requestId },
            { status: 400 },
        );
    }

    const assessment = buildFederationActivationAssessment({
        activation_stage: input.activation_stage,
        deployment_environment: input.deployment_environment,
        data_policy_status: input.data_policy_status,
        attestation_status: input.attestation_status,
        secure_aggregation_status: input.secure_aggregation_status,
        heartbeat_status: input.heartbeat_status,
        last_heartbeat_at: input.last_heartbeat_at ?? null,
        blockers: input.blockers,
    });

    const payload = {
        tenant_id: authContext.tenantId,
        request_id: input.request_id,
        federation_key: federationKey,
        partner_ref: partnerRef,
        membership_id: input.membership_id ?? null,
        node_kind: input.node_kind,
        deployment_environment: input.deployment_environment,
        data_residency_region: input.data_residency_region?.trim() || null,
        activation_stage: input.activation_stage,
        activation_status: assessment.activation_status,
        data_policy_status: input.data_policy_status,
        attestation_status: input.attestation_status,
        secure_aggregation_status: input.secure_aggregation_status,
        heartbeat_status: input.heartbeat_status,
        last_heartbeat_at: input.last_heartbeat_at ?? null,
        readiness_score: assessment.readiness_score,
        blockers: assessment.blockers,
        evidence: {
            ...input.evidence,
            next_required_step: assessment.next_required_step,
            readiness: assessment.readiness,
        },
        observed_at: input.observed_at ?? new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from('federation_activation_events')
        .insert(payload)
        .select('id, activation_status, readiness_score, blockers')
        .single();

    if (error) {
        if (error.code === '23505') {
            const cached = await loadCachedActivationEvent(supabase, authContext.tenantId, input.request_id);
            if (cached) {
                const response = NextResponse.json({
                    federation_activation_event_id: cached.id,
                    activation_status: cached.activation_status,
                    readiness_score: Number(cached.readiness_score ?? 0),
                    blockers: normalizeBlockers(cached.blockers),
                    cached: true,
                    de_identified: true,
                    request_id: requestId,
                });
                withRequestHeaders(response.headers, requestId, startTime);
                return response;
            }
        }
        return NextResponse.json(
            { error: 'federation_activation_event_store_failed', detail: error.message, request_id: requestId },
            { status: 503 },
        );
    }

    const response = NextResponse.json({
        federation_activation_event_id: String(data.id),
        activation_status: String(data.activation_status),
        readiness_score: Number(data.readiness_score ?? assessment.readiness_score),
        blockers: normalizeBlockers(data.blockers),
        cached: false,
        de_identified: true,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

async function resolveFederationActivationAuthorizationContext(
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

async function loadCachedActivationEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
): Promise<{ id: string; activation_status: string; readiness_score: number | string | null; blockers: string[] | null } | null> {
    const { data } = await supabase
        .from('federation_activation_events')
        .select('id, activation_status, readiness_score, blockers')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    return data?.id ? data as { id: string; activation_status: string; readiness_score: number | string | null; blockers: string[] | null } : null;
}

function toActivationNodeDigest(row: FederationActivationEventRow) {
    return {
        federation_key: row.federation_key,
        partner_ref: row.partner_ref,
        node_kind: row.node_kind ?? 'clinic',
        deployment_environment: row.deployment_environment ?? 'sandbox',
        data_residency_region: row.data_residency_region ?? null,
        activation_stage: row.activation_stage,
        activation_status: row.activation_status,
        data_policy_status: row.data_policy_status,
        attestation_status: row.attestation_status,
        secure_aggregation_status: row.secure_aggregation_status,
        heartbeat_status: row.heartbeat_status,
        last_heartbeat_at: row.last_heartbeat_at ?? null,
        readiness_score: Number(row.readiness_score ?? 0),
        blockers: normalizeBlockers(row.blockers),
        observed_at: row.observed_at ?? row.created_at ?? null,
    };
}

function clampDays(value: number): number {
    if (!Number.isFinite(value)) return 90;
    return Math.min(365, Math.max(1, Math.round(value)));
}
