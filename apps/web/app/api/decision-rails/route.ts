import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { buildDecisionRailsPacket } from '@/lib/decisionRails/decisionRails';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 60,
        windowMs: 60_000,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }

    const url = new URL(req.url);
    const inferenceEventId = normalizeOptionalUuid(url.searchParams.get('inference_event_id'));
    const requestIdParam = normalizeOptionalUuid(url.searchParams.get('request_id'));
    const decisionId = normalizeOptionalText(url.searchParams.get('decision_id'));

    if (url.searchParams.get('inference_event_id') && !inferenceEventId) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_inference_event_id', request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }
    if (url.searchParams.get('request_id') && !requestIdParam) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_request_id', request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const packet = await buildDecisionRailsPacket({
        client: supabase,
        tenantId: auth.actor.tenantId,
        decisionId,
        inferenceEventId,
        requestId: requestIdParam,
    });

    return withHeaders(
        NextResponse.json({
            packet,
            request_id: requestId,
            error: null,
        }, { status: packet.query_errors.length > 0 ? 207 : 200 }),
        requestId,
        startTime,
    );
}

function normalizeOptionalText(value: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function normalizeOptionalUuid(value: string | null) {
    const trimmed = normalizeOptionalText(value);
    if (!trimmed) return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
        ? trimmed
        : null;
}

function withHeaders(response: NextResponse, requestId: string, startTime: number) {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
