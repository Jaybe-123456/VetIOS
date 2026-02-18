/**
 * @vetios/ai-core — Inference Pipeline
 *
 * Orchestrates the full AI reasoning flow:
 *   Context Assembly → PII Redaction → Prompt Rendering → Model Call →
 *   Output Parsing → Constraint Validation → Decision Log Creation
 *
 * Returns a structured DecisionResult with a trace_id
 * for full auditability of every AI decision.
 */

import type { TypedSupabaseClient, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';
import { createDecisionLog } from '@vetios/domain';
import { captureDataEvent } from '@vetios/domain';
import { validatePrescriptionBatch } from '@vetios/domain';
import type { ConstraintViolation } from '@vetios/domain';
import type { VetAIClient, CompletionResponse } from './client';
import type { PromptContext } from './prompts';
import { getPromptTemplate } from './prompts';
import { redactPII, restorePII } from './redaction';
import { searchKnowledge } from './rag';
import { emitFeedbackSignal } from './feedback-loop';

const logger = createLogger({ module: 'ai-core.pipeline' });

// ─── Types ───────────────────────────────────────────────────────────────────

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
}

// ─── Pipeline Implementation ─────────────────────────────────────────────────

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
     * This is the primary entry point for the Decision Intelligence Layer.
     * Every step is logged and the full context is captured for traceability.
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

            // ── Step 2: RAG — Retrieve relevant knowledge ────────────────────
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
                    // RAG failure is non-fatal — proceed without retrieved knowledge
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

            // Collect all token maps for response reconstruction
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

            // ── Step 7: Restore PII in response ───────────────────────────────
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

            // ── Step 10: Build context snapshot for audit ──────────────────────
            const contextSnapshot: Record<string, unknown> = {
                patient: input.patient,
                chief_complaint: input.encounter.chief_complaint,
                clinical_event_count: input.encounter.clinical_events.length,
                rag_results_count: retrievedKnowledge.length,
                clinic_protocols_count: input.clinic_protocols?.length ?? 0,
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
            });

            // ── Step 12: Data Flywheel — Capture data generation event ──
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
                    } as Json,
                });
            } catch (flywheelErr) {
                pipelineLogger.warn('Flywheel capture failed (non-fatal)', {
                    error: flywheelErr instanceof Error ? flywheelErr.message : String(flywheelErr),
                });
            }

            // ── Step 13: Emit intelligence metric for the decision ──
            try {
                await emitFeedbackSignal(this.supabase, {
                    tenant_id: input.tenant_id,
                    metric_type: 'prediction_accuracy',
                    decision_id: decisionLog.id,
                    encounter_id: input.encounter_id,
                    score: constraintViolations.length === 0 ? 0.8 : 0.4,
                    feedback_signal: {
                        trace_id: traceId,
                        constraints_passed: constraintViolations.length === 0,
                        model_version: completion.model,
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

// ─── Constraint Validation (Post-Processing) ────────────────────────────────

/**
 * Attempts to extract medication recommendations from the AI output
 * and validate them against the deterministic constraint engine.
 */
function runConstraintValidation(
    parsedOutput: Record<string, unknown>,
    patient: PipelineInput['patient'],
): ConstraintViolation[] {
    // Look for medications in the output (treatment_plan template)
    const medications = parsedOutput['medications'] as
        | Array<{ drug_name: string; dose_mg_per_kg?: number; total_dose_mg?: number }>
        | undefined;

    if (!medications || !Array.isArray(medications) || medications.length === 0) {
        return [];
    }

    if (!patient.weight_kg || patient.weight_kg <= 0) {
        return []; // Cannot validate dosage without weight
    }

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

// ─── Utilities ───────────────────────────────────────────────────────────────

function generateTraceId(): string {
    // UUID v4 generation without external dependency
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
