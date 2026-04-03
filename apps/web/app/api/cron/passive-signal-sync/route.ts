import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { runDuePassiveConnectorSyncs } from '@/lib/passiveSignals/service';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    if (!isAuthorizedCronRequest(req)) {
        const response = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const url = new URL(req.url);
    const tenantId = normalizeOptionalText(url.searchParams.get('tenant_id'));
    const syncRuns = await runDuePassiveConnectorSyncs({
        client: getSupabaseServer(),
        tenantId,
        actor: 'cron:passive_signal_sync',
    });

    const response = NextResponse.json({
        cron: {
            schedule: '*/15 * * * *',
            authorized_by: resolveCronAuthLabel(req),
            tenant_id: tenantId,
        },
        summary: {
            sync_runs: syncRuns.length,
        },
        sync_runs: syncRuns,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

function isAuthorizedCronRequest(req: Request): boolean {
    const token = extractBearerToken(req.headers.get('authorization'));
    const cronSecret = normalizeOptionalText(process.env.CRON_SECRET);
    const internalToken = normalizeOptionalText(process.env.VETIOS_INTERNAL_API_TOKEN);

    if (cronSecret && token === cronSecret) return true;
    return Boolean(internalToken && token === internalToken);
}

function resolveCronAuthLabel(req: Request): string {
    const token = extractBearerToken(req.headers.get('authorization'));
    const cronSecret = normalizeOptionalText(process.env.CRON_SECRET);
    return cronSecret && token === cronSecret ? 'cron_secret' : 'internal_token';
}

function extractBearerToken(authorization: string | null): string | null {
    const match = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    return match && match.length > 0 ? match : null;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
