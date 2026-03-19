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
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { runInferencePipeline } from '@/lib/ai/inferenceOrchestrator';
import { logInference } from '@/lib/logging/inferenceLogger';
import { logSimulation } from '@/lib/logging/simulationLogger';
import {
    createSupabaseClinicalCaseStore,
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterInference,
} from '@/lib/clinicalCases/clinicalCaseManager';
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
    const tenantId = session?.tenantId || process.env.VETIOS_DEV_TENANT_ID || 'dev_tenant_001';

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

        // ── FIX: Neutralize target bias ──
        // Strip target_disease from inference payload so it does NOT influence the prediction.
        // Preserve it separately for post-hoc evaluation only.
        const targetDisease = inputSignature.target_disease ?? inputSignature.target_rare_disease_profile ?? null;
        delete inputSignature.target_disease;
        delete inputSignature.target_rare_disease_profile;

        // ── AI inference with timeout ──
        const inferenceResult = await Promise.race([
            runInferencePipeline({
                model: body.inference.model,
                rawInput: inputSignature,
                inputMode: 'json',
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS)
            ),
        ]);

        const latencyMs = Date.now() - startTime;
        const supabase = getSupabaseServer();
        const inferenceEventId = randomUUID();
        const simulationEventId = randomUUID();

        const telemetry = inferenceResult.output_payload.telemetry && typeof inferenceResult.output_payload.telemetry === 'object'
            ? (inferenceResult.output_payload.telemetry as Record<string, unknown>)
            : {};
        telemetry.model_version = body.inference.model_version ?? body.inference.model;
        telemetry.inference_id = inferenceEventId;
        telemetry.simulation_id = simulationEventId;
        inferenceResult.output_payload.telemetry = telemetry;

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

        // ── Log inference ──
        const caseStore = createSupabaseClinicalCaseStore(supabase);
        const observedAt = new Date().toISOString();
        const canonicalClinicalCase = await ensureCanonicalClinicalCase(caseStore, {
            tenantId,
            clinicId: null,
            requestedCaseId: null,
            inputSignature: signatureForLog,
            observedAt,
        });
        const triggeredInferenceId = await logInference(supabase, {
            id: inferenceEventId,
            tenant_id: tenantId,
            case_id: canonicalClinicalCase.id,
            model_name: body.inference.model,
            model_version: body.inference.model_version ?? body.inference.model,
            input_signature: signatureForLog,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            compute_profile: telemetry,
            inference_latency_ms: latencyMs,
        });
        await finalizeClinicalCaseAfterInference(
            caseStore,
            canonicalClinicalCase,
            triggeredInferenceId,
            observedAt,
        );
        revalidatePath('/dataset');

        // ── Log simulation ──
        const persistedSimulationEventId = await logSimulation(supabase, {
            id: simulationEventId,
            simulation_type: body.simulation.type,
            simulation_parameters: body.simulation.parameters,
            triggered_inference_id: triggeredInferenceId,
            stress_metrics: {
                ...inferenceResult.output_payload,
                contradiction_analysis: inferenceResult.contradiction_analysis,
            },
            is_real_world: false,
        });

        // ── Post-hoc target evaluation ──
        const parsedDiag = inferenceResult.output_payload.diagnosis as Record<string, unknown>;
        const differentialDiagnosis = parsedDiag && Array.isArray(parsedDiag.top_differentials)
            ? parsedDiag.top_differentials
            : [];
        const topDiagnosis = differentialDiagnosis[0]?.name ?? null;
        const targetMatch = targetDisease
            ? topDiagnosis?.toLowerCase().includes(String(targetDisease).toLowerCase()) ?? false
            : null;

        // Compute differential spread (how close top-3 are)
        const differentialSpread = (inferenceResult.output_payload.differential_spread as Record<string, unknown> | null) ?? (
            differentialDiagnosis.length >= 2
                ? {
                    top_1_probability: differentialDiagnosis[0]?.probability ?? null,
                    top_2_probability: differentialDiagnosis[1]?.probability ?? null,
                    top_3_probability: differentialDiagnosis[2]?.probability ?? null,
                    spread: Number(((differentialDiagnosis[0]?.probability ?? 0) - (differentialDiagnosis[1]?.probability ?? 0)).toFixed(3)),
                }
                : null
        );

        const response = NextResponse.json({
            simulation_event_id: persistedSimulationEventId,
            triggered_inference_event_id: triggeredInferenceId,
            clinical_case_id: canonicalClinicalCase.id,
            inference_output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            inference_latency_ms: latencyMs,
            // Enhanced adversarial metrics
            contradiction_analysis: inferenceResult.contradiction_analysis,
            differential_diagnosis: differentialDiagnosis,
            differential_spread: differentialSpread,
            target_evaluation: targetDisease ? {
                target_disease: targetDisease,
                top_diagnosis: topDiagnosis,
                target_matched_top: targetMatch,
            } : null,
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

        const message = err instanceof Error ? err.stack || err.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 }
        );
    }
}
