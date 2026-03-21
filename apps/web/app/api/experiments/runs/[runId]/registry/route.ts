import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { RegistryControlPlaneError } from '@/lib/experiments/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { applyExperimentRegistryAction, backfillSummaryExperimentRuns } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req);
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    await backfillSummaryExperimentRuns(store, tenantId);
    const registry = await store.getExperimentRegistryLink(tenantId, runId);

    const response = NextResponse.json({ registry, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<{
        action?: 'promote_to_staging' | 'promote_to_production' | 'set_manual_approval' | 'archive' | 'rollback';
        manual_approval?: boolean;
        reason?: string;
        incident_id?: string | null;
    }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    if (!body.data.action) {
        return NextResponse.json({ error: 'action is required', request_id: requestId }, { status: 400 });
    }

    const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    try {
        const registry = await applyExperimentRegistryAction(
            store,
            tenantId,
            runId,
            body.data.action,
            actor?.userId ?? null,
            {
                manualApproval: body.data.manual_approval,
                reason: body.data.reason,
                incidentId: body.data.incident_id ?? null,
            },
        );

        const response = NextResponse.json({
            registry,
            authenticated_user_id: actor?.userId ?? null,
            auth_mode: actor?.authMode ?? 'dev_bypass',
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            error instanceof RegistryControlPlaneError
                ? {
                    error: error.message,
                    code: error.code,
                    details: error.details,
                    request_id: requestId,
                }
                : {
                    error: error instanceof Error ? error.message : 'Registry action failed.',
                    request_id: requestId,
                },
            { status: error instanceof RegistryControlPlaneError ? error.httpStatus : 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
