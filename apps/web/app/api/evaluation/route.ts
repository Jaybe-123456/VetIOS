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
import { getSupabaseServer } from '@/lib/supabaseServer';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { loadTelemetryObservabilitySnapshot } from '@/lib/telemetry/observability';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { EvaluationRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { backfillInferenceEvaluation, ensureEvaluationForOutcome, ensureOutcomeRecord } from '@/lib/platform/flywheel';
import type { PlatformActor } from '@/lib/platform/types';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    try {
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:read'],
            requestedTenantId: new URL(req.url).searchParams.get('tenant_id'),
        });
        const url = new URL(req.url);
        const modelVersion = url.searchParams.get('model_version');
        const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '20'), 100));

        let query = supabase
            .from('evaluations')
            .select('*')
            .order('evaluated_at', { ascending: false })
            .limit(limit);

        if (actor.role !== 'system_admin' || tenantId) {
            query = query.eq('tenant_id', tenantId);
        }
        if (modelVersion) {
            query = query.eq('model_version', modelVersion);
        }

        const { data, error } = await query;
        if (error) {
            throw error;
        }

        const [recent, observability] = await Promise.all([
            getRecentEvaluations(supabase, tenantId ?? actor.tenantId ?? '', modelVersion ?? '', 50),
            loadTelemetryObservabilitySnapshot(supabase, tenantId ?? actor.tenantId ?? ''),
        ]);
        const scores = (data ?? [])
            .map((row) => readNumber((row as Record<string, unknown>).score))
            .filter((value): value is number => value != null);
        const errors = recent.map((entry) => entry.calibration_error).filter((value): value is number => value != null);
        const drifts = recent.map((entry) => entry.drift_score).filter((value): value is number => value != null);

        const summary = {
            total_evaluations: data?.length ?? 0,
            mean_score: scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
            mean_calibration_error: errors.length > 0 ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null,
            mean_drift_score: drifts.length > 0 ? drifts.reduce((sum, value) => sum + value, 0) / drifts.length : null,
            rolling_top1_accuracy: observability.latest_accuracy?.top1_accuracy ?? null,
            rolling_top3_accuracy: observability.latest_accuracy?.top3_accuracy ?? null,
            calibration_gap: observability.latest_accuracy?.calibration_gap ?? null,
            overconfidence_rate: observability.latest_accuracy?.overconfidence_rate ?? null,
            abstention_rate: observability.latest_accuracy?.abstention_rate ?? null,
            recent_failure_events: observability.recent_failures.length,
        };

        const response = NextResponse.json({
            data: {
                evaluations: data ?? [],
                summary,
            },
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
                request_id: requestId,
            },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = error instanceof PlatformRateLimitError
            ? NextResponse.json({
                data: buildRateLimitErrorPayload(error),
                meta: {
                    tenant_id: error.tenantId,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error.code,
                    message: error.message,
                },
            }, { status: error.status })
            : NextResponse.json({
                data: null,
                meta: {
                    tenant_id: null,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error instanceof PlatformAuthError ? error.code : 'evaluation_list_failed',
                    message: error instanceof Error ? error.message : 'Failed to load evaluations.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    try {
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:write'],
            rateLimitKind: 'evaluation',
        });

        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required for evaluation requests.');
        }

        const parsed = await safeJson(req);
        if (!parsed.ok) {
            return NextResponse.json(
                { error: parsed.error, request_id: requestId },
                { status: 400 },
            );
        }

        const result = EvaluationRequestSchema.safeParse(parsed.data);
        if (!result.success) {
            return NextResponse.json(
                { error: formatZodErrors(result.error), request_id: requestId },
                { status: 400 },
            );
        }
        const body = result.data;

        const evalResult = await executeEvaluationRequest(supabase, {
            actor,
            tenantId,
            body,
        });
        const response = NextResponse.json({
            data: evalResult,
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
                request_id: requestId,
            },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] POST /api/evaluation Error:`, error);
        const response = error instanceof PlatformRateLimitError
            ? NextResponse.json(buildRateLimitErrorPayload(error), { status: error.status })
            : NextResponse.json(
                { error: error instanceof Error ? error.message : 'Unknown error', request_id: requestId },
                { status: error instanceof PlatformAuthError ? error.status : 500 },
            );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function executeEvaluationRequest(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        actor: PlatformActor;
        tenantId: string;
        body: {
            outcome_id?: string;
            inference_event_id?: string;
            model_name: string;
            model_version: string;
            predicted_confidence?: number;
            trigger_type?: 'inference' | 'outcome' | 'simulation';
        };
    },
) {
    if (input.body.outcome_id) {
        return ensureEvaluationForOutcome(supabase, {
            actor: input.actor,
            tenantId: input.tenantId,
            outcomeId: input.body.outcome_id,
            inferenceEventId: input.body.inference_event_id ?? '',
            modelName: input.body.model_name,
            modelVersion: input.body.model_version,
            outputPayload: {},
            confidenceScore: input.body.predicted_confidence ?? null,
            trigger: input.body.trigger_type === 'outcome' ? 'backfill' : 'evaluation',
        });
    }

    if (input.body.inference_event_id) {
        const { data: inferenceEvent, error } = await supabase
            .from('ai_inference_events')
            .select('id,output_payload,model_name,model_version,confidence_score')
            .eq('tenant_id', input.tenantId)
            .eq('id', input.body.inference_event_id)
            .single();

        if (error || !inferenceEvent) {
            throw new Error(`Inference event not found for evaluation: ${error?.message ?? 'Unknown error'}`);
        }

        const outcome = await ensureOutcomeRecord(supabase, {
            tenantId: input.tenantId,
            inferenceEventId: input.body.inference_event_id,
            rawOutput: JSON.stringify((inferenceEvent as Record<string, unknown>).output_payload ?? {}),
            metadata: {
                auto_created: true,
                source: 'evaluation-route',
            },
        });

        return ensureEvaluationForOutcome(supabase, {
            actor: input.actor,
            tenantId: input.tenantId,
            outcomeId: outcome.id,
            inferenceEventId: input.body.inference_event_id,
            modelName: input.body.model_name || readText((inferenceEvent as Record<string, unknown>).model_name) || 'unknown-model',
            modelVersion: input.body.model_version || readText((inferenceEvent as Record<string, unknown>).model_version) || 'unknown-version',
            outputPayload: asRecord((inferenceEvent as Record<string, unknown>).output_payload),
            confidenceScore: input.body.predicted_confidence ?? readNumber((inferenceEvent as Record<string, unknown>).confidence_score),
            trigger: input.body.trigger_type === 'outcome' ? 'backfill' : 'evaluation',
        });
    }

    const recentEvals = await getRecentEvaluations(
        supabase,
        input.tenantId,
        input.body.model_name,
        20,
    );

    return createEvaluationEvent(supabase, {
        tenant_id: input.tenantId,
        trigger_type: input.body.trigger_type ?? 'inference',
        inference_event_id: input.body.inference_event_id,
        model_name: input.body.model_name,
        model_version: input.body.model_version,
        predicted_confidence: input.body.predicted_confidence,
        recent_evaluations: recentEvals,
    });
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
