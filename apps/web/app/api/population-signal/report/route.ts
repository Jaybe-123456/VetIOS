/**
 * GET /api/population-signal/report
 * Full population disease surveillance report
 */

import { NextResponse } from 'next/server';
import { enforceVetiosClinicalActorGate } from '@/lib/auth/authTrustRouteGate';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getPopulationSignalService } from '@/lib/populationSignal/populationSignalService';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const REALTIME_CACHE_CONTROL = 'no-store';

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();
  const auth = await resolveClinicalApiActor(req, {
    client: supabase,
    requiredScopes: ['evaluation:read'],
  });
  if (auth.error || !auth.actor) {
    const res = NextResponse.json(
      { error: { code: 'unauthorized', message: auth.error?.message ?? 'Unauthorized' } },
      { status: auth.error?.status ?? 401 },
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }

  const trustGate = await enforceVetiosClinicalActorGate({
    client: supabase,
    requestId,
    actor: auth.actor,
    actionKey: 'surveillance.cross_tenant.export',
    resource: {
      type: 'population_surveillance_report',
      id: 'global',
      tenantId: null,
    },
    riskSignals: { crossTenantAccess: true },
    evidence: { route: '/api/population-signal/report' },
  });
  if (!trustGate.ok) {
    withRequestHeaders(trustGate.response.headers, requestId, startTime);
    return trustGate.response;
  }

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
    res.headers.set('Cache-Control', REALTIME_CACHE_CONTROL);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      { error: { code: 'internal_error', message: String(err) } },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', REALTIME_CACHE_CONTROL);
    return res;
  }
}
