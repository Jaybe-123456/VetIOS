/**
 * POST /api/inference
 *
 * Runs AI inference, logs it to ai_inference_events, returns result.
 *
 * Protections:
 *   - Rate limit: 10 req/min per IP
 *   - Zod schema validation
 *   - Request ID tracing
 *   - AI provider timeout (15s)
 *   - Error sanitization (no stack traces in production)
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { runInference } from '@/lib/ai/provider';
import { logInference } from '@/lib/logging/inferenceLogger';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { InferenceRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';

const AI_TIMEOUT_MS = 55_000;

export async function POST(req: Request) {
    // ── Guard: rate limit + size ──
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    // ── Auth ──
    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 }
        );
    }
    const tenantId = session?.tenantId || 'dev_tenant_001';

    // ── Parse + validate ──
    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json(
            { error: parsed.error, request_id: requestId },
            { status: 400 }
        );
    }

    const result = InferenceRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 }
        );
    }
    const body = result.data;

    try {
        // ── AI inference with timeout ──
        const inferenceResult = await Promise.race([
            runInference({
                model: body.model.name,
                input_signature: body.input.input_signature,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS)
            ),
        ]);

        const latencyMs = Date.now() - startTime;

        // Sanitize input signature to remove base64 payloads before logging to database
        const signatureForLog = { ...body.input.input_signature };
        if (Array.isArray(signatureForLog.diagnostic_images)) {
            signatureForLog.diagnostic_images = signatureForLog.diagnostic_images.map(img => ({
                file_name: img.file_name,
                mime_type: img.mime_type,
                size_bytes: img.size_bytes
            }));
        }
        if (Array.isArray(signatureForLog.lab_results)) {
            signatureForLog.lab_results = signatureForLog.lab_results.map(doc => ({
                file_name: doc.file_name,
                mime_type: doc.mime_type,
                size_bytes: doc.size_bytes
            }));
        }

        // ── Log to Supabase ──
        const supabase = getSupabaseServer();
        const inferenceEventId = await logInference(supabase, {
            tenant_id: tenantId,
            clinic_id: body.clinic_id ?? null,
            case_id: body.case_id ?? null,
            model_name: body.model.name,
            model_version: body.model.version,
            input_signature: signatureForLog,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
        });

        // ── Evaluation (non-blocking) ──
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
            console.warn(`[${requestId}] Evaluation auto-trigger failed (non-fatal):`, evalErr);
        }

        // ── ML Risk enrichment (non-blocking) ──
        let mlRisk = null;
        try {
            const { mlPredict } = await import('@/lib/ml/mlClient');
            mlRisk = await mlPredict({
                decision_count: 1,
                override_count: 0,
                species: (body.input.input_signature as Record<string, string>).species || 'canine',
            });
        } catch (mlErr) {
            console.warn(`[${requestId}] ML risk enrichment failed (non-fatal):`, mlErr);
        }

        const response = NextResponse.json({
            inference_event_id: inferenceEventId,
            output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
            evaluation: evalResult,
            ml_risk: mlRisk,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        console.error(`[${requestId}] POST /api/inference Error:`, err);

        // ── Timeout ──
        if (err instanceof Error && err.message === 'AI_TIMEOUT') {
            return NextResponse.json(
                { error: 'AI inference timed out', request_id: requestId },
                { status: 504 }
            );
        }

        // ── Sanitized error ──
        const message = process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err instanceof Error ? err.message : 'Unknown error';

        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 }
        );
    }
}
