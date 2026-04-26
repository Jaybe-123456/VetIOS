/**
 * POST /api/population-signal/ingest  — ingest a disease signal
 * GET  /api/population-signal/report  — surveillance report
 * GET  /api/population-signal         — active outbreak alerts
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { getPopulationSignalService } from '@/lib/populationSignal/populationSignalService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  try {
    const url = new URL(req.url);
    const region = url.searchParams.get('region') ?? undefined;

    const service = getPopulationSignalService();
    const [alerts, heatmap] = await Promise.all([
      service.detectOutbreaks(),
      service.buildHeatmap(region),
    ]);

    const res = NextResponse.json(
      {
        data: {
          activeAlerts: alerts,
          heatmap: heatmap.slice(0, 30),
          alertCount: alerts.length,
          region: region ?? 'global',
        },
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

export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    const { tenantId } = await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const body = (await req.json()) as {
      disease: string;
      species: string;
      region: string;
      confidence?: number;
      inferenceEventId: string;
    };

    if (!body.disease || !body.species || !body.region || !body.inferenceEventId) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: 'disease, species, region, inferenceEventId are required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const service = getPopulationSignalService();
    await service.ingestSignal({
      tenantId,
      disease: body.disease,
      species: body.species,
      region: body.region,
      confidence: body.confidence ?? 0.7,
      inferenceEventId: body.inferenceEventId,
    });

    const res = NextResponse.json(
      {
        data: { ingested: true },
        meta: { timestamp: new Date().toISOString(), request_id: requestId },
      },
      { status: 201 }
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
