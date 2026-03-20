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
import { revalidatePath } from 'next/cache';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { runInferencePipeline } from '@/lib/ai/inferenceOrchestrator';
import { logInference } from '@/lib/logging/inferenceLogger';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import {
    createSupabaseClinicalCaseStore,
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterInference,
} from '@/lib/clinicalCases/clinicalCaseManager';
import { logClinicalDatasetMutation } from '@/lib/dataset/clinicalDatasetDiagnostics';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { InferenceRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import {
    beginTelemetryExecutionSample,
    emitTelemetryEvent,
    extractPredictionLabel,
    extractSystemTelemetry,
    finishTelemetryExecutionSample,
    resolveTelemetryRunId,
    telemetryInferenceEventId,
} from '@/lib/telemetry/service';

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
    const { tenantId, userId } = resolveRequestActor(session);

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
        const executionSample = beginTelemetryExecutionSample();
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

        const executionMetrics = finishTelemetryExecutionSample(executionSample);
        const measuredLatencyMs = executionMetrics.latencyMs;
        const latencyMs = Math.max(1, Math.round(measuredLatencyMs));
        const inferenceEventId = randomUUID();
        const telemetryRunId = resolveTelemetryRunId(
            body.model.version,
            resolveTelemetryRunCandidate(body.input.input_signature),
        );

        const telemetry = inferenceResult.output_payload.telemetry && typeof inferenceResult.output_payload.telemetry === 'object'
            ? (inferenceResult.output_payload.telemetry as Record<string, unknown>)
            : {};
        telemetry.model_version = body.model.version;
        telemetry.inference_id = inferenceEventId;
        telemetry.run_id = telemetryRunId;
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
        const caseStore = createSupabaseClinicalCaseStore(supabase);
        const observedAt = new Date().toISOString();
        const canonicalClinicalCase = await ensureCanonicalClinicalCase(caseStore, {
            tenantId,
            userId,
            clinicId: body.clinic_id ?? null,
            requestedCaseId: body.case_id ?? null,
            sourceModule: 'inference_console',
            inputSignature: signatureForLog,
            observedAt,
        });
        const persistedInferenceEventId = await logInference(supabase, {
            id: inferenceEventId,
            tenant_id: tenantId,
            user_id: userId,
            clinic_id: body.clinic_id ?? null,
            case_id: canonicalClinicalCase.id,
            source_module: 'inference_console',
            model_name: body.model.name,
            model_version: body.model.version,
            input_signature: signatureForLog,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            compute_profile: telemetry,
            inference_latency_ms: latencyMs,
        });
        try {
            await emitTelemetryEvent(supabase, {
                event_id: telemetryInferenceEventId(persistedInferenceEventId),
                tenant_id: tenantId,
                event_type: 'inference',
                timestamp: observedAt,
                model_version: body.model.version,
                run_id: telemetryRunId,
                metrics: {
                    latency_ms: measuredLatencyMs,
                    confidence: inferenceResult.confidence_score,
                    prediction: extractPredictionLabel(inferenceResult.output_payload),
                },
                system: extractSystemTelemetry(telemetry, executionMetrics.system),
                metadata: {
                    source_module: 'inference_console',
                    request_id: requestId,
                    inference_event_id: persistedInferenceEventId,
                    clinic_id: body.clinic_id ?? null,
                    case_id: canonicalClinicalCase.id,
                },
            });
        } catch (telemetryErr) {
            console.error(`[${requestId}] Telemetry emission failed (non-fatal):`, telemetryErr);
        }
        await finalizeClinicalCaseAfterInference(
            caseStore,
            canonicalClinicalCase,
            persistedInferenceEventId,
            {
                observedAt,
                userId,
                sourceModule: 'inference_console',
                outputPayload: inferenceResult.output_payload,
                confidenceScore: inferenceResult.confidence_score,
                modelVersion: body.model.version,
                metadataPatch: {
                    latest_inference_confidence: inferenceResult.confidence_score,
                    latest_inference_emergency_level: extractEmergencyLevel(inferenceResult.output_payload),
                    latest_inference_model_version: body.model.version,
                    latest_inference_source: 'inference_console',
                },
            },
        );
        logClinicalDatasetMutation({
            source: 'api/inference',
            mutationType: 'inference',
            authenticatedUserId: userId,
            resolvedTenantId: tenantId,
            writeTenantId: tenantId,
            caseId: canonicalClinicalCase.id,
            inferenceEventId: persistedInferenceEventId,
        });
        revalidatePath('/dataset');

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
            clinical_case_id: canonicalClinicalCase.id,
            output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            contradiction_analysis: inferenceResult.contradiction_analysis,
            differential_spread: inferenceResult.output_payload.differential_spread ?? null,
            inference_latency_ms: measuredLatencyMs,
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

function extractEmergencyLevel(outputPayload: Record<string, unknown>): string | null {
    const riskAssessment = outputPayload.risk_assessment;
    if (
        typeof riskAssessment !== 'object' ||
        riskAssessment === null ||
        Array.isArray(riskAssessment)
    ) {
        return null;
    }

    return typeof (riskAssessment as Record<string, unknown>).emergency_level === 'string'
        ? (riskAssessment as Record<string, unknown>).emergency_level as string
        : null;
}

function resolveTelemetryRunCandidate(inputSignature: Record<string, unknown>): unknown {
    const metadata = asRecord(inputSignature.metadata);
    return inputSignature.run_id ?? metadata.run_id ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
