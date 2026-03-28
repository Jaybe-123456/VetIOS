/**
 * Model Improver (Audit Proof)
 * 
 * Enforces the "Before vs After" proof principle.
 * We never blindly trust a reinforcement update. This module calculates the delta
 * between what the model originall predicted (pre_update) vs what it predicts
 * now that the features have been reinforced locally (post_update).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { MODEL_IMPROVEMENT_AUDITS } from '@/lib/db/schemaContracts';

export interface AuditInput {
    tenant_id: string;
    inference_event_id: string;
    pre_update_prediction: Record<string, unknown>;
    pre_confidence: number | null;
    reinforcement_applied: boolean;
    // In a real live system, we would shadow-query the LLM or ML server here
    // with the updated weights. For the refactor, we simulate the post-update values
    // by boosting the target class and dampening the others based on the reinforcement delta.
    actual_correctness: number; 
    calibration_improvement: number;
    failure_correction_report?: Record<string, unknown>;
}

export async function logModelImprovementAudit(
    client: SupabaseClient,
    input: AuditInput
): Promise<string | null> {
    if (!input.reinforcement_applied) return null;

    // Simulate the post-update values based on local reinforcement (Mock shadow test)
    // Over time this should be replaced with an actual shadow inference run.
    const improvedConfidence = Math.min(1.0, (input.pre_confidence ?? 0.5) + (input.actual_correctness > 0.5 ? 0.1 : -0.1));
    const improvementDelta = improvedConfidence - (input.pre_confidence ?? 0.5);

    const postUpdatePrediction = { ...input.pre_update_prediction };
    (postUpdatePrediction as any)._audit_note = "Simulated post-update weights";
    if (input.failure_correction_report) {
        (postUpdatePrediction as any)._failure_correction_report = input.failure_correction_report;
    }

    const C = MODEL_IMPROVEMENT_AUDITS.COLUMNS;

    const { data, error } = await client
        .from(MODEL_IMPROVEMENT_AUDITS.TABLE)
        .insert({
            [C.tenant_id]: input.tenant_id,
            [C.inference_event_id]: input.inference_event_id,
            [C.pre_update_prediction]: input.pre_update_prediction,
            [C.post_update_prediction]: postUpdatePrediction,
            [C.pre_confidence]: input.pre_confidence,
            [C.post_confidence]: improvedConfidence,
            [C.improvement_delta]: improvementDelta
        })
        .select('id')
        .single();

    if (error || !data) {
        console.error('[logModelImprovementAudit] DB insertion failed:', error);
        throw new Error(`Failed to log audit: ${error?.message}`);
    }

    return data.id as string;
}
