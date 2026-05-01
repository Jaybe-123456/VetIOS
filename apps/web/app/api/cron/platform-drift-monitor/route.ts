import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { runDriftDetection } from '@/lib/platform/flywheel';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const _cronAuth = authorizeCronRequest(req, 'platform-drift-monitor');
  if (!_cronAuth.authorized) {
    const res = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }

  const startedAt = Date.now();

  try {
    const results = await runDriftDetection(getSupabaseServer());
    const response = NextResponse.json({
      cron: {
        schedule: '0 * * * *',
        authorized_by: _cronAuth.method,
      },
      summary: {
        evaluated_pairs: results.length,
        drift_detected: results.filter((result) => result.drift_detected).length,
      },
      results,
      duration_ms: Date.now() - startedAt,
      request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Platform drift monitor failed.',
        request_id: requestId,
      },
      { status: 500 },
    );
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
  }
}








