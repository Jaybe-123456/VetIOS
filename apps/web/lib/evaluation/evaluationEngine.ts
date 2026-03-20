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
    case_id?: string | null;
    model_name: string;
    model_version: string;
    prediction?: string | null;
    ground_truth?: string | null;
    condition_class_pred?: string | null;
    condition_class_true?: string | null;
    severity_pred?: string | null;
    severity_true?: string | null;
    contradiction_score?: number | null;
    adversarial_case?: boolean;

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
    prediction: string | null;
    ground_truth: string | null;
    created_at: string;
}

export interface EvaluationResult {
    id: string;
    evaluation_event_id: string;
    case_id: string | null;
    prediction: string | null;
    prediction_confidence: number | null;
    ground_truth: string | null;
    prediction_correct: boolean | null;
    condition_class_pred: string | null;
    condition_class_true: string | null;
    severity_pred: string | null;
    severity_true: string | null;
    contradiction_score: number | null;
    adversarial_case: boolean;
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

    const predicted = new Map<string, number>();
    const actual = new Map<string, number>();

    for (const evaluation of recentEvaluations) {
        const prediction = normalizeLabel(evaluation.prediction);
        const groundTruth = normalizeLabel(evaluation.ground_truth);
        if (!prediction || !groundTruth) continue;
        predicted.set(prediction, (predicted.get(prediction) ?? 0) + 1);
        actual.set(groundTruth, (actual.get(groundTruth) ?? 0) + 1);
    }

    const sampleCount = Array.from(actual.values()).reduce((sum, count) => sum + count, 0);
    if (sampleCount < 3) return null;

    const labels = new Set([...predicted.keys(), ...actual.keys()]);
    let squaredDistance = 0;
    for (const label of labels) {
        const predictedProbability = (predicted.get(label) ?? 0) / sampleCount;
        const actualProbability = (actual.get(label) ?? 0) / sampleCount;
        squaredDistance += (predictedProbability - actualProbability) ** 2;
    }

    return Math.max(0, Math.min(1, Math.sqrt(squaredDistance)));
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
    const prediction = normalizeLabel(
        input.prediction
        ?? extractPredictionLabel(input.predicted_output)
        ?? null,
    );
    const groundTruth = normalizeLabel(
        input.ground_truth
        ?? extractOutcomeLabel(input.actual_outcome)
        ?? null,
    );
    const predictionCorrect = prediction && groundTruth
        ? prediction === groundTruth
        : null;

    // Compute metrics based on trigger type
    const calibrationError = computeCalibrationError(
        input.predicted_confidence,
        input.actual_correctness ?? (predictionCorrect == null ? null : (predictionCorrect ? 1 : 0)),
    );

    const driftScore = computeDriftScore([
        ...(input.recent_evaluations ?? []),
        {
            calibration_error: calibrationError,
            drift_score: null,
            prediction,
            ground_truth: groundTruth,
            created_at: new Date().toISOString(),
        },
    ]);

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
            case_id: input.case_id ?? null,
            calibration_error: calibrationError,
            drift_score: driftScore,
            outcome_alignment_delta: outcomeAlignmentDelta,
            simulation_degradation: simulationDegradation,
            prediction,
            prediction_confidence: input.predicted_confidence ?? null,
            ground_truth: groundTruth,
            prediction_correct: predictionCorrect,
            condition_class_pred: normalizeLabel(input.condition_class_pred),
            condition_class_true: normalizeLabel(input.condition_class_true),
            severity_pred: normalizeLabel(input.severity_pred),
            severity_true: normalizeLabel(input.severity_true),
            contradiction_score: input.contradiction_score ?? null,
            adversarial_case: input.adversarial_case === true,
            calibrated_confidence: stratified.calibrated_confidence,
            epistemic_uncertainty: stratified.epistemic_uncertainty,
            aleatoric_uncertainty: stratified.aleatoric_uncertainty,
            model_name: input.model_name,
            model_version: input.model_version,
            evaluation_payload: {
                raw_confidence: confidence,
                trigger_type: input.trigger_type,
                prediction,
                ground_truth: groundTruth,
                prediction_correct: predictionCorrect,
                computed_at: new Date().toISOString(),
            },
        })
        .select('id,evaluation_event_id,case_id,prediction,prediction_confidence,ground_truth,prediction_correct,condition_class_pred,condition_class_true,severity_pred,severity_true,contradiction_score,adversarial_case')
        .single();

    if (error) {
        throw new Error(`Failed to create evaluation event: ${error.message}`);
    }

    return {
        id: data.id,
        evaluation_event_id: data.evaluation_event_id ?? data.id,
        case_id: data.case_id ?? null,
        prediction: data.prediction ?? null,
        prediction_confidence: data.prediction_confidence ?? null,
        ground_truth: data.ground_truth ?? null,
        prediction_correct: data.prediction_correct ?? null,
        condition_class_pred: data.condition_class_pred ?? null,
        condition_class_true: data.condition_class_true ?? null,
        severity_pred: data.severity_pred ?? null,
        severity_true: data.severity_true ?? null,
        contradiction_score: data.contradiction_score ?? null,
        adversarial_case: data.adversarial_case === true,
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
        .select('calibration_error, drift_score, prediction, ground_truth, created_at')
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

function extractPredictionLabel(output?: Record<string, unknown>) {
    if (!output) return null;
    const diagnosis = asRecord(output.diagnosis);
    const topDifferentials = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : [];
    const topDiagnosis = topDifferentials[0];
    if (typeof topDiagnosis === 'object' && topDiagnosis !== null) {
        const candidate = normalizeLabel((topDiagnosis as Record<string, unknown>).name);
        if (candidate) return candidate;
    }
    return normalizeLabel(diagnosis.primary_condition_class);
}

function extractOutcomeLabel(output?: Record<string, unknown>) {
    if (!output) return null;
    return normalizeLabel(
        output.confirmed_diagnosis
        ?? output.final_diagnosis
        ?? output.diagnosis
        ?? output.primary_condition_class
        ?? null,
    );
}

function normalizeLabel(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
