import type { SupabaseClient } from '@supabase/supabase-js';
import {
    CONNECTOR_DELIVERY_ATTEMPTS,
    CONNECTOR_INSTALLATIONS,
    OUTBOX_EVENTS,
} from '@/lib/db/schemaContracts';
import {
    createOutcomeNetworkRepository,
    reconcileEpisodeMembership,
} from '@/lib/outcomeNetwork/service';

type JsonObject = Record<string, unknown>;

export type OutboxStatus = 'pending' | 'processing' | 'retryable' | 'delivered' | 'dead_letter';
export type OutboxTargetType = 'internal_task' | 'connector_webhook';
export type OutboxHandlerKey = 'passive_signal_reconcile' | 'connector_webhook';
export type ConnectorDeliveryAttemptStatus = 'processing' | 'succeeded' | 'retryable' | 'dead_letter';

export interface OutboxEventRecord {
    id: string;
    tenant_id: string;
    topic: string;
    handler_key: OutboxHandlerKey;
    target_type: OutboxTargetType;
    target_ref: string | null;
    idempotency_key: string | null;
    payload: JsonObject;
    headers: JsonObject;
    metadata: JsonObject;
    status: OutboxStatus;
    attempt_count: number;
    max_attempts: number;
    available_at: string;
    locked_at: string | null;
    locked_by: string | null;
    last_error: string | null;
    delivered_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ConnectorDeliveryAttemptRecord {
    id: string;
    outbox_event_id: string;
    tenant_id: string;
    connector_installation_id: string | null;
    handler_key: OutboxHandlerKey;
    attempt_no: number;
    worker_id: string | null;
    status: ConnectorDeliveryAttemptStatus;
    request_payload: JsonObject;
    response_payload: JsonObject;
    error_message: string | null;
    started_at: string;
    finished_at: string | null;
    created_at: string;
}

export interface OutboxQueueSnapshot {
    counts: Record<OutboxStatus, number>;
    recent_events: OutboxEventRecord[];
    recent_attempts: ConnectorDeliveryAttemptRecord[];
}

export interface OutboxQueueSnapshotOptions {
    limit?: number;
    status?: OutboxStatus | 'all' | null;
    attemptStatus?: ConnectorDeliveryAttemptStatus | 'all' | null;
    topic?: string | null;
    handlerKey?: OutboxHandlerKey | 'all' | null;
}

export interface EnqueueOutboxEventInput {
    tenantId: string;
    topic: string;
    handlerKey: OutboxHandlerKey;
    targetType?: OutboxTargetType;
    targetRef?: string | null;
    idempotencyKey?: string | null;
    payload?: JsonObject;
    headers?: JsonObject;
    metadata?: JsonObject;
    availableAt?: string | null;
    maxAttempts?: number;
}

export interface DispatchOutboxBatchResult {
    leased_count: number;
    delivered_count: number;
    retryable_count: number;
    dead_letter_count: number;
    processed: Array<{
        event_id: string;
        topic: string;
        status: OutboxStatus;
        error: string | null;
    }>;
}

export interface RequeueOutboxEventsResult {
    count: number;
    event_ids: string[];
}

interface HandlerResult {
    status: 'succeeded' | 'retryable' | 'dead_letter';
    responsePayload?: JsonObject;
    errorMessage?: string | null;
    retryAfterMs?: number | null;
    connectorInstallationId?: string | null;
}

export async function enqueueOutboxEvent(
    client: SupabaseClient,
    input: EnqueueOutboxEventInput,
): Promise<{ event: OutboxEventRecord; created: boolean }> {
    const C = OUTBOX_EVENTS.COLUMNS;
    const idempotencyKey = normalizeOptionalText(input.idempotencyKey);
    if (idempotencyKey) {
        const { data: existing, error: lookupError } = await client
            .from(OUTBOX_EVENTS.TABLE)
            .select('*')
            .eq(C.tenant_id, input.tenantId)
            .eq(C.idempotency_key, idempotencyKey)
            .maybeSingle();

        if (lookupError) {
            throw new Error(`Failed to resolve outbox idempotency key: ${lookupError.message}`);
        }
        if (existing) {
            return {
                event: mapOutboxEvent(existing as JsonObject),
                created: false,
            };
        }
    }

    const { data, error } = await client
        .from(OUTBOX_EVENTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.topic]: normalizeRequiredText(input.topic, 'topic'),
            [C.handler_key]: input.handlerKey,
            [C.target_type]: input.targetType ?? 'internal_task',
            [C.target_ref]: normalizeOptionalText(input.targetRef),
            [C.idempotency_key]: idempotencyKey,
            [C.payload]: input.payload ?? {},
            [C.headers]: input.headers ?? {},
            [C.metadata]: input.metadata ?? {},
            [C.status]: 'pending',
            [C.available_at]: normalizeTimestamp(input.availableAt) ?? new Date().toISOString(),
            [C.max_attempts]: normalizePositiveInteger(input.maxAttempts) ?? 6,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to enqueue outbox event: ${error?.message ?? 'Unknown error'}`);
    }

    return {
        event: mapOutboxEvent(data as JsonObject),
        created: true,
    };
}

export async function getOutboxQueueSnapshot(
    client: SupabaseClient,
    tenantId: string,
    options: OutboxQueueSnapshotOptions = {},
): Promise<OutboxQueueSnapshot> {
    const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
    const outboxColumns = OUTBOX_EVENTS.COLUMNS;
    const attemptColumns = CONNECTOR_DELIVERY_ATTEMPTS.COLUMNS;
    let eventQuery = client
        .from(OUTBOX_EVENTS.TABLE)
        .select('*')
        .eq(outboxColumns.tenant_id, tenantId)
        .order(outboxColumns.created_at, { ascending: false })
        .limit(limit);

    const statusFilter = normalizeSnapshotStatusFilter(options.status);
    if (statusFilter) {
        eventQuery = eventQuery.eq(outboxColumns.status, statusFilter);
    }
    const handlerFilter = normalizeSnapshotHandlerFilter(options.handlerKey);
    if (handlerFilter) {
        eventQuery = eventQuery.eq(outboxColumns.handler_key, handlerFilter);
    }
    const topicFilter = normalizeOptionalText(options.topic);
    if (topicFilter) {
        eventQuery = eventQuery.eq(outboxColumns.topic, topicFilter);
    }

    let attemptQuery = client
        .from(CONNECTOR_DELIVERY_ATTEMPTS.TABLE)
        .select('*')
        .eq(attemptColumns.tenant_id, tenantId)
        .order(attemptColumns.created_at, { ascending: false })
        .limit(limit);

    const attemptStatusFilter = normalizeSnapshotAttemptStatusFilter(options.attemptStatus);
    if (attemptStatusFilter) {
        attemptQuery = attemptQuery.eq(attemptColumns.status, attemptStatusFilter);
    }
    if (handlerFilter) {
        attemptQuery = attemptQuery.eq(attemptColumns.handler_key, handlerFilter);
    }

    const [{ data: events, error: eventError }, { data: attempts, error: attemptError }, counts] = await Promise.all([
        eventQuery,
        attemptQuery,
        countOutboxEventsByStatus(client, tenantId),
    ]);

    if (eventError) {
        throw new Error(`Failed to load outbox snapshot: ${eventError.message}`);
    }
    if (attemptError) {
        throw new Error(`Failed to load outbox delivery attempts: ${attemptError.message}`);
    }

    return {
        counts,
        recent_events: (events ?? []).map((row) => mapOutboxEvent(row as JsonObject)),
        recent_attempts: (attempts ?? []).map((row) => mapConnectorDeliveryAttempt(row as JsonObject)),
    };
}

export async function requeueOutboxEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        eventId: string;
    },
): Promise<OutboxEventRecord> {
    const C = OUTBOX_EVENTS.COLUMNS;
    const { data, error } = await client
        .from(OUTBOX_EVENTS.TABLE)
        .update({
            [C.status]: 'pending',
            [C.available_at]: new Date().toISOString(),
            [C.locked_at]: null,
            [C.locked_by]: null,
            [C.last_error]: null,
            [C.delivered_at]: null,
            [C.attempt_count]: 0,
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, input.eventId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to requeue outbox event: ${error?.message ?? 'Unknown error'}`);
    }

    const event = mapOutboxEvent(data as JsonObject);
    await markPassiveSignalQueued(client, event);
    return event;
}

export async function requeueDeadLetterEvents(
    client: SupabaseClient,
    input: {
        tenantId: string;
        limit?: number;
        handlerKey?: OutboxHandlerKey | null;
    },
): Promise<RequeueOutboxEventsResult> {
    const C = OUTBOX_EVENTS.COLUMNS;
    let query = client
        .from(OUTBOX_EVENTS.TABLE)
        .select(C.id)
        .eq(C.tenant_id, input.tenantId)
        .eq(C.status, 'dead_letter')
        .order(C.created_at, { ascending: true })
        .limit(Math.max(1, Math.min(input.limit ?? 25, 100)));

    if (input.handlerKey) {
        query = query.eq(C.handler_key, input.handlerKey);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to load dead-letter events: ${error.message}`);
    }

    const eventIds = (data ?? [])
        .map((row) => normalizeOptionalText((row as JsonObject).id))
        .filter((value): value is string => value != null);

    if (eventIds.length === 0) {
        return { count: 0, event_ids: [] };
    }

    await Promise.all(eventIds.map((eventId) =>
        requeueOutboxEvent(client, {
            tenantId: input.tenantId,
            eventId,
        })
    ));

    return {
        count: eventIds.length,
        event_ids: eventIds,
    };
}

export async function releaseStaleOutboxEvents(
    client: SupabaseClient,
    input: {
        tenantId?: string | null;
        olderThanMinutes?: number;
    } = {},
): Promise<RequeueOutboxEventsResult> {
    const olderThanMinutes = Math.max(1, Math.min(input.olderThanMinutes ?? 5, 120));
    const threshold = new Date(Date.now() - (olderThanMinutes * 60 * 1000)).toISOString();
    const C = OUTBOX_EVENTS.COLUMNS;

    let query = client
        .from(OUTBOX_EVENTS.TABLE)
        .update({
            [C.status]: 'retryable',
            [C.available_at]: new Date().toISOString(),
            [C.locked_at]: null,
            [C.locked_by]: null,
            [C.last_error]: 'Lease released by operator after stale processing timeout.',
        })
        .eq(C.status, 'processing')
        .lt(C.locked_at, threshold)
        .select(C.id);

    const tenantId = normalizeOptionalText(input.tenantId);
    if (tenantId) {
        query = query.eq(C.tenant_id, tenantId);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to release stale outbox leases: ${error.message}`);
    }

    const eventIds = (data ?? [])
        .map((row) => normalizeOptionalText((row as JsonObject).id))
        .filter((value): value is string => value != null);

    return {
        count: eventIds.length,
        event_ids: eventIds,
    };
}

export async function dispatchOutboxBatch(
    client: SupabaseClient,
    input: {
        workerId: string;
        batchSize?: number;
        tenantId?: string | null;
        topics?: string[] | null;
    },
): Promise<DispatchOutboxBatchResult> {
    const events = await leaseOutboxBatch(client, input);
    const processed: DispatchOutboxBatchResult['processed'] = [];
    let deliveredCount = 0;
    let retryableCount = 0;
    let deadLetterCount = 0;

    for (const event of events) {
        const result = await processOutboxEvent(client, event, input.workerId);
        processed.push({
            event_id: event.id,
            topic: event.topic,
            status: result.status,
            error: result.error,
        });

        if (result.status === 'delivered') deliveredCount += 1;
        if (result.status === 'retryable') retryableCount += 1;
        if (result.status === 'dead_letter') deadLetterCount += 1;
    }

    return {
        leased_count: events.length,
        delivered_count: deliveredCount,
        retryable_count: retryableCount,
        dead_letter_count: deadLetterCount,
        processed,
    };
}

async function leaseOutboxBatch(
    client: SupabaseClient,
    input: {
        workerId: string;
        batchSize?: number;
        tenantId?: string | null;
        topics?: string[] | null;
    },
): Promise<OutboxEventRecord[]> {
    const { data, error } = await client.rpc('lease_outbox_events', {
        p_worker_id: normalizeRequiredText(input.workerId, 'worker_id'),
        p_batch_size: normalizePositiveInteger(input.batchSize) ?? 20,
        p_topics: input.topics?.length ? input.topics : null,
        p_tenant_id: normalizeOptionalText(input.tenantId),
    });

    if (error) {
        throw new Error(`Failed to lease outbox events: ${error.message}`);
    }

    return Array.isArray(data)
        ? data.map((row) => mapOutboxEvent(row as JsonObject))
        : [];
}

async function processOutboxEvent(
    client: SupabaseClient,
    event: OutboxEventRecord,
    workerId: string,
): Promise<{ status: OutboxStatus; error: string | null }> {
    const attempt = await beginConnectorDeliveryAttempt(client, event, workerId);
    const handlerResult = await executeOutboxHandler(client, event);

    if (handlerResult.status === 'succeeded') {
        await Promise.all([
            finalizeOutboxEvent(client, event, {
                status: 'delivered',
                errorMessage: null,
            }),
            completeConnectorDeliveryAttempt(client, attempt.id, {
                status: 'succeeded',
                responsePayload: handlerResult.responsePayload ?? {},
                errorMessage: null,
            }),
        ]);
        return { status: 'delivered', error: null };
    }

    const terminalStatus: OutboxStatus =
        handlerResult.status === 'dead_letter' || event.attempt_count >= event.max_attempts
            ? 'dead_letter'
            : 'retryable';
    const retryDelayMs = handlerResult.retryAfterMs ?? computeRetryDelayMs(event.attempt_count);
    await Promise.all([
        finalizeOutboxEvent(client, event, {
            status: terminalStatus,
            errorMessage: handlerResult.errorMessage ?? 'Outbox delivery failed.',
            retryDelayMs: terminalStatus === 'retryable' ? retryDelayMs : null,
        }),
        completeConnectorDeliveryAttempt(client, attempt.id, {
            status: terminalStatus === 'dead_letter' ? 'dead_letter' : 'retryable',
            responsePayload: handlerResult.responsePayload ?? {},
            errorMessage: handlerResult.errorMessage ?? 'Outbox delivery failed.',
        }),
    ]);
    await reflectSignalIngestionStatus(client, event, terminalStatus);

    return {
        status: terminalStatus,
        error: handlerResult.errorMessage ?? 'Outbox delivery failed.',
    };
}

async function executeOutboxHandler(
    client: SupabaseClient,
    event: OutboxEventRecord,
): Promise<HandlerResult> {
    if (event.handler_key === 'passive_signal_reconcile') {
        return handlePassiveSignalReconcile(client, event);
    }

    if (event.handler_key === 'connector_webhook') {
        return handleConnectorWebhook(client, event);
    }

    return {
        status: 'dead_letter',
        errorMessage: `Unsupported outbox handler: ${event.handler_key}`,
    };
}

async function handlePassiveSignalReconcile(
    client: SupabaseClient,
    event: OutboxEventRecord,
): Promise<HandlerResult> {
    const payload = event.payload;
    const signalEventId = normalizeOptionalText(payload.signal_event_id);
    if (!signalEventId) {
        return {
            status: 'dead_letter',
            errorMessage: 'passive_signal_reconcile requires signal_event_id.',
        };
    }

    const repo = createOutcomeNetworkRepository(client);

    try {
        const reconcile = await reconcileEpisodeMembership(repo, {
            tenantId: event.tenant_id,
            clinicId: normalizeOptionalText(payload.clinic_id),
            patientId: normalizeOptionalText(payload.patient_id),
            encounterId: normalizeOptionalText(payload.encounter_id),
            caseId: normalizeOptionalText(payload.case_id),
            signalEventId,
            episodeId: normalizeOptionalText(payload.episode_id),
            primaryConditionClass: normalizeOptionalText(payload.primary_condition_class),
            observedAt: normalizeTimestamp(payload.observed_at) ?? new Date().toISOString(),
            status: normalizeOptionalText(payload.status),
            outcomeState: normalizeOptionalText(payload.outcome_state),
            resolvedAt: normalizeTimestamp(payload.resolved_at),
            summaryPatch: asRecord(payload.summary_patch),
        });

        return {
            status: 'succeeded',
            responsePayload: {
                episode_id: reconcile.episode.id,
                signal_event_id: reconcile.signal_event?.id ?? signalEventId,
                clinical_case_id: reconcile.clinical_case?.id ?? null,
            },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to reconcile passive signal.';
        return {
            status: isPermanentPassiveSignalError(message) ? 'dead_letter' : 'retryable',
            errorMessage: message,
        };
    }
}

async function handleConnectorWebhook(
    client: SupabaseClient,
    event: OutboxEventRecord,
): Promise<HandlerResult> {
    const installation = event.target_ref
        ? await loadConnectorInstallation(client, event.tenant_id, event.target_ref)
        : null;
    const metadata = {
        ...installation?.metadata,
        ...event.metadata,
    };
    const targetUrl = normalizeOptionalText(metadata.webhook_url);

    if (!targetUrl) {
        return {
            status: 'dead_letter',
            errorMessage: 'connector_webhook requires metadata.webhook_url or a connector installation with webhook_url.',
            connectorInstallationId: installation?.id ?? null,
        };
    }

    try {
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: buildWebhookHeaders(event),
            body: JSON.stringify({
                event_id: event.id,
                topic: event.topic,
                tenant_id: event.tenant_id,
                created_at: event.created_at,
                payload: event.payload,
                metadata: event.metadata,
            }),
        });
        const responseText = await response.text();
        if (response.ok) {
            return {
                status: 'succeeded',
                responsePayload: {
                    status_code: response.status,
                    response_excerpt: truncateText(responseText, 500),
                },
                connectorInstallationId: installation?.id ?? null,
            };
        }

        return {
            status: isRetryableHttpStatus(response.status) ? 'retryable' : 'dead_letter',
            errorMessage: `Webhook delivery failed with status ${response.status}.`,
            responsePayload: {
                status_code: response.status,
                response_excerpt: truncateText(responseText, 500),
            },
            connectorInstallationId: installation?.id ?? null,
        };
    } catch (error) {
        return {
            status: 'retryable',
            errorMessage: error instanceof Error ? error.message : 'Webhook delivery failed.',
            connectorInstallationId: installation?.id ?? null,
        };
    }
}

async function beginConnectorDeliveryAttempt(
    client: SupabaseClient,
    event: OutboxEventRecord,
    workerId: string,
): Promise<ConnectorDeliveryAttemptRecord> {
    const C = CONNECTOR_DELIVERY_ATTEMPTS.COLUMNS;
    const { data, error } = await client
        .from(CONNECTOR_DELIVERY_ATTEMPTS.TABLE)
        .insert({
            [C.outbox_event_id]: event.id,
            [C.tenant_id]: event.tenant_id,
            [C.connector_installation_id]: event.target_type === 'connector_webhook'
                ? normalizeOptionalText(event.target_ref)
                : null,
            [C.handler_key]: event.handler_key,
            [C.attempt_no]: event.attempt_count,
            [C.worker_id]: workerId,
            [C.status]: 'processing',
            [C.request_payload]: {
                topic: event.topic,
                payload: event.payload,
                metadata: event.metadata,
                target_type: event.target_type,
                target_ref: event.target_ref,
            },
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create connector delivery attempt: ${error?.message ?? 'Unknown error'}`);
    }

    return mapConnectorDeliveryAttempt(data as JsonObject);
}

async function completeConnectorDeliveryAttempt(
    client: SupabaseClient,
    attemptId: string,
    input: {
        status: ConnectorDeliveryAttemptStatus;
        responsePayload: JsonObject;
        errorMessage: string | null;
    },
): Promise<void> {
    const C = CONNECTOR_DELIVERY_ATTEMPTS.COLUMNS;
    const { error } = await client
        .from(CONNECTOR_DELIVERY_ATTEMPTS.TABLE)
        .update({
            [C.status]: input.status,
            [C.response_payload]: input.responsePayload,
            [C.error_message]: input.errorMessage,
            [C.finished_at]: new Date().toISOString(),
        })
        .eq(C.id, attemptId);

    if (error) {
        throw new Error(`Failed to finalize connector delivery attempt: ${error.message}`);
    }
}

async function finalizeOutboxEvent(
    client: SupabaseClient,
    event: OutboxEventRecord,
    input: {
        status: OutboxStatus;
        errorMessage: string | null;
        retryDelayMs?: number | null;
    },
): Promise<void> {
    const C = OUTBOX_EVENTS.COLUMNS;
    const availableAt = input.status === 'retryable'
        ? new Date(Date.now() + Math.max(input.retryDelayMs ?? 0, 5_000)).toISOString()
        : new Date().toISOString();

    const { error } = await client
        .from(OUTBOX_EVENTS.TABLE)
        .update({
            [C.status]: input.status,
            [C.available_at]: availableAt,
            [C.locked_at]: null,
            [C.locked_by]: null,
            [C.last_error]: input.errorMessage,
            [C.delivered_at]: input.status === 'delivered' ? new Date().toISOString() : null,
        })
        .eq(C.id, event.id);

    if (error) {
        throw new Error(`Failed to finalize outbox event: ${error.message}`);
    }
}

async function reflectSignalIngestionStatus(
    client: SupabaseClient,
    event: OutboxEventRecord,
    status: OutboxStatus,
): Promise<void> {
    if (event.handler_key !== 'passive_signal_reconcile') {
        return;
    }

    const signalEventId = normalizeOptionalText(event.payload.signal_event_id);
    if (!signalEventId) {
        return;
    }

    try {
        await createOutcomeNetworkRepository(client).updateSignal(event.tenant_id, signalEventId, {
            ingestion_status: status === 'retryable'
                ? 'retryable'
                : status === 'dead_letter'
                    ? 'dead_letter'
                    : 'attached',
        });
    } catch {
        // Best-effort reflection. The outbox event state remains the source of truth.
    }
}

async function markPassiveSignalQueued(
    client: SupabaseClient,
    event: OutboxEventRecord,
): Promise<void> {
    if (event.handler_key !== 'passive_signal_reconcile') {
        return;
    }

    const signalEventId = normalizeOptionalText(event.payload.signal_event_id);
    if (!signalEventId) {
        return;
    }

    try {
        await createOutcomeNetworkRepository(client).updateSignal(event.tenant_id, signalEventId, {
            ingestion_status: 'queued',
        });
    } catch {
        // Best-effort reflection. Outbox remains the authoritative state.
    }
}

async function loadConnectorInstallation(
    client: SupabaseClient,
    tenantId: string,
    installationId: string,
): Promise<{ id: string; metadata: JsonObject } | null> {
    const C = CONNECTOR_INSTALLATIONS.COLUMNS;
    const { data, error } = await client
        .from(CONNECTOR_INSTALLATIONS.TABLE)
        .select(`${C.id}, ${C.metadata}`)
        .eq(C.tenant_id, tenantId)
        .eq(C.id, installationId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load connector installation: ${error.message}`);
    }

    if (!data) {
        return null;
    }

    return {
        id: String((data as JsonObject).id),
        metadata: asRecord((data as JsonObject).metadata),
    };
}

function buildWebhookHeaders(event: OutboxEventRecord): HeadersInit {
    const baseHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'x-vetios-event-id': event.id,
        'x-vetios-topic': event.topic,
    };

    for (const [key, value] of Object.entries(event.headers)) {
        if (typeof value === 'string' && value.trim().length > 0) {
            baseHeaders[key] = value.trim();
        }
    }

    return baseHeaders;
}

function computeRetryDelayMs(attemptCount: number): number {
    const normalizedAttemptCount = Math.max(1, attemptCount);
    return Math.min(60 * 60 * 1000, 15_000 * (2 ** Math.max(0, normalizedAttemptCount - 1)));
}

function isPermanentPassiveSignalError(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return normalized.includes('requires a patient_id')
        || normalized.includes('signal_event_id')
        || normalized.includes('not found');
}

function isRetryableHttpStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function mapOutboxEvent(row: JsonObject): OutboxEventRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        topic: String(row.topic),
        handler_key: normalizeHandlerKey(row.handler_key),
        target_type: normalizeTargetType(row.target_type),
        target_ref: normalizeOptionalText(row.target_ref),
        idempotency_key: normalizeOptionalText(row.idempotency_key),
        payload: asRecord(row.payload),
        headers: asRecord(row.headers),
        metadata: asRecord(row.metadata),
        status: normalizeOutboxStatus(row.status),
        attempt_count: normalizePositiveInteger(row.attempt_count) ?? 0,
        max_attempts: normalizePositiveInteger(row.max_attempts) ?? 6,
        available_at: String(row.available_at),
        locked_at: normalizeOptionalText(row.locked_at),
        locked_by: normalizeOptionalText(row.locked_by),
        last_error: normalizeOptionalText(row.last_error),
        delivered_at: normalizeOptionalText(row.delivered_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapConnectorDeliveryAttempt(row: JsonObject): ConnectorDeliveryAttemptRecord {
    return {
        id: String(row.id),
        outbox_event_id: String(row.outbox_event_id),
        tenant_id: String(row.tenant_id),
        connector_installation_id: normalizeOptionalText(row.connector_installation_id),
        handler_key: normalizeHandlerKey(row.handler_key),
        attempt_no: normalizePositiveInteger(row.attempt_no) ?? 1,
        worker_id: normalizeOptionalText(row.worker_id),
        status: normalizeAttemptStatus(row.status),
        request_payload: asRecord(row.request_payload),
        response_payload: asRecord(row.response_payload),
        error_message: normalizeOptionalText(row.error_message),
        started_at: String(row.started_at),
        finished_at: normalizeOptionalText(row.finished_at),
        created_at: String(row.created_at),
    };
}

function normalizeOutboxStatus(value: unknown): OutboxStatus {
    return value === 'processing' || value === 'retryable' || value === 'delivered' || value === 'dead_letter'
        ? value
        : 'pending';
}

function normalizeSnapshotStatusFilter(value: OutboxQueueSnapshotOptions['status']): OutboxStatus | null {
    return value === 'processing' || value === 'retryable' || value === 'delivered' || value === 'dead_letter' || value === 'pending'
        ? value
        : null;
}

function normalizeSnapshotAttemptStatusFilter(
    value: OutboxQueueSnapshotOptions['attemptStatus'],
): ConnectorDeliveryAttemptStatus | null {
    return value === 'succeeded' || value === 'retryable' || value === 'dead_letter' || value === 'processing'
        ? value
        : null;
}

function normalizeSnapshotHandlerFilter(
    value: OutboxQueueSnapshotOptions['handlerKey'],
): OutboxHandlerKey | null {
    return value === 'connector_webhook' || value === 'passive_signal_reconcile'
        ? value
        : null;
}

function normalizeTargetType(value: unknown): OutboxTargetType {
    return value === 'connector_webhook' ? 'connector_webhook' : 'internal_task';
}

function normalizeHandlerKey(value: unknown): OutboxHandlerKey {
    return value === 'connector_webhook' ? 'connector_webhook' : 'passive_signal_reconcile';
}

function normalizeAttemptStatus(value: unknown): ConnectorDeliveryAttemptStatus {
    return value === 'succeeded' || value === 'retryable' || value === 'dead_letter'
        ? value
        : 'processing';
}

function normalizeRequiredText(value: unknown, field: string): string {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        throw new Error(`${field} is required.`);
    }
    return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizePositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    }
    return null;
}

function asRecord(value: unknown): JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as JsonObject
        : {};
}

function truncateText(value: string, maxLength: number): string {
    return value.length <= maxLength
        ? value
        : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function countOutboxEventsByStatus(
    client: SupabaseClient,
    tenantId: string,
): Promise<Record<OutboxStatus, number>> {
    const C = OUTBOX_EVENTS.COLUMNS;
    const statuses: OutboxStatus[] = ['pending', 'processing', 'retryable', 'delivered', 'dead_letter'];

    const counts = await Promise.all(statuses.map(async (status) => {
        const { count, error } = await client
            .from(OUTBOX_EVENTS.TABLE)
            .select('*', { count: 'exact', head: true })
            .eq(C.tenant_id, tenantId)
            .eq(C.status, status);

        if (error) {
            throw new Error(`Failed to count ${status} outbox events: ${error.message}`);
        }

        return [status, count ?? 0] as const;
    }));

    return Object.fromEntries(counts) as Record<OutboxStatus, number>;
}
