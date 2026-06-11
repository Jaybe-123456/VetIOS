import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { loadInferenceExecutionTraceEvents, type TraceSupabaseClient } from '@/lib/inference/executionTrace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const inferenceEventId = params.id;

    if (!isUuid(inferenceEventId)) {
        return NextResponse.json({ error: 'invalid_inference_event_id' }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const traceStore = supabase as unknown as TraceSupabaseClient;
    const { data: event, error: eventError } = await supabase
        .from('ai_inference_events')
        .select('id')
        .eq('tenant_id', auth.actor.tenantId)
        .eq('id', inferenceEventId)
        .maybeSingle();

    if (eventError) {
        return NextResponse.json(
            { error: 'inference_trace_event_lookup_failed', detail: eventError.message },
            { status: 500 },
        );
    }

    if (!event) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const trace = await loadInferenceExecutionTraceEvents(traceStore, auth.actor.tenantId, inferenceEventId);
    if (trace.error) {
        return NextResponse.json(
            { error: 'inference_trace_unavailable', detail: trace.error },
            { status: 503 },
        );
    }

    return NextResponse.json({
        data: trace.data,
        meta: {
            inference_event_id: inferenceEventId,
            tenant_id: auth.actor.tenantId,
            trace_event_count: trace.data.length,
        },
        error: null,
    });
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
