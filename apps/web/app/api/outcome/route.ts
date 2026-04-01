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
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { logOutcome } from '@/lib/logging/outcomeLogger';
import { createEvaluationEvent, getRecentEvaluations } from '@/lib/evaluation/evaluationEngine';
import { logOutcomeCalibration } from '@/lib/evaluation/calibrationEngine';
import { logErrorCluster } from '@/lib/learning/errorClustering';
import { routeReinforcement } from '@/lib/learning/reinforcementRouter';
import {
    buildFailureCorrectionFeatureVector,
    generateFailureCorrectionReport,
} from '@/lib/learning/failureCorrectionEngine';
import { logModelImprovementAudit } from '@/lib/learning/modelImprover';
import {
    createSupabaseClinicalCaseStore,
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterOutcome,
} from '@/lib/clinicalCases/clinicalCaseManager';
import {
    BENCHMARK_COHORTS,
    BENCHMARK_SNAPSHOTS,
    CLINICAL_CASES,
    EVIDENCE_CARDS,
    OUTCOME_INFERENCES,
    PATIENT_EPISODES,
    PROTOCOL_EXECUTIONS,
    PROTOCOL_TEMPLATES,
} from '@/lib/db/schemaContracts';
import { logClinicalDatasetMutation } from '@/lib/dataset/clinicalDatasetDiagnostics';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { OutcomeRequestSchema, formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import {
    createOutcomeNetworkRepository,
    reconcileEpisodeMembership,
} from '@/lib/outcomeNetwork/service';
import {
    emitTelemetryEvent,
    extractPredictionLabel,
    telemetryEvaluationEventId,
    resolveTelemetryRunId,
    telemetryInferenceEventId,
    telemetryOutcomeEventId,
} from '@/lib/telemetry/service';
import { recordOutcomeObservability } from '@/lib/telemetry/observability';
import { evaluateDecisionEngine } from '@/lib/decisionEngine/service';
import { attachRoutingOutcomeFeedback } from '@/lib/routingEngine/service';

const NON_CRITICAL_EFFECT_TIMEOUT_MS = 1_500;

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['outcome:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }
    const { tenantId, userId } = auth.actor;

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
        if (idempotencyKey) {
            const { data: existing } = await supabase
                .from('clinical_outcome_events')
                .select('id')
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle();

            if (existing) {
                const response = NextResponse.json({
                    outcome_event_id: existing.id,
                    episode_id: null,
                    episode_reconcile_error: null,
                    outcome_inference_id: null,
                    evidence_card_id: null,
                    artifact_error: null,
                    protocol_template_id: null,
                    protocol_execution_id: null,
                    protocol_error: null,
                    benchmark_cohort_id: null,
                    benchmark_snapshot_id: null,
                    benchmark_snapshot: null,
                    benchmark_error: null,
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

        const finalizedClinicalCase = await finalizeClinicalCaseAfterOutcome(caseStore, canonicalClinicalCase, outcomeEventId, {
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
        const episodeOutcomeState = deriveEpisodeOutcomeState(body.outcome.type, body.outcome.payload);
        const episodeStatus = episodeOutcomeState === 'resolved'
            ? 'resolved'
            : episodeOutcomeState === 'failed' || episodeOutcomeState === 'recurred'
                ? 'monitoring'
                : null;
        let episodeId: string | null = finalizedClinicalCase.episode_id ?? null;
        let episodeReconcileError: string | null = null;
        let outcomeInferenceId: string | null = null;
        let evidenceCardId: string | null = null;
        let artifactError: string | null = null;
        let protocolTemplateId: string | null = null;
        let protocolExecutionId: string | null = null;
        let protocolError: string | null = null;
        let benchmarkCohortId: string | null = null;
        let benchmarkSnapshotId: string | null = null;
        let benchmarkSnapshot: BenchmarkSnapshotSummary | null = null;
        let benchmarkError: string | null = null;
        try {
            const episodeLink = await reconcileEpisodeMembership(
                createOutcomeNetworkRepository(supabase),
                {
                    tenantId,
                    clinicId: body.clinic_id ?? resolvedInferenceRecord.clinic_id ?? null,
                    caseId: finalizedClinicalCase.id,
                    observedAt: body.outcome.timestamp,
                    primaryConditionClass: finalizedClinicalCase.primary_condition_class,
                    status: episodeStatus,
                    outcomeState: episodeOutcomeState,
                    resolvedAt: episodeOutcomeState === 'resolved' ? body.outcome.timestamp : null,
                    summaryPatch: {
                        latest_outcome_event_id: outcomeEventId,
                        latest_outcome_type: body.outcome.type,
                        latest_outcome_at: body.outcome.timestamp,
                    },
                },
            );
            episodeId = episodeLink.episode.id;
        } catch (episodeError) {
            episodeReconcileError = episodeError instanceof Error
                ? episodeError.message
                : 'Failed to attach outcome to episode.';
            console.warn(`[${requestId}] Episode reconciliation failed (non-fatal):`, episodeError);
        }
        if (episodeId) {
            try {
                const artifacts = await ensureEpisodeOutcomeArtifacts(supabase, {
                    tenantId,
                    clinicId: body.clinic_id ?? resolvedInferenceRecord.clinic_id ?? null,
                    episodeId,
                    caseId: finalizedClinicalCase.id,
                    inferenceEventId: body.inference_event_id,
                    outcomeEventId,
                    outcomeType: body.outcome.type,
                    outcomePayload: body.outcome.payload,
                    outcomeTimestamp: body.outcome.timestamp,
                    labelType: deriveOutcomeLabelType(body.outcome.type, body.outcome.payload),
                    inferredState: episodeOutcomeState,
                    primaryConditionClass: finalizedClinicalCase.primary_condition_class,
                    modelVersion: finalizedClinicalCase.model_version,
                    requestId,
                });
                outcomeInferenceId = artifacts.outcomeInferenceId;
                evidenceCardId = artifacts.evidenceCardId;
            } catch (artifactErr) {
                artifactError = artifactErr instanceof Error
                    ? artifactErr.message
                    : 'Failed to create outcome trust artifacts.';
                console.warn(`[${requestId}] Outcome trust artifact creation failed (non-fatal):`, artifactErr);
            }
            try {
                const protocolAutomation = await ensureEpisodeOutcomeProtocolExecution(supabase, {
                    tenantId,
                    clinicId: body.clinic_id ?? resolvedInferenceRecord.clinic_id ?? null,
                    patientId: finalizedClinicalCase.patient_id ?? null,
                    encounterId: finalizedClinicalCase.encounter_id ?? null,
                    episodeId,
                    caseId: finalizedClinicalCase.id,
                    outcomeEventId,
                    outcomeType: body.outcome.type,
                    outcomePayload: body.outcome.payload,
                    outcomeTimestamp: body.outcome.timestamp,
                    inferredState: episodeOutcomeState,
                    primaryConditionClass: finalizedClinicalCase.primary_condition_class,
                    requestId,
                });
                protocolTemplateId = protocolAutomation.protocolTemplateId;
                protocolExecutionId = protocolAutomation.protocolExecutionId;
            } catch (protocolErr) {
                protocolError = protocolErr instanceof Error
                    ? protocolErr.message
                    : 'Failed to create protocol execution.';
                console.warn(`[${requestId}] Protocol automation failed (non-fatal):`, protocolErr);
            }
            try {
                const benchmarkRollup = await ensureEpisodeBenchmarkRollup(supabase, {
                    tenantId,
                    clinicId: body.clinic_id ?? resolvedInferenceRecord.clinic_id ?? null,
                    episodeId,
                    episodeOutcomeState,
                    outcomeTimestamp: body.outcome.timestamp,
                    clinicalCase: finalizedClinicalCase,
                });
                benchmarkCohortId = benchmarkRollup.benchmarkCohortId;
                benchmarkSnapshotId = benchmarkRollup.benchmarkSnapshot?.id ?? null;
                benchmarkSnapshot = benchmarkRollup.benchmarkSnapshot;
            } catch (benchmarkErr) {
                benchmarkError = benchmarkErr instanceof Error
                    ? benchmarkErr.message
                    : 'Failed to update benchmark rollup.';
                console.warn(`[${requestId}] Benchmark rollup failed (non-fatal):`, benchmarkErr);
            }
        }
        logClinicalDatasetMutation({
            source: 'api/outcome',
            mutationType: 'outcome',
            authenticatedUserId: userId,
            resolvedTenantId: tenantId,
            writeTenantId: tenantId,
            caseId: finalizedClinicalCase.id,
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

                const predictedLabel = extractPredictionLabel(inf.output_payload);
                const predictedDiagnosis = predictedLabel ?? undefined;
                const predictedClass = resolveConditionClassLabel(
                    typeof diagPayload.primary_condition_class === 'string'
                        ? diagPayload.primary_condition_class
                        : typeof diagPayload.condition_class === 'string'
                            ? diagPayload.condition_class
                            : null,
                    predictedLabel,
                );
                const predictedSeverity = riskPayload.severity_score as number | undefined;

                const actualOutcome = body.outcome.payload as Record<string, unknown>;
                const groundTruthLabel = resolveOutcomeGroundTruth(actualOutcome);
                const actualDiagnosis = groundTruthLabel ?? undefined;
                const actualClass = resolveConditionClassLabel(
                    typeof actualOutcome.primary_condition_class === 'string'
                        ? actualOutcome.primary_condition_class
                        : typeof actualOutcome.condition_class === 'string'
                            ? actualOutcome.condition_class
                            : null,
                    groundTruthLabel,
                );
                const actualSeverity = actualOutcome.severity_score as number | undefined;
                const telemetryRecord = asRecord(inf.output_payload.telemetry);
                const telemetryCorrect = predictedLabel && groundTruthLabel
                    ? areLabelsEqual(predictedLabel, groundTruthLabel)
                    : null;

                await emitTelemetryEvent(supabase, {
                    event_id: telemetryOutcomeEventId(outcomeEventId),
                    tenant_id: tenantId,
                    linked_event_id: telemetryInferenceEventId(body.inference_event_id),
                    source_id: outcomeEventId,
                    source_table: 'clinical_outcome_events',
                    event_type: 'outcome',
                    timestamp: body.outcome.timestamp,
                    model_version: inf.model_version,
                    run_id: resolveTelemetryRunId(inf.model_version, telemetryRecord.run_id),
                    metrics: {
                        ground_truth: groundTruthLabel,
                        correct: telemetryCorrect,
                    },
                    metadata: {
                        source_module: 'outcome_learning',
                        request_id: requestId,
                        inference_event_id: body.inference_event_id,
                        outcome_event_id: outcomeEventId,
                        outcome_type: body.outcome.type,
                        predicted_label: predictedLabel,
                        pipeline_stage_completion: ['outcome_linked'],
                    },
                });
                await attachRoutingOutcomeFeedback({
                    client: supabase,
                    tenantId,
                    inferenceEventId: body.inference_event_id,
                    outcomeEventId,
                    predictionCorrect: telemetryCorrect,
                });

                const recentEvals = await getRecentEvaluations(supabase, tenantId, inf.model_name, 20);
                const contradictionAnalysis = asRecord(inf.output_payload.contradiction_analysis);
                const contradictionScore = readNumber(contradictionAnalysis.contradiction_score)
                    ?? readNumber(inf.output_payload.contradiction_score);
                const predictedSeverityLabel = normalizeOptionalLabel(
                    typeof riskPayload.emergency_level === 'string'
                        ? riskPayload.emergency_level
                        : predictedSeverity != null
                            ? String(predictedSeverity)
                            : null,
                );
                const actualSeverityLabel = normalizeOptionalLabel(
                    typeof actualOutcome.emergency_level === 'string'
                        ? actualOutcome.emergency_level
                        : actualSeverity != null
                            ? String(actualSeverity)
                            : null,
                );
                pipelineResult.evaluation = await createEvaluationEvent(supabase, {
                    tenant_id: tenantId,
                    trigger_type: 'outcome',
                    inference_event_id: body.inference_event_id,
                    outcome_event_id: outcomeEventId,
                    case_id: finalizedClinicalCase.id,
                    model_name: inf.model_name,
                    model_version: inf.model_version,
                    prediction: predictedLabel,
                    ground_truth: groundTruthLabel,
                    condition_class_pred: normalizeOptionalLabel(predictedClass),
                    condition_class_true: normalizeOptionalLabel(actualClass),
                    severity_pred: predictedSeverityLabel,
                    severity_true: actualSeverityLabel,
                    contradiction_score: contradictionScore,
                    adversarial_case: finalizedClinicalCase.adversarial_case === true,
                    predicted_confidence: inf.confidence_score,
                    actual_correctness: telemetryCorrect == null ? undefined : (telemetryCorrect ? 1.0 : 0.0),
                    predicted_output: inf.output_payload,
                    actual_outcome: body.outcome.payload,
                    recent_evaluations: recentEvals,
                });
                await emitTelemetryEvent(supabase, {
                    event_id: telemetryEvaluationEventId(pipelineResult.evaluation.evaluation_event_id),
                    tenant_id: tenantId,
                    linked_event_id: telemetryInferenceEventId(body.inference_event_id),
                    source_id: pipelineResult.evaluation.evaluation_event_id,
                    source_table: 'model_evaluation_events',
                    event_type: 'evaluation',
                    timestamp: body.outcome.timestamp,
                    model_version: inf.model_version,
                    run_id: resolveTelemetryRunId(inf.model_version, telemetryRecord.run_id),
                    metrics: {
                        confidence: inf.confidence_score,
                        prediction: pipelineResult.evaluation.prediction,
                        ground_truth: pipelineResult.evaluation.ground_truth,
                        correct: pipelineResult.evaluation.prediction_correct,
                    },
                    metadata: {
                        source_module: 'outcome_learning',
                        request_id: requestId,
                        inference_event_id: body.inference_event_id,
                        outcome_event_id: outcomeEventId,
                        evaluation_event_id: pipelineResult.evaluation.evaluation_event_id,
                        case_id: finalizedClinicalCase.id,
                        condition_class_pred: normalizeOptionalLabel(predictedClass),
                        condition_class_true: normalizeOptionalLabel(actualClass),
                        severity_pred: predictedSeverityLabel,
                        severity_true: actualSeverityLabel,
                        contradiction_score: contradictionScore,
                        adversarial_case: finalizedClinicalCase.adversarial_case === true,
                        pipeline_stage_completion: ['outcome_linked', 'evaluation_created', 'calibration_logged'],
                    },
                });
                await attachRoutingOutcomeFeedback({
                    client: supabase,
                    tenantId,
                    inferenceEventId: body.inference_event_id,
                    outcomeEventId,
                    evaluationEventId: pipelineResult.evaluation.evaluation_event_id,
                    predictionCorrect: pipelineResult.evaluation.prediction_correct,
                });
                const evaluationCorrectness =
                    pipelineResult.evaluation.prediction_correct == null
                        ? telemetryCorrect
                        : pipelineResult.evaluation.prediction_correct;

                pipelineResult.calibration = await logOutcomeCalibration(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    outcome_event_id: outcomeEventId,
                    predicted_confidence: inf.confidence_score,
                    actual_correctness: evaluationCorrectness == null ? null : (evaluationCorrectness ? 1.0 : 0.0),
                });

                pipelineResult.error_cluster = await logErrorCluster(supabase, {
                    tenant_id: tenantId,
                    predicted_class: predictedClass ?? undefined,
                    actual_class: actualClass ?? undefined,
                    predicted_severity: predictedSeverity,
                    actual_severity: actualSeverity,
                    had_contradictions:
                        (contradictionScore ?? 0) > 0
                            || contradictionAnalysis.is_plausible === false,
                });

                const diagnosisFeatureImportance = asNumericRecord(inf.output_payload?.diagnosis_feature_importance);
                pipelineResult.failure_correction = generateFailureCorrectionReport({
                    case_input: inf.input_signature,
                    model_output: inf.output_payload,
                    predicted_condition: predictedDiagnosis ?? null,
                    target_condition: actualDiagnosis ?? null,
                    predicted_condition_class: predictedClass ?? null,
                    target_condition_class: actualClass ?? null,
                    diagnosis_feature_importance: diagnosisFeatureImportance,
                    contradiction_analysis: contradictionAnalysis,
                    signal_weight_profile: asRecord(inf.output_payload?.signal_weight_profile),
                    clinical_signal: asRecord(inf.output_payload?.clinical_signal),
                });
                const reinforcementFeatures = mergeNumericFeatures(
                    diagnosisFeatureImportance,
                    buildFailureCorrectionFeatureVector(pipelineResult.failure_correction),
                );

                pipelineResult.reinforcement = await routeReinforcement(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    label_type: (actualOutcome.label_type as string) || 'expert',
                    predicted_diagnosis: predictedDiagnosis ?? undefined,
                    predicted_class: predictedClass ?? undefined,
                    actual_diagnosis: actualDiagnosis ?? undefined,
                    actual_class: actualClass ?? undefined,
                    predicted_severity: predictedSeverity,
                    actual_severity: actualSeverity,
                    calibration_error: pipelineResult.calibration?.calibration_error,
                    extracted_features: reinforcementFeatures,
                });

                pipelineResult.audit = await logModelImprovementAudit(supabase, {
                    tenant_id: tenantId,
                    inference_event_id: body.inference_event_id,
                    pre_update_prediction: inf.output_payload,
                    pre_confidence: inf.confidence_score,
                    reinforcement_applied:
                        pipelineResult.reinforcement.diagnostic_updates_applied > 0 ||
                        pipelineResult.reinforcement.severity_updates_applied > 0,
                    actual_correctness: evaluationCorrectness == null ? 0.0 : (evaluationCorrectness ? 1.0 : 0.0),
                    calibration_improvement: pipelineResult.calibration?.calibration_error ?? 0,
                    failure_correction_report: pipelineResult.failure_correction,
                });

                if (pipelineResult.evaluation) {
                    await settleNonCriticalEffect(
                        requestId,
                        'Observability aggregation',
                        recordOutcomeObservability(supabase, {
                            tenantId,
                            inferenceEventId: body.inference_event_id,
                            outcomeEventId,
                            evaluationEventId: pipelineResult.evaluation.evaluation_event_id,
                            modelVersion: inf.model_version,
                            observedAt: body.outcome.timestamp,
                            prediction: pipelineResult.evaluation.prediction,
                            actual: pipelineResult.evaluation.ground_truth,
                            confidence: inf.confidence_score,
                            contradictionScore,
                            outputPayload: inf.output_payload,
                            actualOutcome,
                        }),
                        { timeoutMs: NON_CRITICAL_EFFECT_TIMEOUT_MS },
                    );
                }
            }
        } catch (pipelineErr) {
            console.warn(`[${requestId}] Learning Pipeline auto-trigger failed (non-fatal):`, pipelineErr);
        }

        try {
            await evaluateDecisionEngine({
                client: supabase,
                tenantId,
                triggerSource: 'outcome',
            });
        } catch (decisionErr) {
            console.error(`[${requestId}] Decision engine evaluation failed (non-fatal):`, decisionErr);
        }

        const response = NextResponse.json({
            outcome_event_id: outcomeEventId,
            clinical_case_id: finalizedClinicalCase.id,
            episode_id: episodeId,
            episode_reconcile_error: episodeReconcileError,
            outcome_inference_id: outcomeInferenceId,
            evidence_card_id: evidenceCardId,
            artifact_error: artifactError,
            protocol_template_id: protocolTemplateId,
            protocol_execution_id: protocolExecutionId,
            protocol_error: protocolError,
            benchmark_cohort_id: benchmarkCohortId,
            benchmark_snapshot_id: benchmarkSnapshotId,
            benchmark_snapshot: benchmarkSnapshot,
            benchmark_error: benchmarkError,
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

function deriveEpisodeOutcomeState(
    outcomeType: string,
    payload: Record<string, unknown>,
): string | null {
    const explicitState = typeof payload.outcome_state === 'string'
        ? payload.outcome_state.trim().toLowerCase()
        : typeof payload.status === 'string'
            ? payload.status.trim().toLowerCase()
            : null;

    if (explicitState === 'resolved' || explicitState === 'recovered' || explicitState === 'closed') {
        return 'resolved';
    }
    if (explicitState === 'failed' || explicitState === 'failure') {
        return 'failed';
    }
    if (explicitState === 'recurred' || explicitState === 'relapsed') {
        return 'recurred';
    }

    const normalizedType = outcomeType.trim().toLowerCase();
    if (
        payload.resolved === true ||
        payload.discharged === true ||
        payload.recovered === true ||
        normalizedType.includes('resolved') ||
        normalizedType.includes('discharged') ||
        normalizedType.includes('recovered')
    ) {
        return 'resolved';
    }
    if (
        payload.failed === true ||
        normalizedType.includes('failed') ||
        normalizedType.includes('failure')
    ) {
        return 'failed';
    }
    if (
        payload.recurred === true ||
        payload.relapsed === true ||
        normalizedType.includes('recur') ||
        normalizedType.includes('relapse')
    ) {
        return 'recurred';
    }

    return null;
}

async function ensureEpisodeOutcomeArtifacts(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        clinicId: string | null;
        episodeId: string;
        caseId: string;
        inferenceEventId: string;
        outcomeEventId: string;
        outcomeType: string;
        outcomePayload: Record<string, unknown>;
        outcomeTimestamp: string;
        labelType: string;
        inferredState: string | null;
        primaryConditionClass: string | null;
        modelVersion: string | null;
        requestId: string;
    },
): Promise<{ outcomeInferenceId: string | null; evidenceCardId: string | null }> {
    const inferenceId = await ensureOutcomeInferenceRecord(supabase, input);
    const evidenceCardId = await ensureOutcomeEvidenceCard(supabase, input);
    return {
        outcomeInferenceId: inferenceId,
        evidenceCardId,
    };
}

type OutcomeProtocolPlan = {
    protocolKey: string;
    version: number;
    triggerSource: string;
    triggerRules: Record<string, unknown>;
    steps: Record<string, unknown>[];
    writebackTargets: Record<string, unknown>[];
    recommendedActions: Record<string, unknown>[];
};

async function ensureEpisodeOutcomeProtocolExecution(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        clinicId: string | null;
        patientId: string | null;
        encounterId: string | null;
        episodeId: string;
        caseId: string;
        outcomeEventId: string;
        outcomeType: string;
        outcomePayload: Record<string, unknown>;
        outcomeTimestamp: string;
        inferredState: string | null;
        primaryConditionClass: string | null;
        requestId: string;
    },
): Promise<{ protocolTemplateId: string | null; protocolExecutionId: string | null }> {
    const plan = buildEpisodeOutcomeProtocolPlan(input);
    if (!plan) {
        return {
            protocolTemplateId: null,
            protocolExecutionId: null,
        };
    }

    const protocolTemplateId = await ensureProtocolTemplateRecord(supabase, {
        tenantId: input.tenantId,
        plan,
    });
    const protocolExecutionId = await ensureProtocolExecutionRecord(supabase, {
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        patientId: input.patientId,
        encounterId: input.encounterId,
        episodeId: input.episodeId,
        caseId: input.caseId,
        outcomeTimestamp: input.outcomeTimestamp,
        templateId: protocolTemplateId,
        plan,
    });

    return {
        protocolTemplateId,
        protocolExecutionId,
    };
}

function buildEpisodeOutcomeProtocolPlan(input: {
    outcomeEventId: string;
    outcomeType: string;
    outcomePayload: Record<string, unknown>;
    outcomeTimestamp: string;
    inferredState: string | null;
    primaryConditionClass: string | null;
    requestId: string;
}): OutcomeProtocolPlan | null {
    const inferredState = input.inferredState ?? normalizeOutcomeStateFallback(input.outcomeType);
    const conditionLabel = normalizeOptionalLabel(input.primaryConditionClass) ?? 'clinical';
    const commonMetadata = {
        source_outcome_event_id: input.outcomeEventId,
        inferred_state: inferredState,
        outcome_type: input.outcomeType,
        request_id: input.requestId,
    };

    if (inferredState === 'resolved') {
        return {
            protocolKey: 'system_episode_resolution_followup',
            version: 1,
            triggerSource: 'outcome_auto:resolved',
            triggerRules: {
                ...commonMetadata,
                automation_kind: 'episode_outcome_protocol',
                outcome_window: 'post_resolution',
            },
            steps: [
                {
                    step_key: 'confirm_resolution_summary',
                    title: 'Confirm resolution summary',
                    description: `Review the closure rationale for this ${conditionLabel} episode and ensure the summary is complete.`,
                    writeback_target: 'episode_summary',
                },
                {
                    step_key: 'queue_follow_up_check',
                    title: 'Queue follow-up check',
                    description: 'Schedule a callback or recheck only if the clinician still wants post-resolution monitoring.',
                    writeback_target: 'follow_up_queue',
                },
            ],
            writebackTargets: [
                { target: 'episode_summary', mode: 'append' },
                { target: 'follow_up_queue', mode: 'enqueue_if_needed' },
            ],
            recommendedActions: [
                {
                    action_key: 'confirm_resolution_summary',
                    action_type: 'summary_review',
                    title: 'Confirm episode resolution summary',
                    rationale: `Outcome signals indicate this ${conditionLabel} episode may be resolved.`,
                    writeback_target: 'episode_summary',
                    recommended_at: input.outcomeTimestamp,
                    due_in_hours: 24,
                    metadata: commonMetadata,
                },
                {
                    action_key: 'queue_follow_up_check',
                    action_type: 'follow_up',
                    title: 'Queue a follow-up if clinically indicated',
                    rationale: 'Resolved episodes still benefit from a lightweight safety-net callback when risk remains.',
                    writeback_target: 'follow_up_queue',
                    recommended_at: input.outcomeTimestamp,
                    due_in_hours: 72,
                    metadata: commonMetadata,
                },
            ],
        };
    }

    if (inferredState === 'failed') {
        return {
            protocolKey: 'system_episode_escalation_review',
            version: 1,
            triggerSource: 'outcome_auto:failed',
            triggerRules: {
                ...commonMetadata,
                automation_kind: 'episode_outcome_protocol',
                outcome_window: 'treatment_failure',
            },
            steps: [
                {
                    step_key: 'review_escalation_need',
                    title: 'Review escalation need',
                    description: `Assess whether this ${conditionLabel} episode now needs escalation, referral, or a revised treatment plan.`,
                    writeback_target: 'care_plan',
                },
                {
                    step_key: 'check_diagnostic_gaps',
                    title: 'Check diagnostic gaps',
                    description: 'Capture any unresolved differentials, missing tests, or contradictory findings before the next intervention.',
                    writeback_target: 'diagnostic_worklist',
                },
            ],
            writebackTargets: [
                { target: 'care_plan', mode: 'append' },
                { target: 'diagnostic_worklist', mode: 'enqueue' },
            ],
            recommendedActions: [
                {
                    action_key: 'review_escalation_need',
                    action_type: 'escalation_review',
                    title: 'Review escalation or referral need',
                    rationale: 'Outcome signals suggest the current management path may have failed.',
                    writeback_target: 'care_plan',
                    recommended_at: input.outcomeTimestamp,
                    due_in_hours: 6,
                    metadata: commonMetadata,
                },
                {
                    action_key: 'check_diagnostic_gaps',
                    action_type: 'diagnostic_gap_review',
                    title: 'Check diagnostic gaps before next step',
                    rationale: 'Treatment failure should trigger a structured review of missed tests and contradictory evidence.',
                    writeback_target: 'diagnostic_worklist',
                    recommended_at: input.outcomeTimestamp,
                    due_in_hours: 12,
                    metadata: commonMetadata,
                },
            ],
        };
    }

    if (inferredState === 'recurred') {
        return {
            protocolKey: 'system_episode_recurrence_review',
            version: 1,
            triggerSource: 'outcome_auto:recurred',
            triggerRules: {
                ...commonMetadata,
                automation_kind: 'episode_outcome_protocol',
                outcome_window: 'recurrence',
            },
            steps: [
                {
                    step_key: 'compare_with_previous_resolution',
                    title: 'Compare with previous resolution',
                    description: `Review what changed between the last stable period and this recurrent ${conditionLabel} episode.`,
                    writeback_target: 'episode_summary',
                },
                {
                    step_key: 'owner_follow_up_review',
                    title: 'Review owner follow-up plan',
                    description: 'Confirm symptom timeline, adherence, and whether earlier warning signs were missed.',
                    writeback_target: 'follow_up_queue',
                },
            ],
            writebackTargets: [
                { target: 'episode_summary', mode: 'append' },
                { target: 'follow_up_queue', mode: 'enqueue' },
            ],
            recommendedActions: [
                {
                    action_key: 'compare_with_previous_resolution',
                    action_type: 'recurrence_review',
                    title: 'Compare recurrence against previous resolution',
                    rationale: 'Recurrence should trigger a structured comparison with the prior stable or resolved period.',
                    writeback_target: 'episode_summary',
                    recommended_at: input.outcomeTimestamp,
                    due_in_hours: 12,
                    metadata: commonMetadata,
                },
                {
                    action_key: 'owner_follow_up_review',
                    action_type: 'follow_up',
                    title: 'Review owner adherence and symptom timeline',
                    rationale: 'Recurrence often reflects adherence, timing, or follow-up gaps that should be captured explicitly.',
                    writeback_target: 'follow_up_queue',
                    recommended_at: input.outcomeTimestamp,
                    due_in_hours: 24,
                    metadata: commonMetadata,
                },
            ],
        };
    }

    return null;
}

async function ensureProtocolTemplateRecord(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        plan: OutcomeProtocolPlan;
    },
): Promise<string> {
    const C = PROTOCOL_TEMPLATES.COLUMNS;
    const { data: existing, error: lookupError } = await supabase
        .from(PROTOCOL_TEMPLATES.TABLE)
        .select(C.id)
        .eq(C.tenant_id, input.tenantId)
        .eq(C.protocol_key, input.plan.protocolKey)
        .eq(C.version, input.plan.version)
        .maybeSingle();

    if (lookupError) {
        throw new Error(`Failed to check protocol template: ${lookupError.message}`);
    }
    if (existing?.id) {
        return String(existing.id);
    }

    const { data, error } = await supabase
        .from(PROTOCOL_TEMPLATES.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.protocol_key]: input.plan.protocolKey,
            [C.version]: input.plan.version,
            [C.condition_class]: null,
            [C.trigger_rules]: input.plan.triggerRules,
            [C.steps]: input.plan.steps,
            [C.writeback_targets]: input.plan.writebackTargets,
            [C.status]: 'active',
        })
        .select(C.id)
        .single();

    if (error || !data) {
        throw new Error(`Failed to create protocol template: ${error?.message ?? 'Unknown error'}`);
    }

    return String(data.id);
}

async function ensureProtocolExecutionRecord(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        clinicId: string | null;
        patientId: string | null;
        encounterId: string | null;
        episodeId: string;
        caseId: string;
        outcomeTimestamp: string;
        templateId: string;
        plan: OutcomeProtocolPlan;
    },
): Promise<string> {
    const C = PROTOCOL_EXECUTIONS.COLUMNS;
    const { data: existing, error: lookupError } = await supabase
        .from(PROTOCOL_EXECUTIONS.TABLE)
        .select(C.id)
        .eq(C.tenant_id, input.tenantId)
        .eq(C.episode_id, input.episodeId)
        .eq(C.template_id, input.templateId)
        .eq(C.trigger_source, input.plan.triggerSource)
        .order(C.created_at, { ascending: false })
        .limit(1)
        .maybeSingle();

    if (lookupError) {
        throw new Error(`Failed to check protocol execution: ${lookupError.message}`);
    }
    if (existing?.id) {
        return String(existing.id);
    }

    const { data, error } = await supabase
        .from(PROTOCOL_EXECUTIONS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.clinic_id]: input.clinicId,
            [C.patient_id]: input.patientId,
            [C.encounter_id]: input.encounterId,
            [C.episode_id]: input.episodeId,
            [C.case_id]: input.caseId,
            [C.template_id]: input.templateId,
            [C.trigger_source]: input.plan.triggerSource,
            [C.status]: 'recommended',
            [C.recommended_actions]: input.plan.recommendedActions,
            [C.accepted_actions]: [],
            [C.started_at]: input.outcomeTimestamp,
        })
        .select(C.id)
        .single();

    if (error || !data) {
        throw new Error(`Failed to create protocol execution: ${error?.message ?? 'Unknown error'}`);
    }

    return String(data.id);
}

type BenchmarkRollupPlan = {
    cohortKey: string;
    species: string | null;
    conditionClass: string | null;
    acuityBand: string | null;
    metricName: string;
    targetState: string;
    windowStart: string;
    windowEnd: string;
    matchingRules: Record<string, unknown>;
};

type BenchmarkSnapshotSummary = {
    id: string;
    metric_name: string;
    support_n: number;
    observed_value: number | null;
    expected_value: number | null;
    risk_adjusted_value: number | null;
    oe_ratio: number | null;
    confidence_interval: Record<string, unknown>;
    window_start: string;
    window_end: string;
};

async function ensureEpisodeBenchmarkRollup(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        clinicId: string | null;
        episodeId: string;
        episodeOutcomeState: string | null;
        outcomeTimestamp: string;
        clinicalCase: {
            species: string | null;
            species_canonical: string | null;
            species_display: string | null;
            primary_condition_class: string | null;
            severity_score: number | null;
        };
    },
): Promise<{ benchmarkCohortId: string | null; benchmarkSnapshot: BenchmarkSnapshotSummary | null }> {
    if (!input.clinicId) {
        return {
            benchmarkCohortId: null,
            benchmarkSnapshot: null,
        };
    }

    const plan = buildEpisodeBenchmarkRollupPlan(input);
    if (!plan) {
        return {
            benchmarkCohortId: null,
            benchmarkSnapshot: null,
        };
    }

    const benchmarkCohortId = await ensureBenchmarkCohortRecord(supabase, {
        tenantId: input.tenantId,
        plan,
    });
    const benchmarkSnapshot = await upsertBenchmarkSnapshotRecord(supabase, {
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        cohortId: benchmarkCohortId,
        plan,
    });

    return {
        benchmarkCohortId,
        benchmarkSnapshot,
    };
}

function buildEpisodeBenchmarkRollupPlan(input: {
    episodeOutcomeState: string | null;
    outcomeTimestamp: string;
    clinicalCase: {
        species: string | null;
        species_canonical: string | null;
        species_display: string | null;
        primary_condition_class: string | null;
        severity_score: number | null;
    };
}): BenchmarkRollupPlan | null {
    const targetState = input.episodeOutcomeState;
    if (!targetState) return null;

    const eventDate = new Date(input.outcomeTimestamp);
    const windowEndDate = endOfUtcDay(eventDate);
    const windowStartDate = startOfUtcDay(new Date(windowEndDate.getTime() - (89 * 24 * 60 * 60 * 1000)));
    const species = normalizeOptionalLabel(
        input.clinicalCase.species_canonical
        ?? input.clinicalCase.species_display
        ?? input.clinicalCase.species,
    );
    const conditionClass = normalizeOptionalLabel(input.clinicalCase.primary_condition_class);
    const acuityBand = resolveAcuityBand(input.clinicalCase.severity_score);
    const cohortKey = [
        'episode',
        species ?? 'unknown_species',
        conditionClass ?? 'unknown_condition',
        acuityBand ?? 'unknown_acuity',
    ]
        .map(normalizeCohortKeySegment)
        .join(':');

    return {
        cohortKey,
        species,
        conditionClass,
        acuityBand,
        metricName: resolveBenchmarkMetricName(targetState),
        targetState,
        windowStart: windowStartDate.toISOString(),
        windowEnd: windowEndDate.toISOString(),
        matchingRules: {
            entity: 'episode',
            species,
            condition_class: conditionClass,
            acuity_band: acuityBand,
            window_days: 90,
        },
    };
}

async function ensureBenchmarkCohortRecord(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        plan: BenchmarkRollupPlan;
    },
): Promise<string> {
    const C = BENCHMARK_COHORTS.COLUMNS;
    const { data: existing, error: lookupError } = await supabase
        .from(BENCHMARK_COHORTS.TABLE)
        .select(C.id)
        .eq(C.tenant_id, input.tenantId)
        .eq(C.cohort_key, input.plan.cohortKey)
        .maybeSingle();

    if (lookupError) {
        throw new Error(`Failed to check benchmark cohort: ${lookupError.message}`);
    }
    if (existing?.id) {
        return String(existing.id);
    }

    const { data, error } = await supabase
        .from(BENCHMARK_COHORTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.scope]: 'tenant',
            [C.cohort_key]: input.plan.cohortKey,
            [C.species]: input.plan.species,
            [C.condition_class]: input.plan.conditionClass,
            [C.acuity_band]: input.plan.acuityBand,
            [C.matching_rules]: input.plan.matchingRules,
            [C.min_support]: 5,
        })
        .select(C.id)
        .single();

    if (error || !data) {
        throw new Error(`Failed to create benchmark cohort: ${error?.message ?? 'Unknown error'}`);
    }

    return String(data.id);
}

async function upsertBenchmarkSnapshotRecord(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        clinicId: string;
        cohortId: string;
        plan: BenchmarkRollupPlan;
    },
): Promise<BenchmarkSnapshotSummary | null> {
    const pool = await loadBenchmarkEpisodePool(supabase, {
        tenantId: input.tenantId,
        plan: input.plan,
    });

    const clinicEpisodes = pool.filter((episode) => episode.clinic_id === input.clinicId);
    if (clinicEpisodes.length === 0) {
        return null;
    }

    const clinicMatches = clinicEpisodes.filter((episode) => episode.outcome_state === input.plan.targetState).length;
    const networkMatches = pool.filter((episode) => episode.outcome_state === input.plan.targetState).length;
    const observedValue = computeRate(clinicMatches, clinicEpisodes.length);
    const expectedValue = computeRate(networkMatches, pool.length);
    const riskAdjustedValue = stabilizeObservedRate(observedValue, expectedValue, clinicEpisodes.length);
    const oeRatio = observedValue == null || expectedValue == null || expectedValue <= 0
        ? (observedValue === 0 && expectedValue === 0 ? 1 : null)
        : observedValue / expectedValue;
    const confidenceInterval = buildWilsonInterval(clinicMatches, clinicEpisodes.length);

    const C = BENCHMARK_SNAPSHOTS.COLUMNS;
    const { data, error } = await supabase
        .from(BENCHMARK_SNAPSHOTS.TABLE)
        .upsert({
            [C.tenant_id]: input.tenantId,
            [C.clinic_id]: input.clinicId,
            [C.cohort_id]: input.cohortId,
            [C.metric_name]: input.plan.metricName,
            [C.window_start]: input.plan.windowStart,
            [C.window_end]: input.plan.windowEnd,
            [C.support_n]: clinicEpisodes.length,
            [C.observed_value]: observedValue,
            [C.expected_value]: expectedValue,
            [C.risk_adjusted_value]: riskAdjustedValue,
            [C.oe_ratio]: oeRatio,
            [C.confidence_interval]: confidenceInterval,
            [C.computed_at]: new Date().toISOString(),
        }, {
            onConflict: 'tenant_id,clinic_id,cohort_id,metric_name,window_end',
        })
        .select([
            C.id,
            C.metric_name,
            C.support_n,
            C.observed_value,
            C.expected_value,
            C.risk_adjusted_value,
            C.oe_ratio,
            C.confidence_interval,
            C.window_start,
            C.window_end,
        ].join(', '))
        .single();

    if (error || !data) {
        throw new Error(`Failed to upsert benchmark snapshot: ${error?.message ?? 'Unknown error'}`);
    }
    const snapshotRow = asRecord(data);

    return {
        id: String(snapshotRow.id),
        metric_name: String(snapshotRow.metric_name),
        support_n: typeof snapshotRow.support_n === 'number' ? snapshotRow.support_n : 0,
        observed_value: typeof snapshotRow.observed_value === 'number' ? snapshotRow.observed_value : null,
        expected_value: typeof snapshotRow.expected_value === 'number' ? snapshotRow.expected_value : null,
        risk_adjusted_value: typeof snapshotRow.risk_adjusted_value === 'number' ? snapshotRow.risk_adjusted_value : null,
        oe_ratio: typeof snapshotRow.oe_ratio === 'number' ? snapshotRow.oe_ratio : null,
        confidence_interval: asRecord(snapshotRow.confidence_interval),
        window_start: String(snapshotRow.window_start),
        window_end: String(snapshotRow.window_end),
    };
}

async function loadBenchmarkEpisodePool(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        plan: BenchmarkRollupPlan;
    },
): Promise<Array<{ id: string; clinic_id: string | null; outcome_state: string; latest_case_id: string | null }>> {
    const E = PATIENT_EPISODES.COLUMNS;
    const { data: episodeRows, error: episodeError } = await supabase
        .from(PATIENT_EPISODES.TABLE)
        .select(`${E.id}, ${E.clinic_id}, ${E.outcome_state}, ${E.latest_case_id}, ${E.updated_at}`)
        .eq(E.tenant_id, input.tenantId)
        .gte(E.updated_at, input.plan.windowStart)
        .lte(E.updated_at, input.plan.windowEnd);

    if (episodeError) {
        throw new Error(`Failed to load benchmark episode pool: ${episodeError.message}`);
    }

    const episodes = (episodeRows ?? []).map((row) => ({
        id: String((row as Record<string, unknown>).id),
        clinic_id: typeof (row as Record<string, unknown>).clinic_id === 'string'
            ? String((row as Record<string, unknown>).clinic_id)
            : null,
        outcome_state: typeof (row as Record<string, unknown>).outcome_state === 'string'
            ? String((row as Record<string, unknown>).outcome_state)
            : 'unknown',
        latest_case_id: typeof (row as Record<string, unknown>).latest_case_id === 'string'
            ? String((row as Record<string, unknown>).latest_case_id)
            : null,
    }));

    const caseIds = Array.from(new Set(
        episodes
            .map((episode) => episode.latest_case_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ));

    const caseProjectionById = await loadBenchmarkCaseProjectionMap(supabase, {
        tenantId: input.tenantId,
        caseIds,
    });

    return episodes.filter((episode) => {
        const projection = episode.latest_case_id ? caseProjectionById.get(episode.latest_case_id) : null;
        if (!projection) return false;
        if (normalizeOptionalLabel(projection.species) !== normalizeOptionalLabel(input.plan.species)) return false;
        if (normalizeOptionalLabel(projection.conditionClass) !== normalizeOptionalLabel(input.plan.conditionClass)) return false;
        if (normalizeOptionalLabel(projection.acuityBand) !== normalizeOptionalLabel(input.plan.acuityBand)) return false;
        return true;
    });
}

async function loadBenchmarkCaseProjectionMap(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        caseIds: string[];
    },
): Promise<Map<string, { species: string | null; conditionClass: string | null; acuityBand: string | null }>> {
    const projections = new Map<string, { species: string | null; conditionClass: string | null; acuityBand: string | null }>();
    if (input.caseIds.length === 0) {
        return projections;
    }

    const C = CLINICAL_CASES.COLUMNS;
    const { data: caseRows, error: caseError } = await supabase
        .from(CLINICAL_CASES.TABLE)
        .select(`${C.id}, ${C.species}, ${C.species_canonical}, ${C.species_display}, ${C.primary_condition_class}, ${C.severity_score}`)
        .eq(C.tenant_id, input.tenantId)
        .in(C.id, input.caseIds);

    if (caseError) {
        throw new Error(`Failed to load benchmark case projection: ${caseError.message}`);
    }

    for (const row of caseRows ?? []) {
        const record = row as Record<string, unknown>;
        const caseId = typeof record.id === 'string' ? record.id : null;
        if (!caseId) continue;
        projections.set(caseId, {
            species: normalizeOptionalLabel(
                typeof record.species_canonical === 'string'
                    ? record.species_canonical
                    : typeof record.species_display === 'string'
                        ? record.species_display
                        : typeof record.species === 'string'
                            ? record.species
                            : null,
            ),
            conditionClass: normalizeOptionalLabel(
                typeof record.primary_condition_class === 'string' ? record.primary_condition_class : null,
            ),
            acuityBand: resolveAcuityBand(readNumber(record.severity_score)),
        });
    }

    return projections;
}

function resolveBenchmarkMetricName(targetState: string): string {
    if (targetState === 'resolved') return 'episode_resolution_rate_90d';
    if (targetState === 'failed') return 'episode_failure_rate_90d';
    if (targetState === 'recurred') return 'episode_recurrence_rate_90d';
    return `episode_${normalizeCohortKeySegment(targetState)}_rate_90d`;
}

function resolveAcuityBand(severityScore: number | null): string | null {
    if (severityScore == null) return null;
    if (severityScore >= 0.85) return 'critical';
    if (severityScore >= 0.65) return 'high';
    if (severityScore >= 0.35) return 'moderate';
    return 'low';
}

function normalizeCohortKeySegment(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function computeRate(numerator: number, denominator: number): number | null {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        return null;
    }
    return numerator / denominator;
}

function stabilizeObservedRate(
    observedValue: number | null,
    expectedValue: number | null,
    supportN: number,
): number | null {
    if (observedValue == null) return null;
    if (expectedValue == null) return observedValue;
    const weight = supportN <= 0 ? 0 : supportN / (supportN + 10);
    return expectedValue + ((observedValue - expectedValue) * weight);
}

function buildWilsonInterval(successes: number, trials: number) {
    if (trials <= 0) {
        return {
            method: 'wilson',
            lower: null,
            upper: null,
        };
    }
    const z = 1.96;
    const p = successes / trials;
    const denominator = 1 + ((z * z) / trials);
    const center = p + ((z * z) / (2 * trials));
    const margin = z * Math.sqrt(((p * (1 - p)) / trials) + ((z * z) / (4 * trials * trials)));
    return {
        method: 'wilson',
        lower: Math.max(0, (center - margin) / denominator),
        upper: Math.min(1, (center + margin) / denominator),
        successes,
        trials,
    };
}

function startOfUtcDay(value: Date): Date {
    return new Date(Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        0,
        0,
        0,
        0,
    ));
}

function endOfUtcDay(value: Date): Date {
    return new Date(Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        23,
        59,
        59,
        999,
    ));
}

async function ensureOutcomeInferenceRecord(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        clinicId: string | null;
        episodeId: string;
        caseId: string;
        inferenceEventId: string;
        outcomeEventId: string;
        outcomeType: string;
        outcomePayload: Record<string, unknown>;
        outcomeTimestamp: string;
        labelType: string;
        inferredState: string | null;
        primaryConditionClass: string | null;
    },
): Promise<string | null> {
    const C = OUTCOME_INFERENCES.COLUMNS;
    const rationaleMarker = {
        source_outcome_event_id: input.outcomeEventId,
        artifact_kind: 'outcome_event_projection',
    };
    const { data: existing, error: lookupError } = await supabase
        .from(OUTCOME_INFERENCES.TABLE)
        .select(C.id)
        .eq(C.tenant_id, input.tenantId)
        .eq(C.episode_id, input.episodeId)
        .contains(C.rationale, rationaleMarker)
        .maybeSingle();

    if (lookupError) {
        throw new Error(`Failed to check outcome inference artifact: ${lookupError.message}`);
    }
    if (existing?.id) {
        return String(existing.id);
    }

    const confidence = resolveArtifactConfidence(input.labelType, input.outcomePayload);
    const inferredState = input.inferredState ?? normalizeOutcomeStateFallback(input.outcomeType);
    const reviewStatus = input.labelType === 'lab_confirmed' || input.labelType === 'expert_reviewed'
        ? 'accepted'
        : 'pending';
    const { data, error } = await supabase
        .from(OUTCOME_INFERENCES.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.clinic_id]: input.clinicId,
            [C.episode_id]: input.episodeId,
            [C.case_id]: input.caseId,
            [C.inference_type]: 'outcome_event_projection',
            [C.inferred_state]: inferredState,
            [C.confidence]: confidence,
            [C.window_end]: input.outcomeTimestamp,
            [C.rationale]: {
                ...rationaleMarker,
                source_inference_event_id: input.inferenceEventId,
                outcome_type: input.outcomeType,
                label_type: input.labelType,
                primary_condition_class: input.primaryConditionClass,
            },
            [C.evidence_event_ids]: [input.outcomeEventId, input.inferenceEventId],
            [C.review_status]: reviewStatus,
        })
        .select(C.id)
        .single();

    if (error || !data) {
        throw new Error(`Failed to create outcome inference artifact: ${error?.message ?? 'Unknown error'}`);
    }

    return String(data.id);
}

async function ensureOutcomeEvidenceCard(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        tenantId: string;
        episodeId: string;
        caseId: string;
        inferenceEventId: string;
        outcomeEventId: string;
        outcomeType: string;
        outcomePayload: Record<string, unknown>;
        outcomeTimestamp: string;
        labelType: string;
        inferredState: string | null;
        primaryConditionClass: string | null;
        modelVersion: string | null;
        requestId: string;
    },
): Promise<string | null> {
    const C = EVIDENCE_CARDS.COLUMNS;
    const lineageMarker = {
        artifact_kind: 'outcome_projection',
        source_outcome_event_id: input.outcomeEventId,
    };
    const { data: existing, error: lookupError } = await supabase
        .from(EVIDENCE_CARDS.TABLE)
        .select(C.id)
        .eq(C.tenant_id, input.tenantId)
        .eq(C.subject_type, 'episode')
        .eq(C.subject_id, input.episodeId)
        .contains(C.lineage, lineageMarker)
        .maybeSingle();

    if (lookupError) {
        throw new Error(`Failed to check episode evidence artifact: ${lookupError.message}`);
    }
    if (existing?.id) {
        return String(existing.id);
    }

    const inferredState = input.inferredState ?? normalizeOutcomeStateFallback(input.outcomeType);
    const summaryFragments = [
        input.primaryConditionClass ? `Condition: ${input.primaryConditionClass}.` : null,
        `Outcome type: ${input.outcomeType}.`,
        `State: ${inferredState}.`,
        `Label trust: ${input.labelType}.`,
        typeof input.outcomePayload.ground_truth === 'string'
            ? `Ground truth: ${input.outcomePayload.ground_truth}.`
            : null,
    ].filter((value): value is string => value != null);

    const { data, error } = await supabase
        .from(EVIDENCE_CARDS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.subject_type]: 'episode',
            [C.subject_id]: input.episodeId,
            [C.headline]: buildEvidenceHeadline(inferredState, input.outcomeType),
            [C.summary]: summaryFragments.join(' '),
            [C.lineage]: {
                ...lineageMarker,
                source_case_id: input.caseId,
                source_inference_event_id: input.inferenceEventId,
                observed_at: input.outcomeTimestamp,
                request_id: input.requestId,
            },
            [C.support_n]: 1,
            [C.model_versions]: input.modelVersion ? [input.modelVersion] : [],
        })
        .select(C.id)
        .single();

    if (error || !data) {
        throw new Error(`Failed to create episode evidence card: ${error?.message ?? 'Unknown error'}`);
    }

    return String(data.id);
}

function resolveArtifactConfidence(
    labelType: string,
    payload: Record<string, unknown>,
): number {
    if (typeof payload.confidence === 'number' && Number.isFinite(payload.confidence)) {
        return Math.min(Math.max(payload.confidence, 0), 1);
    }
    if (labelType === 'lab_confirmed') return 0.99;
    if (labelType === 'expert_reviewed') return 0.95;
    if (labelType === 'synthetic') return 0.65;
    return 0.8;
}

function normalizeOutcomeStateFallback(outcomeType: string): string {
    const normalized = outcomeType.trim().toLowerCase();
    if (normalized.includes('resolved') || normalized.includes('recover') || normalized.includes('discharge')) {
        return 'resolved';
    }
    if (normalized.includes('recur') || normalized.includes('relapse')) {
        return 'recurred';
    }
    if (normalized.includes('fail')) {
        return 'failed';
    }
    return normalized.replace(/\s+/g, '_') || 'observed_outcome';
}

function buildEvidenceHeadline(
    inferredState: string,
    outcomeType: string,
): string {
    if (inferredState === 'resolved') return 'Outcome suggests episode resolution';
    if (inferredState === 'failed') return 'Outcome suggests treatment failure or escalation';
    if (inferredState === 'recurred') return 'Outcome suggests recurrence risk';
    return `Outcome captured: ${outcomeType}`;
}

function resolveOutcomeGroundTruth(payload: Record<string, unknown>): string | null {
    const explicitGroundTruth = typeof payload.ground_truth === 'string' ? payload.ground_truth : null;
    if (explicitGroundTruth && explicitGroundTruth.trim().length > 0) {
        return explicitGroundTruth.trim();
    }

    const actualDiagnosis = typeof payload.actual_diagnosis === 'string' ? payload.actual_diagnosis : null;
    if (actualDiagnosis && actualDiagnosis.trim().length > 0) {
        return actualDiagnosis.trim();
    }

    const camelActualDiagnosis = typeof payload.actualDiagnosis === 'string' ? payload.actualDiagnosis : null;
    if (camelActualDiagnosis && camelActualDiagnosis.trim().length > 0) {
        return camelActualDiagnosis.trim();
    }

    const confirmedDiagnosis = typeof payload.confirmed_diagnosis === 'string' ? payload.confirmed_diagnosis : null;
    if (confirmedDiagnosis && confirmedDiagnosis.trim().length > 0) {
        return confirmedDiagnosis.trim();
    }

    const finalDiagnosis = typeof payload.final_diagnosis === 'string' ? payload.final_diagnosis : null;
    if (finalDiagnosis && finalDiagnosis.trim().length > 0) {
        return finalDiagnosis.trim();
    }

    const directDiagnosis = typeof payload.diagnosis === 'string' ? payload.diagnosis : null;
    if (directDiagnosis && directDiagnosis.trim().length > 0) {
        return directDiagnosis.trim();
    }

    const diagnosisName = typeof payload.diagnosis_name === 'string' ? payload.diagnosis_name : null;
    if (diagnosisName && diagnosisName.trim().length > 0) {
        return diagnosisName.trim();
    }

    const primaryConditionClass = typeof payload.primary_condition_class === 'string'
        ? payload.primary_condition_class
        : null;
    return primaryConditionClass && primaryConditionClass.trim().length > 0
        ? primaryConditionClass.trim()
        : null;
}

function areLabelsEqual(left: string, right: string) {
    return normalizeLabel(left) === normalizeLabel(right);
}

function normalizeLabel(value: string) {
    return value.trim().toLowerCase();
}

function normalizeOptionalLabel(value: string | null | undefined) {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function resolveConditionClassLabel(explicit: string | null, diagnosisLabel: string | null) {
    const normalizedExplicit = normalizeOptionalLabel(explicit);
    if (normalizedExplicit && normalizedExplicit.toLowerCase() !== 'idiopathic / unknown' && normalizedExplicit.toLowerCase() !== 'unknown') {
        return normalizedExplicit;
    }

    const normalizedDiagnosis = normalizeOptionalLabel(diagnosisLabel)?.toLowerCase() ?? '';
    if (!normalizedDiagnosis) {
        return normalizedExplicit;
    }
    if (
        normalizedDiagnosis.includes('gdv') ||
        normalizedDiagnosis.includes('dilatation') ||
        normalizedDiagnosis.includes('volvulus') ||
        normalizedDiagnosis.includes('obstruction') ||
        normalizedDiagnosis.includes('tracheal collapse')
    ) {
        return 'Mechanical';
    }
    if (
        normalizedDiagnosis.includes('herpesvirus') ||
        normalizedDiagnosis.includes('tracheobronchitis') ||
        normalizedDiagnosis.includes('viral') ||
        normalizedDiagnosis.includes('bacterial') ||
        normalizedDiagnosis.includes('infection') ||
        normalizedDiagnosis.includes('parvo') ||
        normalizedDiagnosis.includes('distemper') ||
        normalizedDiagnosis.includes('rhinotracheitis') ||
        normalizedDiagnosis.includes('kennel cough')
    ) {
        return 'Infectious';
    }
    if (normalizedDiagnosis.includes('bronchitis') || normalizedDiagnosis.includes('pancreatitis')) {
        return 'Inflammatory';
    }
    if (normalizedDiagnosis.includes('toxic')) {
        return 'Toxicology';
    }
    return normalizedExplicit;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
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

function asNumericRecord(value: unknown): Record<string, number> {
    return Object.fromEntries(
        Object.entries(asRecord(value))
            .map(([key, raw]) => [key, readNumber(raw)])
            .filter((entry): entry is [string, number] => entry[1] != null),
    );
}

function mergeNumericFeatures(...sources: Array<Record<string, number>>): Record<string, number> {
    const merged: Record<string, number> = {};

    for (const source of sources) {
        for (const [key, value] of Object.entries(source)) {
            merged[key] = value;
        }
    }

    return merged;
}

async function settleNonCriticalEffect(
    requestId: string,
    label: string,
    effect: Promise<unknown>,
    options: {
        timeoutMs?: number;
    } = {},
) {
    try {
        if (options.timeoutMs && options.timeoutMs > 0) {
            await Promise.race([
                effect,
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`${label} timed out after ${options.timeoutMs}ms`)), options.timeoutMs),
                ),
            ]);
            return;
        }

        await effect;
    } catch (error) {
        console.error(`[${requestId}] ${label} failed (non-fatal):`, error);
    }
}
