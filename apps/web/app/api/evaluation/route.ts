/**
 * GET /api/evaluation — returns evaluation metrics for the tenant.
 * POST /api/evaluation — manually trigger an evaluation event.
 *
 * Protections:
 *   - Rate limit: 30 req/min per IP
 *   - Zod schema validation (POST)
 *   - Request ID tracing
 *   - Error sanitization
 */

import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { loadTelemetryObservabilitySnapshot } from '@/lib/telemetry/observability';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { EvaluationRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 }
        );
    }
    const tenantId = auth.actor.tenantId;

    const url = new URL(req.url);
    const model = url.searchParams.get('model');
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const trigger = url.searchParams.get('trigger');

    let query = supabase
        .from('model_evaluation_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (model) query = query.eq('model_name', model);
    if (trigger) query = query.eq('trigger_type', trigger);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json(
            { error: error.message, request_id: requestId },
            { status: 500 }
        );
    }

    const [recent, observability] = await Promise.all([
        getRecentEvaluations(supabase, tenantId, model ?? '', 50),
        loadTelemetryObservabilitySnapshot(supabase, tenantId),
    ]);
    const errors = recent.map(e => e.calibration_error).filter((e): e is number => e != null);
    const drifts = recent.map(e => e.drift_score).filter((e): e is number => e != null);

    const summary = {
        total_evaluations: data?.length ?? 0,
        mean_calibration_error: errors.length > 0
            ? errors.reduce((a, b) => a + b, 0) / errors.length
            : null,
        mean_drift_score: drifts.length > 0
            ? drifts.reduce((a, b) => a + b, 0) / drifts.length
            : null,
        rolling_top1_accuracy: observability.latest_accuracy?.top1_accuracy ?? null,
        rolling_top3_accuracy: observability.latest_accuracy?.top3_accuracy ?? null,
        calibration_gap: observability.latest_accuracy?.calibration_gap ?? null,
        overconfidence_rate: observability.latest_accuracy?.overconfidence_rate ?? null,
        abstention_rate: observability.latest_accuracy?.abstention_rate ?? null,
        recent_failure_events: observability.recent_failures.length,
    };

    const response = NextResponse.json({
        evaluations: data,
        summary,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 }
        );
    }
    const tenantId = auth.actor.tenantId;

    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json(
            { error: parsed.error, request_id: requestId },
            { status: 400 }
        );
    }

    const result = EvaluationRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 }
        );
    }
    const body = result.data;

    try {
        const recentEvals = await getRecentEvaluations(
            supabase, tenantId, body.model_name, 20,
        );

        const evalResult = await createEvaluationEvent(supabase, {
            tenant_id: tenantId,
            trigger_type: body.trigger_type ?? 'inference',
            inference_event_id: body.inference_event_id,
            model_name: body.model_name,
            model_version: body.model_version,
            predicted_confidence: body.predicted_confidence,
            recent_evaluations: recentEvals,
        });

        const response = NextResponse.json({
            ...evalResult,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        console.error(`[${requestId}] POST /api/evaluation Error:`, err);
        const message = process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 }
        );
    }
}
