import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
    resolveClinicalApiActor,
    validateConnectorInstallationAccess,
} from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import {
    PassiveConnectorIngestRequestSchema,
    formatZodErrors,
} from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import {
    createOutcomeNetworkRepository,
    reconcileEpisodeMembership,
} from '@/lib/outcomeNetwork/service';
import { normalizePassiveConnectorPayload } from '@/lib/outcomeNetwork/passiveConnectors';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const result = PassiveConnectorIngestRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json({ error: formatZodErrors(result.error), request_id: requestId }, { status: 400 });
    }

    const body = result.data;
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['signals:connect'],
    });
    const connectorKey = req.headers.get('x-vetios-connector-key');
    const expectedConnectorKey = process.env.PASSIVE_CONNECTOR_INGEST_KEY?.trim() ?? '';
    const hasLegacyConnectorAccess = expectedConnectorKey.length > 0 && connectorKey === expectedConnectorKey;

    const tenantId = auth.actor?.tenantId
        ?? body.connector.tenant_id
        ?? process.env.VETIOS_DEV_TENANT_ID
        ?? null;

    if (!tenantId || (!auth.actor && !hasLegacyConnectorAccess)) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    if (auth.actor) {
        const connectorAccess = validateConnectorInstallationAccess({
            actor: auth.actor,
            connectorType: body.connector.connector_type,
            vendorName: body.connector.vendor_name ?? null,
            vendorAccountRef: body.connector.vendor_account_ref ?? null,
        });
        if (!connectorAccess.ok) {
            return NextResponse.json(
                { error: connectorAccess.message, request_id: requestId },
                { status: connectorAccess.status },
            );
        }
    }

    try {
        const normalized = normalizePassiveConnectorPayload({
            connectorType: body.connector.connector_type,
            vendorName: body.connector.vendor_name ?? null,
            patientId: body.connector.patient_id ?? null,
            observedAt: body.connector.observed_at ?? null,
            payload: body.connector.payload,
        });
        const repo = createOutcomeNetworkRepository(supabase);

        let sourceId: string | null = null;
        const existingSource = await repo.findSignalSource(
            tenantId,
            body.connector.connector_type,
            body.connector.vendor_name ?? null,
            body.connector.vendor_account_ref ?? null,
        );
        if (existingSource?.id) {
            sourceId = String(existingSource.id);
        } else {
            const createdSource = await repo.createSignalSource({
                tenant_id: tenantId,
                clinic_id: body.connector.clinic_id ?? null,
                source_type: body.connector.connector_type,
                vendor_name: body.connector.vendor_name ?? null,
                vendor_account_ref: body.connector.vendor_account_ref ?? null,
            });
            sourceId = String(createdSource.id);
        }

        let signalEvent = await repo.findSignalByDedupeKey(tenantId, normalized.dedupeKey);
        const idempotent = signalEvent != null;
        if (!signalEvent) {
            signalEvent = await repo.createSignal({
                tenant_id: tenantId,
                clinic_id: body.connector.clinic_id ?? null,
                patient_id: body.connector.patient_id ?? null,
                encounter_id: body.connector.encounter_id ?? null,
                case_id: body.connector.case_id ?? null,
                episode_id: body.connector.episode_id ?? null,
                source_id: sourceId,
                signal_type: normalized.signalType,
                signal_subtype: normalized.signalSubtype,
                observed_at: normalized.observedAt,
                payload: normalized.payload,
                normalized_facts: normalized.normalizedFacts,
                confidence: normalized.confidence,
                dedupe_key: normalized.dedupeKey,
                ingestion_status: 'normalized',
            });
        }

        let episode = null;
        let reconcileError: string | null = null;
        if (body.connector.auto_reconcile !== false) {
            try {
                const reconcile = await reconcileEpisodeMembership(repo, {
                    tenantId,
                    clinicId: body.connector.clinic_id ?? null,
                    patientId: body.connector.patient_id ?? null,
                    encounterId: body.connector.encounter_id ?? null,
                    caseId: body.connector.case_id ?? null,
                    signalEventId: signalEvent.id,
                    episodeId: body.connector.episode_id ?? null,
                    primaryConditionClass: normalized.primaryConditionClass,
                    observedAt: normalized.observedAt,
                    status: normalized.episodeStatus,
                    outcomeState: normalized.outcomeState,
                    resolvedAt: normalized.resolvedAt,
                    summaryPatch: normalized.summaryPatch,
                });
                episode = reconcile.episode;
            } catch (error) {
                reconcileError = error instanceof Error
                    ? error.message
                    : 'Failed to attach passive connector signal to episode.';
            }
        }

        revalidatePath('/dataset');
        revalidatePath('/outcome');
        revalidatePath('/inference');

        const response = NextResponse.json({
            signal_event: signalEvent,
            episode,
            connector: {
                connector_type: body.connector.connector_type,
                signal_type: normalized.signalType,
                signal_subtype: normalized.signalSubtype,
                primary_condition_class: normalized.primaryConditionClass,
                episode_status: normalized.episodeStatus,
                outcome_state: normalized.outcomeState,
            },
            idempotent,
            reconcile_error: reconcileError,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] POST /api/signals/connect Error:`, error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error', request_id: requestId },
            { status: 500 },
        );
    }
}
