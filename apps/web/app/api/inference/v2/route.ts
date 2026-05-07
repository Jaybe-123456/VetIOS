/**
 * POST /api/inference/v2
 *
 * V2 inference endpoint accepting EncounterPayloadV2 with multisystemic,
 * species-gated diagnostic panels. Validates, flattens to structured text,
 * then delegates to the existing inference pipeline.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runInferencePipeline } from '@/lib/ai/inferenceOrchestrator';
import { logInference } from '@/lib/logging/inferenceLogger';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    beginTelemetryExecutionSample,
    finishTelemetryExecutionSample,
} from '@/lib/telemetry/service';
import { recordInferenceObservability } from '@/lib/telemetry/observability';
import { evaluateGovernancePolicyForInference } from '@/lib/platform/governance';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { recordPlatformTelemetry } from '@/lib/platform/telemetry';
import { evaluateInferenceReliability } from '@/lib/cire/engine';
import type { PlatformActor } from '@/lib/platform/types';
import { getRAGPipeline } from '@/lib/rag/ragPipeline';
import type { RAGContext } from '@/lib/rag/ragPipeline';
import {
    validateEncounterPayloadV2,
    validateSpeciesPanelGating,
    flattenPanelsToStructuredText,
    extractActiveSystems,
    buildCrossPanelSystemPromptBlock,
    type EncounterPayloadV2,
} from '@vetios/inference-schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

const AI_TIMEOUT_MS = 50_000;

/**
 * Map a V2 EncounterPayloadV2 into the V1 input_signature shape
 * so runInferencePipeline can consume it without changes.
 */
function mapV2ToV1InputSignature(
    payload: EncounterPayloadV2,
    structuredText: string,
    crossPanelPrompt: string,
) {
    const { patient, encounter } = payload;

    const diagnosticTests: Record<string, unknown> = {};
    for (const panel of payload.active_system_panels) {
        const activeTests: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(panel.tests)) {
            if (isPopulatedPanelValue(value)) {
                activeTests[key] = value;
            }
        }
        if (Object.keys(activeTests).length > 0) {
            diagnosticTests[`${panel.system}_${panel.panel}`] = activeTests;
        }
    }

    return {
        species: patient.species,
        breed: patient.breed,
        symptoms: encounter.presenting_complaints,
        presenting_signs: encounter.presenting_complaints,
        diagnostic_tests: diagnosticTests,
        history: {
            duration_days: encounter.history.duration_days,
            free_text: encounter.history.free_text,
            medications: encounter.history.medications,
        },
        preventive_history: null,
        physical_exam: {
            ...(encounter.vitals.temp_c != null ? { temperature: encounter.vitals.temp_c, temp_c: encounter.vitals.temp_c } : {}),
            ...(encounter.vitals.heart_rate_bpm != null ? { heart_rate: encounter.vitals.heart_rate_bpm, heart_rate_bpm: encounter.vitals.heart_rate_bpm } : {}),
            ...(encounter.vitals.respiratory_rate_bpm != null ? { respiratory_rate: encounter.vitals.respiratory_rate_bpm, respiratory_rate_bpm: encounter.vitals.respiratory_rate_bpm } : {}),
            ...(encounter.vitals.mm_colour != null ? { mucous_membrane_color: encounter.vitals.mm_colour, mm_colour: encounter.vitals.mm_colour } : {}),
            ...(encounter.vitals.crt_seconds != null ? { capillary_refill_time_s: encounter.vitals.crt_seconds, crt_seconds: encounter.vitals.crt_seconds } : {}),
        },
        region: null,
        weight_kg: patient.weight_kg,
        age_years: patient.age_years,
        sex: patient.sex,
        structured_input_text: structuredText,
        active_systems: extractActiveSystems(payload.active_system_panels),
        metadata: {
            model_family: 'diagnostics',
            route_hint: 'clinical_diagnosis',
            schema_version: 'v2',
            v2_payload: true,
            structured_input_text: structuredText,
            cross_panel_prompt: crossPanelPrompt,
            sex: patient.sex,
            age_years: patient.age_years,
            medications: encounter.history.medications,
            duration_days: encounter.history.duration_days,
            encounter_id: payload.metadata.encounter_id,
        },
        diagnostic_images: [],
        lab_results: [],
    };
}

function isPopulatedPanelValue(value: unknown): boolean {
    if (value === 'not_done') return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    return value != null;
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
            return NextResponse.json(buildRateLimitErrorPayload(error), { status: error.status });
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

    // Parse and validate V2 payload.

    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const rawBody = parsed.data as Record<string, unknown>;
    const validation = validateEncounterPayloadV2(rawBody);

    if (!validation.success) {
        return NextResponse.json(
            { error: `V2 payload validation failed: ${validation.error}`, request_id: requestId },
            { status: 400 },
        );
    }

    const payload = validation.data;

    // Enforce species-panel gating.

    const gatingViolations = validateSpeciesPanelGating(payload);
    if (gatingViolations.length > 0) {
        return NextResponse.json(
            {
                error: 'Species-panel gating violation',
                violations: gatingViolations,
                request_id: requestId,
            },
            { status: 422 },
        );
    }

    // Flatten panels to deterministic structured text.

    const structuredText = flattenPanelsToStructuredText(payload.active_system_panels);
    const activeSystems = extractActiveSystems(payload.active_system_panels);
    const crossPanelPrompt = buildCrossPanelSystemPromptBlock(
        payload.patient.species,
        payload.active_system_panels,
    );

    // Run governance checks before model execution.

    const governanceDecision = await evaluateGovernancePolicyForInference(supabase, {
        actor,
        tenantId,
        requestBody: rawBody,
    });

    if (governanceDecision.decision === 'block') {
        await recordPlatformTelemetry(supabase, {
            telemetry_key: `blocked:v2:${tenantId}:${requestId}`,
            inference_event_id: null,
            tenant_id: tenantId,
            pipeline_id: 'governance',
            model_version: 'v2',
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
        }).catch(() => {});

        return NextResponse.json(
            { blocked: true, reason: governanceDecision.reason, request_id: requestId },
            { status: 403 },
        );
    }

    // Build RAG context with a non-blocking 2 second cap.

    let ragCtx: RAGContext | null = null;
    try {
        ragCtx = await Promise.race([
            getRAGPipeline().buildContext({
                species: payload.patient.species,
                breed: payload.patient.breed,
                age_years: payload.patient.age_years,
                weight_kg: payload.patient.weight_kg,
                symptoms: payload.encounter.presenting_complaints,
                biomarkers: null,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('RAG_TIMEOUT')), 2_000),
            ),
        ]);
    } catch {
        // Non-critical: proceed without retrieval grounding.
    }

    // Map V2 payload to the existing V1 input signature.

    const v1InputSignature = mapV2ToV1InputSignature(payload, structuredText, crossPanelPrompt);

    if (ragCtx?.promptContext) {
        (v1InputSignature.metadata as Record<string, unknown>).rag_context = ragCtx.promptContext;
    }

    // Execute inference pipeline.

    const inferenceEventId = randomUUID();
    const executionSample = beginTelemetryExecutionSample();

    try {
        const inferenceResult = await Promise.race([
            runInferencePipeline({
                model: 'gpt-4o-mini',
                rawInput: { input_signature: v1InputSignature },
                inputMode: 'json',
                tenantId,
                patientId: null,
                inferenceEventId,
            }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS),
            ),
        ]);

        const executionMetrics = finishTelemetryExecutionSample(executionSample);
        const latencyMs = Math.max(1, Math.round(executionMetrics.latencyMs));

        // CIRE reliability evaluation.

        let cirePayload = null;
        try {
            const cireResult = await evaluateInferenceReliability(supabase, {
                inferenceId: inferenceEventId,
                tenantId,
                actor,
                inputPayload: rawBody as any,
                outputPayload: inferenceResult.output_payload,
                modelVersion: 'gpt-4o-mini',
            });
            cirePayload = {
                phi_hat: cireResult.snapshot.phi_hat,
                cps: cireResult.snapshot.cps,
                safety_state: cireResult.snapshot.safety_state,
                reliability_badge: cireResult.snapshot.reliability_badge,
                input_quality: cireResult.input_quality,
                incident_id: cireResult.incident?.id ?? null,
                available: cireResult.available,
                unavailable_reason: cireResult.unavailable_reason,
            };
        } catch {
            cirePayload = {
                available: false,
                unavailable_reason: 'cire_evaluation_failed',
            };
        }

        const contradiction = inferenceResult.contradiction_analysis && typeof inferenceResult.contradiction_analysis === 'object'
            ? inferenceResult.contradiction_analysis as Record<string, unknown>
            : null;
        const contradictionScore = typeof contradiction?.contradiction_score === 'number'
            ? contradiction.contradiction_score
            : null;
        // Log inference event with V2 audit columns.

        const eventId = await logInference(supabase, {
            id: inferenceEventId,
            tenant_id: tenantId,
            user_id: actor.userId ?? null,
            model_name: 'gpt-4o-mini',
            model_version: '1.0.0',
            input_signature: v1InputSignature,
            output_payload: inferenceResult.output_payload,
            confidence_score: inferenceResult.confidence_score ?? null,
            inference_latency_ms: latencyMs,
            source_module: 'inference_console_v2',
            species: payload.patient.species,
            structured_input_text: structuredText || null,
            active_systems: activeSystems.length > 0 ? activeSystems : null,
        });

        // Record observability signals without blocking the response.

        recordInferenceObservability(supabase, {
            inferenceEventId: eventId,
            tenantId,
            modelVersion: '1.0.0',
            observedAt: new Date().toISOString(),
            outputPayload: inferenceResult.output_payload,
            confidenceScore: inferenceResult.confidence_score ?? null,
            contradictionScore,
        }).catch(() => {});

        // Build response.

        const response = NextResponse.json({
            inference_event_id: eventId,
            data: {
                output: inferenceResult.output_payload,
            },
            structured_input_text: structuredText,
            active_systems: activeSystems,
            species: payload.patient.species,
            confidence_score: inferenceResult.confidence_score ?? null,
            cire: cirePayload,
            latency_ms: latencyMs,
            schema_version: 'v2',
            request_id: requestId,
        });

        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'V2 inference failed.';
        const isTimeout = errorMessage === 'AI_TIMEOUT';

        const response = NextResponse.json(
            {
                error: isTimeout
                    ? 'Inference timed out. The model did not respond within the allowed window.'
                    : errorMessage,
                request_id: requestId,
            },
            { status: isTimeout ? 504 : 500 },
        );

        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
