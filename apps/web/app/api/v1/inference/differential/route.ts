import { NextResponse, type NextRequest } from 'next/server';
import { POST as internalInferencePost } from '@/app/api/inference/route';
import { runPartnerV1Route } from '@/lib/api/v1-route';
import { DEFAULT_V1_INFERENCE_MODEL, StructuredInferenceRequestSchema } from '@/lib/inference/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    return runPartnerV1Route(request, {
        endpoint: '/v1/inference/differential',
        aggregateType: 'inference',
        handler: async (_auth, req) => {
            const rawBody = await readJsonBody(req);
            if ('error' in rawBody) {
                return NextResponse.json({ error: rawBody.error }, { status: 400 });
            }

            if (isInternalInferenceEnvelope(rawBody.value)) {
                return internalInferencePost(buildForwardedRequest(req, rawBody.text));
            }

            const candidateBody = normalizeLegacyInferencePayload(rawBody.value);
            const parsed = StructuredInferenceRequestSchema.safeParse(candidateBody);
            if (!parsed.success) {
                return NextResponse.json({
                    error: parsed.error.issues.map((issue) => issue.path.join('.') ? `${issue.path.join('.')}: ${issue.message}` : issue.message).join('; '),
                }, { status: 400 });
            }

            const body = {
                model: DEFAULT_V1_INFERENCE_MODEL,
                input: {
                    input_signature: {
                        species: parsed.data.species,
                        breed: parsed.data.breed ?? null,
                        age_years: parsed.data.age_years,
                        weight_kg: parsed.data.weight_kg,
                        sex: parsed.data.sex,
                        region: parsed.data.region,
                        symptoms: parsed.data.presenting_signs,
                        presenting_signs: parsed.data.presenting_signs,
                        history: parsed.data.history,
                        preventive_history: parsed.data.preventive_history,
                        diagnostic_tests: parsed.data.diagnostic_tests,
                        physical_exam: parsed.data.physical_exam,
                        metadata: {
                            model_family: 'diagnostics',
                            route_hint: 'clinical_diagnosis',
                            api_version: 'v1',
                        },
                    },
                },
            };

            return internalInferencePost(buildForwardedRequest(req, JSON.stringify(body)));
        },
    });
}

async function readJsonBody(request: NextRequest): Promise<
    | { text: string; value: unknown }
    | { error: string }
> {
    let text = '';
    try {
        text = await request.text();
    } catch {
        return { error: 'Unable to read inference request body.' };
    }

    if (!text.trim()) {
        return { error: 'Missing inference request body.' };
    }

    try {
        return { text, value: JSON.parse(text) };
    } catch {
        return { error: 'Inference request body must be valid JSON.' };
    }
}

function isInternalInferenceEnvelope(value: unknown): value is {
    model: Record<string, unknown>;
    input: { input_signature: Record<string, unknown> };
} {
    if (typeof value !== 'object' || value == null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.model === 'object'
        && candidate.model != null
        && typeof candidate.input === 'object'
        && candidate.input != null
        && typeof (candidate.input as Record<string, unknown>).input_signature === 'object';
}

function buildForwardedRequest(request: NextRequest, body: string): Request {
    return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
    });
}

function normalizeLegacyInferencePayload(value: unknown): unknown {
    if (typeof value !== 'object' || value == null || Array.isArray(value)) {
        return value;
    }

    const candidate = { ...(value as Record<string, unknown>) };
    if (
        !Array.isArray(candidate.presenting_signs)
        && Array.isArray(candidate.symptoms)
    ) {
        candidate.presenting_signs = candidate.symptoms;
    }
    delete candidate.symptoms;
    return candidate;
}
