import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor, type ClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { checkRateLimit } from '@/lib/inference-rate-limit';
import { runInference } from '@/lib/vetios-inference';
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
        .select('id, created_at, model_name, model_version, input_signature, differentials, confidence_score, cire')
        .eq('tenant_id', auth.actor.tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        return NextResponse.json({ error: 'inference_list_failed', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
        data: data ?? [],
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
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    tenantId = auth.actor.tenantId;
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

    const cached = await loadCachedInferenceEvent(supabase, tenantId, requestId);
    if (cached.error) {
        const errorCode = readErrorCode(cached.error, 'inference_idempotency_lookup_failed');
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
            auth.actor,
        );
        if (!simulationContext.ok) {
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

        const result = await runInference({
            tenantId,
            requestId,
            supabase,
            model: parsed.data.model,
            inputSignature: parsed.data.input.input_signature as InputSignature,
            persist: true,
            userId: auth.actor.userId,
            sourceModule: simulationContext.simulationId ? 'simulation_api' : 'clinical_api',
            simulationId: simulationContext.simulationId,
            isSynthetic: simulationContext.isSynthetic,
            simulationAgentIndex: simulationContext.agentIndex,
            simulationRequestIndex: simulationContext.requestIndex,
            parentInferenceEventId: simulationContext.parentInferenceEventId,
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
        .select('id, case_id, tenant_id, request_id, output_payload, differentials, confidence_score, inference_latency_ms, latency_ms, cire, created_at')
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
            : [];

    return {
        inference_event_id: readString(row.id),
        clinical_case_id: readString(row.case_id),
        data: {
            confidence_score: confidenceScore,
            differentials,
            output_payload: outputPayload,
        },
        output_payload: outputPayload,
        latency_ms: readNumber(row.inference_latency_ms) ?? readNumber(row.latency_ms) ?? 0,
        cire: asCoreRecord(row.cire),
        meta: {
            tenant_id: readString(row.tenant_id),
            request_id: requestId,
            idempotent: true,
        },
        error: null,
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

function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}
