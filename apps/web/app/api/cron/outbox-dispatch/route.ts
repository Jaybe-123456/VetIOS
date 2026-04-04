import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { dispatchBatch, releaseStaleLeases } from '@/lib/outbox/outbox-service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_BATCHES = 4;
const DEFAULT_TIME_BUDGET_MS = 8_500;

export async function GET(req: Request) {
    return runCronDispatch(req);
}

export async function POST(req: Request) {
    return runCronDispatch(req);
}

async function runCronDispatch(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    if (!isAuthorizedCronRequest(req)) {
        const response = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const url = new URL(req.url);
    const batchSize = readPositiveInteger(url.searchParams.get('batch_size'), DEFAULT_BATCH_SIZE);
    const maxBatches = readPositiveInteger(url.searchParams.get('max_batches'), DEFAULT_MAX_BATCHES);
    const timeBudgetMs = readPositiveInteger(
        url.searchParams.get('time_budget_ms') ?? process.env.VETIOS_OUTBOX_CRON_TIME_BUDGET_MS,
        DEFAULT_TIME_BUDGET_MS,
    );
    const workerIdBase = `cron-outbox:${req.headers.get('x-vercel-cron')?.trim() || 'manual'}:${randomUUID()}`;
    const startedAt = Date.now();

    try {
        const released = await releaseStaleLeases();
        const batches: Array<Awaited<ReturnType<typeof dispatchBatch>> & { batchIndex: number }> = [];

        for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
            if (Date.now() - startedAt >= timeBudgetMs) {
                break;
            }

            const result = await dispatchBatch({
                batchSize,
                workerId: `${workerIdBase}:${batchIndex + 1}`,
            });

            batches.push({ ...result, batchIndex: batchIndex + 1 });
            console.log(JSON.stringify({
                ts: new Date().toISOString(),
                workerId: result.workerId,
                batch: batchIndex + 1,
                dispatched: result.dispatched,
                delivered: result.delivered,
                failed: result.failed,
                deadLettered: result.deadLettered,
                durationMs: result.durationMs,
            }));

            if (result.dispatched < batchSize) {
                break;
            }
        }

        const response = NextResponse.json({
            releasedStaleLeases: released,
            batches: batches.length,
            totalDispatched: batches.reduce((sum, batch) => sum + batch.dispatched, 0),
            totalDelivered: batches.reduce((sum, batch) => sum + batch.delivered, 0),
            totalFailed: batches.reduce((sum, batch) => sum + batch.failed, 0),
            totalDeadLettered: batches.reduce((sum, batch) => sum + batch.deadLettered, 0),
            durationMs: Date.now() - startedAt,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Outbox cron dispatch failed.', request_id: requestId },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function isAuthorizedCronRequest(req: Request): boolean {
    const cronSecret = process.env.CRON_SECRET?.trim();
    const authHeader = req.headers.get('authorization');
    if (!cronSecret) {
        return false;
    }
    return authHeader === `Bearer ${cronSecret}`;
}

function readPositiveInteger(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return fallback;
}
