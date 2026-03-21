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
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { runInferencePipeline } from '@/lib/ai/inferenceOrchestrator';
import { logInference } from '@/lib/logging/inferenceLogger';
import { logSimulation } from '@/lib/logging/simulationLogger';
import {
    createSupabaseClinicalCaseStore,
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterInference,
    finalizeClinicalCaseAfterSimulation,
} from '@/lib/clinicalCases/clinicalCaseManager';
import { logClinicalDatasetMutation } from '@/lib/dataset/clinicalDatasetDiagnostics';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { SimulateRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import {
    beginTelemetryExecutionSample,
    emitTelemetryEvent,
    extractPredictionLabel,
    extractSystemTelemetry,
    finishTelemetryExecutionSample,
    resolveTelemetryRunId,
    telemetryInferenceEventId,
    telemetrySimulationEventId,
} from '@/lib/telemetry/service';
import { evaluateDecisionEngine } from '@/lib/decisionEngine/service';

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

    const result = SimulateRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 },
        );
    }
    const body = result.data;

    try {
        const inputSignature: Record<string, unknown> = {
            simulation_type: body.simulation.type,
            ...body.simulation.parameters,
        };

        const targetDisease = inputSignature.target_disease ?? inputSignature.target_rare_disease_profile ?? null;
        delete inputSignature.target_disease;
        delete inputSignature.target_rare_disease_profile;

        const executionSample = beginTelemetryExecutionSample();
        const inferenceResult = await Promise.race([
            runInferencePipeline({
                model: body.inference.model,
                rawInput: inputSignature,
                inputMode: 'json',
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS),
            ),
        ]);

        const executionMetrics = finishTelemetryExecutionSample(executionSample);
        const measuredLatencyMs = executionMetrics.latencyMs;
        const latencyMs = Math.max(1, Math.round(measuredLatencyMs));
        const supabase = getSupabaseServer();
        const inferenceEventId = randomUUID();
        const simulationEventId = randomUUID();
        const modelVersion = body.inference.model_version ?? body.inference.model;
        const telemetryRunId = resolveTelemetryRunId(modelVersion, resolveTelemetryRunCandidate(inputSignature));

        const telemetry = inferenceResult.output_payload.telemetry && typeof inferenceResult.output_payload.telemetry === 'object'
            ? (inferenceResult.output_payload.telemetry as Record<string, unknown>)
            : {};
        telemetry.model_version = modelVersion;
        telemetry.inference_id = inferenceEventId;
        telemetry.simulation_id = simulationEventId;
        telemetry.run_id = telemetryRunId;
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
            clinicId: null,
            requestedCaseId: null,
            sourceModule: 'adversarial_simulation',
            inputSignature: signatureForLog,
            observedAt,
        });
        const triggeredInferenceId = await logInference(supabase, {
            id: inferenceEventId,
            tenant_id: tenantId,
            user_id: userId,
            case_id: canonicalClinicalCase.id,
            source_module: 'adversarial_simulation',
            model_name: body.inference.model,
            model_version: modelVersion,
            input_signature: signatureForLog,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            compute_profile: telemetry,
            inference_latency_ms: latencyMs,
        });
        try {
            await emitTelemetryEvent(supabase, {
                event_id: telemetryInferenceEventId(triggeredInferenceId),
                tenant_id: tenantId,
                event_type: 'inference',
                timestamp: observedAt,
                model_version: modelVersion,
                run_id: telemetryRunId,
                metrics: {
                    latency_ms: measuredLatencyMs,
                    confidence: inferenceResult.confidence_score,
                    prediction: extractPredictionLabel(inferenceResult.output_payload),
                },
                system: extractSystemTelemetry(telemetry, executionMetrics.system),
                metadata: {
                    source_module: 'adversarial_simulation',
                    request_id: requestId,
                    inference_event_id: triggeredInferenceId,
                    simulation_event_id: simulationEventId,
                    case_id: canonicalClinicalCase.id,
                    simulation_type: body.simulation.type,
                    target_disease: targetDisease,
                    synthetic: true,
                },
            });
        } catch (telemetryErr) {
            console.error(`[${requestId}] Telemetry emission failed (non-fatal):`, telemetryErr);
        }
        const inferredClinicalCase = await finalizeClinicalCaseAfterInference(caseStore, canonicalClinicalCase, triggeredInferenceId, {
            observedAt,
            userId,
            sourceModule: 'adversarial_simulation',
            outputPayload: inferenceResult.output_payload,
            confidenceScore: inferenceResult.confidence_score,
            modelVersion: modelVersion,
            metadataPatch: {
                latest_inference_confidence: inferenceResult.confidence_score,
                latest_inference_emergency_level: extractEmergencyLevel(inferenceResult.output_payload),
                latest_inference_model_version: modelVersion,
                latest_inference_source: 'adversarial_simulation',
            },
        });

        const persistedSimulationEventId = await logSimulation(supabase, {
            id: simulationEventId,
            tenant_id: tenantId,
            user_id: userId,
            clinic_id: null,
            case_id: canonicalClinicalCase.id,
            source_module: 'adversarial_simulation',
            simulation_type: body.simulation.type,
            simulation_parameters: body.simulation.parameters,
            triggered_inference_id: triggeredInferenceId,
            stress_metrics: {
                ...inferenceResult.output_payload,
                contradiction_analysis: inferenceResult.contradiction_analysis,
            },
            is_real_world: false,
        });
        try {
            await emitTelemetryEvent(supabase, {
                event_id: telemetrySimulationEventId(persistedSimulationEventId),
                tenant_id: tenantId,
                linked_event_id: telemetryInferenceEventId(triggeredInferenceId),
                source_id: persistedSimulationEventId,
                source_table: 'edge_simulation_events',
                event_type: 'simulation',
                timestamp: observedAt,
                model_version: modelVersion,
                run_id: telemetryRunId,
                metrics: {
                    latency_ms: measuredLatencyMs,
                    confidence: inferenceResult.confidence_score,
                    prediction: typeof targetDisease === 'string' ? targetDisease : body.simulation.type,
                },
                system: extractSystemTelemetry(telemetry, executionMetrics.system),
                metadata: {
                    source_module: 'adversarial_simulation',
                    request_id: requestId,
                    inference_event_id: triggeredInferenceId,
                    simulation_event_id: persistedSimulationEventId,
                    case_id: canonicalClinicalCase.id,
                    simulation_type: body.simulation.type,
                    target_disease: targetDisease,
                    synthetic: true,
                },
            });
        } catch (telemetryErr) {
            console.error(`[${requestId}] Simulation telemetry emission failed (non-fatal):`, telemetryErr);
        }
        await finalizeClinicalCaseAfterSimulation(caseStore, inferredClinicalCase, persistedSimulationEventId, {
            observedAt,
            userId,
            sourceModule: 'adversarial_simulation',
            simulationType: body.simulation.type,
            stressMetrics: {
                ...inferenceResult.output_payload,
                contradiction_analysis: inferenceResult.contradiction_analysis,
            },
            metadataPatch: {
                latest_simulation_type: body.simulation.type,
                latest_simulation_timestamp: observedAt,
                latest_simulation_target_disease: targetDisease,
            },
        });
        logClinicalDatasetMutation({
            source: 'api/simulate',
            mutationType: 'simulation',
            authenticatedUserId: userId,
            resolvedTenantId: tenantId,
            writeTenantId: tenantId,
            caseId: canonicalClinicalCase.id,
            inferenceEventId: triggeredInferenceId,
            simulationEventId: persistedSimulationEventId,
        });
        revalidatePath('/dataset');
        try {
            await evaluateDecisionEngine({
                client: supabase,
                tenantId,
                triggerSource: 'simulation',
            });
        } catch (decisionErr) {
            console.error(`[${requestId}] Decision engine evaluation failed (non-fatal):`, decisionErr);
        }

        const parsedDiag = inferenceResult.output_payload.diagnosis as Record<string, unknown>;
        const differentialDiagnosis = parsedDiag && Array.isArray(parsedDiag.top_differentials)
            ? parsedDiag.top_differentials
            : [];
        const topDiagnosis = differentialDiagnosis[0]?.name ?? null;
        const targetMatch = targetDisease
            ? topDiagnosis?.toLowerCase().includes(String(targetDisease).toLowerCase()) ?? false
            : null;

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
            inference_latency_ms: measuredLatencyMs,
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
