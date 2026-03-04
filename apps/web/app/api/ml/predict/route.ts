/**
 * POST /api/ml/predict — proxies risk prediction to ML server.
 * GET  /api/ml/predict — ML server health check.
 *
 * Protections:
 *   - Rate limit: 20 req/min per IP
 *   - Zod schema validation (POST)
 *   - Request ID tracing
 *   - Error sanitization
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant } from '@/lib/supabaseServer';
import { mlPredict, mlHealth, mlModelInfo } from '@/lib/ml/mlClient';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { MLPredictRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 }
        );
    }

    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json(
            { error: parsed.error, request_id: requestId },
            { status: 400 }
        );
    }

    const result = MLPredictRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 }
        );
    }
    const body = result.data;

    const prediction = await mlPredict({
        decision_count: body.decision_count,
        override_count: body.override_count,
        species: body.species || 'canine',
    });

    const response = NextResponse.json({
        ...prediction,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const [health, model] = await Promise.all([
        mlHealth(),
        mlModelInfo(),
    ]);

    const response = NextResponse.json({
        ml_server_reachable: health !== null,
        health,
        model,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
