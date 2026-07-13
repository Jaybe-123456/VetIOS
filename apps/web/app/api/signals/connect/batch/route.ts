import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    resolveClinicalApiActor,
    validateConnectorInstallationAccess,
    type ClinicalApiActor,
} from '@/lib/auth/machineAuth';
import { enqueueOutboxEvent } from '@/lib/eventPlane/outbox';
import { apiGuard } from '@/lib/http/apiGuard';
import {
    PassiveConnectorBatchIngestRequestSchema,
    formatZodErrors,
    type PassiveConnectorBatchIngestRequest,
} from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { normalizePassiveConnectorPayload } from '@/lib/outcomeNetwork/passiveConnectors';
import {
    createOutcomeNetworkRepository,
    reconcileEpisodeMembership,
} from '@/lib/outcomeNetwork/service';
import {
    buildWorkflowConnectorEvidence,
    buildWorkflowIntegrationReadiness,
    buildWorkflowIntegrationRunAuditDraft,
    type WorkflowConnectorEvidencePacket,
    type WorkflowIntegrationRunAuditDraft,
} from '@/lib/outcomeNetwork/workflowConnectorEvidence';
import { resolvePassiveConnectorWorkflow } from '@/lib/outcomeNetwork/pimsWorkflowAdapter';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BatchConnectorEvent = PassiveConnectorBatchIngestRequest['connector_batch']['events'][number];
type OutcomeNetworkRepository = ReturnType<typeof createOutcomeNetworkRepository>;

interface PreparedBatchEvent {
    index: number;
    requestId: string;
    sourceId: string | null;
    signalEventId: string;
    idempotent: boolean;
    reconcileQueued: boolean;
    outboxEventId: string | null;
    reconcileError: string | null;
    packet: WorkflowConnectorEvidencePacket;
    evidence: Record<string, unknown>;
    response: Record<string, unknown>;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 12, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const result = PassiveConnectorBatchIngestRequestSchema.safeParse(parsed.data);
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
        ?? body.connector_batch.tenant_id
        ?? process.env.VETIOS_DEV_TENANT_ID
        ?? null;

    if (!tenantId || (!auth.actor && !hasLegacyConnectorAccess)) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const repo = createOutcomeNetworkRepository(supabase);
    const prepared: PreparedBatchEvent[] = [];
    const failures: Array<{ index: number; error: string }> = [];
    const batchRequestId = normalizeOptionalText(body.connector_batch.batch_id) ?? requestId;

    for (const [index, event] of body.connector_batch.events.entries()) {
        const eventRequestId = `${batchRequestId}:${String(index + 1).padStart(3, '0')}`;
        try {
            prepared.push(await prepareBatchEvent({
                client: supabase,
                repo,
                req,
                actor: auth.actor,
                hasLegacyConnectorAccess,
                tenantId,
                requestId: eventRequestId,
                batchId: body.connector_batch.batch_id ?? null,
                batchDefaults: body.connector_batch,
                event,
                index,
            }));
        } catch (error) {
            failures.push({
                index,
                error: error instanceof Error ? error.message : 'Failed to process connector event.',
            });
        }
    }

    const readiness = buildWorkflowIntegrationReadiness({
        packets: prepared.map((entry) => entry.packet),
    });
    const workflowEvidence = [];

    for (const entry of prepared) {
        const auditDraft = buildWorkflowIntegrationRunAuditDraft({
            tenantId,
            requestId: entry.requestId,
            signalEventId: entry.signalEventId,
            packet: entry.packet,
            readiness,
            evidence: entry.evidence,
        });
        const persisted = await persistWorkflowIntegrationRunEvent(supabase, auditDraft);
        workflowEvidence.push({
            ...entry.response,
            workflow_evidence: {
                run_event_id: persisted.id,
                warning: persisted.warning,
                status: entry.packet.evidence_status,
                moat_posture: entry.packet.moat_posture,
                readiness_score: entry.packet.readiness_score,
                workflow_moat_status: auditDraft.workflow_moat_status,
                workflow_readiness_score: auditDraft.workflow_readiness_score,
            },
        });
    }

    revalidatePath('/dataset');
    revalidatePath('/outcome');
    revalidatePath('/inference');

    const response = NextResponse.json({
        batch: {
            batch_id: body.connector_batch.batch_id ?? null,
            tenant_id: tenantId,
            events_received: body.connector_batch.events.length,
            events_ingested: prepared.length,
            events_failed: failures.length,
            workflow_moat_status: readiness.moat_status,
            workflow_readiness_score: readiness.readiness_score,
            raw_vendor_payloads_stored_in_workflow_ledger: false,
        },
        readiness,
        events: workflowEvidence,
        failures,
        request_id: requestId,
    }, {
        status: failures.length > 0 && prepared.length > 0 ? 207 : failures.length > 0 ? 400 : 200,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

async function prepareBatchEvent(input: {
    client: SupabaseClient;
    repo: OutcomeNetworkRepository;
    req: Request;
    actor: ClinicalApiActor | null;
    hasLegacyConnectorAccess: boolean;
    tenantId: string;
    requestId: string;
    batchId: string | null;
    batchDefaults: PassiveConnectorBatchIngestRequest['connector_batch'];
    event: BatchConnectorEvent;
    index: number;
}): Promise<PreparedBatchEvent> {
    const connector = mergeBatchConnectorEvent(input.batchDefaults, input.event);
    const workflow = resolvePassiveConnectorWorkflow({
        connectorType: connector.connector_type ?? null,
        vendorName: connector.vendor_name ?? null,
        vendorEventType: connector.workflow_event_type ?? null,
        payload: connector.payload,
    });

    if (input.actor) {
        const connectorAccess = validateConnectorInstallationAccess({
            actor: input.actor,
            connectorType: workflow.connectorType,
            vendorName: connector.vendor_name ?? null,
            vendorAccountRef: connector.vendor_account_ref ?? null,
        });
        if (!connectorAccess.ok) {
            throw new Error(connectorAccess.message);
        }
    }

    const normalized = normalizePassiveConnectorPayload({
        connectorType: workflow.connectorType,
        vendorName: connector.vendor_name ?? null,
        patientId: connector.patient_id ?? null,
        observedAt: connector.observed_at ?? null,
        payload: workflow.payload,
    });

    let sourceId: string | null = null;
    const existingSource = await input.repo.findSignalSource(
        input.tenantId,
        workflow.connectorType,
        connector.vendor_name ?? null,
        connector.vendor_account_ref ?? null,
    );
    if (existingSource?.id) {
        sourceId = String(existingSource.id);
    } else {
        const createdSource = await input.repo.createSignalSource({
            tenant_id: input.tenantId,
            clinic_id: connector.clinic_id ?? null,
            source_type: workflow.connectorType,
            vendor_name: connector.vendor_name ?? null,
            vendor_account_ref: connector.vendor_account_ref ?? null,
        });
        sourceId = String(createdSource.id);
    }

    let signalEvent = await input.repo.findSignalByDedupeKey(input.tenantId, normalized.dedupeKey);
    const idempotent = signalEvent != null;
    if (!signalEvent) {
        signalEvent = await input.repo.createSignal({
            tenant_id: input.tenantId,
            clinic_id: connector.clinic_id ?? null,
            patient_id: connector.patient_id ?? null,
            encounter_id: connector.encounter_id ?? null,
            case_id: connector.case_id ?? null,
            episode_id: connector.episode_id ?? null,
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

    let reconcileQueued = false;
    let reconcileError: string | null = null;
    let outboxEventId: string | null = null;
    if (connector.auto_reconcile !== false) {
        const deferReconcile = shouldDeferSignalReconcile(
            input.actor?.authMode ?? null,
            input.req,
            input.hasLegacyConnectorAccess,
        );
        if (deferReconcile) {
            if (signalEvent.ingestion_status !== 'attached') {
                signalEvent = await input.repo.updateSignal(input.tenantId, signalEvent.id, {
                    ingestion_status: 'queued',
                });
                const queued = await enqueueOutboxEvent(input.client, {
                    tenantId: input.tenantId,
                    topic: 'passive_signal.reconcile_requested',
                    handlerKey: 'passive_signal_reconcile',
                    idempotencyKey: `signal-reconcile:${signalEvent.id}`,
                    payload: {
                        signal_event_id: signalEvent.id,
                        clinic_id: connector.clinic_id ?? null,
                        patient_id: connector.patient_id ?? null,
                        encounter_id: connector.encounter_id ?? null,
                        case_id: connector.case_id ?? null,
                        episode_id: connector.episode_id ?? null,
                        primary_condition_class: normalized.primaryConditionClass,
                        observed_at: normalized.observedAt,
                        status: normalized.episodeStatus,
                        outcome_state: normalized.outcomeState,
                        resolved_at: normalized.resolvedAt,
                        summary_patch: normalized.summaryPatch,
                    },
                    metadata: {
                        source_module: 'api/signals/connect/batch',
                        connector_type: workflow.connectorType,
                        vendor_name: connector.vendor_name ?? null,
                        vendor_account_ref: connector.vendor_account_ref ?? null,
                        workflow_event_type: workflow.vendorEventType,
                        normalized_by: workflow.normalizedBy,
                    },
                });
                outboxEventId = queued.event.id;
                reconcileQueued = true;
            }
        } else {
            try {
                await reconcileEpisodeMembership(input.repo, {
                    tenantId: input.tenantId,
                    clinicId: connector.clinic_id ?? null,
                    patientId: connector.patient_id ?? null,
                    encounterId: connector.encounter_id ?? null,
                    caseId: connector.case_id ?? null,
                    signalEventId: signalEvent.id,
                    episodeId: connector.episode_id ?? null,
                    primaryConditionClass: normalized.primaryConditionClass,
                    observedAt: normalized.observedAt,
                    status: normalized.episodeStatus,
                    outcomeState: normalized.outcomeState,
                    resolvedAt: normalized.resolvedAt,
                    summaryPatch: normalized.summaryPatch,
                });
            } catch (error) {
                reconcileError = error instanceof Error
                    ? error.message
                    : 'Failed to attach passive connector signal to episode.';
            }
        }
    }

    const packet = buildWorkflowConnectorEvidence({
        connectorType: connector.connector_type ?? null,
        vendorName: connector.vendor_name ?? null,
        vendorAccountRef: connector.vendor_account_ref ?? null,
        vendorEventType: connector.workflow_event_type ?? null,
        patientId: connector.patient_id ?? null,
        encounterId: connector.encounter_id ?? null,
        caseId: connector.case_id ?? null,
        episodeId: connector.episode_id ?? null,
        observedAt: connector.observed_at ?? null,
        payload: connector.payload,
    });

    return {
        index: input.index,
        requestId: input.requestId,
        sourceId,
        signalEventId: signalEvent.id,
        idempotent,
        reconcileQueued,
        outboxEventId,
        reconcileError,
        packet,
        evidence: {
            endpoint: '/api/signals/connect/batch',
            batch_id: input.batchId,
            event_index: input.index,
            source_id: sourceId,
            idempotent,
            reconcile_queued: reconcileQueued,
            outbox_event_id: outboxEventId,
            raw_payload_stored_in_workflow_ledger: false,
        },
        response: {
            index: input.index,
            request_id: input.requestId,
            signal_event_id: signalEvent.id,
            source_id: sourceId,
            connector: {
                connector_type: workflow.connectorType,
                workflow_event_type: workflow.vendorEventType,
                normalized_by: workflow.normalizedBy,
                warnings: workflow.warnings,
                signal_type: normalized.signalType,
                signal_subtype: normalized.signalSubtype,
                primary_condition_class: normalized.primaryConditionClass,
                episode_status: normalized.episodeStatus,
                outcome_state: normalized.outcomeState,
            },
            idempotent,
            reconcile_queued: reconcileQueued,
            outbox_event_id: outboxEventId,
            reconcile_error: reconcileError,
        },
    };
}

function mergeBatchConnectorEvent(
    batch: PassiveConnectorBatchIngestRequest['connector_batch'],
    event: BatchConnectorEvent,
): BatchConnectorEvent & { auto_reconcile: boolean; payload: Record<string, unknown> } {
    return {
        ...event,
        tenant_id: event.tenant_id ?? batch.tenant_id,
        vendor_name: event.vendor_name ?? batch.vendor_name,
        vendor_account_ref: event.vendor_account_ref ?? batch.vendor_account_ref,
        clinic_id: event.clinic_id ?? batch.clinic_id,
        auto_reconcile: event.auto_reconcile ?? batch.auto_reconcile ?? true,
        payload: event.payload ?? {},
    };
}

function shouldDeferSignalReconcile(
    authMode: 'session' | 'dev_bypass' | 'service_account' | 'connector_installation' | 'oauth_client' | null,
    req: Request,
    hasLegacyConnectorAccess: boolean,
): boolean {
    const requestedMode = req.headers.get('x-vetios-event-mode')?.trim().toLowerCase();
    if (requestedMode === 'async') {
        return true;
    }

    return hasLegacyConnectorAccess
        || authMode === 'service_account'
        || authMode === 'connector_installation'
        || authMode === 'oauth_client';
}

async function persistWorkflowIntegrationRunEvent(
    client: SupabaseClient,
    draft: WorkflowIntegrationRunAuditDraft,
): Promise<{ id: string | null; warning: string | null }> {
    const { data, error } = await client
        .from('workflow_integration_run_events')
        .insert(draft)
        .select('id')
        .single();

    if (error || !data?.id) {
        const message = error?.message ?? 'unknown persistence failure';
        return {
            id: null,
            warning: isMissingWorkflowIntegrationRunStorage(message)
                ? 'Workflow integration run ledger is not installed; apply supabase/migrations/20260622020000_workflow_integration_run_events.sql to persist PIMS/lab/PACS/follow-up evidence.'
                : `Workflow integration run event was not persisted: ${message}`,
        };
    }

    return { id: String(data.id), warning: null };
}

function isMissingWorkflowIntegrationRunStorage(message: string): boolean {
    return message.includes('workflow_integration_run_events')
        && (
            message.includes('does not exist')
            || message.includes('Could not find the table')
            || message.includes('schema cache')
        );
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
