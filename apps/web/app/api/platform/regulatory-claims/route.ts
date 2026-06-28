import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
} from '@/lib/auth/authorization';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    buildRegulatoryClaimApprovalEventDraft,
    buildRegulatoryClaimOperationsSnapshot,
    type RegulatoryClaimApprovalAction,
    type RegulatoryClaimApprovalEventRow,
    type RegulatoryClaimApprovalStatus,
    type RegulatoryClaimReviewEventRow,
    type RegulatoryClaimReviewerRole,
} from '@/lib/askVetios/regulatoryClaimsWorkflow';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RegulatoryClaimDecisionPayload {
    claim_review_event_id?: string | null;
    claim_request_id?: string | null;
    ask_vetios_query_id?: string | null;
    action_type?: RegulatoryClaimApprovalAction;
    action_status?: RegulatoryClaimApprovalStatus;
    reviewer_role?: RegulatoryClaimReviewerRole;
    artifact_type?: 'cds_evidence_pack' | 'model_card' | 'ifu' | 'approval_packet' | 'external_attestation' | null;
    artifact_hash?: string | null;
    review_note?: string | null;
    blockers?: string[];
    warnings?: string[];
    next_actions?: string[];
    evidence?: Record<string, unknown>;
}

const REVIEW_SELECT = [
    'id',
    'tenant_id',
    'request_id',
    'ask_vetios_query_id',
    'review_queue',
    'claim_review_status',
    'approval_status',
    'cds_evidence_pack_status',
    'model_card_status',
    'ifu_status',
    'clinical_signoff_status',
    'legal_signoff_status',
    'regulatory_claims_status',
    'regulatory_risk_level',
    'evidence_pack_hash',
    'model_card_hash',
    'ifu_hash',
    'approval_packet_hash',
    'blockers',
    'warnings',
    'next_actions',
    'observed_at',
    'created_at',
].join(', ');

const APPROVAL_SELECT = [
    'id',
    'tenant_id',
    'request_id',
    'claim_request_id',
    'claim_review_event_id',
    'ask_vetios_query_id',
    'action_type',
    'action_status',
    'reviewer_role',
    'reviewer_ref_hash',
    'artifact_type',
    'artifact_hash',
    'approval_packet_hash',
    'review_note_hash',
    'blockers',
    'warnings',
    'next_actions',
    'evidence',
    'observed_at',
    'created_at',
].join(', ');

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const client = getSupabaseServer();
    const context = await resolveGovernanceContext(session);
    if (!isRouteAuthorizationGranted(context, 'view_governance')) {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: 'api/platform/regulatory-claims:GET',
            requirement: 'view_governance',
        });
    }

    const url = new URL(req.url);
    const days = clampInteger(Number(url.searchParams.get('days') ?? 30), 1, 365, 30);
    const limit = clampInteger(Number(url.searchParams.get('limit') ?? 100), 1, 500, 100);
    const includeUnscoped = context.authMode === 'dev_bypass'
        && url.searchParams.get('include_unscoped') === 'true';
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let reviewQuery = client
        .from('regulatory_claim_review_events')
        .select(REVIEW_SELECT)
        .neq('review_queue', 'none')
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(limit);

    if (!includeUnscoped && isUuid(context.tenantId)) {
        reviewQuery = reviewQuery.eq('tenant_id', context.tenantId);
    }

    const { data: reviewRows, error: reviewError } = await reviewQuery;
    if (reviewError) {
        const response = NextResponse.json(
            { error: reviewError.message, request_id: requestId },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const reviews = (reviewRows ?? []) as unknown as RegulatoryClaimReviewEventRow[];
    const claimRequestIds = reviews.map((row) => row.request_id).filter(Boolean);
    const approvals = claimRequestIds.length > 0
        ? await fetchApprovalEvents(client, claimRequestIds)
        : [];

    const snapshot = buildRegulatoryClaimOperationsSnapshot({
        tenantId: context.tenantId,
        reviews,
        approvals,
        windowDays: days,
        limit,
    });

    const response = NextResponse.json({ snapshot, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const parsed = await safeJson<RegulatoryClaimDecisionPayload>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const client = getSupabaseServer();
    const context = await resolveGovernanceContext(session);
    if (!isRouteAuthorizationGranted(context, 'admin')) {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: 'api/platform/regulatory-claims:POST',
            requirement: 'admin',
        });
    }

    const validation = validateDecisionPayload(parsed.data);
    if (validation.error) {
        return NextResponse.json({ error: validation.error, request_id: requestId }, { status: 400 });
    }

    const review = parsed.data.claim_review_event_id
        ? await fetchReviewEvent(client, parsed.data.claim_review_event_id, context)
        : null;
    if (parsed.data.claim_review_event_id && !review) {
        return NextResponse.json({ error: 'Claim review event not found.', request_id: requestId }, { status: 404 });
    }

    const claimRequestId = review?.request_id ?? readNonEmpty(parsed.data.claim_request_id);
    if (!claimRequestId) {
        return NextResponse.json({ error: 'claim_request_id is required.', request_id: requestId }, { status: 400 });
    }

    const draft = buildRegulatoryClaimApprovalEventDraft({
        tenantId: isUuid(context.tenantId) ? context.tenantId : null,
        eventRequestId: requestId,
        claimRequestId,
        claimReviewEventId: review?.id ?? readNonEmpty(parsed.data.claim_review_event_id),
        askVetiosQueryId: review?.ask_vetios_query_id ?? readNonEmpty(parsed.data.ask_vetios_query_id),
        actionType: parsed.data.action_type!,
        actionStatus: parsed.data.action_status!,
        reviewerRole: parsed.data.reviewer_role!,
        reviewerRef: context.userId ?? context.authMode,
        artifactType: parsed.data.artifact_type ?? null,
        artifactHash: readNonEmpty(parsed.data.artifact_hash),
        reviewNote: readNonEmpty(parsed.data.review_note),
        blockers: parsed.data.blockers,
        warnings: parsed.data.warnings,
        nextActions: parsed.data.next_actions,
        evidence: {
            route: '/api/platform/regulatory-claims',
            actor_role: context.role,
            auth_mode: context.authMode,
            ...(parsed.data.evidence ?? {}),
        },
    });

    const { data, error } = await client
        .from('regulatory_claim_approval_events')
        .insert(draft)
        .select(APPROVAL_SELECT)
        .single();

    if (error) {
        const status = isMissingApprovalStorage(error) ? 503 : 400;
        const response = NextResponse.json({ error: error.message, request_id: requestId }, { status });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const response = NextResponse.json({ approval_event: data, request_id: requestId }, { status: 201 });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

async function fetchApprovalEvents(
    client: SupabaseClient,
    claimRequestIds: string[],
): Promise<RegulatoryClaimApprovalEventRow[]> {
    const { data, error } = await client
        .from('regulatory_claim_approval_events')
        .select(APPROVAL_SELECT)
        .in('claim_request_id', claimRequestIds)
        .order('observed_at', { ascending: false });

    if (error) {
        if (isMissingApprovalStorage(error)) return [];
        throw new Error(error.message);
    }

    return (data ?? []) as unknown as RegulatoryClaimApprovalEventRow[];
}

async function fetchReviewEvent(
    client: SupabaseClient,
    id: string,
    context: Awaited<ReturnType<typeof resolveGovernanceContext>>,
): Promise<RegulatoryClaimReviewEventRow | null> {
    let query = client
        .from('regulatory_claim_review_events')
        .select(REVIEW_SELECT)
        .eq('id', id)
        .limit(1);

    if (context.authMode !== 'dev_bypass' && isUuid(context.tenantId)) {
        query = query.eq('tenant_id', context.tenantId);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;
    return data[0] as unknown as RegulatoryClaimReviewEventRow;
}

async function resolveGovernanceContext(session: Awaited<ReturnType<typeof resolveSessionTenant>>) {
    if (session) {
        const actor = resolveRequestActor(session);
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
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

function validateDecisionPayload(payload: RegulatoryClaimDecisionPayload): { error: string | null } {
    if (!isAllowed(payload.action_type, [
        'cds_evidence_pack_review',
        'model_card_review',
        'ifu_review',
        'clinical_signoff',
        'legal_signoff',
        'external_attestation',
        'claim_rejection',
    ])) {
        return { error: 'Unsupported action_type.' };
    }
    if (!isAllowed(payload.action_status, [
        'drafted',
        'approved',
        'rejected',
        'changes_requested',
        'attested',
        'superseded',
    ])) {
        return { error: 'Unsupported action_status.' };
    }
    if (!isAllowed(payload.reviewer_role, [
        'clinician',
        'legal',
        'regulatory',
        'model_risk',
        'external_attestor',
        'admin',
    ])) {
        return { error: 'Unsupported reviewer_role.' };
    }
    const artifactHash = readNonEmpty(payload.artifact_hash);
    if (artifactHash && !/^[a-f0-9]{64}$/.test(artifactHash)) {
        return { error: 'artifact_hash must be a lowercase SHA-256 hex digest.' };
    }
    return { error: null };
}

function isAllowed<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function readNonEmpty(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isUuid(value: string | null | undefined): boolean {
    return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function isMissingApprovalStorage(error: { code?: string; message?: string }): boolean {
    const message = (error.message ?? '').toLowerCase();
    return error.code === '42P01'
        || error.code === '42703'
        || message.includes('regulatory_claim_approval_events')
        || message.includes('schema cache');
}
