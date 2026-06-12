import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { isUuidV4 } from '@/lib/api/corePipeline';
import { loadLatestInferenceCalibrationSnapshot } from '@/lib/inference/calibrationSnapshot';
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

    const snapshot = await loadLatestInferenceCalibrationSnapshot(supabase, auth.actor.tenantId, id);
    if (snapshot.error) {
        return NextResponse.json(
            { error: 'calibration_snapshot_lookup_failed', detail: snapshot.error },
            { status: 500 },
        );
    }

    return NextResponse.json({
        data: snapshot.data,
        meta: {
            inference_event_id: id,
            tenant_id: auth.actor.tenantId,
            snapshot_found: Boolean(snapshot.data),
        },
        error: null,
    });
}
