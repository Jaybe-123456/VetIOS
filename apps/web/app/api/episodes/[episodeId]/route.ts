import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import {
    createOutcomeNetworkRepository,
    getEpisodeDetail,
} from '@/lib/outcomeNetwork/service';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    req: Request,
    context: { params: Promise<{ episodeId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const { tenantId } = session ?? {
        tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
    };
    const { episodeId } = await context.params;
    const url = new URL(req.url);
    const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 200)
        : 50;

    try {
        const detail = await getEpisodeDetail(
            createOutcomeNetworkRepository(getSupabaseServer()),
            tenantId,
            episodeId,
            limit,
        );
        if (!detail) {
            return NextResponse.json({ error: 'Episode not found', request_id: requestId }, { status: 404 });
        }

        const response = NextResponse.json({
            ...detail,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] GET /api/episodes/${episodeId} Error:`, error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error', request_id: requestId },
            { status: 500 },
        );
    }
}
