/**
 * POST /api/inference
 *
 * Runs AI inference, logs it to ai_inference_events, returns result.
 *
 * Critical rule: Log the inference EVERY TIME the model successfully returns.
 */

import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runInference } from '@/lib/ai/provider';
import { logInference } from '@/lib/logging/inferenceLogger';

interface InferenceRequestBody {
    tenant_id: string;
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
    // ── Safe JSON parse (returns 400, never 500) ──
    const parsed = await safeJson<InferenceRequestBody>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.data;

    try {
        // ── Validate required fields ──
        if (!body.tenant_id) {
            return NextResponse.json({ error: 'Missing tenant_id' }, { status: 400 });
        }
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

        // ── Log to ai_inference_events (automatic moat) ──
        const supabase = getSupabaseServer();
        const inferenceEventId = await logInference(supabase, {
            tenant_id: body.tenant_id,
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

        return NextResponse.json({
            inference_event_id: inferenceEventId,
            output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
        });
    } catch (err) {
        console.error('[POST /api/inference] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}
