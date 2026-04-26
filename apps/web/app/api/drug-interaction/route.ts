/**
 * POST /api/drug-interaction
 *
 * Live drug-drug interaction and contraindication checking.
 * Replaces the stub query_drug_db tool in GaaS with real pharmacokinetic data.
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getDrugInteractionEngine } from '@/lib/drugInteraction/drugInteractionEngine';
import { getConstitutionalAI } from '@/lib/constitutionalAI/constitutionalAIEngine';
import type { DrugCheckRequest } from '@/lib/drugInteraction/drugInteractionEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  try {
    const body = (await req.json()) as Partial<DrugCheckRequest>;

    if (!body.drugs || !Array.isArray(body.drugs) || body.drugs.length === 0) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: 'drugs[] array is required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    if (!body.species) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: 'species is required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const engine = getDrugInteractionEngine();
    const result = engine.check({
      drugs: body.drugs,
      species: body.species,
      conditions: body.conditions ?? [],
      age_years: body.age_years ?? null,
      weight_kg: body.weight_kg ?? null,
    });

    // Run constitutional AI over treatment output
    const constitutionalAI = getConstitutionalAI();
    const safetyEval = constitutionalAI.evaluate(
      { drug_check: result } as Record<string, unknown>,
      {
        species: body.species,
        confidence_score: result.safeToAdminister ? 0.9 : 0.2,
        raw_output: result as unknown as Record<string, unknown>,
      }
    );

    const res = NextResponse.json(
      {
        data: {
          ...result,
          constitutional_safety: {
            decision: safetyEval.decision,
            violations: safetyEval.violations,
            requires_hitl: safetyEval.requiresHITL,
          },
        },
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          engine_version: 'vetios-drug-db-v2',
        },
      },
      { status: 200 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      {
        error: {
          code: 'internal_error',
          message: err instanceof Error ? err.message : 'Drug interaction check failed',
        },
      },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}

export async function GET(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const url = new URL(req.url);
  const drugId = url.searchParams.get('drug');

  if (!drugId) {
    const res = NextResponse.json(
      { error: { code: 'bad_request', message: '?drug= query param required' } },
      { status: 400 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }

  const engine = getDrugInteractionEngine();
  const profile = engine.getDrug(drugId);

  if (!profile) {
    const res = NextResponse.json(
      { error: { code: 'not_found', message: `Drug not found: ${drugId}` } },
      { status: 404 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }

  const res = NextResponse.json(
    { data: profile, meta: { timestamp: new Date().toISOString(), request_id: requestId } },
    { status: 200 }
  );
  withRequestHeaders(res.headers, requestId, startTime);
  return res;
}
