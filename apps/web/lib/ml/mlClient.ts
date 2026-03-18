/**
 * ML Inference Client — connects VetIOS Next.js to the Python ML server.
 *
 * Features:
 *   - Configurable timeout (default 5s)
 *   - Circuit-breaker pattern (opens after N consecutive failures)
 *   - Graceful fallback when ML server is unavailable
 */

// ── Configuration ────────────────────────────────────────────────────────────

const ML_SERVER_URL = process.env.ML_SERVER_URL || 'http://localhost:8000';
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS) || 5000;
const CIRCUIT_BREAKER_THRESHOLD = 3; // Open circuit after 3 consecutive failures
const CIRCUIT_BREAKER_RESET_MS = 30_000; // Try again after 30s

// ── Types ────────────────────────────────────────────────────────────────────

export interface MLPredictRequest {
    decision_count: number;
    override_count: number;
    species: string;
}

export interface MLPredictResponse {
    risk_score: number;
    confidence: number;
    abstain: boolean;
    model_version: string;
}

export interface MLHealthResponse {
    status: string;
    model_loaded: boolean;
}

export interface MLModelInfo {
    input_dim: number;
    feature_cols: string[];
    final_loss: number;
    final_accuracy: number;
    epochs: number;
}

interface MLFallbackResponse {
    risk_score: number;
    confidence: number;
    abstain: boolean;
    model_version: string;
    _fallback: true;
    _reason: string;
}

// ── Circuit Breaker State ────────────────────────────────────────────────────

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function isCircuitOpen(): boolean {
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        if (Date.now() < circuitOpenUntil) {
            return true; // Circuit is open — skip ML calls
        }
        // Reset: try again (half-open state)
        consecutiveFailures = 0;
    }
    return false;
}

function recordSuccess(): void {
    consecutiveFailures = 0;
}

function recordFailure(): void {
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
        console.warn(
            `[mlClient] Circuit breaker OPEN — ML server failed ${consecutiveFailures} times. ` +
            `Skipping calls for ${CIRCUIT_BREAKER_RESET_MS / 1000}s.`
        );
    }
}

// ── Fallback Response ────────────────────────────────────────────────────────

function fallbackPrediction(reason: string): MLFallbackResponse {
    return {
        risk_score: 0.5, // Neutral — no signal
        confidence: 0.0,
        abstain: true,   // Always abstain on fallback
        model_version: 'fallback',
        _fallback: true,
        _reason: reason,
    };
}

// ── Fetch with Timeout ───────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timer);
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Call the ML inference server to predict clinical risk.
 * Returns a fallback response if the server is unavailable.
 */
export async function mlPredict(input: MLPredictRequest): Promise<MLPredictResponse | MLFallbackResponse> {
    if (isCircuitOpen()) {
        return fallbackPrediction('Circuit breaker open — ML server recently unavailable');
    }

    try {
        const response = await fetchWithTimeout(
            `${ML_SERVER_URL}/predict`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
            ML_TIMEOUT_MS
        );

        if (!response.ok) {
            recordFailure();
            return fallbackPrediction(`ML server returned ${response.status}`);
        }

        const data: MLPredictResponse = await response.json();
        recordSuccess();
        return data;
    } catch (error) {
        recordFailure();
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[mlClient] ML predict failed: ${message}`);
        return fallbackPrediction(`ML server error: ${message}`);
    }
}

/**
 * Check ML server health status.
 */
export async function mlHealth(): Promise<MLHealthResponse | null> {
    try {
        const response = await fetchWithTimeout(
            `${ML_SERVER_URL}/health`,
            { method: 'GET' },
            3000
        );
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Get ML model metadata.
 */
export async function mlModelInfo(): Promise<MLModelInfo | null> {
    try {
        const response = await fetchWithTimeout(
            `${ML_SERVER_URL}/model`,
            { method: 'GET' },
            3000
        );
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}


// ── Fix 1 + 3 + 5: Extended types ────────────────────────────────────────────

export type EmergencyLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export type ConditionClass =
  | 'mechanical_emergency'
  | 'infectious'
  | 'inflammatory_autoimmune'
  | 'metabolic_toxic'
  | 'neoplastic'
  | 'cardiovascular_shock';

export interface MLPredictResponseV2 extends MLPredictResponse {
  emergency_level: EmergencyLevel;   // Fix 3
  override_applied: boolean;         // Fix 2
}

export interface MLDiagnosisRequest {
  decision_count: number;
  override_count: number;
  species: string;
  symptom_vector_similarity?: number;
  breed_predisposition_score?: number;
}

export interface MLDiagnosisResponse {                    // Fix 1 + 5
  primary_class: ConditionClass;
  primary_label: string;
  primary_probability: number;
  secondary_class?: ConditionClass;
  secondary_probability?: number;
  requires_emergency_triage: boolean;
  model_version: string;
}

export interface MLFullPredictResponse extends MLPredictResponseV2, MLDiagnosisResponse {}

/**
 * Call /predict/diagnosis — Fix 5: diagnosis model only.
 * Returns condition class (Fix 1), not "Primary Pathogen".
 */
export async function mlPredictDiagnosis(
  input: MLDiagnosisRequest,
): Promise<MLDiagnosisResponse | MLFallbackResponse> {
  if (isCircuitOpen()) {
    return fallbackPrediction('Circuit breaker open');
  }
  try {
    const response = await fetchWithTimeout(
      `${ML_SERVER_URL}/predict/diagnosis`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
      ML_TIMEOUT_MS,
    );
    if (!response.ok) { recordFailure(); return fallbackPrediction(`ML server returned ${response.status}`); }
    const data: MLDiagnosisResponse = await response.json();
    recordSuccess();
    return data;
  } catch (error) {
    recordFailure();
    return fallbackPrediction(`ML diagnosis error: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

/**
 * Call /predict/full — Fix 5: both models in one call.
 */
export async function mlPredictFull(
  input: MLPredictRequest,
): Promise<MLFullPredictResponse | MLFallbackResponse> {
  if (isCircuitOpen()) {
    return fallbackPrediction('Circuit breaker open');
  }
  try {
    const response = await fetchWithTimeout(
      `${ML_SERVER_URL}/predict/full`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
      ML_TIMEOUT_MS,
    );
    if (!response.ok) { recordFailure(); return fallbackPrediction(`ML server returned ${response.status}`); }
    const data: MLFullPredictResponse = await response.json();
    recordSuccess();
    return data;
  } catch (error) {
    recordFailure();
    return fallbackPrediction(`ML full predict error: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}
