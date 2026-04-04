import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { OUTBOX_DELIVERY_ATTEMPTS, OUTBOX_EVENTS } from '@/lib/db/schemaContracts';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { dispatchEvent } from '@/lib/outbox/handlers';
import type {
    DeliveryResult,
    DispatchResult,
    OutboxDeliveryAttempt,
    OutboxEvent,
    OutboxEventListItem,
    OutboxSnapshot,
    OutboxStatus,
    RetryResult,
} from '@/lib/outbox/types';

type JsonRecord = Record<string, unknown>;

interface CreateOutboxEventParams {
    aggregateType: string;
    aggregateId: string;
    eventName: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
    metadata?: Record<string, unknown>;
}

interface DispatchBatchOptions {
    batchSize?: number;
    workerId: string;
    leaseDurationMs?: number;
}

interface GetEventsFilter {
    status?: OutboxStatus;
    aggregateType?: string;
    limit?: number;
    offset?: number;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_LEASE_DURATION_MS = 60_000;
const TRANSACTIONAL_OUTBOX_SCOPE_FILTERS = {
    aggregateTypeColumn: OUTBOX_EVENTS.COLUMNS.aggregate_type,
    eventNameColumn: OUTBOX_EVENTS.COLUMNS.event_name,
} as const;

/**
 * Insert an outbox event inside the same database transaction/client context as the business write.
 *
 * Example:
 * await db.transaction(async (tx) => {
 *   await tx.insert(visitRecords).values(visitData);
 *   await createOutboxEvent({ ... }, tx);
 * });
 */
export async function createOutboxEvent(
    params: CreateOutboxEventParams,
    client: SupabaseClient = getSupabaseServer(),
): Promise<OutboxEvent> {
    const now = new Date();
    const nowIso = now.toISOString();
    const metadata = normalizeJsonRecord(params.metadata);
    const maxAttempts = clampPositiveInteger(params.maxAttempts, 5, 1, 20);
    const aggregateType = normalizeRequiredText(params.aggregateType, 'aggregateType');
    const aggregateId = normalizeRequiredText(params.aggregateId, 'aggregateId');
    const eventName = normalizeRequiredText(params.eventName, 'eventName');
    const tenantId = resolveLegacyTenantId(metadata);
    const legacyHandlerKey = mapLegacyHandlerKey(aggregateType);
    const C = OUTBOX_EVENTS.COLUMNS;

    const { data, error } = await client
        .from(OUTBOX_EVENTS.TABLE)
        .insert({
            [C.tenant_id]: tenantId,
            [C.aggregate_type]: aggregateType,
            [C.aggregate_id]: aggregateId,
            [C.event_name]: eventName,
            [C.topic]: eventName,
            [C.handler_key]: legacyHandlerKey,
            [C.target_type]: aggregateType === 'api_webhook' ? 'connector_webhook' : 'internal_task',
            [C.target_ref]: aggregateId,
            [C.payload]: normalizeJsonRecord(params.payload),
            [C.headers]: {},
            [C.metadata]: metadata,
            [C.status]: 'pending',
            [C.attempt_count]: 0,
            [C.max_attempts]: maxAttempts,
            [C.last_attempted_at]: null,
            [C.next_retry_at]: nowIso,
            [C.leased_until]: null,
            [C.leased_by]: null,
            [C.available_at]: nowIso,
            [C.locked_at]: null,
            [C.locked_by]: null,
            [C.error_detail]: null,
            [C.last_error]: null,
            [C.delivered_at]: null,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create outbox event: ${error?.message ?? 'Unknown error'}`);
    }

    return mapOutboxEvent(data as JsonRecord);
}

export async function dispatchBatch(
    options: DispatchBatchOptions,
    client: SupabaseClient = getSupabaseServer(),
): Promise<DispatchResult> {
    const workerId = normalizeRequiredText(options.workerId, 'workerId');
    const batchSize = clampPositiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, 100);
    const leaseDurationMs = clampPositiveInteger(options.leaseDurationMs, DEFAULT_LEASE_DURATION_MS, 1_000, 15 * 60_000);
    const startedAt = Date.now();
    const leasedEvents = await leaseOutboxEvents(client, {
        batchSize,
        workerId,
        leaseDurationMs,
    });

    if (leasedEvents.length === 0) {
        const result = {
            workerId,
            dispatched: 0,
            delivered: 0,
            failed: 0,
            deadLettered: 0,
            durationMs: Date.now() - startedAt,
        };
        console.log(JSON.stringify({
            ts: new Date().toISOString(),
            workerId,
            dispatched: result.dispatched,
            delivered: result.delivered,
            failed: result.failed,
            deadLettered: result.deadLettered,
            durationMs: result.durationMs,
        }));
        return result;
    }

    const outcomes = await Promise.all(leasedEvents.map((event) => processEventDispatch(client, event)));
    const delivered = outcomes.filter((outcome) => outcome.finalStatus === 'delivered').length;
    const deadLettered = outcomes.filter((outcome) => outcome.finalStatus === 'dead_letter').length;
    const failed = outcomes.filter((outcome) => outcome.finalStatus !== 'delivered').length;
    const result = {
        workerId,
        dispatched: leasedEvents.length,
        delivered,
        failed,
        deadLettered,
        durationMs: Date.now() - startedAt,
    };

    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        workerId,
        dispatched: result.dispatched,
        delivered: result.delivered,
        failed: result.failed,
        deadLettered: result.deadLettered,
        durationMs: result.durationMs,
    }));

    return result;
}

export async function retryDeadLetters(
    client: SupabaseClient = getSupabaseServer(),
): Promise<RetryResult> {
    const C = OUTBOX_EVENTS.COLUMNS;
    const nowIso = new Date().toISOString();
    let query = client
        .from(OUTBOX_EVENTS.TABLE)
        .select(C.id)
        .eq(C.status, 'dead_letter');
    query = applyTransactionalScope(query);

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to load dead-letter outbox events: ${error.message}`);
    }

    const eventIds = (data ?? [])
        .map((row) => normalizeOptionalText((row as JsonRecord).id))
        .filter((value): value is string => value != null);

    if (eventIds.length === 0) {
        return { reset: 0 };
    }

    const { error: updateError } = await client
        .from(OUTBOX_EVENTS.TABLE)
        .update({
            [C.status]: 'retryable',
            [C.attempt_count]: 0,
            [C.last_attempted_at]: null,
            [C.next_retry_at]: nowIso,
            [C.leased_until]: null,
            [C.leased_by]: null,
            [C.available_at]: nowIso,
            [C.locked_at]: null,
            [C.locked_by]: null,
            [C.error_detail]: null,
            [C.last_error]: null,
            [C.delivered_at]: null,
        })
        .in(C.id, eventIds);

    if (updateError) {
        throw new Error(`Failed to reset dead-letter outbox events: ${updateError.message}`);
    }

    return { reset: eventIds.length };
}

export async function releaseStaleLeases(
    client: SupabaseClient = getSupabaseServer(),
): Promise<number> {
    const C = OUTBOX_EVENTS.COLUMNS;
    const nowIso = new Date().toISOString();
    let query = client
        .from(OUTBOX_EVENTS.TABLE)
        .select(C.id)
        .eq(C.status, 'processing')
        .lt(C.leased_until, nowIso);
    query = applyTransactionalScope(query);

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to inspect stale outbox leases: ${error.message}`);
    }

    const eventIds = (data ?? [])
        .map((row) => normalizeOptionalText((row as JsonRecord).id))
        .filter((value): value is string => value != null);

    if (eventIds.length === 0) {
        return 0;
    }

    const { error: updateError } = await client
        .from(OUTBOX_EVENTS.TABLE)
        .update({
            [C.status]: 'retryable',
            [C.next_retry_at]: nowIso,
            [C.leased_until]: null,
            [C.leased_by]: null,
            [C.available_at]: nowIso,
            [C.locked_at]: null,
            [C.locked_by]: null,
            [C.error_detail]: 'Lease automatically released after stale processing timeout.',
            [C.last_error]: 'Lease automatically released after stale processing timeout.',
        })
        .in(C.id, eventIds);

    if (updateError) {
        throw new Error(`Failed to release stale outbox leases: ${updateError.message}`);
    }

    return eventIds.length;
}

export async function getSnapshot(
    client: SupabaseClient = getSupabaseServer(),
): Promise<OutboxSnapshot> {
    const [pending, processing, retryable, deadLetter, delivered, total] = await Promise.all([
        countEvents(client, 'pending'),
        countEvents(client, 'processing'),
        countEvents(client, 'retryable'),
        countEvents(client, 'dead_letter'),
        countEvents(client, 'delivered'),
        countEvents(client, null),
    ]);

    return {
        pending,
        processing,
        retryable,
        deadLetter,
        delivered,
        total,
    };
}

export async function getEvents(
    filter: GetEventsFilter = {},
    client: SupabaseClient = getSupabaseServer(),
): Promise<{ events: OutboxEventListItem[]; total: number }> {
    const C = OUTBOX_EVENTS.COLUMNS;
    const limit = clampPositiveInteger(filter.limit, 50, 1, 100);
    const offset = Math.max(0, Math.floor(filter.offset ?? 0));
    const status = normalizeOutboxStatus(filter.status);
    const aggregateType = normalizeOptionalText(filter.aggregateType);

    let countQuery = client
        .from(OUTBOX_EVENTS.TABLE)
        .select('*', { count: 'exact', head: true });
    countQuery = applyTransactionalScope(countQuery);
    if (status) {
        countQuery = countQuery.eq(C.status, status);
    }
    if (aggregateType) {
        countQuery = countQuery.eq(C.aggregate_type, aggregateType);
    }

    let eventsQuery = client
        .from(OUTBOX_EVENTS.TABLE)
        .select('*')
        .order(C.created_at, { ascending: false })
        .range(offset, offset + limit - 1);
    eventsQuery = applyTransactionalScope(eventsQuery);
    if (status) {
        eventsQuery = eventsQuery.eq(C.status, status);
    }
    if (aggregateType) {
        eventsQuery = eventsQuery.eq(C.aggregate_type, aggregateType);
    }

    const [{ count, error: countError }, { data, error }] = await Promise.all([countQuery, eventsQuery]);
    if (countError) {
        throw new Error(`Failed to count outbox events: ${countError.message}`);
    }
    if (error) {
        throw new Error(`Failed to list outbox events: ${error.message}`);
    }

    const events = (data ?? []).map((row) => mapOutboxEvent(row as JsonRecord));
    const deliveryAttemptCounts = await getAttemptCountByEventId(events.map((event) => event.id), client);

    return {
        total: count ?? 0,
        events: events.map((event) => ({
            ...event,
            deliveryAttemptCount: deliveryAttemptCounts.get(event.id) ?? 0,
        })),
    };
}

export async function getDeliveryAttempts(
    eventId: string,
    client: SupabaseClient = getSupabaseServer(),
): Promise<OutboxDeliveryAttempt[]> {
    const normalizedEventId = normalizeRequiredText(eventId, 'eventId');
    const C = OUTBOX_DELIVERY_ATTEMPTS.COLUMNS;
    const { data, error } = await client
        .from(OUTBOX_DELIVERY_ATTEMPTS.TABLE)
        .select('*')
        .eq(C.event_id, normalizedEventId)
        .order(C.attempted_at, { ascending: false });

    if (error) {
        throw new Error(`Failed to load outbox delivery attempts: ${error.message}`);
    }

    return (data ?? []).map((row) => mapOutboxDeliveryAttempt(row as JsonRecord));
}

async function processEventDispatch(
    client: SupabaseClient,
    event: OutboxEvent,
): Promise<{ finalStatus: OutboxStatus }> {
    const C = OUTBOX_EVENTS.COLUMNS;
    const now = new Date();
    const dispatchResult = await dispatchEvent(event);
    const finalStatus = dispatchResult.success
        ? 'delivered'
        : event.attemptCount >= event.maxAttempts || dispatchResult.retryable === false
            ? 'dead_letter'
            : 'retryable';
    const responseBody = normalizeOptionalText(dispatchResult.responseBody) ?? null;
    const errorDetail = normalizeOptionalText(dispatchResult.error) ?? null;

    await recordDeliveryAttempt(client, {
        eventId: event.id,
        success: dispatchResult.success,
        statusCode: normalizeInteger(dispatchResult.statusCode),
        responseBody,
        errorDetail,
        durationMs: clampNullableInteger(dispatchResult.durationMs),
    });

    const updatePayload: Record<string, unknown> = {
        [C.status]: finalStatus,
        [C.last_attempted_at]: now.toISOString(),
        [C.leased_until]: null,
        [C.leased_by]: null,
        [C.locked_at]: null,
        [C.locked_by]: null,
        [C.error_detail]: errorDetail,
        [C.last_error]: errorDetail,
    };

    if (finalStatus === 'delivered') {
        updatePayload[C.delivered_at] = now.toISOString();
        updatePayload[C.next_retry_at] = null;
        updatePayload[C.available_at] = now.toISOString();
    } else if (finalStatus === 'retryable') {
        const nextRetryAt = computeNextRetryAt(event.attemptCount);
        updatePayload[C.next_retry_at] = nextRetryAt.toISOString();
        updatePayload[C.available_at] = nextRetryAt.toISOString();
        updatePayload[C.delivered_at] = null;
    } else {
        updatePayload[C.next_retry_at] = null;
        updatePayload[C.available_at] = null;
        updatePayload[C.delivered_at] = null;
    }

    const { error } = await client
        .from(OUTBOX_EVENTS.TABLE)
        .update(updatePayload)
        .eq(C.id, event.id);

    if (error) {
        throw new Error(`Failed to finalize outbox event ${event.id}: ${error.message}`);
    }

    return { finalStatus };
}

async function leaseOutboxEvents(
    client: SupabaseClient,
    input: {
        batchSize: number;
        workerId: string;
        leaseDurationMs: number;
    },
): Promise<OutboxEvent[]> {
    const { data, error } = await client.rpc('lease_transactional_outbox_events' as never, {
        p_batch_size: input.batchSize,
        p_worker_id: input.workerId,
        p_lease_duration_ms: input.leaseDurationMs,
    } as never);

    if (error) {
        throw new Error(`Failed to lease outbox events: ${error.message}`);
    }

    return Array.isArray(data)
        ? data.map((row) => mapOutboxEvent(row as JsonRecord))
        : [];
}

async function recordDeliveryAttempt(
    client: SupabaseClient,
    input: {
        eventId: string;
        success: boolean;
        statusCode: number | null;
        responseBody: string | null;
        errorDetail: string | null;
        durationMs: number | null;
    },
): Promise<void> {
    const C = OUTBOX_DELIVERY_ATTEMPTS.COLUMNS;
    const { error } = await client
        .from(OUTBOX_DELIVERY_ATTEMPTS.TABLE)
        .insert({
            [C.id]: randomUUID(),
            [C.event_id]: input.eventId,
            [C.success]: input.success,
            [C.status_code]: input.statusCode,
            [C.response_body]: input.responseBody,
            [C.error_detail]: input.errorDetail,
            [C.duration_ms]: input.durationMs,
        });

    if (error) {
        throw new Error(`Failed to record outbox delivery attempt: ${error.message}`);
    }
}

async function countEvents(client: SupabaseClient, status: OutboxStatus | null): Promise<number> {
    const C = OUTBOX_EVENTS.COLUMNS;
    let query = client
        .from(OUTBOX_EVENTS.TABLE)
        .select('*', { count: 'exact', head: true });
    query = applyTransactionalScope(query);
    if (status) {
        query = query.eq(C.status, status);
    }

    const { count, error } = await query;
    if (error) {
        throw new Error(`Failed to count ${status ?? 'all'} outbox events: ${error.message}`);
    }
    return count ?? 0;
}

async function getAttemptCountByEventId(
    eventIds: string[],
    client: SupabaseClient,
): Promise<Map<string, number>> {
    if (eventIds.length === 0) {
        return new Map<string, number>();
    }

    const C = OUTBOX_DELIVERY_ATTEMPTS.COLUMNS;
    const { data, error } = await client
        .from(OUTBOX_DELIVERY_ATTEMPTS.TABLE)
        .select(C.event_id)
        .in(C.event_id, eventIds);

    if (error) {
        throw new Error(`Failed to count outbox delivery attempts: ${error.message}`);
    }

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
        const eventId = normalizeOptionalText((row as JsonRecord)[C.event_id]);
        if (!eventId) continue;
        counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
    }
    return counts;
}

function applyTransactionalScope<T>(query: T): T {
    const scopedQuery = query as {
        not: (column: string, operator: string, value: null) => unknown;
    };
    const aggregateScoped = scopedQuery.not(
        TRANSACTIONAL_OUTBOX_SCOPE_FILTERS.aggregateTypeColumn,
        'is',
        null,
    ) as {
        not: (column: string, operator: string, value: null) => unknown;
    };

    return aggregateScoped.not(
        TRANSACTIONAL_OUTBOX_SCOPE_FILTERS.eventNameColumn,
        'is',
        null,
    ) as T;
}

function mapOutboxEvent(row: JsonRecord): OutboxEvent {
    const C = OUTBOX_EVENTS.COLUMNS;
    return {
        id: normalizeRequiredText(row[C.id], 'id'),
        aggregateType: normalizeRequiredText(row[C.aggregate_type], 'aggregate_type'),
        aggregateId: normalizeRequiredText(row[C.aggregate_id], 'aggregate_id'),
        eventName: normalizeRequiredText(row[C.event_name], 'event_name'),
        payload: normalizeJsonRecord(row[C.payload]),
        status: normalizeOutboxStatus(row[C.status]) ?? 'pending',
        attemptCount: clampPositiveInteger(row[C.attempt_count], 0, 0, 999),
        maxAttempts: clampPositiveInteger(row[C.max_attempts], 5, 1, 999),
        lastAttemptedAt: readDate(row[C.last_attempted_at]),
        nextRetryAt: readDate(row[C.next_retry_at]),
        leasedUntil: readDate(row[C.leased_until]),
        leasedBy: normalizeOptionalText(row[C.leased_by]),
        errorDetail: normalizeOptionalText(row[C.error_detail] ?? row[C.last_error]),
        createdAt: readDate(row[C.created_at]) ?? new Date(0),
        deliveredAt: readDate(row[C.delivered_at]),
        metadata: normalizeJsonRecord(row[C.metadata]),
    };
}

function mapOutboxDeliveryAttempt(row: JsonRecord): OutboxDeliveryAttempt {
    const C = OUTBOX_DELIVERY_ATTEMPTS.COLUMNS;
    return {
        id: normalizeRequiredText(row[C.id], 'id'),
        eventId: normalizeRequiredText(row[C.event_id], 'event_id'),
        attemptedAt: readDate(row[C.attempted_at]) ?? new Date(0),
        success: Boolean(row[C.success]),
        statusCode: normalizeInteger(row[C.status_code]),
        responseBody: normalizeOptionalText(row[C.response_body]),
        errorDetail: normalizeOptionalText(row[C.error_detail]),
        durationMs: clampNullableInteger(row[C.duration_ms]),
    };
}

function computeNextRetryAt(attemptCount: number): Date {
    const minutes = Math.max(2, 2 ** Math.max(1, attemptCount));
    return new Date(Date.now() + (minutes * 60_000));
}

function mapLegacyHandlerKey(aggregateType: string): string {
    switch (aggregateType) {
        case 'petpass_sync':
            return 'petpass_notification_delivery';
        case 'api_webhook':
            return 'connector_webhook';
        case 'outcome_contribution':
        default:
            return 'passive_signal_reconcile';
    }
}

function resolveLegacyTenantId(metadata: JsonRecord): string {
    return normalizeOptionalText(metadata.tenantId)
        ?? normalizeOptionalText(metadata.tenant_id)
        ?? normalizeOptionalText(metadata.clinicId)
        ?? normalizeOptionalText(metadata.clinic_id)
        ?? 'outbox_system';
}

function normalizeRequiredText(value: unknown, label: string): string {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        throw new Error(`${label} is required.`);
    }
    return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOutboxStatus(value: unknown): OutboxStatus | null {
    return value === 'pending' || value === 'processing' || value === 'retryable' || value === 'dead_letter' || value === 'delivered'
        ? value
        : null;
}

function normalizeJsonRecord(value: unknown): JsonRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

function readDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
}

function clampNullableInteger(value: unknown): number | null {
    const normalized = normalizeInteger(value);
    return normalized == null ? null : Math.max(0, normalized);
}

function clampPositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
    const normalized = normalizeInteger(value);
    if (normalized == null) return fallback;
    return Math.min(max, Math.max(min, normalized));
}
