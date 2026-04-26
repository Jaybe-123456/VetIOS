/**
 * GET /api/population-signal/report
 * Full population disease surveillance report
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getPopulationSignalService } from '@/lib/populationSignal/populationSignalService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  try {
    const service = getPopulationSignalService();
    const report = await service.generateSurveillanceReport();

    const res = NextResponse.json(
      {
        data: report,
        meta: { timestamp: new Date().toISOString(), request_id: requestId },
      },
      { status: 200 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      { error: { code: 'internal_error', message: String(err) } },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}
