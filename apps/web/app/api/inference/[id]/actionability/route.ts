import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { isUuidV4 } from '@/lib/api/corePipeline';
import { loadLatestInferenceActionabilityGateEvent } from '@/lib/inference/actionabilityGate';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
    const { id } = await context.params;
    if (!isUuidV4(id)) {
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

    const gate = await loadLatestInferenceActionabilityGateEvent(supabase, auth.actor.tenantId, id);
    if (gate.error) {
        return NextResponse.json(
            { error: 'actionability_gate_lookup_failed', detail: gate.error },
            { status: 500 },
        );
    }

    return NextResponse.json({
        data: gate.data,
        meta: {
            inference_event_id: id,
            tenant_id: auth.actor.tenantId,
            gate_found: Boolean(gate.data),
        },
        error: null,
    });
}
