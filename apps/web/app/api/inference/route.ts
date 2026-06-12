import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor, type ClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { checkRateLimit } from '@/lib/inference-rate-limit';
import { runInference } from '@/lib/vetios-inference';
import { enrichInputWithGraphPriors } from '@/lib/graph/inferencePriors';
import { runOptionalQuantumRanking } from '@/lib/quantum/inferenceRanking';
import { safeJson } from '@/lib/http/safeJson';
import { recordInferenceObservability } from '@/lib/telemetry/observability';
import {
    emitTelemetryEvent,
    extractPredictionLabel,
    resolveTelemetryRunId,
    telemetryInferenceEventId,
} from '@/lib/telemetry/service';
import {
    SupabaseWriteError,
    asRecord as asCoreRecord,
    isUuidV4,
    logApiCompleted,
    logApiReceived,
    logSupabaseFailure,
    readErrorCode,
    readErrorMessage,
    readString,
    retryAfterResponse,
} from '@/lib/api/corePipeline';
import type { InputSignature } from '@/lib/vetios-inference';
import { recordProductUsageEvent } from '@/lib/billing/entitlements';
import {
    createInferenceExecutionTraceContext,
    type InferenceExecutionTraceContext,
    type TraceSupabaseClient,
} from '@/lib/inference/executionTrace';
import { recordInferenceCalibrationSnapshot } from '@/lib/inference/calibrationSnapshot';

export const runtime = 'nodejs';

const InferenceRequestSchema = z.object({
    request_id: z.string().refine(isUuidV4, 'request_id must be a UUID v4'),
    model: z.object({
        name: z.string().min(1),
        version: z.string().min(1),
    }),
    input: z.object({
        input_signature: z.object({
            species: z.string().min(1),
            symptoms: z.array(z.string().min(1)).min(1),
            breed: z.string().min(1).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
        }).passthrough(),
    }),
    use_quantum: z.boolean().optional(),
});

export async function GET(req: Request) {
    const requestId = randomUUID();
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '20'), 100));
    const { data, error } = await supabase
        .from('ai_inference_events')
        .select('id, created_at, model_name, model_version, prompt_template_hash, prompt_template_version, schema_version, phi_hat, input_signature, output_payload, confidence_score, uncertainty_metrics, inference_latency_ms')
        .eq('tenant_id', auth.actor.tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        return NextResponse.json({ error: 'inference_list_failed', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
        data: (data ?? []).map(normalizeInferenceListRow),
        meta: {
            tenant_id: auth.actor.tenantId,
            request_id: requestId,
        },
        error: null,
    });
}

export async function POST(req: Request) {
    const startTime = Date.now();
    let requestId: string | null = null;
    let tenantId: string | null = null;
    let trace: InferenceExecutionTraceContext | null = null;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actor = auth.actor;
    const traceStore = supabase as unknown as TraceSupabaseClient;
    tenantId = actor.tenantId;
    const rateLimit = checkRateLimit(tenantId);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: 'rate_limit_exceeded' },
            {
                status: 429,
                headers: {
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(rateLimit.resetAt),
                },
            },
        );
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        logApiReceived({ event: 'inference.received', route: '/api/inference', tenantId, requestId });
        logApiCompleted({
            event: 'inference.completed',
            route: '/api/inference',
            tenantId,
            requestId,
            startTime,
            error: 'invalid_json',
        });
        return NextResponse.json(
            { error: 'invalid_input', detail: parsedJson.error },
            { status: 400 },
        );
    }

    requestId = readString(asCoreRecord(parsedJson.data).request_id);
    logApiReceived({ event: 'inference.received', route: '/api/inference', tenantId, requestId });

    const parsed = InferenceRequestSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        logApiCompleted({
            event: 'inference.completed',
            route: '/api/inference',
            tenantId,
            requestId,
            startTime,
            error: 'invalid_input',
        });
        return NextResponse.json(
            { error: 'invalid_input', detail: formatZodErrors(parsed.error) },
            { status: 400 },
        );
    }
    requestId = parsed.data.request_id;
    trace = createInferenceExecutionTraceContext({
        tenantId,
        requestId,
        sourceModule: 'clinical_api',
        modelName: parsed.data.model.name,
        modelVersion: parsed.data.model.version,
        providerName: 'vetios-clinical-engine',
        schemaVersion: 'v1',
        inputDigestSource: parsed.data.input.input_signature,
    });
    trace.recordCompleted('request_validated', 'Request validated', {
        auth_mode: actor.authMode,
        scope_count: actor.scopes.length,
        rate_limit_remaining: rateLimit.remaining,
        feature_count: parsed.data.input.input_signature.symptoms.length,
        has_metadata: Boolean(parsed.data.input.input_signature.metadata),
        quantum_requested: parsed.data.use_quantum === true,
    });

    const cached = await trace.measure(
        'idempotency_lookup',
        'Idempotency lookup',
        () => loadCachedInferenceEvent(supabase, tenantId, requestId),
    );
    if (cached.error) {
        const errorCode = readErrorCode(cached.error, 'inference_idempotency_lookup_failed');
        trace.recordFailed('idempotency_lookup_result', 'Idempotency lookup result', cached.error, {
            error_code: errorCode,
        });
        await trace.flush(traceStore);
        logSupabaseFailure({
            route: '/api/inference',
            requestId,
            tenantId,
            errorCode,
            error: cached.error,
        });
        logApiCompleted({
            event: 'inference.completed',
            route: '/api/inference',
            tenantId,
            requestId,
            startTime,
            error: errorCode,
        });
        return retryAfterResponse({ requestId, errorCode, detail: readErrorMessage(cached.error) });
    }
    if (cached.data) {
        const cachedRecord = cached.data as Record<string, unknown>;
        trace.recordCompleted('idempotency_cache_hit', 'Cached inference returned', {
            cache_hit: true,
            cached_at_available: Boolean(cachedRecord.created_at),
        });
        await trace.flush(traceStore, {
            inferenceEventId: readString(cachedRecord.id),
            ranker: readRanker(readString(cachedRecord.ranker)),
            outputDigestSource: cachedRecord.output_payload,
        });
        logApiCompleted({
            event: 'inference.completed',
            route: '/api/inference',
            tenantId,
            requestId,
            startTime,
            confidenceScore: readNumber((cached.data as Record<string, unknown>).confidence_score),
            cached: true,
        });
        const response = NextResponse.json(buildCachedInferencePayload(cached.data as Record<string, unknown>, requestId));
        response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining));
        response.headers.set('X-RateLimit-Reset', String(rateLimit.resetAt));
        return response;
    }

    try {
        const simulationContext = resolveSimulationContext(
            req,
            parsed.data.input.input_signature as InputSignature,
            actor,
        );
        if (!simulationContext.ok) {
            trace.recordFailed('simulation_context', 'Simulation context validation', new Error(simulationContext.code), {
                error_code: simulationContext.code,
                status: simulationContext.status,
            });
            await trace.flush(traceStore);
            logApiCompleted({
                event: 'inference.completed',
                route: '/api/inference',
                tenantId,
                requestId,
                startTime,
                error: simulationContext.code,
            });
            return NextResponse.json(
                { error: simulationContext.code, detail: simulationContext.message },
                { status: simulationContext.status },
            );
        }
        trace.recordCompleted('simulation_context', 'Simulation context validation', {
            synthetic: simulationContext.isSynthetic,
            simulation_linked: Boolean(simulationContext.simulationId),
            has_parent_event: Boolean(simulationContext.parentInferenceEventId),
        });

        const enrichedInputSignature = await trace.measure(
            'graph_priors',
            'Knowledge graph prior enrichment',
            () => enrichInputWithGraphPriors(
                supabase,
                parsed.data.input.input_signature as InputSignature,
            ),
            { graph_priors_enabled: true },
        );
        const quantumRanking = await trace.measure(
            'quantum_ranking',
            'Optional quantum ranking',
            () => runOptionalQuantumRanking({
                enabledByRequest: parsed.data.use_quantum === true,
                inputSignature: enrichedInputSignature,
            }),
            { requested: parsed.data.use_quantum === true },
        );

        const result = await trace.measure(
            'clinical_inference_persist',
            'Clinical inference and persistence',
            () => runInference({
                tenantId,
                requestId,
                supabase,
                model: parsed.data.model,
                inputSignature: enrichedInputSignature,
                persist: true,
                userId: actor.userId,
                sourceModule: simulationContext.simulationId ? 'simulation_api' : 'clinical_api',
                simulationId: simulationContext.simulationId,
                isSynthetic: simulationContext.isSynthetic,
                simulationAgentIndex: simulationContext.agentIndex,
                simulationRequestIndex: simulationContext.requestIndex,
                parentInferenceEventId: simulationContext.parentInferenceEventId,
                ranker: quantumRanking.ranker,
                quantumResult: quantumRanking.quantumResult,
            }),
            {
                persist: true,
                source_module: simulationContext.simulationId ? 'simulation_api' : 'clinical_api',
                quantum_ranker: quantumRanking.ranker,
            },
        );
        trace.recordCompleted('response_build', 'Inference response built', {
            ranker: result.ranker,
            latency_ms: result.latency_ms,
            cire_state: result.cire.safety_state,
        });
        await trace.flush(traceStore, {
            inferenceEventId: result.inference_event_id,
            ranker: result.ranker,
            outputDigestSource: result.output_payload,
        });

        const response = NextResponse.json({
            inference_event_id: result.inference_event_id,
            clinical_case_id: result.clinical_case_id,
            data: {
                ...result.data,
                output_payload: result.output_payload,
            },
            output_payload: result.output_payload,
            latency_ms: result.latency_ms,
            cire: result.cire,
            ranker: result.ranker,
            quantum_result: result.quantum_result,
            meta: result.meta,
            error: null,
        });
        response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining));
        response.headers.set('X-RateLimit-Reset', String(rateLimit.resetAt));
        await recordSuccessfulInferenceTelemetry({
            supabase,
            tenantId,
            result,
            modelVersion: parsed.data.model.version,
        });
        if (!simulationContext.isSynthetic) {
            await recordProductUsageEvent({
                tenantId,
                userId: actor.userId,
                eventType: 'diagnosis',
                source: 'inference_api',
                requestId,
                metadata: {
                    inference_event_id: result.inference_event_id,
                    clinical_case_id: result.clinical_case_id,
                    ranker: result.ranker,
                },
                client: supabase,
            });
        }
        logApiCompleted({
            event: 'inference.completed',
            route: '/api/inference',
            tenantId,
            requestId,
            startTime,
            confidenceScore: result.data.confidence_score,
        });
        return response;
    } catch (error) {
        trace?.recordFailed('inference_request', 'Inference request failed', error, {
            elapsed_ms: Date.now() - startTime,
        });
        await trace?.flush(traceStore);
        if (error instanceof SupabaseWriteError) {
            await recordFailedInferenceTelemetry({
                supabase,
                tenantId,
                requestId,
                startTime,
                modelVersion: parsed.data.model.version,
                errorCode: error.errorCode,
            });
            logSupabaseFailure({
                route: '/api/inference',
                requestId,
                tenantId,
                errorCode: error.errorCode,
                error: error.originalError,
            });
            logApiCompleted({
                event: 'inference.completed',
                route: '/api/inference',
                tenantId,
                requestId,
                startTime,
                error: error.errorCode,
            });
            return retryAfterResponse({ requestId, errorCode: error.errorCode, detail: error.message });
        }

        if (isInferenceUnavailableError(error)) {
            await recordFailedInferenceTelemetry({
                supabase,
                tenantId,
                requestId,
                startTime,
                modelVersion: parsed.data.model.version,
                errorCode: 'inference_unavailable',
            });
            logApiCompleted({
                event: 'inference.completed',
                route: '/api/inference',
                tenantId,
                requestId,
                startTime,
                error: 'inference_unavailable',
            });
            const response = NextResponse.json(
                {
                    error: 'inference_unavailable',
                    message: 'AI provider unavailable. Please retry.',
                    request_id: requestId,
                },
                { status: 503 },
            );
            response.headers.set('Retry-After', '5');
            return response;
        }

        const message = error instanceof Error ? error.message : 'Unknown model error';
        await recordFailedInferenceTelemetry({
            supabase,
            tenantId,
            requestId,
            startTime,
            modelVersion: parsed.data.model.version,
            errorCode: message === 'unparseable output' ? 'unparseable_output' : 'model_error',
        });
        if (message === 'unparseable output') {
            logApiCompleted({
                event: 'inference.completed',
                route: '/api/inference',
                tenantId,
                requestId,
                startTime,
                error: 'model_error',
            });
            return NextResponse.json(
                { error: 'model_error', detail: 'unparseable output' },
                { status: 502 },
            );
        }

        logApiCompleted({
            event: 'inference.completed',
            route: '/api/inference',
            tenantId,
            requestId,
            startTime,
            error: 'model_error',
        });
        return NextResponse.json(
            { error: 'model_error', detail: message },
            { status: 502 },
        );
    }
}

async function recordSuccessfulInferenceTelemetry(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    result: Awaited<ReturnType<typeof runInference>>;
    modelVersion: string;
}): Promise<void> {
    if (!input.result.inference_event_id) return;

    const observedAt = new Date().toISOString();
    const contradiction = asCoreRecord(input.result.output_payload.contradiction_analysis);
    const contradictionScore = readNumber(input.result.output_payload.contradiction_score)
        ?? readNumber(contradiction.contradiction_score);
    const prediction = extractPredictionLabel(input.result.output_payload);

    await Promise.allSettled([
        recordInferenceObservability(input.supabase, {
            inferenceEventId: input.result.inference_event_id,
            tenantId: input.tenantId,
            modelVersion: input.modelVersion,
            observedAt,
            outputPayload: input.result.output_payload,
            confidenceScore: input.result.data.confidence_score,
            contradictionScore,
        }),
        emitTelemetryEvent(input.supabase, {
            event_id: telemetryInferenceEventId(input.result.inference_event_id),
            tenant_id: input.tenantId,
            linked_event_id: input.result.inference_event_id,
            source_id: input.result.inference_event_id,
            source_table: 'ai_inference_events',
            event_type: 'inference',
            timestamp: observedAt,
            model_version: input.modelVersion,
            run_id: resolveTelemetryRunId(input.modelVersion, asCoreRecord(input.result.output_payload.telemetry).run_id),
            metrics: {
                latency_ms: input.result.latency_ms,
                confidence: input.result.data.confidence_score,
                prediction,
                failed: false,
            },
            metadata: {
                source_module: 'clinical_api',
                inference_event_id: input.result.inference_event_id,
                vision_status: asCoreRecord(input.result.output_payload.vision_inference).status ?? null,
            },
        }),
        recordInferenceCalibrationSnapshot(input.supabase, {
            tenantId: input.tenantId,
            inferenceEventId: input.result.inference_event_id,
            requestId: input.result.meta.request_id,
            caseId: input.result.clinical_case_id,
            modelVersion: input.modelVersion,
            sourceModule: 'clinical_api',
            ranker: input.result.ranker,
            outputPayload: input.result.output_payload,
            confidenceScore: input.result.data.confidence_score,
            phiHat: input.result.cire.phi_hat,
        }),
    ]);
}

async function recordFailedInferenceTelemetry(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string | null;
    requestId: string | null;
    startTime: number;
    modelVersion: string;
    errorCode: string;
}): Promise<void> {
    if (!input.tenantId) return;
    const timestamp = new Date().toISOString();
    const eventId = `evt_inference_failed_${input.requestId ?? randomUUID()}`;
    await Promise.allSettled([emitTelemetryEvent(input.supabase, {
        event_id: eventId,
        tenant_id: input.tenantId,
        event_type: 'inference',
        timestamp,
        model_version: input.modelVersion,
        run_id: resolveTelemetryRunId(input.modelVersion, null),
        metrics: {
            latency_ms: Date.now() - input.startTime,
            failed: true,
            error_code: input.errorCode,
        },
        metadata: {
            source_module: 'clinical_api',
            request_id: input.requestId,
            error_code: input.errorCode,
        },
    })]);
}

async function loadCachedInferenceEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
) {
    return supabase
        .from('ai_inference_events')
        .select('id, case_id, tenant_id, request_id, prompt_template_hash, prompt_template_version, schema_version, phi_hat, output_payload, confidence_score, inference_latency_ms, ranker, quantum_result, created_at')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
}

function buildCachedInferencePayload(row: Record<string, unknown>, requestId: string) {
    const outputPayload = asCoreRecord(row.output_payload);
    const confidenceScore = readNumber(row.confidence_score)
        ?? readNumber(outputPayload.confidence_score)
        ?? readNumber(outputPayload.primary_confidence)
        ?? 0;
    const differentials = Array.isArray(row.differentials)
        ? row.differentials
        : Array.isArray(outputPayload.differentials)
            ? outputPayload.differentials
            : Array.isArray(asCoreRecord(outputPayload.diagnosis).top_differentials)
                ? asCoreRecord(outputPayload.diagnosis).top_differentials
                : [];
    const cire = asCoreRecord(row.cire);
    const outputCire = asCoreRecord(outputPayload.cire);

    return {
        inference_event_id: readString(row.id),
        clinical_case_id: readString(row.case_id),
        data: {
            confidence_score: confidenceScore,
            differentials,
            output_payload: outputPayload,
        },
        output_payload: outputPayload,
        latency_ms: readNumber(row.inference_latency_ms) ?? 0,
        cire: Object.keys(cire).length > 0 ? cire : outputCire,
        ranker: readString(row.ranker) ?? readString(outputPayload.ranker) ?? 'classical',
        quantum_result: row.quantum_result ?? outputPayload.quantum_result ?? null,
        meta: {
            tenant_id: readString(row.tenant_id),
            request_id: requestId,
            idempotent: true,
        },
        error: null,
    };
}

function normalizeInferenceListRow(row: unknown): Record<string, unknown> {
    const record = asCoreRecord(row);
    const outputPayload = asCoreRecord(record.output_payload);
    const diagnosis = asCoreRecord(outputPayload.diagnosis);
    const differentials = Array.isArray(record.differentials)
        ? record.differentials
        : Array.isArray(outputPayload.differentials)
            ? outputPayload.differentials
            : Array.isArray(diagnosis.top_differentials)
                ? diagnosis.top_differentials
                : [];
    const cire = asCoreRecord(record.cire);
    const outputCire = asCoreRecord(outputPayload.cire);

    return {
        ...record,
        differentials,
        cire: Object.keys(cire).length > 0 ? cire : outputCire,
    };
}

type SimulationContext =
    | {
        ok: true;
        simulationId: string | null;
        isSynthetic: boolean;
        agentIndex: number | null;
        requestIndex: number | null;
        parentInferenceEventId: string | null;
    }
    | { ok: false; status: number; code: string; message: string };

function resolveSimulationContext(
    req: Request,
    inputSignature: InputSignature,
    actor: ClinicalApiActor,
): SimulationContext {
    const metadata = asRecord(inputSignature.metadata);
    const headerSimulationId = readText(req.headers.get('x-simulation-run-id'))
        ?? readText(req.headers.get('x-vetios-simulation-id'));
    const metadataSimulationId = readText(metadata.simulation_id);
    const simulationId = headerSimulationId ?? metadataSimulationId;
    const isSynthetic = metadata.is_synthetic === true || Boolean(simulationId);

    if (simulationId && !isUuid(simulationId)) {
        return {
            ok: false,
            status: 400,
            code: 'invalid_simulation_id',
            message: 'simulation_id must be a UUID.',
        };
    }

    if (isSynthetic && !simulationId) {
        return {
            ok: false,
            status: 400,
            code: 'simulation_id_required',
            message: 'Synthetic inference requests must include X-Simulation-Run-Id or metadata.simulation_id.',
        };
    }

    if (simulationId && !actorHasScope(actor, 'simulation:write')) {
        return {
            ok: false,
            status: 403,
            code: 'simulation_scope_required',
            message: 'Simulation-linked inference requires simulation:write scope.',
        };
    }

    return {
        ok: true,
        simulationId: simulationId ?? null,
        isSynthetic,
        agentIndex: readNumber(metadata.simulation_agent_index),
        requestIndex: readNumber(metadata.simulation_request_index) ?? readNumber(metadata.simulation_step),
        parentInferenceEventId: readText(metadata.parent_inference_event_id),
    };
}

function actorHasScope(actor: ClinicalApiActor, scope: string) {
    const scopes = actor.scopes as readonly string[];
    return scopes.includes('*') || scopes.includes(scope);
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readRanker(value: unknown): 'classical' | 'quantum' | 'hybrid' | null {
    return value === 'classical' || value === 'quantum' || value === 'hybrid' ? value : null;
}

function isInferenceUnavailableError(error: unknown): boolean {
    const record = asCoreRecord(error);
    const name = readString(record.name);
    const code = readString(record.errorCode) ?? readString(record.error_code);
    const message = error instanceof Error
        ? error.message
        : readString(record.message) ?? '';

    return code === 'inference_unavailable'
        || name === 'AiProviderUnavailableError'
        || name === 'AiProviderTimeoutError'
        || /AI_TIMEOUT|AI provider .*timed out/i.test(message);
}

function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}
