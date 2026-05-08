import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

export async function GET(req: Request) {
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('ai_inference_events')
        .select('id, created_at, differentials, confidence_score, cire, output_payload')
        .eq('tenant_id', auth.actor.tenantId)
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        return NextResponse.json(
            { error: 'recent_inference_query_failed', detail: error.message },
            { status: 500 },
        );
    }

    return NextResponse.json({ events: data ?? [] });
}
