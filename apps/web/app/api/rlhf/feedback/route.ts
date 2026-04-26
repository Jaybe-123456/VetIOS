/**
 * POST /api/rlhf/feedback
 *
 * Vet feedback submission endpoint.
 * Every correction, confirmation, or outcome report feeds the RLHF flywheel.
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { getRLHFEngine } from '@/lib/rlhf/rlhfEngine';
import type { VetFeedbackInput } from '@/lib/rlhf/rlhfEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    const { tenantId } = await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const body = (await req.json()) as Partial<VetFeedbackInput>;

    // Validate required fields
    const required: Array<keyof VetFeedbackInput> = [
      'inferenceEventId', 'feedbackType', 'species', 'labelType',
    ];
    const missing = required.filter((k) => !body[k]);
    if (missing.length > 0) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: `Missing required fields: ${missing.join(', ')}` } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const engine = getRLHFEngine();
    const result = await engine.processFeedback({
      inferenceEventId: body.inferenceEventId!,
      tenantId: tenantId ?? "",
      patientId: body.patientId ?? null,
      feedbackType: body.feedbackType!,
      predictedDiagnosis: body.predictedDiagnosis ?? null,
      actualDiagnosis: body.actualDiagnosis ?? null,
      predictedConfidence: body.predictedConfidence ?? 0.5,
      vetConfidence: body.vetConfidence ?? 0.9,
      species: body.species!,
      breed: body.breed ?? null,
      ageYears: body.ageYears ?? null,
      region: body.region ?? null,
      extractedFeatures: body.extractedFeatures ?? {},
      vetNotes: body.vetNotes ?? null,
      labelType: body.labelType!,
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
  } catch (err) {
    const res = NextResponse.json(
      {
        error: {
          code: 'internal_error',
          message: err instanceof Error ? err.message : 'RLHF feedback processing failed',
        },
      },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}
