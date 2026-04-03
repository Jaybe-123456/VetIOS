import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import {
    dispatchOutboxBatch,
    getOutboxQueueSnapshot,
    releaseStaleOutboxEvents,
    requeueDeadLetterEvents,
    requeueOutboxEvent,
    type ConnectorDeliveryAttemptStatus,
    type OutboxHandlerKey,
    type OutboxStatus,
} from '@/lib/eventPlane/outbox';
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
    }
    | {
        action: 'requeue_event';
        event_id?: string | null;
        tenant_id?: string | null;
    }
    | {
        action: 'requeue_dead_letters';
        tenant_id?: string | null;
        limit?: number;
        handler_key?: OutboxHandlerKey | 'all' | null;
    }
    | {
        action: 'release_stale_processing';
        tenant_id?: string | null;
        older_than_minutes?: number;
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
    const status = normalizeStatusFilter(url.searchParams.get('status'));
    const attemptStatus = normalizeAttemptStatusFilter(url.searchParams.get('attempt_status'));
    const handlerKey = normalizeHandlerFilter(url.searchParams.get('handler_key'));
    const topic = normalizeOptionalText(url.searchParams.get('topic'));
    const snapshot = await getOutboxQueueSnapshot(adminClient, tenantId, {
        limit: Number.isFinite(limit) ? limit : 30,
        status,
        attemptStatus,
        handlerKey,
        topic,
    });

    const response = NextResponse.json({
        snapshot,
        filters: {
            status,
            attempt_status: attemptStatus,
            handler_key: handlerKey,
            topic,
        },
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

    try {
        const action = body.data.action ?? 'dispatch';
        const tenantId = actor?.tenantId ?? body.data.tenant_id ?? process.env.VETIOS_DEV_TENANT_ID ?? null;

        let payload: Record<string, unknown>;
        if (action === 'dispatch') {
            const dispatchBody = body.data as Extract<OutboxAction, { action?: 'dispatch' }>;
            payload = {
                dispatch: await dispatchOutboxBatch(adminClient, {
                    workerId: normalizeOptionalText(dispatchBody.worker_id)
                        ?? actor?.userId
                        ?? `outbox-worker-${Date.now()}`,
                    batchSize: normalizePositiveInteger(dispatchBody.batch_size) ?? 20,
                    tenantId,
                    topics: Array.isArray(dispatchBody.topics)
                        ? dispatchBody.topics.filter((topic): topic is string => typeof topic === 'string' && topic.trim().length > 0)
                        : null,
                }),
            };
        } else if (action === 'requeue_event') {
            if (!tenantId) {
                return NextResponse.json({ error: 'tenant_id is required for requeue_event.', request_id: requestId }, { status: 400 });
            }
            const requeueEventBody = body.data as Extract<OutboxAction, { action: 'requeue_event' }>;
            payload = {
                requeue: await requeueOutboxEvent(adminClient, {
                    tenantId,
                    eventId: normalizeRequiredText(requeueEventBody.event_id, 'event_id'),
                }),
            };
        } else if (action === 'requeue_dead_letters') {
            if (!tenantId) {
                return NextResponse.json({ error: 'tenant_id is required for requeue_dead_letters.', request_id: requestId }, { status: 400 });
            }
            const requeueDeadLettersBody = body.data as Extract<OutboxAction, { action: 'requeue_dead_letters' }>;
            payload = {
                requeue: await requeueDeadLetterEvents(adminClient, {
                    tenantId,
                    limit: normalizePositiveInteger(requeueDeadLettersBody.limit) ?? 25,
                    handlerKey: normalizeHandlerFilter(requeueDeadLettersBody.handler_key),
                }),
            };
        } else if (action === 'release_stale_processing') {
            const releaseBody = body.data as Extract<OutboxAction, { action: 'release_stale_processing' }>;
            payload = {
                released: await releaseStaleOutboxEvents(adminClient, {
                    tenantId,
                    olderThanMinutes: normalizePositiveInteger(releaseBody.older_than_minutes) ?? 5,
                }),
            };
        } else {
            return NextResponse.json({ error: 'Unsupported outbox action.', request_id: requestId }, { status: 400 });
        }

        const response = NextResponse.json({
            ...payload,
            snapshot: tenantId
                ? await getOutboxQueueSnapshot(adminClient, tenantId, { limit: 40 })
                : null,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Outbox action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
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

function normalizeRequiredText(value: unknown, field: string): string {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        throw new Error(`${field} is required.`);
    }
    return normalized;
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

function normalizeStatusFilter(value: unknown): OutboxStatus | null {
    return value === 'pending' || value === 'processing' || value === 'retryable' || value === 'delivered' || value === 'dead_letter'
        ? value
        : null;
}

function normalizeAttemptStatusFilter(value: unknown): ConnectorDeliveryAttemptStatus | null {
    return value === 'processing' || value === 'succeeded' || value === 'retryable' || value === 'dead_letter'
        ? value
        : null;
}

function normalizeHandlerFilter(value: unknown): OutboxHandlerKey | null {
    return value === 'connector_webhook' || value === 'passive_signal_reconcile' || value === 'petpass_notification_delivery'
        ? value
        : null;
}
