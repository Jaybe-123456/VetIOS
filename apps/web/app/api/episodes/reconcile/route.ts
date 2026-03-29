import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import {
    EpisodeReconcileRequestSchema,
    formatZodErrors,
} from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import {
    createOutcomeNetworkRepository,
    reconcileEpisodeMembership,
} from '@/lib/outcomeNetwork/service';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const result = EpisodeReconcileRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json({ error: formatZodErrors(result.error), request_id: requestId }, { status: 400 });
    }

    try {
        const repo = createOutcomeNetworkRepository(getSupabaseServer());
        const episode = await reconcileEpisodeMembership(repo, {
            tenantId: actor.tenantId,
            clinicId: result.data.clinic_id ?? null,
            patientId: result.data.patient_id ?? null,
            encounterId: result.data.encounter_id ?? null,
            caseId: result.data.case_id ?? null,
            signalEventId: result.data.signal_event_id ?? null,
            episodeId: result.data.episode_id ?? null,
            primaryConditionClass: result.data.primary_condition_class ?? null,
            observedAt: result.data.observed_at ?? new Date().toISOString(),
            status: result.data.status ?? null,
            outcomeState: result.data.outcome_state ?? null,
            resolvedAt: result.data.resolved_at ?? null,
            summaryPatch: result.data.summary_patch ?? {},
        });

        revalidatePath('/dataset');
        const response = NextResponse.json({
            ...episode,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] POST /api/episodes/reconcile Error:`, error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error', request_id: requestId },
            { status: 500 },
        );
    }
}
