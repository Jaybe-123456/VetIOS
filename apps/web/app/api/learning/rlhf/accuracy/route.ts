import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const { searchParams } = new URL(req.url);
    const species = searchParams.get('species');
    const diagnosis = searchParams.get('diagnosis');
    const minCount = parseInt(searchParams.get('min_count') ?? '5', 10);

    const supabase = getSupabaseServer();

    let query = supabase
        .from('rlhf_accuracy_by_tuple')
        .select('species, breed, top_ai_diagnosis, total_signals, correct_count, accuracy_pct, avg_ai_confidence, last_signal_at')
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