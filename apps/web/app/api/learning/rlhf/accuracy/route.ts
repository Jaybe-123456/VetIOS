import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const { searchParams } = new URL(req.url);
    const species = searchParams.get('species');
    const diagnosis = searchParams.get('diagnosis');
    const minCount = parseInt(searchParams.get('min_count') ?? '5', 10);

    let query = supabase
        .from('rlhf_accuracy_by_tenant_tuple')
        .select('species, breed, top_ai_diagnosis, total_signals, correct_count, accuracy_pct, avg_ai_confidence, last_signal_at')
        .eq('tenant_id', auth.actor.tenantId)
        .gte('total_signals', minCount)
        .order('accuracy_pct', { ascending: false })
        .limit(100);

    if (species) query = query.eq('species', species);
    if (diagnosis) query = query.ilike('top_ai_diagnosis', `%${diagnosis}%`);

    const { data, error } = await query;

    if (error) {
        console.error('[rlhf/accuracy] query error:', error);
        return NextResponse.json({ error: 'Failed to retrieve accuracy data', request_id: requestId }, { status: 500 });
    }

    const response = NextResponse.json({
        accuracy_tuples: data ?? [],
        count: (data ?? []).length,
        note: 'Accuracy computed from vet-confirmed override signals. Minimum 5 signals per tuple.',
        request_id: requestId,
    });

    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
