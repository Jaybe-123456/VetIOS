/**
 * Calibration Engine
 * 
 * Computes strict calibration metrics (Brier Score, ECE proxies) for single events
 * and aggregates them over time. Ensures the model's self-reported confidence
 * actually matches its real-world correctness rate.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { OUTCOME_CALIBRATIONS } from '@/lib/db/schemaContracts';

export interface CalibrationResult {
    id: string;
    brier_score: number | null;
    calibration_error: number | null;
}

/**
 * Calculates the Brier Score dynamically for a single event.
 * Formula: (predicted_probability - actual_outcome)^2
 * @param predictedConfidence Float [0,1]
 * @param actualCorrectness Float [0,1] (usually strictly 0 or 1)
 */
export function calculateBrierScore(predictedConfidence: number, actualCorrectness: number): number {
    const p = Math.max(0, Math.min(1, predictedConfidence));
    const a = Math.max(0, Math.min(1, actualCorrectness));
    // Squaring the error heavily penalizes high confidence when wrong.
    return Math.pow(p - a, 2);
}

/**
 * Calculates raw individual Calibration Error.
 * Formula: |predicted_probability - actual_outcome|
 * Aggregating this yields a proxy for Expected Calibration Error (ECE).
 */
export function calculateCalibrationError(predictedConfidence: number, actualCorrectness: number): number {
    const p = Math.max(0, Math.min(1, predictedConfidence));
    const a = Math.max(0, Math.min(1, actualCorrectness));
    return Math.abs(p - a);
}

/**
 * Persists the calibration for a single outcome attachment.
 */
export async function logOutcomeCalibration(
    client: SupabaseClient,
    params: {
        tenant_id: string;
        inference_event_id: string;
        outcome_event_id: string;
        predicted_confidence: number | null;
        actual_correctness: number | null;
    }
): Promise<CalibrationResult | null> {
    if (params.predicted_confidence == null || params.actual_correctness == null) {
        return null; // Cannot calibrate without confidence or correctness mapping
    }

    const brierScore = calculateBrierScore(params.predicted_confidence, params.actual_correctness);
    const calibrationError = calculateCalibrationError(params.predicted_confidence, params.actual_correctness);

    const C = OUTCOME_CALIBRATIONS.COLUMNS;

    const { data, error } = await client
        .from(OUTCOME_CALIBRATIONS.TABLE)
        .insert({
            [C.tenant_id]: params.tenant_id,
            [C.inference_event_id]: params.inference_event_id,
            [C.outcome_event_id]: params.outcome_event_id,
            [C.predicted_confidence]: params.predicted_confidence,
            [C.actual_correctness]: params.actual_correctness,
            [C.brier_score]: brierScore,
            [C.calibration_error]: calibrationError,
        })
        .select('id')
        .single();

    if (error || !data) {
        console.error('[logOutcomeCalibration] DB insertion failed:', error);
        throw new Error(`Failed to log calibration: ${error?.message}`);
    }

    return {
        id: data.id,
        brier_score: brierScore,
        calibration_error: calibrationError,
    };
}
