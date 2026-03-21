import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import {
    getModelRegistryControlPlaneSnapshot,
    RegistryControlPlaneError,
    verifyModelRegistryControlPlane,
} from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';

type RegistryControlPlaneAction =
    | {
        action?: 'verify_control_plane';
    };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    try {
        const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
        const snapshot = await getModelRegistryControlPlaneSnapshot(
            createSupabaseExperimentTrackingStore(getSupabaseServer()),
            tenantId,
        );
        const response = NextResponse.json({
            snapshot,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to load registry control plane.', request_id: requestId },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const body = await safeJson<RegistryControlPlaneAction>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    try {
        const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
        if ((body.data.action ?? 'verify_control_plane') !== 'verify_control_plane') {
            throw new RegistryControlPlaneError('INVALID_ACTION', 'Unsupported registry control-plane action.', {
                httpStatus: 400,
            });
        }

        const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
        const verification = await verifyModelRegistryControlPlane(store, tenantId);
        const response = NextResponse.json({
            verification,
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
                    error: error instanceof Error ? error.message : 'Failed to verify registry control plane.',
                    request_id: requestId,
                },
            { status: error instanceof RegistryControlPlaneError ? error.httpStatus : 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
