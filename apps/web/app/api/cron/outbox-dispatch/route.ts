import { NextResponse } from 'next/server';
import { dispatchOutboxBatch } from '@/lib/eventPlane/outbox';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_BATCHES = 4;

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    if (!isAuthorizedScheduledDispatcherRequest(req)) {
        const response = NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const batchSize = readPositiveInteger(
        new URL(req.url).searchParams.get('batch_size'),
        readPositiveInteger(process.env.VETIOS_OUTBOX_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    );
    const maxBatches = readPositiveInteger(
        new URL(req.url).searchParams.get('max_batches'),
        readPositiveInteger(process.env.VETIOS_OUTBOX_CRON_MAX_BATCHES, DEFAULT_MAX_BATCHES),
    );
    const tenantId = normalizeOptionalText(new URL(req.url).searchParams.get('tenant_id'));
    const workerId = [
        'cron-outbox',
        req.headers.get('x-vercel-cron')?.trim() || 'manual',
        Date.now().toString(36),
    ].join(':');

    const client = getSupabaseServer();
    const runs: Array<Awaited<ReturnType<typeof dispatchOutboxBatch>>> = [];
    for (let index = 0; index < maxBatches; index += 1) {
        const result = await dispatchOutboxBatch(client, {
            workerId: `${workerId}:${index + 1}`,
            batchSize,
            tenantId,
        });
        runs.push(result);
        if (result.leased_count < batchSize) {
            break;
        }
    }

    const response = NextResponse.json({
        cron: {
            schedule: '*/1 * * * *',
            authorized_by: resolveSchedulerAuthLabel(req),
            tenant_id: tenantId,
            batch_size: batchSize,
            max_batches: maxBatches,
        },
        summary: {
            batches_run: runs.length,
            leased_count: runs.reduce((sum, run) => sum + run.leased_count, 0),
            delivered_count: runs.reduce((sum, run) => sum + run.delivered_count, 0),
            retryable_count: runs.reduce((sum, run) => sum + run.retryable_count, 0),
            dead_letter_count: runs.reduce((sum, run) => sum + run.dead_letter_count, 0),
        },
        runs,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

function isAuthorizedScheduledDispatcherRequest(req: Request): boolean {
    const token = extractBearerToken(req.headers.get('authorization'));
    const cronSecret = normalizeOptionalText(process.env.CRON_SECRET);
    const internalToken = normalizeOptionalText(process.env.VETIOS_INTERNAL_API_TOKEN);

    if (cronSecret && token === cronSecret) {
        return true;
    }

    return Boolean(internalToken && token === internalToken);
}

function resolveSchedulerAuthLabel(req: Request): string {
    const token = extractBearerToken(req.headers.get('authorization'));
    const cronSecret = normalizeOptionalText(process.env.CRON_SECRET);
    if (cronSecret && token === cronSecret) {
        return 'cron_secret';
    }
    return 'internal_token';
}

function extractBearerToken(authorization: string | null): string | null {
    const match = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    return match && match.length > 0 ? match : null;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
