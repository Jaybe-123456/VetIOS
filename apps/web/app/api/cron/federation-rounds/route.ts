import { NextResponse } from 'next/server';
import { runDueFederationAutomation } from '@/lib/federation/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

  const _cronAuth = authorizeCronRequest(req, 'federation-rounds');
  if (!_cronAuth.authorized) {
    const res = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenant_id') ?? undefined;
    const federationKey = url.searchParams.get('federation_key') ?? undefined;
    const runs = await runDueFederationAutomation(getSupabaseServer(), {
        tenantId,
        federationKey,
        actor: 'cron:federation_rounds',
    });

    const response = NextResponse.json({
        cron: {
            schedule: '0 * * * *',
            authorized_by: _cronAuth.method,
            tenant_id: tenantId,
            federation_key: federationKey,
        },
        summary: {
            runs: runs.length,
            rounds_completed: runs.filter((run) => run.round != null).length,
            auto_enrolled_memberships: runs.reduce((sum, run) => sum + run.auto_enrolled_memberships.length, 0),
        },
        runs,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}






