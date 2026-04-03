/**
 * POST /api/inference
 *
 * Runs routed AI inference, logs it to ai_inference_events, returns result.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runInferencePipeline } from '@/lib/ai/inferenceOrchestrator';
import { logInference } from '@/lib/logging/inferenceLogger';
import {
    fetchRecentClinicalIntegrityHistory,
    logClinicalIntegrityEvent,
} from '@/lib/logging/clinicalIntegrityLogger';
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
    createOutcomeNetworkRepository,
    reconcileEpisodeMembership,
} from '@/lib/outcomeNetwork/service';
import {
    beginTelemetryExecutionSample,
    emitTelemetryEvent,
    extractPredictionLabel,
    extractSystemTelemetry,
    finishTelemetryExecutionSample,
    resolveTelemetryRunId,
    telemetryInferenceEventId,
} from '@/lib/telemetry/service';
import { recordInferenceObservability } from '@/lib/telemetry/observability';
import { evaluateDecisionEngine } from '@/lib/decisionEngine/service';
import { evaluateClinicalIntegrity } from '@/lib/integrity/clinicalIntegrityEngine';
import {
    buildRoutingTelemetryMetadata,
    createRoutingDecisionRecord,
    executeRoutingPlan,
    failRoutingDecisionRecord,
    finalizeRoutingDecisionRecord,
    planModelRoute,
} from '@/lib/routingEngine/service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const AI_TIMEOUT_MS = 50_000;
const NON_CRITICAL_EFFECT_TIMEOUT_MS = 1_500;
const DECISION_ENGINE_TIMEOUT_MS = 1_000;

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }
    const { tenantId, userId } = auth.actor;

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
        const contradictionAnalysis = asRecord(inferenceResult.contradiction_analysis);
        const reasoningAlignment = asRecord(inferenceResult.output_payload.reasoning_alignment);

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

        const recentIntegrityHistoryPromise = fetchRecentClinicalIntegrityHistory(supabase, tenantId);
        const caseStore = createSupabaseClinicalCaseStore(supabase);
        const observedAt = new Date().toISOString();
        const canonicalClinicalCasePromise = ensureCanonicalClinicalCase(caseStore, {
            tenantId,
            userId,
            clinicId: body.clinic_id ?? null,
            requestedCaseId: body.case_id ?? null,
            sourceModule: 'inference_console',
            inputSignature: signatureForLog,
            observedAt,
        });
        const [recentIntegrityHistory, canonicalClinicalCase] = await Promise.all([
            recentIntegrityHistoryPromise,
            canonicalClinicalCasePromise,
        ]);
        const integrityEvaluation = evaluateClinicalIntegrity(
            {
                inputSignature: signatureForLog,
                outputPayload: inferenceResult.output_payload,
                confidenceScore: inferenceResult.confidence_score,
                uncertaintyMetrics: asNullableRecord(inferenceResult.uncertainty_metrics),
                contradictionAnalysis,
            },
            {
                recentHistory: recentIntegrityHistory,
            },
        );
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

        const finalizedClinicalCase = await finalizeClinicalCaseAfterInference(
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

        let episodeId: string | null = finalizedClinicalCase.episode_id ?? null;
        let episodeReconcileError: string | null = null;
        try {
            const episodeLink = await reconcileEpisodeMembership(
                createOutcomeNetworkRepository(supabase),
                {
                    tenantId,
                    clinicId: body.clinic_id ?? null,
                    caseId: finalizedClinicalCase.id,
                    observedAt,
                    primaryConditionClass: finalizedClinicalCase.primary_condition_class,
                    summaryPatch: {
                        latest_inference_event_id: persistedInferenceEventId,
                        latest_inference_at: observedAt,
                        latest_inference_model_version: routedModel.model_version,
                    },
                },
            );
            episodeId = episodeLink.episode.id;
        } catch (episodeError) {
            episodeReconcileError = episodeError instanceof Error
                ? episodeError.message
                : 'Failed to attach inference to episode.';
            console.warn(`[${requestId}] Episode reconciliation failed (non-fatal):`, episodeError);
        }

        await Promise.all([
            settleNonCriticalEffect(
                requestId,
                'Clinical integrity logging',
                logClinicalIntegrityEvent(supabase, {
                    inference_event_id: persistedInferenceEventId,
                    tenant_id: tenantId,
                    perturbation_score_m: integrityEvaluation.integrity.perturbation.m,
                    global_phi: integrityEvaluation.integrity.global_phi,
                    delta_phi: integrityEvaluation.integrity.instability.delta_phi,
                    curvature: integrityEvaluation.integrity.instability.curvature,
                    variance_proxy: integrityEvaluation.integrity.instability.variance_proxy,
                    divergence: integrityEvaluation.integrity.instability.divergence,
                    critical_instability_index: integrityEvaluation.integrity.instability.critical_instability_index,
                    state: integrityEvaluation.integrity.state,
                    collapse_risk: integrityEvaluation.integrity.collapse_risk,
                    precliff_detected: integrityEvaluation.integrity.precliff_detected,
                    details: {
                        perturbation: integrityEvaluation.integrity.perturbation,
                        capabilities: integrityEvaluation.integrity.capabilities,
                        instability: integrityEvaluation.integrity.instability,
                        precliff_detected: integrityEvaluation.integrity.precliff_detected,
                        safety_policy: integrityEvaluation.safetyPolicy,
                    },
                }),
                { timeoutMs: NON_CRITICAL_EFFECT_TIMEOUT_MS },
            ),
            settleNonCriticalEffect(
                requestId,
                'Telemetry emission',
                Promise.all([
                    emitTelemetryEvent(supabase, {
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
                            contradiction_triggers: Array.isArray(contradictionAnalysis.contradiction_reasons)
                                ? contradictionAnalysis.contradiction_reasons
                                : [],
                            persistence_rule_triggers: Array.isArray(inferenceResult.uncertainty_metrics?.persistence_rule_triggers)
                                ? inferenceResult.uncertainty_metrics?.persistence_rule_triggers
                                : [],
                            reasoning_missing_domains: Array.isArray(reasoningAlignment.missing_domains)
                                ? reasoningAlignment.missing_domains
                                : [],
                            reasoning_generic_fallback_bias: reasoningAlignment.generic_fallback_bias === true,
                            reasoning_hallucination_risk: reasoningAlignment.hallucination_risk === true,
                            pipeline_stage_completion: Array.isArray(inferenceResult.output_payload.pipeline_trace)
                                ? inferenceResult.output_payload.pipeline_trace
                                : [],
                            ...routingTelemetryMetadata,
                        },
                    }),
                    emitTelemetryEvent(supabase, {
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
                            contradiction_triggers: Array.isArray(contradictionAnalysis.contradiction_reasons)
                                ? contradictionAnalysis.contradiction_reasons
                                : [],
                            reasoning_missing_domains: Array.isArray(reasoningAlignment.missing_domains)
                                ? reasoningAlignment.missing_domains
                                : [],
                            reasoning_generic_fallback_bias: reasoningAlignment.generic_fallback_bias === true,
                            reasoning_hallucination_risk: reasoningAlignment.hallucination_risk === true,
                            pipeline_stage_completion: Array.isArray(inferenceResult.output_payload.pipeline_trace)
                                ? inferenceResult.output_payload.pipeline_trace
                                : [],
                            ...routingTelemetryMetadata,
                        },
                    }),
                ]),
                { timeoutMs: NON_CRITICAL_EFFECT_TIMEOUT_MS },
            ),
            settleNonCriticalEffect(
                requestId,
                'Observability aggregation',
                recordInferenceObservability(supabase, {
                    tenantId,
                    inferenceEventId: persistedInferenceEventId,
                    modelVersion: routedModel.model_version,
                    observedAt,
                    outputPayload: inferenceResult.output_payload,
                    confidenceScore: inferenceResult.confidence_score,
                    contradictionScore:
                        typeof contradictionAnalysis.contradiction_score === 'number'
                            ? contradictionAnalysis.contradiction_score
                            : null,
                }),
                { timeoutMs: NON_CRITICAL_EFFECT_TIMEOUT_MS },
            ),
            settleNonCriticalEffect(
                requestId,
                'Routing decision finalization',
                finalizeRoutingDecisionRecord(supabase, routingPlan, routingExecution, {
                    inferenceEventId: persistedInferenceEventId,
                    caseId: finalizedClinicalCase.id,
                    actualLatencyMs: measuredLatencyMs,
                    prediction: extractPredictionLabel(inferenceResult.output_payload),
                    predictionConfidence: inferenceResult.confidence_score,
                }),
            ),
            settleNonCriticalEffect(
                requestId,
                'Decision engine evaluation',
                evaluateDecisionEngine({
                    client: supabase,
                    tenantId,
                    triggerSource: 'inference',
                }),
                { timeoutMs: DECISION_ENGINE_TIMEOUT_MS },
            ),
        ]);

        const response = NextResponse.json({
            inference_event_id: persistedInferenceEventId,
            clinical_case_id: finalizedClinicalCase.id,
            episode_id: episodeId,
            episode_reconcile_error: episodeReconcileError,
            prediction: inferenceResult.output_payload,
            output: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score,
            uncertainty_metrics: inferenceResult.uncertainty_metrics,
            contradiction_analysis: inferenceResult.contradiction_analysis,
            differential_spread: inferenceResult.output_payload.differential_spread ?? null,
            inference_latency_ms: measuredLatencyMs,
            integrity: {
                perturbation_score_m: integrityEvaluation.integrity.perturbation.m,
                global_phi: integrityEvaluation.integrity.global_phi,
                state: integrityEvaluation.integrity.state,
                collapse_risk: integrityEvaluation.integrity.collapse_risk,
                precliff_detected: integrityEvaluation.integrity.precliff_detected,
                instability: integrityEvaluation.integrity.instability,
                capabilities: integrityEvaluation.integrity.capabilities.map((capability) => ({
                    name: capability.name,
                    phi: capability.phi,
                })),
            },
            safety_policy: integrityEvaluation.safetyPolicy,
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

        if (
            err instanceof Error
            && err.message.includes('Routing engine could not find an approved model candidate for this case.')
        ) {
            return NextResponse.json(
                { error: err.message, request_id: requestId },
                { status: 503 },
            );
        }

        const message = err instanceof Error ? err.message : 'Unknown error';
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

function asNullableRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

async function settleNonCriticalEffect(
    requestId: string,
    label: string,
    effect: Promise<unknown>,
    options: {
        timeoutMs?: number;
    } = {},
) {
    try {
        if (options.timeoutMs && options.timeoutMs > 0) {
            await Promise.race([
                effect,
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`${label} timed out after ${options.timeoutMs}ms`)), options.timeoutMs),
                ),
            ]);
            return;
        }

        await effect;
    } catch (error) {
        console.error(`[${requestId}] ${label} failed (non-fatal):`, error);
    }
}
