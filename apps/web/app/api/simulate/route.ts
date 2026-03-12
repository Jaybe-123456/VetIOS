/**
 * POST /api/simulate
 *
 * Runs an adversarial simulation through the real inference pipeline.
 *
 * Protections:
 *   - Rate limit: 10 req/min per IP
 *   - Zod schema validation
 *   - Request ID tracing
 *   - AI provider timeout (15s)
 *   - Error sanitization
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { runInference } from '@/lib/ai/provider';
import { logInference } from '@/lib/logging/inferenceLogger';
import { logSimulation } from '@/lib/logging/simulationLogger';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { SimulateRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';

const AI_TIMEOUT_MS = 55_000;

export async function POST(req: Request) {
    // ── Guard ──
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

    const result = SimulateRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 }
        );
    }
    const body = result.data;

    try {
        const inputSignature: Record<string, unknown> = {
            simulation_type: body.simulation.type,
            ...body.simulation.parameters,
        };

        // ── AI inference with timeout ──
        const inferenceResult = await Promise.race([
            runInference({
                model: body.inference.model,
                input_signature: inputSignature,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS)
            ),
        ]);

        const latencyMs = Date.now() - startTime;
        const supabase = getSupabaseServer();

        const signatureForLog = { ...inputSignature };
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

        // ── Log inference ──
        const triggeredInferenceId = await logInference(supabase, {
            tenant_id: tenantId,
            model_name: body.inference.model,
            model_version: body.inference.model_version ?? body.inference.model,
            input_signature: signatureForLog,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            inference_latency_ms: latencyMs,
        });

        // ── Log simulation ──
        const simulationEventId = await logSimulation(supabase, {
            simulation_type: body.simulation.type,
            simulation_parameters: body.simulation.parameters,
            triggered_inference_id: triggeredInferenceId,
            stress_metrics: inferenceResult.output_payload,
            is_real_world: false,
        });

        const response = NextResponse.json({
            simulation_event_id: simulationEventId,
            triggered_inference_event_id: triggeredInferenceId,
            inference_output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            inference_latency_ms: latencyMs,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        console.error(`[${requestId}] POST /api/simulate Error:`, err);

        if (err instanceof Error && err.message === 'AI_TIMEOUT') {
            return NextResponse.json(
                { error: 'AI inference timed out', request_id: requestId },
                { status: 504 }
            );
        }

        const message = process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 }
        );
    }
}
