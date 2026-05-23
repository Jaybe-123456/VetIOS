import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
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
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runInference, type InputSignature } from '@/lib/vetios-inference';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SimulateRequestSchema = z.object({
    request_id: z.string().refine(isUuidV4, 'request_id must be a UUID v4'),
    steps: z.number().int().min(1).max(50),
    mode: z.enum(['adaptive', 'fixed']),
    base_case: z.object({
        species: z.string().min(1),
        symptoms: z.array(z.string().min(1)).min(1),
        breed: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }).passthrough(),
    inference: z.object({
        model: z.string().min(1).optional(),
        model_version: z.string().min(1).optional(),
    }).optional(),
});

type SimulationMode = z.infer<typeof SimulateRequestSchema>['mode'];

export async function POST(req: Request) {
    const startTime = Date.now();
    let requestId: string | null = null;
    let tenantId: string | null = null;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['simulation:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        logApiReceived({ event: 'simulate.received', route: '/api/simulate', tenantId, requestId });
        logApiCompleted({
            event: 'simulate.completed',
            route: '/api/simulate',
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
    tenantId = auth.actor.tenantId;
    logApiReceived({ event: 'simulate.received', route: '/api/simulate', tenantId, requestId });

    const parsed = SimulateRequestSchema.safeParse(normalizeSimulateRequest(parsedJson.data));
    if (!parsed.success) {
        logApiCompleted({
            event: 'simulate.completed',
            route: '/api/simulate',
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
    const body = parsed.data;

    const cached = await loadCachedSimulationEvent(supabase, tenantId, requestId);
    if (cached.error) {
        const errorCode = readErrorCode(cached.error, 'simulate_idempotency_lookup_failed');
        logSupabaseFailure({
            route: '/api/simulate',
            requestId,
            tenantId,
            errorCode,
            error: cached.error,
        });
        logApiCompleted({
            event: 'simulate.completed',
            route: '/api/simulate',
            tenantId,
            requestId,
            startTime,
            error: errorCode,
        });
        return retryAfterResponse({ requestId, errorCode, detail: readErrorMessage(cached.error) });
    }
    if (cached.data) {
        logApiCompleted({
            event: 'simulate.completed',
            route: '/api/simulate',
            tenantId,
            requestId,
            startTime,
            confidenceScore: readNumber(asCoreRecord((cached.data as Record<string, unknown>).stress_metrics).mean_confidence),
            cached: true,
        });
        return NextResponse.json(buildCachedSimulationPayload(cached.data as Record<string, unknown>, requestId));
    }

    const model = {
        name: body.inference?.model ?? 'VetIOS Diagnostics',
        version: body.inference?.model_version ?? 'latest',
    };
    const clinicalCaseId = randomUUID();
    const confidenceHistory: number[] = [];
    const variants: InputSignature[] = [];
    const results = [];
    const simulationRun = await createSimulationRun(supabase, {
        tenantId,
        steps: body.steps,
        mode: body.mode,
        model,
        baseCase: body.base_case,
    });

    if (!simulationRun.ok) {
        const errorCode = 'simulation_run_create_failed';
        logSupabaseFailure({
            route: '/api/simulate',
            requestId,
            tenantId,
            errorCode,
            error: new Error(simulationRun.message),
        });
        logApiCompleted({
            event: 'simulate.completed',
            route: '/api/simulate',
            tenantId,
            requestId,
            startTime,
            error: errorCode,
        });
        return retryAfterResponse({ requestId, errorCode, detail: simulationRun.message });
    }

    const inferenceEventIds: string[] = [];

    try {
        for (let index = 0; index < body.steps; index += 1) {
            const generatedVariant = generateVariants(
                body.base_case as InputSignature,
                index + 1,
                body.mode,
                confidenceHistory,
            )[index];
            const variant = attachSimulationMetadata(generatedVariant, {
                simulationId: simulationRun.id,
                step: index + 1,
                mode: body.mode,
                routeRequestId: requestId,
            });
            variants.push(variant);

            const result = await runInference({
                tenantId,
                requestId: randomUUID(),
                supabase,
                model,
                inputSignature: variant,
                persist: true,
                sourceModule: 'legacy_simulate',
                simulationId: simulationRun.id,
                isSynthetic: true,
                simulationRequestIndex: index + 1,
            });
            confidenceHistory.push(result.data.confidence_score);
            if (result.inference_event_id) {
                inferenceEventIds.push(result.inference_event_id);
            }
            results.push(result);
        }
    } catch (error) {
        await updateSimulationRun(supabase, simulationRun.id, {
            status: 'failed',
            completed: results.length,
            total: body.steps,
            summary: {
                request_id: requestId,
                error: error instanceof Error ? error.message : 'Unknown simulation error',
                inference_event_ids: inferenceEventIds,
            },
            error_message: error instanceof Error ? error.message : 'Unknown simulation error',
        }).catch(() => undefined);
        if (error instanceof SupabaseWriteError) {
            logSupabaseFailure({
                route: '/api/simulate',
                requestId,
                tenantId,
                errorCode: error.errorCode,
                error: error.originalError,
            });
            logApiCompleted({
                event: 'simulate.completed',
                route: '/api/simulate',
                tenantId,
                requestId,
                startTime,
                error: error.errorCode,
            });
            return retryAfterResponse({ requestId, errorCode: error.errorCode, detail: error.message });
        }
        logApiCompleted({
            event: 'simulate.completed',
            route: '/api/simulate',
            tenantId,
            requestId,
            startTime,
            error: 'simulation_failed',
        });
        return NextResponse.json(
            { error: 'simulation_failed', detail: error instanceof Error ? error.message : 'Unknown simulation error' },
            { status: 502 },
        );
    }

    const passes = results.filter((result) => result.cire.safety_state !== 'hold').length;
    const failures = body.steps - passes;
    const meanConfidence = average(results.map((result) => result.data.confidence_score));
    const resultsSummary = results.map((result, index) => ({
        step: index + 1,
        confidence: result.data.confidence_score,
        safety_state: result.cire.safety_state,
        top_differential: result.data.differentials[0]?.label ?? null,
    }));
    const stabilityReport = {
        passes,
        failures,
        mean_confidence: Number(meanConfidence.toFixed(4)),
    };

    const { data: simulationEvent, error: insertError } = await supabase
        .from('edge_simulation_events')
        .insert({
            tenant_id: tenantId,
            request_id: requestId,
            simulation_type: `stability_${body.mode}`,
            simulation_parameters: {
                steps: body.steps,
                mode: body.mode,
                model,
                base_case: body.base_case,
            },
            case_id: clinicalCaseId,
            stress_metrics: {
                simulation_id: simulationRun.id,
                clinical_case_id: clinicalCaseId,
                base_case: body.base_case,
                variants,
                inference_event_ids: inferenceEventIds,
                stability_report: stabilityReport,
                results_summary: resultsSummary,
            },
            failure_mode: failures > 0 ? 'hold_state_detected' : null,
            is_real_world: false,
            triggered_inference_id: inferenceEventIds[0] ?? null,
        })
        .select('id')
        .single();

    if (insertError || !simulationEvent?.id) {
        await updateSimulationRun(supabase, simulationRun.id, {
            status: 'failed',
            completed: results.length,
            total: body.steps,
            summary: {
                request_id: requestId,
                error: insertError?.message ?? 'Unknown insert error',
                inference_event_ids: inferenceEventIds,
            },
            error_message: insertError?.message ?? 'Unknown insert error',
        }).catch(() => undefined);
        const errorCode = readErrorCode(insertError, 'simulation_insert_failed');
        logSupabaseFailure({
            route: '/api/simulate',
            requestId,
            tenantId,
            errorCode,
            error: insertError ?? new Error('Unknown insert error'),
        });
        logApiCompleted({
            event: 'simulate.completed',
            route: '/api/simulate',
            tenantId,
            requestId,
            startTime,
            error: errorCode,
        });
        return retryAfterResponse({ requestId, errorCode, detail: insertError?.message ?? 'Unknown insert error' });
    }

    await updateSimulationRun(supabase, simulationRun.id, {
        status: 'completed',
        completed: body.steps,
        total: body.steps,
        summary: {
            request_id: requestId,
            edge_simulation_event_id: String(simulationEvent.id),
            clinical_case_id: clinicalCaseId,
            stability_report: stabilityReport,
            results_summary: resultsSummary,
            inference_event_ids: inferenceEventIds,
            synthetic_inference_events: inferenceEventIds.length,
        },
    }).catch(() => undefined);

    logApiCompleted({
        event: 'simulate.completed',
        route: '/api/simulate',
        tenantId,
        requestId,
        startTime,
        confidenceScore: stabilityReport.mean_confidence,
    });
    return NextResponse.json({
        simulation_id: simulationRun.id,
        simulation_event_id: String(simulationEvent.id),
        clinical_case_id: clinicalCaseId,
        inference_event_ids: inferenceEventIds,
        stability_report: stabilityReport,
        request_id: requestId,
    });
}

function attachSimulationMetadata(
    input: InputSignature,
    metadata: { simulationId: string; step: number; mode: SimulationMode; routeRequestId: string },
): InputSignature {
    return {
        ...input,
        metadata: {
            ...asRecord(input.metadata),
            simulation_id: metadata.simulationId,
            simulation_step: metadata.step,
            simulation_request_index: metadata.step,
            simulation_mode: metadata.mode,
            route_request_id: metadata.routeRequestId,
            is_synthetic: true,
        },
    };
}

async function loadCachedSimulationEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
) {
    return supabase
        .from('edge_simulation_events')
        .select('id, tenant_id, request_id, case_id, triggered_inference_id, stress_metrics, simulation_parameters, created_at')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
}

function buildCachedSimulationPayload(row: Record<string, unknown>, requestId: string) {
    const stressMetrics = asCoreRecord(row.stress_metrics);
    return {
        simulation_id: readString(stressMetrics.simulation_id),
        simulation_event_id: readString(row.id),
        clinical_case_id: readString(row.case_id) ?? readString(stressMetrics.clinical_case_id),
        inference_event_ids: Array.isArray(stressMetrics.inference_event_ids) ? stressMetrics.inference_event_ids : [],
        stability_report: asCoreRecord(stressMetrics.stability_report),
        request_id: requestId,
        meta: {
            tenant_id: readString(row.tenant_id),
            idempotent: true,
        },
        error: null,
    };
}

async function createSimulationRun(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        steps: number;
        mode: SimulationMode;
        model: { name: string; version: string };
        baseCase: unknown;
    },
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    const { data, error } = await supabase
        .from('simulations')
        .insert({
            tenant_id: input.tenantId,
            scenario_name: `Legacy stability simulation (${input.mode})`,
            mode: 'scenario_load',
            status: 'running',
            config: {
                source: 'api_simulate',
                requested_mode: input.mode,
                steps: input.steps,
                model: input.model,
                base_case: input.baseCase,
            },
            summary: {},
            completed: 0,
            total: input.steps,
            candidate_model_version: input.model.version,
        })
        .select('id')
        .single();

    if (error || !data?.id) {
        return { ok: false, message: error?.message ?? 'Unknown simulation run insert error' };
    }

    return { ok: true, id: String(data.id) };
}

async function updateSimulationRun(
    supabase: ReturnType<typeof getSupabaseServer>,
    simulationId: string,
    patch: Record<string, unknown>,
) {
    return supabase
        .from('simulations')
        .update({
            ...patch,
            updated_at: new Date().toISOString(),
        })
        .eq('id', simulationId);
}

export function generateVariants(
    baseCase: InputSignature,
    steps: number,
    mode: SimulationMode,
    confidenceHistory: number[] = [],
): InputSignature[] {
    return Array.from({ length: steps }, (_, index) => {
        const previousConfidence = confidenceHistory[index - 1] ?? 1;
        const symptoms = [...baseCase.symptoms];
        const shouldStabilize = mode === 'adaptive' && previousConfidence < 0.5;

        if (!shouldStabilize && symptoms.length > 1 && Math.random() < 0.5) {
            symptoms.splice(Math.floor(Math.random() * symptoms.length), 1);
        }

        if (shouldStabilize) {
            const missingSymptom = baseCase.symptoms.find((symptom) => !symptoms.includes(symptom));
            if (missingSymptom) {
                symptoms.push(missingSymptom);
            }
        }

        const metadata = asRecord(baseCase.metadata);
        const labs = readLabs(metadata);

        return {
            ...baseCase,
            symptoms,
            metadata: {
                ...metadata,
                labs: addLabNoise(labs),
                simulation_step: index + 1,
                simulation_mode: mode,
            },
        };
    });
}

function addLabNoise(labs: Record<string, number>): Record<string, number> {
    if (Object.keys(labs).length === 0) {
        return {
            synthetic_noise: Number((1 + ((Math.random() * 0.2) - 0.1)).toFixed(4)),
        };
    }

    return Object.fromEntries(
        Object.entries(labs).map(([key, value]) => [
            key,
            Number((value * (1 + ((Math.random() * 0.2) - 0.1))).toFixed(4)),
        ]),
    );
}

function readLabs(metadata: Record<string, unknown>): Record<string, number> {
    const explicitLabs = asRecord(metadata.labs);
    const source = Object.keys(explicitLabs).length > 0 ? explicitLabs : metadata;
    return Object.fromEntries(
        Object.entries(source)
            .map(([key, value]) => [key, readNumber(value)])
            .filter((entry): entry is [string, number] => entry[1] != null),
    );
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeSimulateRequest(value: unknown): unknown {
    const record = asRecord(value);
    if ('steps' in record || 'base_case' in record) {
        return value;
    }

    const legacySimulation = asRecord(record.simulation);
    if (Object.keys(legacySimulation).length === 0) {
        return value;
    }

    const parameters = asRecord(legacySimulation.parameters);
    const targetDisease = readText(parameters.target_disease) ?? readText(parameters.targetDisease);
    const edgeCases = readTextArray(parameters.edge_cases);
    const contradictions = parameters.contradictions;
    const inferredSymptoms = [
        targetDisease,
        ...edgeCases,
        readText(contradictions),
    ]
        .filter((entry): entry is string => entry != null)
        .flatMap((entry) => entry.split(/[+,;]/).map((part) => part.trim()).filter(Boolean));
    const simulationMode = readText(legacySimulation.mode) ?? readText(parameters.mode);

    return {
        steps: Math.min(50, Math.max(1, readNumber(parameters.steps) ?? 5)),
        mode: simulationMode === 'fixed' ? 'fixed' : 'adaptive',
        base_case: {
            species: readText(parameters.species) ?? 'canine',
            breed: readText(parameters.breed) ?? undefined,
            symptoms: inferredSymptoms.length > 0 ? inferredSymptoms : ['fever', 'lethargy'],
            metadata: {
                source: 'legacy_simulation_payload',
                simulation_type: readText(legacySimulation.type),
                ...parameters,
            },
        },
        inference: asRecord(record.inference),
    };
}

function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readTextArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
    const text = readText(value);
    return text ? [text] : [];
}
