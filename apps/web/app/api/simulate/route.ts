import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { runInference, type InputSignature } from '@/lib/vetios-inference';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SimulateRequestSchema = z.object({
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
    const requestId = randomUUID();
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
        return NextResponse.json(
            { error: 'invalid_input', detail: parsedJson.error },
            { status: 400 },
        );
    }

    const parsed = SimulateRequestSchema.safeParse(normalizeSimulateRequest(parsedJson.data));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: formatZodErrors(parsed.error) },
            { status: 400 },
        );
    }

    const tenantId = auth.actor.tenantId;
    const body = parsed.data;
    const model = {
        name: body.inference?.model ?? 'VetIOS Diagnostics',
        version: body.inference?.model_version ?? 'latest',
    };
    const clinicalCaseId = randomUUID();
    const confidenceHistory: number[] = [];
    const variants: InputSignature[] = [];
    const results = [];

    try {
        for (let index = 0; index < body.steps; index += 1) {
            const variant = generateVariants(
                body.base_case as InputSignature,
                index + 1,
                body.mode,
                confidenceHistory,
            )[index];
            variants.push(variant);

            const result = await runInference({
                tenantId,
                requestId,
                supabase,
                model,
                inputSignature: variant,
                persist: false,
            });
            confidenceHistory.push(result.data.confidence_score);
            results.push(result);
        }
    } catch (error) {
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
            simulation_type: `stability_${body.mode}`,
            simulation_parameters: {
                steps: body.steps,
                mode: body.mode,
                model,
                base_case: body.base_case,
            },
            case_id: clinicalCaseId,
            triggered_inference_id: null,
            stress_metrics: {
                clinical_case_id: clinicalCaseId,
                base_case: body.base_case,
                variants,
                stability_report: stabilityReport,
                results_summary: resultsSummary,
            },
            failure_mode: failures > 0 ? 'hold_state_detected' : null,
            is_real_world: false,
        })
        .select('id')
        .single();

    if (insertError || !simulationEvent?.id) {
        return NextResponse.json(
            { error: 'simulation_insert_failed', detail: insertError?.message ?? 'Unknown insert error' },
            { status: 500 },
        );
    }

    return NextResponse.json({
        simulation_event_id: String(simulationEvent.id),
        clinical_case_id: clinicalCaseId,
        stability_report: stabilityReport,
        request_id: requestId,
    });
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
