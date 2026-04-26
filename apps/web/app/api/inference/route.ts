/**
 * POST /api/inference
 *
 * Runs routed AI inference, logs it to ai_inference_events, returns result.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
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
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { evaluateGovernancePolicyForInference } from '@/lib/platform/governance';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { recordPlatformTelemetry } from '@/lib/platform/telemetry';
import { runInferenceFlywheel } from '@/lib/platform/flywheel';
import { dispatchWebhookEvent } from '@/lib/platform/webhooks';
import { evaluateInferenceReliability } from '@/lib/cire/engine';
import type { PlatformActor } from '@/lib/platform/types';
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

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();

    try {
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['inference:write'],
            requestedTenantId: new URL(req.url).searchParams.get('tenant_id'),
        });

        const url = new URL(req.url);
        const countOnly = url.searchParams.get('count') === 'true';
        const requestedScope = url.searchParams.get('scope');
        const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '20'), 100));
        const sort = url.searchParams.get('sort') ?? 'created_at:desc';
        const ascending = sort.endsWith(':asc');

        if (requestedScope === 'all' && actor.role !== 'system_admin') {
            throw new PlatformAuthError(403, 'system_admin_required', 'scope=all requires a system_admin actor.');
        }

        let query = countOnly
            ? supabase
                .from('ai_inference_events')
                .select('id', { count: 'exact', head: true })
            : supabase
                .from('ai_inference_events')
                .select('id,tenant_id,model_name,model_version,input_signature,output_payload,confidence_score,created_at,flagged,flag_reason,blocked')
                .order('created_at', { ascending })
                .limit(limit);

        if (requestedScope !== 'all' || actor.role !== 'system_admin' || tenantId) {
            query = query.eq('tenant_id', tenantId);
        }

        const { data, error, count } = await query;
        if (error) {
            throw error;
        }

        const response = NextResponse.json({
            data: countOnly ? { count: count ?? 0 } : data ?? [],
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
                request_id: requestId,
            },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = error instanceof PlatformRateLimitError
            ? NextResponse.json({
                data: buildRateLimitErrorPayload(error),
                meta: {
                    tenant_id: error.tenantId,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error.code,
                    message: error.message,
                },
            }, { status: error.status })
            : NextResponse.json({
                data: null,
                meta: {
                    tenant_id: null,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error instanceof PlatformAuthError ? error.code : 'inference_list_failed',
                    message: error instanceof Error ? error.message : 'Failed to load inference events.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    let actor: PlatformActor;
    let tenantId: string | null;
    try {
        const context = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['inference:write'],
            rateLimitKind: 'inference',
        });
        actor = context.actor;
        tenantId = context.tenantId;
    } catch (error) {
        if (error instanceof PlatformRateLimitError) {
            return NextResponse.json(
                buildRateLimitErrorPayload(error),
                { status: error.status },
            );
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unauthorized', request_id: requestId },
            { status: error instanceof PlatformAuthError ? error.status : 401 },
        );
    }

    if (!tenantId) {
        return NextResponse.json(
            { error: 'tenant_id is required for inference requests.', request_id: requestId },
            { status: 400 },
        );
    }

    const userId = actor.userId;

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
    const governanceDecision = await evaluateGovernancePolicyForInference(supabase, {
        actor,
        tenantId,
        requestBody: rawBody,
    });

    if (governanceDecision.decision === 'block') {
        await recordPlatformTelemetry(supabase, {
            telemetry_key: `blocked:${tenantId}:${requestId}`,
            inference_event_id: null,
            tenant_id: tenantId,
            pipeline_id: 'governance',
            model_version: body.model.version,
            latency_ms: 0,
            token_count_input: governanceDecision.tokenCount,
            token_count_output: 0,
            outcome_linked: false,
            evaluation_score: null,
            flagged: false,
            blocked: true,
            timestamp: new Date().toISOString(),
            metadata: {
                policy_id: governanceDecision.policyId,
                reason: governanceDecision.reason,
            },
        }).catch((error) => {
            console.error(`[${requestId}] Failed to emit blocked-governance telemetry:`, error);
        });

        await dispatchWebhookEvent(supabase, {
            tenantId,
            eventType: 'inference.blocked',
            payload: {
                policy_id: governanceDecision.policyId,
                reason: governanceDecision.reason,
                request_id: requestId,
                model_version: body.model.version,
            },
        }).catch((error) => {
            console.error(`[${requestId}] Failed to dispatch blocked-governance webhook:`, error);
        });

        return NextResponse.json(
            {
                blocked: true,
                reason: governanceDecision.reason,
                policy_id: governanceDecision.policyId,
                request_id: requestId,
            },
            { status: 403 },
        );
    }

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
            blocked: false,
            flagged: governanceDecision.flagged,
            flag_reason: governanceDecision.reason,
            blocked_reason: null,
            governance_policy_id: governanceDecision.policyId,
            orphaned: false,
            orphaned_at: null,
            species: typeof inferenceResult.normalizedInput?.species === 'string' ? inferenceResult.normalizedInput.species : null,
            top_diagnosis: (() => { try { const d = inferenceResult.output_payload?.diagnosis as Record<string,unknown>; const diffs = Array.isArray(d?.top_differentials) ? d.top_differentials as Array<Record<string,unknown>> : []; return String(diffs[0]?.name ?? diffs[0]?.condition ?? d?.top_diagnosis ?? ''); } catch { return null; } })(),
            contradiction_score: typeof inferenceResult.uncertainty_metrics?.contradiction_score === 'number' ? inferenceResult.uncertainty_metrics.contradiction_score as number : null,
            outcome_confirmed: false,
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

        let flywheelEvaluation:
            | {
                outcome: { id: string; status: string };
                evaluation: { id: string; score: number; dataset_version: number | null };
            }
            | null = null;
        let flywheelError: string | null = null;

        try {
            const tokenCountInput = estimateTokenCount(rawBody);
            const tokenCountOutput = estimateTokenCount(inferenceResult.output_payload);
            const flywheelResult = await runInferenceFlywheel(supabase, {
                actor,
                tenantId,
                inferenceEventId: persistedInferenceEventId,
                modelName: routedModel.model_name,
                modelVersion: routedModel.model_version,
                outputPayload: inferenceResult.output_payload,
                rawOutput: JSON.stringify(inferenceResult.output_payload),
                confidenceScore: inferenceResult.confidence_score ?? null,
                latencyMs,
                tokenCountInput,
                tokenCountOutput,
                flagged: governanceDecision.flagged,
                blocked: false,
                flagReason: governanceDecision.reason,
                pipelineId: 'inference',
                metadata: {
                    request_id: requestId,
                    case_id: canonicalClinicalCase.id,
                },
            });
            flywheelEvaluation = {
                outcome: {
                    id: flywheelResult.outcome.id,
                    status: flywheelResult.outcome.status,
                },
                evaluation: {
                    id: flywheelResult.evaluation.id,
                    score: flywheelResult.evaluation.score,
                    dataset_version: flywheelResult.evaluation.dataset_version,
                },
            };
        } catch (error) {
            flywheelError = error instanceof Error
                ? error.message
                : 'Automatic flywheel processing failed.';
            console.error(`[${requestId}] Inference flywheel failed:`, error);
        }

        const cireResult = await evaluateInferenceReliability(supabase, {
            inferenceId: persistedInferenceEventId,
            tenantId,
            actor,
            inputPayload: rawBody,
            outputPayload: inferenceResult.output_payload,
            modelVersion: routedModel.model_version,
        });
        const cirePayload = {
            phi_hat: cireResult.snapshot.phi_hat,
            cps: cireResult.snapshot.cps,
            safety_state: cireResult.snapshot.safety_state,
            reliability_badge: cireResult.snapshot.reliability_badge,
            input_quality: cireResult.input_quality,
            incident_id: cireResult.incident?.id ?? null,
            available: cireResult.available,
            unavailable_reason: cireResult.unavailable_reason,
        };

        runDetachedEffects(requestId, [
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
                            cire: cirePayload,
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
                            cire: cirePayload,
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

        const responseData = {
            inference_event_id: persistedInferenceEventId,
            clinical_case_id: finalizedClinicalCase.id,
            episode_id: episodeId,
            episode_reconcile_error: episodeReconcileError,
            output: inferenceResult.output_payload,
            differentials: Array.isArray(asRecord(inferenceResult.output_payload.diagnosis).top_differentials)
                ? asRecord(inferenceResult.output_payload.diagnosis).top_differentials
                : [],
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
            evaluation: flywheelEvaluation?.evaluation ?? null,
            auto_outcome: flywheelEvaluation?.outcome ?? null,
            flywheel_error: flywheelError,
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
        };

        if (cirePayload.available !== false && cirePayload.safety_state === 'blocked') {
            const response = NextResponse.json({
                inference_event_id: persistedInferenceEventId,
                clinical_case_id: finalizedClinicalCase.id,
                episode_id: episodeId,
                episode_reconcile_error: episodeReconcileError,
                prediction: null,
                output: null,
                data: null,
                cire: {
                    phi_hat: cirePayload.phi_hat,
                    cps: cirePayload.cps,
                    safety_state: 'blocked' as const,
                    reliability_badge: 'SUPPRESSED' as const,
                    incident_id: cirePayload.incident_id,
                },
                meta: {
                    tenant_id: tenantId,
                    timestamp: new Date().toISOString(),
                    request_id: requestId,
                    inference_id: persistedInferenceEventId,
                },
                error: {
                    code: 'INFERENCE_SUPPRESSED',
                    message: `Output suppressed by CIRE safety layer. Collapse proximity score: ${cirePayload.cps}. Manual review required.`,
                },
                request_id: requestId,
            }, { status: 200 });
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        const response = NextResponse.json({
            inference_event_id: persistedInferenceEventId,
            clinical_case_id: finalizedClinicalCase.id,
            episode_id: episodeId,
            episode_reconcile_error: episodeReconcileError,
            prediction: inferenceResult.output_payload,
            output: inferenceResult.output_payload,
            data: responseData,
            cire: cirePayload,
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                request_id: requestId,
                inference_id: persistedInferenceEventId,
            },
            error: null,
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
            evaluation: flywheelEvaluation?.evaluation ?? null,
            auto_outcome: flywheelEvaluation?.outcome ?? null,
            flywheel_error: flywheelError,
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

function estimateTokenCount(value: unknown) {
    return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
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

function runDetachedEffects(
    requestId: string,
    effects: Promise<unknown>[],
) {
    void Promise.all(effects).catch((error) => {
        console.error(`[${requestId}] Detached inference effects failed:`, error);
    });
}
