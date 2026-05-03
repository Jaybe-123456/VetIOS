/**
 * POST /api/agent/multi
 *
 * Multi-agent parallel case resolution.
 * Runs Triage → [Diagnostic + Lab + Treatment] → Synthesis → HITL Gate.
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { MultiAgentOrchestrator } from '@/lib/multiAgent/multiAgentOrchestrator';
import { getRAGPipeline } from '@/lib/rag/ragPipeline';
import { hydrateVKGFromDatabase } from '@/lib/vkg/veterinaryKnowledgeGraph';
import { getLiveCalibrationEngine } from '@/lib/calibration/liveCalibrationEngine';
import { getActiveLearningService } from '@/lib/activeLearning/activeLearningService';
import type { MultiAgentCaseInput } from '@/lib/multiAgent/multiAgentOrchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
  if (guard.blocked) return guard.response!;
  const { requestId, startTime } = guard;

  const supabase = getSupabaseServer();

  try {
    const { tenantId } = await requirePlatformRequestContext(req, supabase, {
      requiredScopes: ['inference:write'],
    });

    const body = (await req.json()) as Partial<MultiAgentCaseInput> & {
      auth_token?: string;
    };

    if (!body.species || !body.symptoms || !Array.isArray(body.symptoms)) {
      const res = NextResponse.json(
        { error: { code: 'bad_request', message: 'species and symptoms[] are required' } },
        { status: 400 }
      );
      withRequestHeaders(res.headers, requestId, startTime);
      return res;
    }

    const caseId = body.caseId ?? `case_${Date.now()}`;
    const authHeader = req.headers.get('Authorization') ?? '';
    const authToken = authHeader.replace('Bearer ', '');
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    // ── Build RAG context before agents run ──
    let ragContext = '';
    try {
      hydrateVKGFromDatabase(supabase).catch(() => {/* non-fatal */});
      const ragPipeline = getRAGPipeline();
      const ragResult = await ragPipeline.buildContext({
        species: body.species,
        breed: body.breed ?? null,
        age_years: body.ageYears ?? null,
        weight_kg: body.weightKg ?? null,
        symptoms: body.symptoms,
        biomarkers: body.biomarkers ?? null,
        region: body.region ?? null,
      });
      ragContext = ragResult.promptContext;
    } catch {
      ragContext = ''; // RAG failure is non-blocking
    }

    // ── Run multi-agent orchestration ──
    const orchestrator = new MultiAgentOrchestrator(baseUrl, authToken);
    const result = await orchestrator.resolveCase({
      caseId,
      tenantId: tenantId ?? "",
      species: body.species,
      breed: body.breed ?? null,
      ageYears: body.ageYears ?? null,
      weightKg: body.weightKg ?? null,
      symptoms: body.symptoms,
      biomarkers: body.biomarkers ?? null,
      hasImaging: body.hasImaging ?? false,
      urgency: body.urgency,
      ragContext,
      region: body.region,
    });

    // ── Apply live calibration to synthesis output ──
    let calibrationResult = null;
    if (result.synthesisOutput.primaryDiagnosis) {
      try {
        const calibrationEngine = getLiveCalibrationEngine();
        calibrationResult = await calibrationEngine.calibrate({
          rawConfidence: result.synthesisOutput.calibratedConfidence,
          species: body.species,
          breed: body.breed ?? null,
          diagnosis: result.synthesisOutput.primaryDiagnosis,
        });
        result.synthesisOutput.calibratedConfidence = calibrationResult.calibratedConfidence;
      } catch {
        // Calibration failure is non-blocking
      }
    }

    // ── Evaluate for active learning ──
    try {
      const alService = getActiveLearningService();
      const differentialProbs = result.synthesisOutput.differentials.map((d) => d.probability);
      await alService.evaluateForQueue({
        inferenceEventId: caseId,
        tenantId: tenantId ?? "",
        species: body.species,
        breed: body.breed ?? null,
        predictedDiagnosis: result.synthesisOutput.primaryDiagnosis,
        confidence: result.synthesisOutput.calibratedConfidence,
        differentialProbabilities: differentialProbs,
      });
    } catch {
      // Active learning failure is non-blocking
    }

    const res = NextResponse.json(
      {
        data: {
          ...result,
          calibration: calibrationResult,
          rag_context_used: ragContext.length > 0,
        },
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          agent_count: result.agentTasks.length,
          total_latency_ms: result.totalLatencyMs,
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
          message: err instanceof Error ? err.message : 'Multi-agent resolution failed',
        },
      },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}
