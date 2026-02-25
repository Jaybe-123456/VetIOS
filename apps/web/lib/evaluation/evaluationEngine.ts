/**
 * Evaluation Engine — The Intelligence Measurement Layer
 *
 * Computes structured evaluation metrics every time:
 *   - Inference runs       → baseline eval (confidence + complexity)
 *   - Outcome attaches     → alignment eval (predicted vs actual)
 *   - Simulation runs      → degradation eval (adversarial resilience)
 *
 * This is the moat: VetIOS doesn't just run AI. It measures intelligence.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EvaluationInput {
    tenant_id: string;
    trigger_type: 'inference' | 'outcome' | 'simulation';
    inference_event_id?: string;
    outcome_event_id?: string;
    model_name: string;
    model_version: string;

    // Raw signals for computation
    predicted_confidence?: number | null;
    actual_correctness?: number;      // 0 or 1 (from outcome)
    predicted_output?: Record<string, unknown>;
    actual_outcome?: Record<string, unknown>;
    simulation_results?: SimulationSignal[];
    recent_evaluations?: PriorEvaluation[];
}

export interface SimulationSignal {
    safety_score: number;
    failure_mode: string | null;
    stress_level: string;
}

export interface PriorEvaluation {
    calibration_error: number | null;
    drift_score: number | null;
    created_at: string;
}

export interface EvaluationResult {
    id: string;
    calibration_error: number | null;
    drift_score: number | null;
    outcome_alignment_delta: number | null;
    simulation_degradation: number | null;
    calibrated_confidence: number | null;
    epistemic_uncertainty: number | null;
    aleatoric_uncertainty: number | null;
}

// ─── Computation Functions ───────────────────────────────────────────────────

/**
 * Calibration Error: |predicted_confidence - actual_correctness|
 *
 * A perfectly calibrated model says "80% confident" and is correct 80% of the time.
 * High calibration error = the model's confidence is misleading.
 */
export function computeCalibrationError(
    predictedConfidence?: number | null,
    actualCorrectness?: number | null,
): number | null {
    if (predictedConfidence == null || actualCorrectness == null) return null;

    // Clamp inputs to [0, 1]
    const p = Math.max(0, Math.min(1, predictedConfidence));
    const a = Math.max(0, Math.min(1, actualCorrectness));

    return Math.abs(p - a);
}

/**
 * Drift Score: Rolling degradation signal.
 *
 * Compares recent calibration errors against baseline.
 * Score 0 = stable. Score approaching 1 = model is degrading.
 */
export function computeDriftScore(
    recentEvaluations?: PriorEvaluation[],
): number | null {
    if (!recentEvaluations || recentEvaluations.length < 3) return null;

    const errors = recentEvaluations
        .map(e => e.calibration_error)
        .filter((e): e is number => e != null);

    if (errors.length < 3) return null;

    // Split into baseline (older half) and recent (newer half)
    const midpoint = Math.floor(errors.length / 2);
    const baseline = errors.slice(0, midpoint);
    const recent = errors.slice(midpoint);

    const baselineMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;

    // Drift = how much worse the recent errors are vs baseline
    // Normalized to [0, 1] with sigmoid-like clamping
    const rawDrift = recentMean - baselineMean;
    return Math.max(0, Math.min(1, rawDrift * 2)); // Scale factor
}

/**
 * Outcome Alignment Delta: Distance between predicted and actual diagnosis.
 *
 * Uses Jaccard similarity on the keys/types present in both payloads.
 * Delta 0 = perfect alignment. Delta 1 = completely wrong.
 */
export function computeOutcomeAlignmentDelta(
    predictedOutput?: Record<string, unknown>,
    actualOutcome?: Record<string, unknown>,
): number | null {
    if (!predictedOutput || !actualOutcome) return null;

    const predictedKeys = new Set(Object.keys(predictedOutput));
    const actualKeys = new Set(Object.keys(actualOutcome));

    if (predictedKeys.size === 0 && actualKeys.size === 0) return 0;

    // Jaccard distance: 1 - (intersection / union)
    const intersection = new Set([...predictedKeys].filter(k => actualKeys.has(k)));
    const union = new Set([...predictedKeys, ...actualKeys]);

    const jaccardSimilarity = intersection.size / union.size;

    // Also compare matched key values for deeper alignment
    let valueMatchCount = 0;
    for (const key of intersection) {
        const pVal = JSON.stringify(predictedOutput[key]);
        const aVal = JSON.stringify(actualOutcome[key]);
        if (pVal === aVal) valueMatchCount++;
    }

    const valueSimilarity = intersection.size > 0
        ? valueMatchCount / intersection.size
        : 0;

    // Weighted combination: 60% key overlap + 40% value match
    const alignment = (jaccardSimilarity * 0.6) + (valueSimilarity * 0.4);

    return Math.max(0, Math.min(1, 1 - alignment)); // Invert: 0 = perfect
}

/**
 * Simulation Degradation: How well the model holds under adversarial stress.
 *
 * Aggregates safety scores and failure rates from simulation runs.
 * Score 0 = rock solid. Score 1 = falling apart.
 */
export function computeSimulationDegradation(
    simulationResults?: SimulationSignal[],
): number | null {
    if (!simulationResults || simulationResults.length === 0) return null;

    const failureRate = simulationResults.filter(s => s.failure_mode != null).length
        / simulationResults.length;

    const meanSafetyScore = simulationResults.reduce((sum, s) => sum + s.safety_score, 0)
        / simulationResults.length;

    // Degradation = weighted combination of failure rate and inverse safety
    return Math.max(0, Math.min(1, (failureRate * 0.6) + ((1 - meanSafetyScore) * 0.4)));
}

/**
 * Confidence Stratification: Decomposes raw confidence into
 * epistemic (knowledge gap) and aleatoric (inherent noise) uncertainty.
 *
 * Frontier-level architecture: not just "how confident" but "why uncertain."
 */
export function stratifyConfidence(
    rawConfidence: number,
    calibrationError: number | null,
    driftScore: number | null,
): {
    calibrated_confidence: number;
    epistemic_uncertainty: number;
    aleatoric_uncertainty: number;
} {
    const calError = calibrationError ?? 0;
    const drift = driftScore ?? 0;

    // Calibrated confidence: adjust raw by known calibration error
    const calibrated = Math.max(0, Math.min(1, rawConfidence - calError * 0.5));

    // Epistemic uncertainty: uncertainty from model drift + calibration issues
    // High drift + high calibration error = model doesn't know what it doesn't know
    const epistemic = Math.max(0, Math.min(1, (drift * 0.6) + (calError * 0.4)));

    // Aleatoric uncertainty: inherent noise (approximated from confidence spread)
    // Low raw confidence with low calibration error = genuinely hard case
    const aleatoric = Math.max(0, Math.min(1, (1 - rawConfidence) * (1 - calError)));

    return {
        calibrated_confidence: calibrated,
        epistemic_uncertainty: epistemic,
        aleatoric_uncertainty: aleatoric,
    };
}

// ─── Core: Create Evaluation Event ──────────────────────────────────────────

/**
 * Creates a structured evaluation event in the database.
 *
 * This is the PRIMARY moat function. Call it after every:
 *   - Inference run (trigger_type: 'inference')
 *   - Outcome attachment (trigger_type: 'outcome')
 *   - Simulation run (trigger_type: 'simulation')
 */
export async function createEvaluationEvent(
    supabase: SupabaseClient,
    input: EvaluationInput,
): Promise<EvaluationResult> {
    // Compute metrics based on trigger type
    const calibrationError = computeCalibrationError(
        input.predicted_confidence,
        input.actual_correctness,
    );

    const driftScore = computeDriftScore(input.recent_evaluations);

    const outcomeAlignmentDelta = computeOutcomeAlignmentDelta(
        input.predicted_output,
        input.actual_outcome,
    );

    const simulationDegradation = computeSimulationDegradation(
        input.simulation_results,
    );

    const confidence = input.predicted_confidence ?? 0.5;
    const stratified = stratifyConfidence(confidence, calibrationError, driftScore);

    // Persist evaluation event
    const { data, error } = await supabase
        .from('model_evaluation_events')
        .insert({
            tenant_id: input.tenant_id,
            trigger_type: input.trigger_type,
            inference_event_id: input.inference_event_id ?? null,
            outcome_event_id: input.outcome_event_id ?? null,
            calibration_error: calibrationError,
            drift_score: driftScore,
            outcome_alignment_delta: outcomeAlignmentDelta,
            simulation_degradation: simulationDegradation,
            calibrated_confidence: stratified.calibrated_confidence,
            epistemic_uncertainty: stratified.epistemic_uncertainty,
            aleatoric_uncertainty: stratified.aleatoric_uncertainty,
            model_name: input.model_name,
            model_version: input.model_version,
            evaluation_payload: {
                raw_confidence: confidence,
                trigger_type: input.trigger_type,
                computed_at: new Date().toISOString(),
            },
        })
        .select('id')
        .single();

    if (error) {
        throw new Error(`Failed to create evaluation event: ${error.message}`);
    }

    return {
        id: data.id,
        calibration_error: calibrationError,
        drift_score: driftScore,
        outcome_alignment_delta: outcomeAlignmentDelta,
        simulation_degradation: simulationDegradation,
        calibrated_confidence: stratified.calibrated_confidence,
        epistemic_uncertainty: stratified.epistemic_uncertainty,
        aleatoric_uncertainty: stratified.aleatoric_uncertainty,
    };
}

/**
 * Fetches recent evaluations for drift computation.
 * Returns the last N evaluations for a given model.
 */
export async function getRecentEvaluations(
    supabase: SupabaseClient,
    tenantId: string,
    modelName: string,
    limit: number = 20,
): Promise<PriorEvaluation[]> {
    const { data, error } = await supabase
        .from('model_evaluation_events')
        .select('calibration_error, drift_score, created_at')
        .eq('tenant_id', tenantId)
        .eq('model_name', modelName)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[getRecentEvaluations] Error:', error.message);
        return [];
    }

    return (data ?? []) as PriorEvaluation[];
}
