/**
 * POST /api/inference
 *
 * Runs routed AI inference, logs it to ai_inference_events, returns result.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { runInferencePipeline } from '@/lib/ai/inferenceOrchestrator';
import { logInference } from '@/lib/logging/inferenceLogger';
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
import { evaluateDecisionEngine } from '@/lib/decisionEngine/service';
import {
    buildRoutingTelemetryMetadata,
    createRoutingDecisionRecord,
    executeRoutingPlan,
    failRoutingDecisionRecord,
    finalizeRoutingDecisionRecord,
    planModelRoute,
} from '@/lib/routingEngine/service';

const AI_TIMEOUT_MS = 55_000;

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 },
        );
    }
    const { tenantId, userId } = resolveRequestActor(session);

    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json(
            { error: parsed.error, request_id: requestId },
            { status: 400 },
        );
    }

    const rawBody = parsed.data as Record<string, unknown>;
    if (rawBody.input && typeof rawBody.input === 'object') {
        const inp = rawBody.input as Record<string, unknown>;
        if (typeof inp.input_signature === 'string') {
            inp.input_signature = {
                species: null,
                breed: null,
                symptoms: [],
                metadata: { raw_note: inp.input_signature },
            };
        }
        if (inp.input_signature && typeof inp.input_signature === 'object') {
            const sig = inp.input_signature as Record<string, unknown>;
            if (typeof sig.symptoms === 'string') {
                sig.symptoms = (sig.symptoms as string)
                    .split(/[,;]/)
                    .map((entry: string) => entry.trim())
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
    let routingPlan: Awaited<ReturnType<typeof planModelRoute>> | null = null;

    try {
        const supabase = getSupabaseServer();
        routingPlan = await planModelRoute({
            client: supabase,
            tenantId,
            requestedModelName: body.model.name,
            requestedModelVersion: body.model.version,
            inputSignature: body.input.input_signature,
            caseId: body.case_id ?? null,
        });
        await createRoutingDecisionRecord(supabase, routingPlan, {
            caseId: body.case_id ?? null,
        });

        const executionSample = beginTelemetryExecutionSample();
        const routingExecution = await Promise.race([
            executeRoutingPlan({
                plan: routingPlan,
                executor: async (profile) => await runInferencePipeline({
                    model: profile.provider_model,
                    rawInput: body.input,
                    inputMode: 'json',
                }),
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS),
            ),
        ]);

        const inferenceResult = routingExecution.routed_output;
        const routedModel = routingExecution.selected_model;
        const routingTelemetryMetadata = buildRoutingTelemetryMetadata({
            plan: routingPlan,
            execution: routingExecution,
        });
        const executionMetrics = finishTelemetryExecutionSample(executionSample);
        const measuredLatencyMs = executionMetrics.latencyMs;
        const latencyMs = Math.max(1, Math.round(measuredLatencyMs));
        const inferenceEventId = randomUUID();
        const telemetryRunId = resolveTelemetryRunId(
            routedModel.model_version,
            resolveTelemetryRunCandidate(body.input.input_signature),
        );

        const telemetry = inferenceResult.output_payload.telemetry && typeof inferenceResult.output_payload.telemetry === 'object'
            ? (inferenceResult.output_payload.telemetry as Record<string, unknown>)
            : {};
        telemetry.model_version = routedModel.model_version;
        telemetry.model_name = routedModel.model_name;
        telemetry.provider_model = routedModel.provider_model;
        telemetry.inference_id = inferenceEventId;
        telemetry.run_id = telemetryRunId;
        Object.assign(telemetry, routingTelemetryMetadata);
        inferenceResult.output_payload.telemetry = telemetry;

        const signatureForLog = { ...inferenceResult.normalizedInput };
        if (Array.isArray(signatureForLog.diagnostic_images)) {
            signatureForLog.diagnostic_images = signatureForLog.diagnostic_images.map((img: any) => ({
                file_name: img.file_name,
                mime_type: img.mime_type,
                size_bytes: img.size_bytes,
            }));
        }
        if (Array.isArray(signatureForLog.lab_results)) {
            signatureForLog.lab_results = signatureForLog.lab_results.map((doc: any) => ({
                file_name: doc.file_name,
                mime_type: doc.mime_type,
                size_bytes: doc.size_bytes,
            }));
        }

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
            model_name: routedModel.model_name,
            model_version: routedModel.model_version,
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
                model_version: routedModel.model_version,
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
                    ...routingTelemetryMetadata,
                },
            });
            await emitTelemetryEvent(supabase, {
                event_id: `evt_routing_${routingPlan.routing_decision_id}`,
                tenant_id: tenantId,
                linked_event_id: telemetryInferenceEventId(persistedInferenceEventId),
                source_id: persistedInferenceEventId,
                source_table: 'ai_inference_events',
                event_type: 'system',
                timestamp: observedAt,
                model_version: routedModel.model_version,
                run_id: telemetryRunId,
                metrics: {
                    latency_ms: measuredLatencyMs,
                    confidence: inferenceResult.confidence_score,
                    prediction: extractPredictionLabel(inferenceResult.output_payload),
                },
                metadata: {
                    action: routingExecution.fallback_used
                        ? 'routing_fallback'
                        : routingExecution.route_mode === 'ensemble'
                            ? 'routing_ensemble'
                            : 'routing_decision',
                    source_module: 'inference_console',
                    request_id: requestId,
                    inference_event_id: persistedInferenceEventId,
                    case_id: canonicalClinicalCase.id,
                    ...routingTelemetryMetadata,
                },
            });
        } catch (telemetryErr) {
            console.error(`[${requestId}] Telemetry emission failed (non-fatal):`, telemetryErr);
        }

        await finalizeRoutingDecisionRecord(supabase, routingPlan, routingExecution, {
            inferenceEventId: persistedInferenceEventId,
            caseId: canonicalClinicalCase.id,
            actualLatencyMs: measuredLatencyMs,
            prediction: extractPredictionLabel(inferenceResult.output_payload),
            predictionConfidence: inferenceResult.confidence_score,
        });

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
                modelVersion: routedModel.model_version,
                metadataPatch: {
                    latest_inference_confidence: inferenceResult.confidence_score,
                    latest_inference_emergency_level: extractEmergencyLevel(inferenceResult.output_payload),
                    latest_inference_model_version: routedModel.model_version,
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

        try {
            await evaluateDecisionEngine({
                client: supabase,
                tenantId,
                triggerSource: 'inference',
            });
        } catch (decisionErr) {
            console.error(`[${requestId}] Decision engine evaluation failed (non-fatal):`, decisionErr);
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
            evaluation: null,
            ml_risk: inferenceResult.mlRisk,
            routing: {
                routing_decision_id: routingPlan.routing_decision_id,
                requested_model_name: body.model.name,
                requested_model_version: body.model.version,
                selected_model_id: routedModel.model_id,
                selected_model_name: routedModel.model_name,
                selected_provider_model: routedModel.provider_model,
                selected_model_version: routedModel.model_version,
                route_mode: routingExecution.route_mode,
                fallback_used: routingExecution.fallback_used,
                attempts: routingExecution.attempts,
                analysis: routingPlan.analysis,
                reason: routingPlan.reason,
            },
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        console.error(`[${requestId}] POST /api/inference Error:`, err);
        if (routingPlan) {
            try {
                const supabase = getSupabaseServer();
                await failRoutingDecisionRecord(
                    supabase,
                    routingPlan.routing_decision_id,
                    err instanceof Error ? err.message : 'Unknown routing execution failure',
                );
            } catch (routingErr) {
                console.error(`[${requestId}] Failed to mark routing decision as failed:`, routingErr);
            }
        }

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
