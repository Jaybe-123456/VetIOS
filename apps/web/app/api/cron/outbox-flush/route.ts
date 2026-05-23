import { NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/http/cronAuth';
import { getRequestId, withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
    asRecord,
    logSupabaseFailure,
    readErrorCode,
    readErrorMessage,
    readString,
    retryAfterResponse,
} from '@/lib/api/corePipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_BATCHES = 1;
const MAX_ATTEMPTS = 5;

export async function GET(req: Request) {
    return flushOutbox(req);
}

export async function POST(req: Request) {
    return flushOutbox(req);
}

async function flushOutbox(req: Request) {
    const requestId = getRequestId(req);
    const startTime = Date.now();
    const auth = authorizeCronRequest(req, 'outbox-flush');
    if (!auth.authorized) {
        const response = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const supabase = getSupabaseServer();
    const batchSize = readPositiveInteger(process.env.VETIOS_OUTBOX_BATCH_SIZE, DEFAULT_BATCH_SIZE);
    const maxBatches = readPositiveInteger(process.env.VETIOS_OUTBOX_CRON_MAX_BATCHES, DEFAULT_MAX_BATCHES);
    let processed = 0;
    let delivered = 0;
    let failed = 0;
    let deadLettered = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
        const { data, error } = await supabase
            .from('outbox_events')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(batchSize);

        if (error) {
            const errorCode = readErrorCode(error, 'outbox_read_failed');
            logSupabaseFailure({
                route: '/api/cron/outbox-flush',
                requestId,
                tenantId: null,
                errorCode,
                error,
            });
            const response = retryAfterResponse({ requestId, errorCode, detail: readErrorMessage(error) });
            withRequestHeaders(response.headers, requestId, startTime);
            return response;
        }

        const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
        if (rows.length === 0) break;

        for (const row of rows) {
            try {
                const claimed = await claimPendingEvent(supabase, row);
                if (!claimed) continue;

                processed += 1;
                const outcome = await processOutboxEvent(claimed);
                if (outcome.ok) {
                    await markDelivered(supabase, claimed);
                    delivered += 1;
                    continue;
                }

                failed += 1;
                const nextAttemptCount = Math.max(0, Math.trunc(readNumber(claimed.attempt_count) ?? 0)) + 1;
                if (nextAttemptCount >= MAX_ATTEMPTS) {
                    await markDeadLettered(supabase, claimed, nextAttemptCount, outcome.error);
                    await fireDeadLetterAlert(claimed, outcome.error, requestId);
                    deadLettered += 1;
                } else {
                    await markPendingRetry(supabase, claimed, nextAttemptCount, outcome.error);
                }
            } catch (error) {
                const errorCode = 'outbox_flush_write_failed';
                logSupabaseFailure({
                    route: '/api/cron/outbox-flush',
                    requestId,
                    tenantId: null,
                    errorCode,
                    error,
                });
                const response = retryAfterResponse({
                    requestId,
                    errorCode,
                    detail: error instanceof Error ? error.message : 'Outbox flush write failed',
                });
                withRequestHeaders(response.headers, requestId, startTime);
                return response;
            }
        }

        if (rows.length < batchSize) break;
    }

    const response = NextResponse.json({
        processed,
        delivered,
        failed,
        dead_lettered: deadLettered,
        request_id: requestId,
        duration_ms: Date.now() - startTime,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

async function claimPendingEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
    const id = readString(row.id);
    if (!id) return null;

    const { data, error } = await supabase
        .from('outbox_events')
        .update({ status: 'processing' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to claim outbox event ${id}: ${error.message}`);
    }

    return data ? data as Record<string, unknown> : null;
}

async function processOutboxEvent(row: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
    const payload = asRecord(row.payload);
    if (payload.force_failure === true || payload.fail === true) {
        return { ok: false, error: 'forced_outbox_failure' };
    }

    const targetUrl = readString(payload.webhook_url) ?? readString(payload.delivery_url);
    if (!targetUrl) {
        return { ok: true };
    }

    try {
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: row.id,
                event_type: row.event_type,
                payload,
            }),
        });
        if (!response.ok) {
            return { ok: false, error: `delivery_http_${response.status}` };
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'delivery_failed' };
    }
}

async function markDelivered(
    supabase: ReturnType<typeof getSupabaseServer>,
    row: Record<string, unknown>,
): Promise<void> {
    const { error } = await supabase
        .from('outbox_events')
        .update({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            error_detail: null,
        })
        .eq('id', row.id);
    if (error) throw new Error(`Failed to mark outbox event delivered: ${error.message}`);
}

async function markPendingRetry(
    supabase: ReturnType<typeof getSupabaseServer>,
    row: Record<string, unknown>,
    attemptCount: number,
    errorDetail: string,
): Promise<void> {
    const { error } = await supabase
        .from('outbox_events')
        .update({
            status: 'pending',
            attempt_count: attemptCount,
            error_detail: errorDetail,
        })
        .eq('id', row.id);
    if (error) throw new Error(`Failed to mark outbox event retryable: ${error.message}`);
}

async function markDeadLettered(
    supabase: ReturnType<typeof getSupabaseServer>,
    row: Record<string, unknown>,
    attemptCount: number,
    errorDetail: string,
): Promise<void> {
    const { error } = await supabase
        .from('outbox_events')
        .update({
            status: 'dead_lettered',
            attempt_count: attemptCount,
            error_detail: errorDetail,
        })
        .eq('id', row.id);
    if (error) throw new Error(`Failed to mark outbox event dead-lettered: ${error.message}`);
}

async function fireDeadLetterAlert(
    row: Record<string, unknown>,
    errorDetail: string,
    requestId: string,
): Promise<void> {
    const webhook = process.env.VETIOS_OUTBREAK_ALERT_WEBHOOK?.trim();
    if (!webhook) return;

    try {
        await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'outbox_dead_lettered',
                outbox_event_id: row.id,
                event_type: row.event_type,
                error_detail: errorDetail,
                request_id: requestId,
                timestamp: new Date().toISOString(),
            }),
        });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'outbox.dead_letter_alert_failed',
            route: '/api/cron/outbox-flush',
            request_id: requestId,
            error: error instanceof Error ? error.message : 'Unknown alert webhook error',
            timestamp: new Date().toISOString(),
        }));
    }
}

function readPositiveInteger(value: unknown, fallback: number): number {
    const parsed = readNumber(value);
    return parsed != null && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
