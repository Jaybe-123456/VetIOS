import { NextResponse } from 'next/server';
import {
    acknowledgeEdgeSyncJob,
    pullEdgeSyncWork,
    updateEdgeHeartbeat,
    authenticateEdgeBox,
} from '@/lib/edgeBox/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EdgeSyncAction =
    | {
        action: 'heartbeat';
        software_version?: string | null;
        status?: 'provisioning' | 'online' | 'degraded' | 'offline' | 'retired';
    }
    | {
        action: 'pull_jobs';
        software_version?: string | null;
        limit?: number;
    }
    | {
        action: 'ack_job';
        job_id?: string;
        status?: 'succeeded' | 'failed' | 'canceled';
        error_message?: string | null;
        synced_artifact_ids?: string[];
    };

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const edgeBoxId = req.headers.get('x-vetios-edge-box-id')?.trim() ?? '';
    const token = req.headers.get('x-vetios-edge-token')?.trim() ?? '';
    if (!edgeBoxId || !token) {
        const response = NextResponse.json({ error: 'Missing edge box credentials.', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const parsed = await safeJson<EdgeSyncAction>(req);
    if (!parsed.ok) {
        const response = NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const client = getSupabaseServer();
    try {
        if (parsed.data.action === 'heartbeat') {
            const edgeBox = await authenticateEdgeBox(client, { edgeBoxId, token, action: 'heartbeat' });
            const next = await updateEdgeHeartbeat(client, {
                tenantId: edgeBox.tenant_id,
                edgeBoxId: edgeBox.id,
                status: parsed.data.status ?? 'online',
                softwareVersion: parsed.data.software_version ?? edgeBox.software_version,
                actor: edgeBox.id,
            });
            const response = NextResponse.json({ edge_box: next, request_id: requestId });
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        if (parsed.data.action === 'pull_jobs') {
            const result = await pullEdgeSyncWork(client, {
                edgeBoxId,
                token,
                softwareVersion: parsed.data.software_version ?? null,
                limit: parsed.data.limit,
            });
            const response = NextResponse.json({ ...result, request_id: requestId });
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        if (parsed.data.action === 'ack_job') {
            const result = await acknowledgeEdgeSyncJob(client, {
                edgeBoxId,
                token,
                jobId: parsed.data.job_id ?? '',
                status: parsed.data.status ?? 'succeeded',
                errorMessage: parsed.data.error_message ?? null,
                syncedArtifactIds: parsed.data.synced_artifact_ids ?? [],
            });
            const response = NextResponse.json({ ...result, request_id: requestId });
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        const response = NextResponse.json({ error: 'Unsupported edge sync action.', request_id: requestId }, { status: 400 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const status = typeof (error as Error & { status?: number }).status === 'number'
            ? (error as Error & { status: number }).status
            : 400;
        const response = NextResponse.json({
            error: error instanceof Error ? error.message : 'Edge sync request failed.',
            request_id: requestId,
        }, { status });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
