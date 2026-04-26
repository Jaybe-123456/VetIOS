/**
 * GET  /api/learning/active-queue   — fetch pending candidates
 * POST /api/learning/active-queue   — run a new active learning cycle
 */

import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
    runActiveLearningCycle,
    getActiveLearningQueue,
    getActiveLearningStats,
} from '@/lib/learning/activeLearning';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    try {
        const client = getSupabaseServer();
        const resolution = await resolveClinicalApiActor(req, { client });
        if (!resolution.actor) {
            const res = NextResponse.json(
                { data: null, error: { code: 'unauthorized', message: resolution.error?.message ?? 'Authentication required.' } },
                { status: resolution.error?.status ?? 401 }
            );
            withRequestHeaders(res.headers, requestId, startTime);
            return res;
        }

        const tenantId = resolution.actor.tenantId;
        const url = new URL(req.url);
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100);

        const [queue, stats] = await Promise.all([
            getActiveLearningQueue(client, tenantId, limit),
            getActiveLearningStats(client, tenantId),
        ]);

        const res = NextResponse.json({
            data: { queue, stats },
            meta: { timestamp: new Date().toISOString(), request_id: requestId },
            error: null,
        });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    } catch (err) {
        const res = NextResponse.json({
            data: null,
            meta: { timestamp: new Date().toISOString(), request_id: requestId },
            error: { code: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error.' },
        }, { status: 500 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    try {
        const client = getSupabaseServer();
        const resolution = await resolveClinicalApiActor(req, { client });
        if (!resolution.actor) {
            const res = NextResponse.json(
                { data: null, error: { code: 'unauthorized', message: resolution.error?.message ?? 'Authentication required.' } },
                { status: resolution.error?.status ?? 401 }
            );
            withRequestHeaders(res.headers, requestId, startTime);
            return res;
        }

        const tenantId = resolution.actor.tenantId;
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;

        const result = await runActiveLearningCycle(client, tenantId, {
            uncertainty_threshold: (body.uncertainty_threshold as number) ?? undefined,
            disagreement_threshold: (body.disagreement_threshold as number) ?? undefined,
            batch_size: (body.batch_size as number) ?? undefined,
            lookback_hours: (body.lookback_hours as number) ?? undefined,
        });

        const res = NextResponse.json({
            data: result,
            meta: { timestamp: new Date().toISOString(), request_id: requestId },
            error: null,
        });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    } catch (err) {
        const res = NextResponse.json({
            data: null,
            meta: { timestamp: new Date().toISOString(), request_id: requestId },
            error: { code: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error.' },
        }, { status: 500 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }
}
