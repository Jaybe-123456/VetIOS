/**
 * @vetios/ai-core — Inference Pipeline (updated: Fixes 2, 3, 4 wired in)
 *
 * Full AI reasoning flow:
 *   Context Assembly → PII Redaction → Prompt Rendering → Model Call →
 *   Output Parsing → Contradiction Detection (Fix 4) →
 *   Constraint Validation → Urgency Evaluation (Fix 2 + 3) →
 *   Decision Log → Flywheel → Intelligence Metric
 *
 * DecisionResult now includes:
 *   - urgency_result   (EmergencyLevel + override flag)   Fix 2 + 3
 *   - contradiction    (score + abstain recommendation)   Fix 4
 */

import type { TypedSupabaseClient, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';
import { createDecisionLog } from '@vetios/domain';
import { captureDataEvent } from '@vetios/domain';
import { validatePrescriptionBatch } from '@vetios/domain';
import type { ConstraintViolation } from '@vetios/domain';
import { evaluateUrgency } from '@vetios/domain';         // Fix 2 + 3
import type { UrgencyResult } from '@vetios/domain';      // Fix 3
import { detectContradictions } from '@vetios/domain';    // Fix 4
import type { ContradictionResult } from '@vetios/domain';// Fix 4
import type { VetAIClient, CompletionResponse } from './client';
import type { PromptContext } from './prompts';
import { getPromptTemplate } from './prompts';
import { redactPII, restorePII } from './redaction';
import { searchKnowledge } from './rag';
import { emitFeedbackSignal } from './feedback-loop';

const logger = createLogger({ module: 'ai-core.pipeline' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineInput {
    /** Which prompt template to use (name key) */
    templateName: string;
    /** Tenant context */
    tenant_id: string;
    /** Encounter being analyzed */
    encounter_id: string;
    /** User initiating the analysis */
    user_id: string;
    /** Patient context for prompt building */
    patient: PromptContext['patient'];
    /** Encounter context for prompt building */
    encounter: PromptContext['encounter'];
    /** Whether to run RAG before inference. Default: true */
    enableRAG?: boolean;
    /** Clinic-specific protocols to inject */
    clinic_protocols?: string[];
    /** Override model for this request */
    model?: string;
    /**
     * Normalised symptom keys present in this encounter.
     * Used by the urgency override layer (Fix 2) and contradiction detector (Fix 4).
     * e.g. ['unproductive_retching', 'abdominal_distension', 'acute_onset']
     */
    present_symptoms?: string[];
    /**
     * Context flags for urgency rule matching (breed tags, onset descriptors).
     * e.g. ['large_breed', 'acute_onset', 'great_dane']
     */
    context_flags?: string[];
    /**
     * Symptom confidence weights for contradiction scoring.
     * Record<symptom_key, 0–1>. Defaults to 1.0 for all if omitted.
     */
    symptom_weights?: Record<string, number>;
    /**
     * Raw ML risk score from /predict endpoint (0–1).
     * If omitted, urgency is derived from the LLM output alone.
     */
    ml_risk_score?: number;
}

export interface DecisionResult {
    /** Unique trace ID for auditability */
    trace_id: string;
    /** Database ID of the decision log entry */
    decision_id: string;
    /** Parsed AI output (JSON) */
    parsed_output: Record<string, unknown>;
    /** Raw model response text */
    raw_output: string;
    /** Constraint violations found in the output (if any) */
    constraint_violations: ConstraintViolation[];
    /** Whether the output passed all constraint checks */
    constraints_satisfied: boolean;
    /** Model and provider info */
    model_version: string;
    /** End-to-end latency */
    total_latency_ms: number;
    /** Fix 2 + 3: Urgency tier and override metadata */
    urgency_result: UrgencyResult;
    /** Fix 4: Contradiction score and abstention recommendation */
    contradiction: ContradictionResult;
    /**
     * Fix 4: Whether the pipeline recommends suppressing output.
     * Callers MUST check this before surfacing results to clinicians.
     */
    should_abstain: boolean;
}

// ─── Pipeline Implementation ──────────────────────────────────────────────────

export class InferencePipeline {
    private aiClient: VetAIClient;
    private supabase: TypedSupabaseClient;

    constructor(aiClient: VetAIClient, supabase: TypedSupabaseClient) {
        this.aiClient = aiClient;
        this.supabase = supabase;
    }

    /**
     * Executes the full inference pipeline.
     *
     * Every step is logged. The DecisionResult is the complete audit record
     * for this inference — including urgency override and contradiction score.
     */
    async execute(input: PipelineInput): Promise<DecisionResult> {
        const pipelineStart = Date.now();
        const traceId = generateTraceId();

        const pipelineLogger = logger.child({
            trace_id: traceId,
            tenant_id: input.tenant_id,
            encounter_id: input.encounter_id,
        });

        pipelineLogger.info('Pipeline started', { template: input.templateName });

        try {
            // ── Step 1: Resolve template ──────────────────────────────────────
            const template = getPromptTemplate(input.templateName);

            // ── Step 2: RAG — Retrieve relevant knowledge ─────────────────────
            let retrievedKnowledge: string[] = [];
            if (input.enableRAG !== false && input.encounter.chief_complaint) {
                try {
                    const ragResults = await searchKnowledge(
                        this.supabase,
                        this.aiClient,
                        input.encounter.chief_complaint,
                        input.tenant_id,
                        { limit: 5, threshold: 0.7 },
                    );
                    retrievedKnowledge = ragResults.map((r) => r.content);
                    pipelineLogger.info('RAG search completed', { results_count: ragResults.length });
                } catch (ragError) {
                    pipelineLogger.warn('RAG search failed, proceeding without', {
                        error: ragError instanceof Error ? ragError.message : String(ragError),
                    });
                }
            }

            // ── Step 3: Build prompt context ──────────────────────────────────
            const promptContext: PromptContext = {
                patient: input.patient,
                encounter: input.encounter,
                retrieved_knowledge: retrievedKnowledge,
                clinic_protocols: input.clinic_protocols,
            };

            // ── Step 4: Render messages ───────────────────────────────────────
            const messages = template.build(promptContext);

            // ── Step 5: PII Redaction ─────────────────────────────────────────
            const redactedMessages = messages.map((msg) => {
                const { redactedText, tokenMap } = redactPII(msg.content);
                return { ...msg, content: redactedText, _tokenMap: tokenMap };
            });

            const combinedTokenMap = new Map<string, string>();
            for (const msg of redactedMessages) {
                for (const [k, v] of msg._tokenMap) {
                    combinedTokenMap.set(k, v);
                }
            }

            // ── Step 6: Model Call ────────────────────────────────────────────
            const completionMessages = redactedMessages.map(({ _tokenMap: _, ...msg }) => msg);
            let completion: CompletionResponse;

            try {
                completion = await this.aiClient.complete({
                    messages: completionMessages,
                    model: input.model,
                    temperature: 0.3,
                    responseFormat: 'json_object',
                });
            } catch (aiError) {
                pipelineLogger.error('AI completion failed', {
                    error: aiError instanceof Error ? aiError.message : String(aiError),
                });
                throw aiError;
            }

            // ── Step 7: Restore PII in response ──────────────────────────────
            const rawOutput = restorePII(completion.content, combinedTokenMap);

            // ── Step 8: Parse output ──────────────────────────────────────────
            let parsedOutput: Record<string, unknown>;
            try {
                parsedOutput = JSON.parse(rawOutput) as Record<string, unknown>;
            } catch {
                pipelineLogger.warn('Failed to parse AI output as JSON, wrapping as raw');
                parsedOutput = { raw_text: rawOutput, parse_error: true };
            }

            // ── Step 9: Constraint Validation ─────────────────────────────────
            const constraintViolations = runConstraintValidation(parsedOutput, input.patient);

            // ── Step 9a: Contradiction Detection (Fix 4) ──────────────────────
            // Extract symptoms from parsedOutput if not supplied directly.
            const symptomsForContradiction = input.present_symptoms
                ?? extractSymptomsFromOutput(parsedOutput);

            const contradictionResult = detectContradictions(
                symptomsForContradiction,
                input.symptom_weights,
            );

            pipelineLogger.info('Contradiction check', {
                contradiction_score: contradictionResult.contradiction_score,
                should_abstain: contradictionResult.should_abstain,
                recommended_action: contradictionResult.recommended_action,
                active_conflict_count: contradictionResult.active_conflicts.length,
            });

            if (contradictionResult.should_abstain) {
                pipelineLogger.warn('Abstention recommended — high contradiction score', {
                    score: contradictionResult.contradiction_score,
                    conflicts: contradictionResult.active_conflicts.map((c) => c.pair.pattern_id ?? `${c.pair.symptom_a}↔${c.pair.symptom_b}`),
                });
            }

            // ── Step 9b: Urgency Evaluation (Fix 2 + 3) ──────────────────────
            // Use the ML risk score if available; fall back to 0.5 (neutral).
            const mlRiskScore = input.ml_risk_score ?? 0.5;
            const contextFlags = input.context_flags ?? [];

            const urgencyResult = evaluateUrgency(
                symptomsForContradiction,
                contextFlags,
                mlRiskScore,
            );

            pipelineLogger.info('Urgency evaluated', {
                emergency_level: urgencyResult.emergency_level,
                override_applied: urgencyResult.override_applied,
                override_pattern: urgencyResult.override_pattern_id ?? 'none',
                raw_risk_score: urgencyResult.raw_risk_score,
                effective_risk_score: urgencyResult.effective_risk_score,
            });

            if (urgencyResult.override_applied) {
                pipelineLogger.warn('Emergency override fired', {
                    pattern: urgencyResult.override_pattern_id,
                    description: urgencyResult.override_description,
                    level: urgencyResult.emergency_level,
                });
            }

            // ── Step 10: Build context snapshot for audit ─────────────────────
            const contextSnapshot: Record<string, unknown> = {
                patient: input.patient,
                chief_complaint: input.encounter.chief_complaint,
                clinical_event_count: input.encounter.clinical_events.length,
                rag_results_count: retrievedKnowledge.length,
                clinic_protocols_count: input.clinic_protocols?.length ?? 0,
                // Fix 2 + 3 + 4: persist urgency and contradiction in every audit record
                urgency: {
                    emergency_level: urgencyResult.emergency_level,
                    override_applied: urgencyResult.override_applied,
                    override_pattern_id: urgencyResult.override_pattern_id,
                    raw_risk_score: urgencyResult.raw_risk_score,
                    effective_risk_score: urgencyResult.effective_risk_score,
                },
                contradiction: {
                    score: contradictionResult.contradiction_score,
                    should_abstain: contradictionResult.should_abstain,
                    recommended_action: contradictionResult.recommended_action,
                    active_conflict_count: contradictionResult.active_conflicts.length,
                },
            };

            // ── Step 11: Persist decision log ─────────────────────────────────
            const decisionLog = await createDecisionLog(this.supabase, {
                tenant_id: input.tenant_id,
                encounter_id: input.encounter_id,
                trace_id: traceId,
                model_version: completion.model,
                prompt_template_id: template.template_id,
                context_snapshot: contextSnapshot as Json,
                raw_output: rawOutput,
                parsed_output: parsedOutput as Json,
                latency_ms: completion.latency_ms,
            });

            const totalLatency = Date.now() - pipelineStart;

            pipelineLogger.info('Pipeline completed', {
                decision_id: decisionLog.id,
                model: completion.model,
                ai_latency_ms: completion.latency_ms,
                total_latency_ms: totalLatency,
                constraints_satisfied: constraintViolations.length === 0,
                constraint_violations_count: constraintViolations.length,
                emergency_level: urgencyResult.emergency_level,
                should_abstain: contradictionResult.should_abstain,
            });

            // ── Step 12: Data Flywheel ────────────────────────────────────────
            try {
                await captureDataEvent(this.supabase, {
                    tenant_id: input.tenant_id,
                    event_category: 'ai_diagnostic_outcome',
                    source_encounter_id: input.encounter_id,
                    source_decision_id: decisionLog.id,
                    data_payload: {
                        trace_id: traceId,
                        model: completion.model,
                        template_name: input.templateName,
                        constraint_violations_count: constraintViolations.length,
                        latency_ms: totalLatency,
                        // Fix 2 + 3 + 4: every flywheel event carries urgency + contradiction
                        emergency_level: urgencyResult.emergency_level,
                        override_applied: urgencyResult.override_applied,
                        contradiction_score: contradictionResult.contradiction_score,
                        abstain_recommended: contradictionResult.should_abstain,
                    } as Json,
                });
            } catch (flywheelErr) {
                pipelineLogger.warn('Flywheel capture failed (non-fatal)', {
                    error: flywheelErr instanceof Error ? flywheelErr.message : String(flywheelErr),
                });
            }

            // ── Step 13: Intelligence metric ──────────────────────────────────
            try {
                // Fix 2 + 4: penalise score when override fired (model was wrong)
                // or when contradiction is high (signal quality is poor).
                const baseScore = constraintViolations.length === 0 ? 0.8 : 0.4;
                const overridePenalty = urgencyResult.override_applied ? 0.2 : 0;
                const contradictionPenalty = contradictionResult.contradiction_score * 0.2;
                const finalScore = Math.max(0, baseScore - overridePenalty - contradictionPenalty);

                await emitFeedbackSignal(this.supabase, {
                    tenant_id: input.tenant_id,
                    metric_type: 'prediction_accuracy',
                    decision_id: decisionLog.id,
                    encounter_id: input.encounter_id,
                    score: finalScore,
                    feedback_signal: {
                        trace_id: traceId,
                        constraints_passed: constraintViolations.length === 0,
                        model_version: completion.model,
                        emergency_level: urgencyResult.emergency_level,
                        override_applied: urgencyResult.override_applied,
                        contradiction_score: contradictionResult.contradiction_score,
                    } as Json,
                    intelligence_sharing_opted_in: false,
                    model_version: completion.model,
                });
            } catch (metricErr) {
                pipelineLogger.warn('Intelligence metric emit failed (non-fatal)', {
                    error: metricErr instanceof Error ? metricErr.message : String(metricErr),
                });
            }

            return {
                trace_id: traceId,
                decision_id: decisionLog.id,
                parsed_output: parsedOutput,
                raw_output: rawOutput,
                constraint_violations: constraintViolations,
                constraints_satisfied: constraintViolations.length === 0,
                model_version: completion.model,
                total_latency_ms: totalLatency,
                urgency_result: urgencyResult,       // Fix 2 + 3
                contradiction: contradictionResult,  // Fix 4
                should_abstain: contradictionResult.should_abstain, // Fix 4 (convenience)
            };

        } catch (err) {
            const totalLatency = Date.now() - pipelineStart;
            pipelineLogger.error('Pipeline failed', {
                error: err instanceof Error ? err.message : String(err),
                total_latency_ms: totalLatency,
            });
            throw err;
        }
    }
}

// ─── Constraint Validation ────────────────────────────────────────────────────

function runConstraintValidation(
    parsedOutput: Record<string, unknown>,
    patient: PipelineInput['patient'],
): ConstraintViolation[] {
    const medications = parsedOutput['medications'] as
        | Array<{ drug_name: string; dose_mg_per_kg?: number; total_dose_mg?: number }>
        | undefined;

    if (!medications || !Array.isArray(medications) || medications.length === 0) return [];
    if (!patient.weight_kg || patient.weight_kg <= 0) return [];

    const dosageInputs = medications
        .filter((med) => med.drug_name && (med.total_dose_mg || med.dose_mg_per_kg))
        .map((med) => ({
            drug_name: med.drug_name,
            species: patient.species,
            weight_kg: patient.weight_kg!,
            proposed_dose_mg: med.total_dose_mg ?? (med.dose_mg_per_kg ?? 0) * patient.weight_kg!,
        }));

    if (dosageInputs.length === 0) return [];

    const result = validatePrescriptionBatch(dosageInputs);
    return result.violations;
}

// ─── Symptom Extraction (Fix 4 helper) ───────────────────────────────────────

/**
 * Best-effort extraction of symptom keys from LLM parsed output.
 * Used as fallback when input.present_symptoms is not supplied.
 *
 * Scans 'differentials[].reasoning', 'chief_complaint', and top-level arrays
 * for symptom-like strings. This is heuristic — callers should prefer passing
 * input.present_symptoms directly from the clinical event payload.
 */
function extractSymptomsFromOutput(parsedOutput: Record<string, unknown>): string[] {
    const symptoms: string[] = [];

    // Try pulling from a 'symptoms' key if the LLM included one.
    const rawSymptoms = parsedOutput['symptoms'];
    if (Array.isArray(rawSymptoms)) {
        symptoms.push(...rawSymptoms.filter((s): s is string => typeof s === 'string'));
    }

    // Try 'differentials[].key_symptoms'
    const differentials = parsedOutput['differentials'];
    if (Array.isArray(differentials)) {
        for (const diff of differentials) {
            if (typeof diff === 'object' && diff !== null) {
                const ks = (diff as Record<string, unknown>)['key_symptoms'];
                if (Array.isArray(ks)) {
                    symptoms.push(...ks.filter((s): s is string => typeof s === 'string'));
                }
            }
        }
    }

    return [...new Set(symptoms.map((s) => s.toLowerCase().replace(/\s+/g, '_')))];
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function generateTraceId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
