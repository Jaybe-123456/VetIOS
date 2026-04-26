/**
 * GET  /api/active-learning   — get prioritised queue for tenant
 * PATCH /api/active-learning  — mark a case as reviewed
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { getActiveLearningService } from '@/lib/activeLearning/activeLearningService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    const { tenantId } = await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
    const statsOnly = url.searchParams.get('stats_only') === 'true';

    const service = getActiveLearningService();

    if (statsOnly) {
      const stats = await service.getQueueStats(tenantId ?? "");
      const res = NextResponse.json(
        {
          data: stats,
          meta: { timestamp: new Date().toISOString(), request_id: requestId },
        },
        { status: 200 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const queue = await service.getPrioritisedQueue(tenantId ?? "", limit);

    const res = NextResponse.json(
      {
        data: queue,
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

export async function PATCH(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    const { actor } = await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const body = await req.json();

    if (!body.case_id || !body.confirmed_diagnosis) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: 'case_id and confirmed_diagnosis required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const service = getActiveLearningService();
    await service.markReviewed(
      body.case_id,
      body.confirmed_diagnosis,
      actor.userId ?? 'unknown'
    );

    const res = NextResponse.json(
      {
        data: { reviewed: true },
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
