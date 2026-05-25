import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { buildGbsReadinessProblem } from '@/lib/quantum/gbsReadiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/quantum/readiness
 *
 * Prepares the existing VKG differential candidates as a GBS-compatible
 * maximum weighted clique problem. This does not call Jiuzhang, PennyLane,
 * or any external quantum backend.
 */
export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  try {
    const body = await req.json() as {
      symptoms?: unknown;
      species?: unknown;
      breed?: unknown;
      biomarkers?: unknown;
      maxCandidates?: unknown;
    };

    const symptoms = Array.isArray(body.symptoms)
      ? body.symptoms.filter((symptom): symptom is string => typeof symptom === 'string')
      : [];

    if (symptoms.length === 0) {
      const res = NextResponse.json(
        { data: null, error: { code: 'bad_request', message: 'symptoms[] required' } },
        { status: 400 },
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const result = buildGbsReadinessProblem({
      symptoms,
      species: typeof body.species === 'string' ? body.species : undefined,
      breed: typeof body.breed === 'string' ? body.breed : null,
      biomarkers: body.biomarkers && typeof body.biomarkers === 'object'
        ? body.biomarkers as Record<string, number | string>
        : null,
      maxCandidates: typeof body.maxCandidates === 'number' ? body.maxCandidates : undefined,
    });

    const res = NextResponse.json(
      {
        data: result,
        meta: { timestamp: new Date().toISOString(), request_id: requestId },
        error: null,
      },
      { status: 200 },
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      { data: null, error: { code: 'internal_error', message: String(err) } },
      { status: 500 },
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}
