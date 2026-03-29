import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import {
    PassiveSignalIngestRequestSchema,
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

    const result = PassiveSignalIngestRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json({ error: formatZodErrors(result.error), request_id: requestId }, { status: 400 });
    }

    const body = result.data;

    try {
        const repo = createOutcomeNetworkRepository(getSupabaseServer());
        let sourceId = body.signal.source_id ?? null;
        if (!sourceId && body.signal.source) {
            const existingSource = await repo.findSignalSource(
                actor.tenantId,
                body.signal.source.source_type,
                body.signal.source.vendor_name ?? null,
                body.signal.source.vendor_account_ref ?? null,
            );
            if (existingSource?.id) {
                sourceId = String(existingSource.id);
            } else {
                const createdSource = await repo.createSignalSource({
                    tenant_id: actor.tenantId,
                    clinic_id: body.signal.clinic_id ?? null,
                    source_type: body.signal.source.source_type,
                    vendor_name: body.signal.source.vendor_name ?? null,
                    vendor_account_ref: body.signal.source.vendor_account_ref ?? null,
                });
                sourceId = String(createdSource.id);
            }
        }

        let signalEvent = body.signal.dedupe_key
            ? await repo.findSignalByDedupeKey(actor.tenantId, body.signal.dedupe_key)
            : null;
        const idempotent = signalEvent != null;

        if (!signalEvent) {
            signalEvent = await repo.createSignal({
                tenant_id: actor.tenantId,
                clinic_id: body.signal.clinic_id ?? null,
                patient_id: body.signal.patient_id ?? body.episode?.patient_id ?? null,
                encounter_id: body.signal.encounter_id ?? body.episode?.encounter_id ?? null,
                case_id: body.signal.case_id ?? null,
                episode_id: body.signal.episode_id ?? null,
                source_id: sourceId,
                signal_type: body.signal.signal_type,
                signal_subtype: body.signal.signal_subtype ?? null,
                observed_at: body.signal.observed_at,
                payload: body.signal.payload,
                normalized_facts: body.signal.normalized_facts,
                confidence: body.signal.confidence ?? null,
                dedupe_key: body.signal.dedupe_key ?? null,
                ingestion_status: Object.keys(body.signal.normalized_facts).length > 0 ? 'normalized' : 'pending',
            });
        }

        let reconcileResult: Awaited<ReturnType<typeof reconcileEpisodeMembership>> | null = null;
        let reconcileError: string | null = null;
        if (body.signal.auto_reconcile !== false && signalEvent) {
            try {
                reconcileResult = await reconcileEpisodeMembership(repo, {
                    tenantId: actor.tenantId,
                    clinicId: body.signal.clinic_id ?? null,
                    patientId: body.episode?.patient_id ?? body.signal.patient_id ?? null,
                    encounterId: body.episode?.encounter_id ?? body.signal.encounter_id ?? null,
                    caseId: body.signal.case_id ?? null,
                    signalEventId: signalEvent.id,
                    episodeId: body.signal.episode_id ?? null,
                    primaryConditionClass: body.episode?.primary_condition_class ?? null,
                    observedAt: body.signal.observed_at,
                    status: body.episode?.status ?? null,
                    outcomeState: body.episode?.outcome_state ?? null,
                    resolvedAt: body.episode?.resolved_at ?? null,
                    summaryPatch: body.episode?.summary_patch ?? {},
                });
            } catch (error) {
                reconcileError = error instanceof Error ? error.message : 'Failed to reconcile signal into episode.';
            }
        }

        revalidatePath('/dataset');
        const response = NextResponse.json({
            signal_event: signalEvent,
            episode: reconcileResult?.episode ?? null,
            idempotent,
            reconcile_error: reconcileError,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] POST /api/signals/ingest Error:`, error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error', request_id: requestId },
            { status: 500 },
        );
    }
}
