import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { AI_INFERENCE_EVENTS, VET_OVERRIDE_SIGNALS } from '@/lib/db/schemaContracts';

interface OverrideRequestBody {
    inference_event_id: string;
    override_type: string;
    ai_output: Record<string, unknown>;
    vet_correction: {
        diagnosis: string;
        confidence?: number;
        notes?: string;
    };
    clinical_context: {
        species: string;
        breed?: string;
        age_years?: number;
        presenting_symptoms: string[];
    };
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const bodyResult = await safeJson<OverrideRequestBody>(req);
    if (!bodyResult.ok) {
        return NextResponse.json({ error: bodyResult.error, request_id: requestId }, { status: 400 });
    }

    const body = bodyResult.data;

    if (!body.inference_event_id || !body.override_type || !body.vet_correction?.diagnosis || !body.clinical_context?.species || !body.clinical_context?.presenting_symptoms?.length) {
        return NextResponse.json({ error: 'Missing required fields', request_id: requestId }, { status: 422 });
    }

    const supabase = getSupabaseServer();

    const { data: inferenceEvent, error: ieErr } = await supabase
        .from(AI_INFERENCE_EVENTS.TABLE)
        .select('id, tenant_id, output_payload, confidence_score')
        .eq(AI_INFERENCE_EVENTS.COLUMNS.id, body.inference_event_id)
        .eq(AI_INFERENCE_EVENTS.COLUMNS.tenant_id, actor.tenantId)
        .single();

    if (ieErr || !inferenceEvent) {
        return NextResponse.json({ error: 'Inference event not found', request_id: requestId }, { status: 404 });
    }

    const aiOutput = (inferenceEvent.output_payload ?? body.ai_output) as Record<string, unknown>;
    const differentials = (aiOutput.differentials as Array<{ diagnosis: string; confidence: number }>) ?? [];
    const topDiff = differentials[0] ?? { diagnosis: 'unknown', confidence: inferenceEvent.confidence_score ?? 0 };

    const { data: signal, error: insertErr } = await supabase
        .from(VET_OVERRIDE_SIGNALS.TABLE)
        .insert({
            inference_event_id: body.inference_event_id,
            tenant_id: actor.tenantId,
            vet_user_id: actor.userId,
            override_type: body.override_type,
            ai_output: aiOutput,
            vet_correction: body.vet_correction,
            correction_notes: body.vet_correction.notes ?? null,
            species: body.clinical_context.species,
            breed: body.clinical_context.breed ?? null,
            age_years: body.clinical_context.age_years ?? null,
            presenting_symptoms: body.clinical_context.presenting_symptoms,
            top_ai_diagnosis: topDiff.diagnosis,
            ai_confidence: topDiff.confidence,
            vet_diagnosis: body.vet_correction.diagnosis,
            vet_confidence: body.vet_correction.confidence ?? null,
            status: 'pending',
        })
        .select('id, status, created_at')
        .single();

    if (insertErr) {
        if (insertErr.code === '23505') {
            return NextResponse.json({ error: 'Override already recorded for this inference event', request_id: requestId }, { status: 409 });
        }
        console.error('[rlhf/override] insert error:', insertErr);
        return NextResponse.json({ error: 'Failed to record override', request_id: requestId }, { status: 500 });
    }

    const response = NextResponse.json({
        override_signal_id: signal.id,
        status: signal.status,
        created_at: signal.created_at,
        message: 'Override recorded. This correction will improve VetIOS accuracy.',
        request_id: requestId,
    }, { status: 201 });

    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}