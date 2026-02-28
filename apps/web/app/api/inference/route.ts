/**
 * POST /api/inference
 *
 * Runs AI inference, logs it to ai_inference_events, returns result.
 *
 * Critical rule: Log the inference EVERY TIME the model successfully returns.
 * Auth: Requires authenticated session. tenant_id = auth.uid().
 */

import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { runInference } from '@/lib/ai/provider';
import { logInference } from '@/lib/logging/inferenceLogger';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';

interface InferenceRequestBody {
    tenant_id?: string; // Deprecated: now derived from session
    clinic_id?: string;
    case_id?: string;
    model: {
        name: string;
        version: string;
    };
    input: {
        input_signature: Record<string, unknown>;
    };
}

export async function POST(req: Request) {
    // ── Auth check ──
    const session = await resolveSessionTenant();

    // ── DEV BYPASS: avoid 401 locally ──
    if (!session && process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tenantId = session?.tenantId || 'dev_tenant_001';

    // ── Safe JSON parse (returns 400, never 500) ──
    const parsed = await safeJson<InferenceRequestBody>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.data;

    try {
        // ── Validate required fields ──
        if (!body.model?.name || !body.model?.version) {
            return NextResponse.json(
                { error: 'Missing model.name or model.version' },
                { status: 400 },
            );
        }
        if (!body.input?.input_signature) {
            return NextResponse.json({ error: 'Missing input.input_signature' }, { status: 400 });
        }

        // ── Start timer ──
        const startTime = Date.now();

        // ── Call runInference (the ONLY place that touches the LLM) ──
        const inferenceResult = await runInference({
            model: body.model.name,
            input_signature: body.input.input_signature,
        });

        // ── Stop timer ──
        const latencyMs = Date.now() - startTime;

        // ── Log to ai_inference_events (service_role bypasses RLS for inserts) ──
        const supabase = getSupabaseServer();
        const inferenceEventId = await logInference(supabase, {
            tenant_id: tenantId,
            clinic_id: body.clinic_id ?? null,
            case_id: body.case_id ?? null,
            model_name: body.model.name,
            model_version: body.model.version,
            input_signature: body.input.input_signature,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
        });

        // ── Evaluation Engine: Auto-trigger baseline evaluation ──
        let evalResult = null;
        try {
            const recentEvals = await getRecentEvaluations(
                supabase, tenantId, body.model.name, 20,
            );
            evalResult = await createEvaluationEvent(supabase, {
                tenant_id: tenantId,
                trigger_type: 'inference',
                inference_event_id: inferenceEventId,
                model_name: body.model.name,
                model_version: body.model.version,
                predicted_confidence: inferenceResult.confidence_score,
                recent_evaluations: recentEvals,
            });
        } catch (evalErr) {
            console.warn('[POST /api/inference] Evaluation auto-trigger failed (non-fatal):', evalErr);
        }

        return NextResponse.json({
            inference_event_id: inferenceEventId,
            output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
            evaluation: evalResult,
        });
    } catch (err) {
        console.error('[POST /api/inference] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}

