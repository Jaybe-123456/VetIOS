/**
 * POST /api/inference (Refactor v2)
 *
 * Drop-in replacement for apps/web/app/api/inference/route.ts.
 *
 * What changed:
 *   - runInference() → runVetIOSInference() (new orchestrator)
 *   - Response includes emergency_level, abstain, contradiction_score, top_differentials
 *   - inference_event_id is UNCHANGED — all outcome injection compatibility preserved
 *   - adversarial simulation compatibility preserved (same logInference call)
 *   - All existing guard, auth, rate-limit, and telemetry logic preserved
 *
 * What did NOT change:
 *   - API path: POST /api/inference
 *   - Request schema: InferenceRequestSchema (extended with new optional fields)
 *   - inference_event_id generation (handled by logInference)
 *   - Supabase logging pattern
 *   - Evaluation engine trigger
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { runVetIOSInference } from '@/lib/ai/orchestrator';   // ← new import
import { logInference } from '@/lib/logging/inferenceLogger';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { InferenceRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';

const AI_TIMEOUT_MS = 55_000;

export async function POST(req: Request) {
    // ── Guard: rate limit + size ──────────────────────────────────────────────
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    // ── Auth ──────────────────────────────────────────────────────────────────
    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 },
        );
    }
    const tenantId = session?.tenantId || 'dev_tenant_001';

    // ── Parse + validate ──────────────────────────────────────────────────────
    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json(
            { error: parsed.error, request_id: requestId },
            { status: 400 },
        );
    }

    // Server-side normalisation (preserved from original)
    const rawBody = parsed.data as Record<string, unknown>;
    if (rawBody.input && typeof rawBody.input === 'object') {
        const inp = rawBody.input as Record<string, unknown>;
        if (typeof inp.input_signature === 'string') {
            inp.input_signature = {
                species:  null,
                breed:    null,
                symptoms: [],
                metadata: { raw_note: inp.input_signature },
            };
        }
        if (inp.input_signature && typeof inp.input_signature === 'object') {
            const sig = inp.input_signature as Record<string, unknown>;
            if (typeof sig.symptoms === 'string') {
                sig.symptoms = (sig.symptoms as string)
                    .split(/[,;]/)
                    .map((s: string) => s.trim())
                    .filter(Boolean);
            }
            if (!sig.metadata || typeof sig.metadata !== 'object') {
                sig.metadata = {};
            }
        }
    }

    const result = InferenceRequestSchema.safeParse(rawBody);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 },
        );
    }
    const body = result.data;

    try {
        // ── AI inference with timeout ─────────────────────────────────────────
        const inferenceResult = await Promise.race([
            runVetIOSInference({
                model:           body.model.name,
                input_signature: body.input.input_signature as Record<string, unknown>,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS),
            ),
        ]);

        const latencyMs = Date.now() - startTime;

        // Sanitise images/docs before logging (preserved from original)
        const signatureForLog = { ...body.input.input_signature };
        if (Array.isArray((signatureForLog as Record<string, unknown>).diagnostic_images)) {
            (signatureForLog as Record<string, unknown>).diagnostic_images =
                ((signatureForLog as Record<string, unknown>).diagnostic_images as Record<string, unknown>[])
                    .map((img) => ({
                        file_name:  img.file_name,
                        mime_type:  img.mime_type,
                        size_bytes: img.size_bytes,
                    }));
        }

        // ── Log to Supabase ───────────────────────────────────────────────────
        // inference_event_id is generated here — unchanged from original.
        const supabase = getSupabaseServer();
        const inferenceEventId = await logInference(supabase, {
            tenant_id:           tenantId,
            clinic_id:           body.clinic_id ?? null,
            case_id:             body.case_id ?? null,
            model_name:          body.model.name,
            model_version:       body.model.version,
            input_signature:     signatureForLog as Record<string, unknown>,
            output_payload:      inferenceResult.output_payload,
            confidence_score:    inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
        });

        // ── Evaluation trigger (non-blocking, preserved) ──────────────────────
        let evalResult = null;
        try {
            const recentEvals = await getRecentEvaluations(
                supabase, tenantId, body.model.name, 20,
            );
            evalResult = await createEvaluationEvent(supabase, {
                tenant_id:           tenantId,
                trigger_type:        'inference',
                inference_event_id:  inferenceEventId,
                model_name:          body.model.name,
                model_version:       body.model.version,
                predicted_confidence: inferenceResult.confidence_score,
                recent_evaluations:  recentEvals,
            });
        } catch (evalErr) {
            console.warn(`[${requestId}] Evaluation auto-trigger failed (non-fatal):`, evalErr);
        }

        // ── Convenience fields extracted from output for top-level response ───
        const output = inferenceResult.output_payload;
        const isV2   = output.schema_version === '2.0';

        const response = NextResponse.json({
            // ── Identity (unchanged) ──────────────────────────────────────────
            inference_event_id:  inferenceEventId,
            request_id:          requestId,

            // ── Legacy fields (preserved) ─────────────────────────────────────
            output:              output,
            confidence_score:    inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
            evaluation:          evalResult,

            // ── New v2 UI fields (Fix 3, 4, 5) ───────────────────────────────
            emergency_level:     isV2 ? output.emergency_level      : null,
            abstain:             isV2 ? output.abstain               : null,
            contradiction_score: isV2 ? output.contradiction_score   : null,
            top_differentials:   isV2 ? output.top_differentials     : null,

            // ── Clinician rationale for override (Fix 2) ──────────────────────
            override_rationale:  isV2
                ? (output.severity as Record<string, unknown>)?.override_rationale ?? null
                : null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;

    } catch (err) {
        console.error(`[${requestId}] POST /api/inference Error:`, err);

        if (err instanceof Error && err.message === 'AI_TIMEOUT') {
            return NextResponse.json(
                { error: 'AI inference timed out', request_id: requestId },
                { status: 504 },
            );
        }

        const message = err instanceof Error ? err.stack || err.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 },
        );
    }
}
