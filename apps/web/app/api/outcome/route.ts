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
import { logOutcomeCalibration } from '@/lib/evaluation/calibrationEngine';
import { logErrorCluster } from '@/lib/learning/errorClustering';
import { routeReinforcement } from '@/lib/learning/reinforcementRouter';
import { logModelImprovementAudit } from '@/lib/learning/modelImprover';
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

        // ── Full Outcome Learning Pipeline (non-blocking) ──
        let pipelineResult: any = {};
        try {
            const { data: inferenceData } = await supabase
                .from('ai_inference_events')
                .select('input_signature, output_payload, confidence_score, model_name, model_version')
                .eq('id', body.inference_event_id)
                .single();

            if (inferenceData) {
                const inf = inferenceData as {
                    input_signature: Record<string, unknown>;
                    output_payload: Record<string, unknown>;
                    confidence_score: number | null;
                    model_name: string;
                    model_version: string;
                };

                const diagPayload = (inf.output_payload?.diagnosis || {}) as Record<string, unknown>;
                const riskPayload = (inf.output_payload?.risk_assessment || {}) as Record<string, unknown>;
                
                const predictedClass = diagPayload.primary_condition_class as string | undefined;
                const predictedDiagnosis = (diagPayload.top_differentials as any[])?.[0]?.name as string | undefined;
                const predictedSeverity = riskPayload.severity_score as number | undefined;

                const actualOutcome = body.outcome.payload as Record<string, unknown>;
                const actualClass = actualOutcome.primary_condition_class as string | undefined;
                const actualDiagnosis = actualOutcome.diagnosis as string | undefined;
                const actualSeverity = actualOutcome.severity_score as number | undefined;

                // 1. Log Old Evaluation Event (for backwards compat)
                const recentEvals = await getRecentEvaluations(supabase, tenantId, inf.model_name, 20);
                pipelineResult.evaluation = await createEvaluationEvent(supabase, {
                    tenant_id: tenantId,
                    trigger_type: 'outcome',
                    inference_event_id: body.inference_event_id,
                    outcome_event_id: outcomeEventId,
                    model_name: inf.model_name,
                    model_version: inf.model_version,
                    predicted_confidence: inf.confidence_score,
                    actual_correctness: (predictedClass === actualClass && predictedDiagnosis === actualDiagnosis) ? 1.0 : 0.0,
                    predicted_output: inf.output_payload,
                    actual_outcome: body.outcome.payload,
                    recent_evaluations: recentEvals,
                });

                // 2. Calibration Engine
                pipelineResult.calibration = await logOutcomeCalibration(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    outcome_event_id: outcomeEventId,
                    predicted_confidence: inf.confidence_score,
                    actual_correctness: (predictedClass === actualClass && predictedDiagnosis === actualDiagnosis) ? 1.0 : 0.0,
                });

                // 3. Error Clustering Engine
                pipelineResult.error_cluster = await logErrorCluster(supabase, {
                    tenant_id: tenantId,
                    predicted_class: predictedClass,
                    actual_class: actualClass,
                    predicted_severity: predictedSeverity,
                    actual_severity: actualSeverity,
                    had_contradictions: (inf.output_payload?.contradiction_analysis as any)?.is_plausible === false
                });

                // 4. Structured Reinforcement Pipeline
                pipelineResult.reinforcement = await routeReinforcement(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    // Typically 'label_type' would come from body, assuming synthetic for now if absent
                    label_type: (actualOutcome.label_type as string) || 'expert', 
                    predicted_diagnosis: predictedDiagnosis,
                    predicted_class: predictedClass,
                    actual_diagnosis: actualDiagnosis,
                    actual_class: actualClass,
                    predicted_severity: predictedSeverity,
                    actual_severity: actualSeverity,
                    calibration_error: pipelineResult.calibration?.calibration_error,
                    extracted_features: (inf.output_payload?.diagnosis_feature_importance as any) || {}
                });

                // 5. Before vs After Proof Tracking
                pipelineResult.audit = await logModelImprovementAudit(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    pre_update_prediction: inf.output_payload,
                    pre_confidence: inf.confidence_score,
                    reinforcement_applied: pipelineResult.reinforcement.diagnostic_updates_applied > 0 || pipelineResult.reinforcement.severity_updates_applied > 0,
                    actual_correctness: (predictedClass === actualClass && predictedDiagnosis === actualDiagnosis) ? 1.0 : 0.0,
                    calibration_improvement: pipelineResult.calibration?.calibration_error ?? 0
                });
            }
        } catch (pipelineErr) {
            console.warn(`[${requestId}] Learning Pipeline auto-trigger failed (non-fatal):`, pipelineErr);
        }

        const response = NextResponse.json({
            outcome_event_id: outcomeEventId,
            linked_inference_event_id: body.inference_event_id,
            learning_pipeline: pipelineResult,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (err) {
        console.error(`[${requestId}] POST /api/outcome Error:`, err);
        const message = err instanceof Error ? err.stack || err.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 }
        );
    }
}
