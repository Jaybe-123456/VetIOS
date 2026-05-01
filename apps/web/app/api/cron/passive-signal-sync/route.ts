import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { runDuePassiveConnectorSyncs } from '@/lib/passiveSignals/service';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

  const _cronAuth = authorizeCronRequest(req, 'passive-signal-sync');
  if (!_cronAuth.authorized) {
    const res = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenant_id') ?? undefined;
    const syncRuns = await runDuePassiveConnectorSyncs({
        client: getSupabaseServer(),
        tenantId,
        actor: 'cron:passive_signal_sync',
    });

    const response = NextResponse.json({
        cron: {
            schedule: '*/15 * * * *',
            authorized_by: _cronAuth.method,
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








