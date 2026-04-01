import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
    resolveClinicalApiActor,
    validateConnectorInstallationAccess,
} from '@/lib/auth/machineAuth';
import { enqueueOutboxEvent } from '@/lib/eventPlane/outbox';
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
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['signals:ingest'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const actor = auth.actor;
    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const result = PassiveSignalIngestRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json({ error: formatZodErrors(result.error), request_id: requestId }, { status: 400 });
    }

    const body = result.data;
    if (body.signal.source) {
        const connectorAccess = validateConnectorInstallationAccess({
            actor,
            connectorType: body.signal.source.source_type,
            vendorName: body.signal.source.vendor_name ?? null,
            vendorAccountRef: body.signal.source.vendor_account_ref ?? null,
        });
        if (!connectorAccess.ok) {
            return NextResponse.json(
                { error: connectorAccess.message, request_id: requestId },
                { status: connectorAccess.status },
            );
        }
    }

    try {
        const repo = createOutcomeNetworkRepository(supabase);
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
        let outboxEventId: string | null = null;
        let reconcileQueued = false;
        let reconcileError: string | null = null;
        if (body.signal.auto_reconcile !== false && signalEvent) {
            const deferReconcile = shouldDeferSignalReconcile(actor.authMode, req);
            if (deferReconcile) {
                if (signalEvent.episode_id) {
                    const existingEpisode = await repo.findEpisodeById(actor.tenantId, signalEvent.episode_id);
                    reconcileResult = existingEpisode ? { episode: existingEpisode, signal_event: signalEvent, clinical_case: null } : null;
                }

                if (signalEvent.ingestion_status !== 'attached') {
                    signalEvent = await repo.updateSignal(actor.tenantId, signalEvent.id, {
                        ingestion_status: 'queued',
                    });
                    const queued = await enqueueOutboxEvent(supabase, {
                        tenantId: actor.tenantId,
                        topic: 'passive_signal.reconcile_requested',
                        handlerKey: 'passive_signal_reconcile',
                        idempotencyKey: `signal-reconcile:${signalEvent.id}`,
                        payload: {
                            signal_event_id: signalEvent.id,
                            clinic_id: body.signal.clinic_id ?? null,
                            patient_id: body.episode?.patient_id ?? body.signal.patient_id ?? null,
                            encounter_id: body.episode?.encounter_id ?? body.signal.encounter_id ?? null,
                            case_id: body.signal.case_id ?? null,
                            episode_id: body.signal.episode_id ?? null,
                            primary_condition_class: body.episode?.primary_condition_class ?? null,
                            observed_at: body.signal.observed_at,
                            status: body.episode?.status ?? null,
                            outcome_state: body.episode?.outcome_state ?? null,
                            resolved_at: body.episode?.resolved_at ?? null,
                            summary_patch: body.episode?.summary_patch ?? {},
                        },
                        metadata: {
                            source_module: 'api/signals/ingest',
                            source_type: body.signal.source?.source_type ?? null,
                            vendor_name: body.signal.source?.vendor_name ?? null,
                            vendor_account_ref: body.signal.source?.vendor_account_ref ?? null,
                        },
                    });
                    outboxEventId = queued.event.id;
                    reconcileQueued = true;
                }
            } else {
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
        }

        revalidatePath('/dataset');
        const response = NextResponse.json({
            signal_event: signalEvent,
            episode: reconcileResult?.episode ?? null,
            idempotent,
            reconcile_queued: reconcileQueued,
            outbox_event_id: outboxEventId,
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

function shouldDeferSignalReconcile(
    authMode: 'session' | 'dev_bypass' | 'service_account' | 'connector_installation',
    req: Request,
): boolean {
    const requestedMode = req.headers.get('x-vetios-event-mode')?.trim().toLowerCase();
    if (requestedMode === 'async') {
        return true;
    }

    return authMode === 'service_account' || authMode === 'connector_installation';
}
