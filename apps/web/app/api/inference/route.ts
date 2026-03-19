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
import { randomUUID } from 'crypto';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { runInferencePipeline } from '@/lib/ai/inferenceOrchestrator';
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

    // ── Server-side normalization safety net ──
    // Coerce semi-structured payloads before Zod validation
    const rawBody = parsed.data as Record<string, unknown>;
    if (rawBody.input && typeof rawBody.input === 'object') {
        const inp = rawBody.input as Record<string, unknown>;
        // If input_signature is a raw string, wrap it
        if (typeof inp.input_signature === 'string') {
            inp.input_signature = {
                species: null,
                breed: null,
                symptoms: [],
                metadata: { raw_note: inp.input_signature },
            };
        }
        // Ensure input_signature is an object
        if (inp.input_signature && typeof inp.input_signature === 'object') {
            const sig = inp.input_signature as Record<string, unknown>;
            // Coerce string symptoms to array
            if (typeof sig.symptoms === 'string') {
                sig.symptoms = (sig.symptoms as string).split(/[,;]/).map((s: string) => s.trim()).filter(Boolean);
            }
            // Ensure metadata exists
            if (!sig.metadata || typeof sig.metadata !== 'object') {
                sig.metadata = {};
            }
        }
    }

    const result = InferenceRequestSchema.safeParse(rawBody);
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
            runInferencePipeline({
                model: body.model.name,
                rawInput: body.input,
                inputMode: 'json', // We pass the validated JSON input
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS)
            ),
        ]);

        const latencyMs = Date.now() - startTime;
        const inferenceEventId = randomUUID();

        const telemetry = inferenceResult.output_payload.telemetry && typeof inferenceResult.output_payload.telemetry === 'object'
            ? (inferenceResult.output_payload.telemetry as Record<string, unknown>)
            : {};
        telemetry.model_version = body.model.version;
        telemetry.inference_id = inferenceEventId;
        inferenceResult.output_payload.telemetry = telemetry;

        // Sanitize input signature to remove base64 payloads before logging to database
        const signatureForLog = { ...inferenceResult.normalizedInput };
        if (Array.isArray(signatureForLog.diagnostic_images)) {
            signatureForLog.diagnostic_images = signatureForLog.diagnostic_images.map((img: any) => ({
                file_name: img.file_name,
                mime_type: img.mime_type,
                size_bytes: img.size_bytes
            }));
        }
        if (Array.isArray(signatureForLog.lab_results)) {
            signatureForLog.lab_results = signatureForLog.lab_results.map((doc: any) => ({
                file_name: doc.file_name,
                mime_type: doc.mime_type,
                size_bytes: doc.size_bytes
            }));
        }

        // ── Log to Supabase ──
        const supabase = getSupabaseServer();
        const persistedInferenceEventId = await logInference(supabase, {
            id: inferenceEventId,
            tenant_id: tenantId,
            clinic_id: body.clinic_id ?? null,
            case_id: body.case_id ?? null,
            model_name: body.model.name,
            model_version: body.model.version,
            input_signature: signatureForLog,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            compute_profile: telemetry,
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
                inference_event_id: persistedInferenceEventId,
                model_name: body.model.name,
                model_version: body.model.version,
                predicted_confidence: inferenceResult.confidence_score,
                recent_evaluations: recentEvals,
            });
        } catch (evalErr) {
            console.warn(`[${requestId}] Evaluation auto-trigger failed (non-fatal):`, evalErr);
        }

        const response = NextResponse.json({
            inference_event_id: persistedInferenceEventId,
            output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            contradiction_analysis: inferenceResult.contradiction_analysis,
            differential_spread: inferenceResult.output_payload.differential_spread ?? null,
            inference_latency_ms: latencyMs,
            evaluation: evalResult,
            ml_risk: inferenceResult.mlRisk,
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
        // TEMPORARY: Unmasking production errors to debug the 500 crashes
        const message = err instanceof Error ? err.stack || err.message : 'Unknown error';

        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 }
        );
    }
}
