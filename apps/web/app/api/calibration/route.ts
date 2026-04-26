/**
 * GET /api/calibration?species=feline  — species scorecard
 * POST /api/calibration/increment      — increment a calibration tuple
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { getLiveCalibrationEngine } from '@/lib/calibration/liveCalibrationEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  try {
    const url = new URL(req.url);
    const species = url.searchParams.get('species');
    const diagnosis = url.searchParams.get('diagnosis');
    const rawConfidence = url.searchParams.get('confidence');
    const breed = url.searchParams.get('breed');

    const engine = getLiveCalibrationEngine();

    // Live calibration query
    if (diagnosis && rawConfidence && species) {
      const result = await engine.calibrate({
        rawConfidence: Number(rawConfidence),
        species,
        breed: breed ?? null,
        diagnosis,
      });

      const res = NextResponse.json(
        {
          data: result,
          meta: { timestamp: new Date().toISOString(), request_id: requestId },
        },
        { status: 200 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    // Scorecard query
    if (!species) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: '?species= is required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const scorecard = await engine.getScorecard(species);

    const res = NextResponse.json(
      {
        data: scorecard,
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
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const body = await req.json();

    if (!body.species || !body.diagnosis || body.is_correct === undefined || !body.model_confidence) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: 'species, diagnosis, is_correct, model_confidence required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const engine = getLiveCalibrationEngine();
    await engine.incrementTuple({
      species: body.species,
      breed: body.breed ?? null,
      diagnosis: body.diagnosis,
      isCorrect: Boolean(body.is_correct),
      modelConfidence: Number(body.model_confidence),
    });

    const res = NextResponse.json(
      {
        data: { incremented: true },
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
