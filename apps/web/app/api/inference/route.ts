import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { checkRateLimit } from '@/lib/inference-rate-limit';
import { runInference } from '@/lib/vetios-inference';
import { safeJson } from '@/lib/http/safeJson';
import type { InputSignature } from '@/lib/vetios-inference';

export const runtime = 'nodejs';

const InferenceRequestSchema = z.object({
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
    const requestId = randomUUID();
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = auth.actor.tenantId;
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
        return NextResponse.json(
            { error: 'invalid_input', detail: parsedJson.error },
            { status: 400 },
        );
    }

    const parsed = InferenceRequestSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: formatZodErrors(parsed.error) },
            { status: 400 },
        );
    }

    try {
        const result = await runInference({
            tenantId,
            requestId,
            supabase,
            model: parsed.data.model,
            inputSignature: parsed.data.input.input_signature as InputSignature,
            persist: true,
        });

        const response = NextResponse.json({
            inference_event_id: result.inference_event_id,
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
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown model error';
        if (message === 'unparseable output') {
            return NextResponse.json(
                { error: 'model_error', detail: 'unparseable output' },
                { status: 502 },
            );
        }

        return NextResponse.json(
            { error: 'model_error', detail: message },
            { status: 502 },
        );
    }
}

function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}
