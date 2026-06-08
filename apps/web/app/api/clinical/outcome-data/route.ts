import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { loadConfirmedCaseCollectionStats } from '@/lib/cases/confirmedCaseCollection';
import { loadLatestOutcomeDataSnapshot } from '@/lib/cases/outcomeDataSnapshots';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['outcome:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { data: null, error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    try {
        const [snapshot, liveStats] = await Promise.all([
            loadLatestOutcomeDataSnapshot(supabase, auth.actor.tenantId),
            loadConfirmedCaseCollectionStats(supabase, auth.actor.tenantId, 300),
        ]);
        const response = NextResponse.json({
            data: {
                tenant_id: auth.actor.tenantId,
                snapshot,
                live_stats: liveStats,
                privacy_boundary: {
                    raw_patient_names: false,
                    owner_contacts: false,
                    microchip_ids: false,
                    raw_symptom_text: false,
                },
            },
            error: null,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        return NextResponse.json(
            {
                data: null,
                error: 'outcome_data_snapshot_failed',
                detail: error instanceof Error ? error.message : 'Failed to read outcome data moat snapshot.',
                request_id: requestId,
            },
            { status: 500 },
        );
    }
}
