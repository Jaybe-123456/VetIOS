import { NextResponse } from 'next/server';
import { buildForbiddenRouteResponse, buildRouteAuthorizationContext } from '@/lib/auth/authorization';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import {
    createEdgeBox,
    getEdgeBoxControlPlaneSnapshot,
    queueEdgeSyncJob,
    registerEdgeArtifact,
    updateEdgeHeartbeat,
} from '@/lib/edgeBox/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EdgeBoxAction =
    | {
        action: 'create_edge_box';
        node_name?: string;
        site_label?: string;
        hardware_class?: string | null;
        status?: 'provisioning' | 'online' | 'degraded' | 'offline' | 'retired';
        software_version?: string | null;
    }
    | {
        action: 'queue_sync_job';
        edge_box_id?: string;
        job_type?: 'telemetry_flush' | 'model_bundle' | 'dataset_delta' | 'config_sync';
        direction?: 'cloud_to_edge' | 'edge_to_cloud';
        payload?: Record<string, unknown>;
        scheduled_at?: string | null;
    }
    | {
        action: 'register_artifact';
        edge_box_id?: string | null;
        artifact_type?: 'model_bundle' | 'dataset_delta' | 'config_bundle' | 'telemetry_archive';
        artifact_ref?: string;
        content_hash?: string;
        size_bytes?: number;
    }
    | {
        action: 'heartbeat';
        edge_box_id?: string;
        status?: 'provisioning' | 'online' | 'degraded' | 'offline' | 'retired';
        software_version?: string | null;
    };

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const client = getSupabaseServer();
    const context = await resolveAdminContext(session);
    if (context.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: 'api/platform/edge-box:GET',
            requirement: 'admin',
        });
    }

    const snapshot = await getEdgeBoxControlPlaneSnapshot(client, context.tenantId);
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

    const parsed = await safeJson<EdgeBoxAction>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const client = getSupabaseServer();
    const context = await resolveAdminContext(session);
    if (context.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: `api/platform/edge-box:${parsed.data.action ?? 'unknown'}`,
            requirement: 'admin',
        });
    }

    try {
        let result: Record<string, unknown> = {};
        if (parsed.data.action === 'create_edge_box') {
            result.edge_box = await createEdgeBox(client, {
                tenantId: context.tenantId,
                actor: context.userId,
                nodeName: parsed.data.node_name ?? '',
                siteLabel: parsed.data.site_label ?? '',
                hardwareClass: parsed.data.hardware_class ?? null,
                status: parsed.data.status ?? 'provisioning',
                softwareVersion: parsed.data.software_version ?? null,
            });
        } else if (parsed.data.action === 'queue_sync_job') {
            result.sync_job = await queueEdgeSyncJob(client, {
                tenantId: context.tenantId,
                actor: context.userId,
                edgeBoxId: parsed.data.edge_box_id ?? '',
                jobType: parsed.data.job_type ?? 'config_sync',
                direction: parsed.data.direction ?? 'cloud_to_edge',
                payload: parsed.data.payload ?? {},
                scheduledAt: parsed.data.scheduled_at ?? null,
            });
        } else if (parsed.data.action === 'register_artifact') {
            result.sync_artifact = await registerEdgeArtifact(client, {
                tenantId: context.tenantId,
                edgeBoxId: parsed.data.edge_box_id ?? null,
                artifactType: parsed.data.artifact_type ?? 'config_bundle',
                artifactRef: parsed.data.artifact_ref ?? '',
                contentHash: parsed.data.content_hash ?? '',
                sizeBytes: parsed.data.size_bytes ?? 0,
            });
        } else if (parsed.data.action === 'heartbeat') {
            result.edge_box = await updateEdgeHeartbeat(client, {
                tenantId: context.tenantId,
                edgeBoxId: parsed.data.edge_box_id ?? '',
                status: parsed.data.status ?? 'online',
                softwareVersion: parsed.data.software_version ?? null,
            });
        } else {
            return NextResponse.json({ error: 'Unsupported edge-box action.', request_id: requestId }, { status: 400 });
        }

        const snapshot = await getEdgeBoxControlPlaneSnapshot(client, context.tenantId);
        const response = NextResponse.json({ ...result, snapshot, request_id: requestId });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Edge-box action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolveAdminContext(session: Awaited<ReturnType<typeof resolveSessionTenant>>) {
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
