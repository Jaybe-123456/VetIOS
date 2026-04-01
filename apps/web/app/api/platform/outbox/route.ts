import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { dispatchOutboxBatch, getOutboxQueueSnapshot } from '@/lib/eventPlane/outbox';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

type OutboxAction =
    | {
        action?: 'dispatch';
        batch_size?: number;
        topics?: string[];
        tenant_id?: string | null;
        worker_id?: string | null;
    };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const url = new URL(req.url);
    const tenantIdHint = url.searchParams.get('tenant_id');
    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolveOutboxAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: 'api/platform/outbox:GET',
            requirement: 'admin',
        });
    }

    const tenantId = actor?.tenantId
        ?? tenantIdHint
        ?? process.env.VETIOS_DEV_TENANT_ID
        ?? 'dev_tenant_001';
    const limit = Number(url.searchParams.get('limit') ?? '30');
    const snapshot = await getOutboxQueueSnapshot(adminClient, tenantId, {
        limit: Number.isFinite(limit) ? limit : 30,
    });

    const response = NextResponse.json({
        snapshot,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<OutboxAction>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: body.data.tenant_id ?? null,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolveOutboxAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: `api/platform/outbox:${body.data.action ?? 'dispatch'}`,
            requirement: 'admin',
        });
    }

    const action = body.data.action ?? 'dispatch';
    if (action !== 'dispatch') {
        return NextResponse.json({ error: 'Unsupported outbox action.', request_id: requestId }, { status: 400 });
    }

    const dispatchResult = await dispatchOutboxBatch(adminClient, {
        workerId: normalizeOptionalText(body.data.worker_id)
            ?? actor?.userId
            ?? `outbox-worker-${Date.now()}`,
        batchSize: normalizePositiveInteger(body.data.batch_size) ?? 20,
        tenantId: actor?.tenantId ?? body.data.tenant_id ?? process.env.VETIOS_DEV_TENANT_ID ?? null,
        topics: Array.isArray(body.data.topics)
            ? body.data.topics.filter((topic): topic is string => typeof topic === 'string' && topic.trim().length > 0)
            : null,
    });

    const response = NextResponse.json({
        dispatch: dispatchResult,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

async function resolveOutboxAuthorizationContext(
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

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizePositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    }
    return null;
}
