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
import { revalidatePath } from 'next/cache';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { logOutcome } from '@/lib/logging/outcomeLogger';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { logOutcomeCalibration } from '@/lib/evaluation/calibrationEngine';
import { logErrorCluster } from '@/lib/learning/errorClustering';
import { routeReinforcement } from '@/lib/learning/reinforcementRouter';
import { logModelImprovementAudit } from '@/lib/learning/modelImprover';
import {
    createSupabaseClinicalCaseStore,
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterOutcome,
} from '@/lib/clinicalCases/clinicalCaseManager';
import { logClinicalDatasetMutation } from '@/lib/dataset/clinicalDatasetDiagnostics';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { OutcomeRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 },
        );
    }
    const { tenantId, userId } = resolveRequestActor(session);

    const idempotencyKey = req.headers.get('x-idempotency-key');

    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json(
            { error: parsed.error, request_id: requestId },
            { status: 400 },
        );
    }

    const result = OutcomeRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json(
            { error: formatZodErrors(result.error), request_id: requestId },
            { status: 400 },
        );
    }
    const body = result.data;

    try {
        const supabase = getSupabaseServer();

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

        const { data: inferenceRecord, error: lookupError } = await supabase
            .from('ai_inference_events')
            .select('id, tenant_id, clinic_id, case_id, input_signature')
            .eq('id', body.inference_event_id)
            .single();

        if (lookupError || !inferenceRecord) {
            return NextResponse.json(
                { error: `Inference event not found: ${body.inference_event_id}`, request_id: requestId },
                { status: 404 },
            );
        }

        const resolvedInferenceRecord = inferenceRecord as {
            tenant_id: string;
            clinic_id?: string | null;
            case_id?: string | null;
            input_signature?: Record<string, unknown>;
        };

        if (resolvedInferenceRecord.tenant_id !== tenantId) {
            return NextResponse.json(
                { error: 'Inference event does not belong to this tenant', request_id: requestId },
                { status: 403 },
            );
        }

        const caseStore = createSupabaseClinicalCaseStore(supabase);
        const requestedCaseId = body.case_id ?? resolvedInferenceRecord.case_id ?? null;
        let canonicalClinicalCase = requestedCaseId
            ? await caseStore.findById(tenantId, requestedCaseId)
            : null;

        if (!canonicalClinicalCase) {
            canonicalClinicalCase = await ensureCanonicalClinicalCase(caseStore, {
                tenantId,
                userId,
                clinicId: body.clinic_id ?? resolvedInferenceRecord.clinic_id ?? null,
                requestedCaseId,
                sourceModule: 'outcome_learning',
                inputSignature:
                    resolvedInferenceRecord.input_signature &&
                        typeof resolvedInferenceRecord.input_signature === 'object'
                        ? resolvedInferenceRecord.input_signature
                        : {},
                observedAt: body.outcome.timestamp,
            });
        }

        const outcomeEventId = await logOutcome(supabase, {
            tenant_id: tenantId,
            user_id: userId,
            clinic_id: body.clinic_id ?? resolvedInferenceRecord.clinic_id ?? null,
            case_id: canonicalClinicalCase.id,
            source_module: 'outcome_learning',
            inference_event_id: body.inference_event_id,
            outcome_type: body.outcome.type,
            outcome_payload: body.outcome.payload,
            outcome_timestamp: body.outcome.timestamp,
            label_type: deriveOutcomeLabelType(body.outcome.type, body.outcome.payload),
        });

        await finalizeClinicalCaseAfterOutcome(caseStore, canonicalClinicalCase, outcomeEventId, {
            observedAt: body.outcome.timestamp,
            userId,
            sourceModule: 'outcome_learning',
            outcomePayload: body.outcome.payload,
            outcomeType: body.outcome.type,
            metadataPatch: {
                latest_outcome_type: body.outcome.type,
                latest_outcome_timestamp: body.outcome.timestamp,
                latest_outcome_payload: body.outcome.payload,
            },
        });
        logClinicalDatasetMutation({
            source: 'api/outcome',
            mutationType: 'outcome',
            authenticatedUserId: userId,
            resolvedTenantId: tenantId,
            writeTenantId: tenantId,
            caseId: canonicalClinicalCase.id,
            inferenceEventId: body.inference_event_id,
            outcomeEventId,
        });
        revalidatePath('/dataset');

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

                pipelineResult.calibration = await logOutcomeCalibration(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    outcome_event_id: outcomeEventId,
                    predicted_confidence: inf.confidence_score,
                    actual_correctness: (predictedClass === actualClass && predictedDiagnosis === actualDiagnosis) ? 1.0 : 0.0,
                });

                pipelineResult.error_cluster = await logErrorCluster(supabase, {
                    tenant_id: tenantId,
                    predicted_class: predictedClass,
                    actual_class: actualClass,
                    predicted_severity: predictedSeverity,
                    actual_severity: actualSeverity,
                    had_contradictions:
                        typeof inf.output_payload?.contradiction_score === 'number'
                            ? (inf.output_payload.contradiction_score as number) > 0
                            : ((inf.output_payload?.contradiction_analysis as any)?.is_plausible === false),
                });

                pipelineResult.reinforcement = await routeReinforcement(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    label_type: (actualOutcome.label_type as string) || 'expert',
                    predicted_diagnosis: predictedDiagnosis,
                    predicted_class: predictedClass,
                    actual_diagnosis: actualDiagnosis,
                    actual_class: actualClass,
                    predicted_severity: predictedSeverity,
                    actual_severity: actualSeverity,
                    calibration_error: pipelineResult.calibration?.calibration_error,
                    extracted_features: (inf.output_payload?.diagnosis_feature_importance as any) || {},
                });

                pipelineResult.audit = await logModelImprovementAudit(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    pre_update_prediction: inf.output_payload,
                    pre_confidence: inf.confidence_score,
                    reinforcement_applied:
                        pipelineResult.reinforcement.diagnostic_updates_applied > 0 ||
                        pipelineResult.reinforcement.severity_updates_applied > 0,
                    actual_correctness: (predictedClass === actualClass && predictedDiagnosis === actualDiagnosis) ? 1.0 : 0.0,
                    calibration_improvement: pipelineResult.calibration?.calibration_error ?? 0,
                });
            }
        } catch (pipelineErr) {
            console.warn(`[${requestId}] Learning Pipeline auto-trigger failed (non-fatal):`, pipelineErr);
        }

        const response = NextResponse.json({
            outcome_event_id: outcomeEventId,
            clinical_case_id: canonicalClinicalCase.id,
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
            { status: 500 },
        );
    }
}

function deriveOutcomeLabelType(
    outcomeType: string,
    payload: Record<string, unknown>,
): string {
    const explicit = typeof payload.label_type === 'string'
        ? payload.label_type.trim().toLowerCase()
        : null;

    if (explicit === 'lab_confirmed' || explicit === 'lab-confirmed' || payload.lab_confirmed === true) {
        return 'lab_confirmed';
    }

    if (explicit === 'expert_reviewed' || explicit === 'expert-reviewed' || explicit === 'expert') {
        return 'expert_reviewed';
    }

    if (
        explicit === 'synthetic' ||
        explicit === 'sandbox' ||
        explicit === 'test' ||
        outcomeType.toLowerCase().includes('synthetic') ||
        outcomeType.toLowerCase().includes('sandbox') ||
        outcomeType.toLowerCase().includes('test')
    ) {
        return 'synthetic';
    }

    return 'expert_reviewed';
}
