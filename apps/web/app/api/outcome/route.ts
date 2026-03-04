/**
 * POST /api/outcome
 *
 * Links a clinical outcome to a previously logged inference event.
 *
 * Protections:
 *   - Rate limit: 30 req/min per IP
 *   - Zod schema validation
 *   - Request ID tracing
 *   - Idempotency key support (x-idempotency-key header)
 *   - Error sanitization
 */

import { NextResponse } from 'next/server';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { logOutcome } from '@/lib/logging/outcomeLogger';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { OutcomeRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';

export async function POST(req: Request) {
    // ── Guard ──
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    // ── Auth ──
    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 }
        );
    }
    const tenantId = session?.tenantId || 'dev_tenant_001';

    // ── Idempotency key ──
    const idempotencyKey = req.headers.get('x-idempotency-key');

    // ── Parse + validate ──
    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json(
            { error: parsed.error, request_id: requestId },
            { status: 400 }
        );
    }

    const result = OutcomeRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 }
        );
    }
    const body = result.data;

    try {
        const supabase = getSupabaseServer();

        // ── Idempotency check ──
        if (idempotencyKey) {
            const { data: existing } = await supabase
                .from('clinical_outcome_events')
                .select('id')
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle();

            if (existing) {
                const response = NextResponse.json({
                    outcome_event_id: existing.id,
                    linked_inference_event_id: body.inference_event_id,
                    idempotent: true,
                    request_id: requestId,
                });
                withRequestHeaders(response.headers, requestId, startTime);
                return response;
            }
        }

        // ── Verify inference exists AND belongs to tenant ──
        const { data: inferenceRecord, error: lookupError } = await supabase
            .from('ai_inference_events')
            .select('id, tenant_id')
            .eq('id', body.inference_event_id)
            .single();

        if (lookupError || !inferenceRecord) {
            return NextResponse.json(
                { error: `Inference event not found: ${body.inference_event_id}`, request_id: requestId },
                { status: 404 }
            );
        }

        if ((inferenceRecord as { tenant_id: string }).tenant_id !== tenantId) {
            return NextResponse.json(
                { error: 'Inference event does not belong to this tenant', request_id: requestId },
                { status: 403 }
            );
        }

        // ── Insert outcome ──
        const outcomeEventId = await logOutcome(supabase, {
            tenant_id: tenantId,
            clinic_id: body.clinic_id ?? null,
            case_id: body.case_id ?? null,
            inference_event_id: body.inference_event_id,
            outcome_type: body.outcome.type,
            outcome_payload: body.outcome.payload,
            outcome_timestamp: body.outcome.timestamp,
        });

        // ── Evaluation (non-blocking) ──
        let evalResult = null;
        try {
            const { data: inferenceData } = await supabase
                .from('ai_inference_events')
                .select('output_payload, confidence_score, model_name, model_version')
                .eq('id', body.inference_event_id)
                .single();

            if (inferenceData) {
                const inf = inferenceData as {
                    output_payload: Record<string, unknown>;
                    confidence_score: number | null;
                    model_name: string;
                    model_version: string;
                };
                const recentEvals = await getRecentEvaluations(
                    supabase, tenantId, inf.model_name, 20,
                );
                evalResult = await createEvaluationEvent(supabase, {
                    tenant_id: tenantId,
                    trigger_type: 'outcome',
                    inference_event_id: body.inference_event_id,
                    outcome_event_id: outcomeEventId,
                    model_name: inf.model_name,
                    model_version: inf.model_version,
                    predicted_confidence: inf.confidence_score,
                    actual_correctness: 1.0,
                    predicted_output: inf.output_payload,
                    actual_outcome: body.outcome.payload,
                    recent_evaluations: recentEvals,
                });
            }
        } catch (evalErr) {
            console.warn(`[${requestId}] Evaluation auto-trigger failed (non-fatal):`, evalErr);
        }

        const response = NextResponse.json({
            outcome_event_id: outcomeEventId,
            linked_inference_event_id: body.inference_event_id,
            evaluation: evalResult,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        console.error(`[${requestId}] POST /api/outcome Error:`, err);
        const message = process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 }
        );
    }
}
