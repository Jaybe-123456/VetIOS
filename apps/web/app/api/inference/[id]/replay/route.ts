import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { replayInferenceEventForDrift } from '@/lib/inference/replayDrift';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
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

    const result = await replayInferenceEventForDrift({
        client: supabase as never,
        tenantId: auth.actor.tenantId,
        inferenceEventId,
        userId: auth.actor.userId,
    });

    if (result.error === 'source_inference_not_found') {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    if (result.replay_status === 'failed') {
        return NextResponse.json({
            data: result,
            error: 'replay_failed',
        }, { status: 502 });
    }

    return NextResponse.json({
        data: result,
        error: null,
    });
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
