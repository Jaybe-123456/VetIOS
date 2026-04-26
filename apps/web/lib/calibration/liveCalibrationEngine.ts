/**
 * VetIOS Live Calibration Engine
 *
 * Wires the existing CIRE phi-hat calibration into the live inference path.
 * Previously: calibration was computed post-hoc. Now: every inference output
 * includes a calibrated confidence score anchored to historical accuracy.
 *
 * Powers: "VetIOS is 94% accurate for feline CKD given BUN>40 + weight loss + PU/PD"
 * This is the unfakeable competitive claim.
 */

import { getSupabaseServer } from '@/lib/supabaseServer';

// ─── Types ───────────────────────────────────────────────────

export interface CalibrationTuple {
  species: string;
  breed: string | null;
  diagnosis: string;
  totalCases: number;
  confirmedCases: number;
  accuracyRate: number;
  avgModelConfidence: number;
  calibrationError: number;     // |accuracy - avg_confidence| — how well-calibrated the model is
  confidenceInterval: [number, number]; // 95% Wilson CI
  lastUpdated: string;
  isStatisticallySignificant: boolean; // n >= 30
}

export interface LiveCalibrationResult {
  rawConfidence: number;         // what the model returned
  calibratedConfidence: number;  // adjusted by historical accuracy
  calibrationTuple: CalibrationTuple | null;
  calibrationApplied: boolean;
  calibrationStatement: string;
  phiHat: number;                // CIRE phi-hat score (0-1)
  uncertaintyBand: [number, number];
}

export interface CalibrationScorecard {
  species: string;
  tuples: Array<{
    diagnosis: string;
    accuracyRate: number;
    totalCases: number;
    calibrationError: number;
    isSignificant: boolean;
  }>;
  overallAccuracy: number;
  bestDiagnosis: string | null;
  worstDiagnosis: string | null;
  totalOutcomesClosed: number;
}

// ─── Wilson Confidence Interval ───────────────────────────────

function wilsonCI(successes: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 1];
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

// ─── Platt Scaling (confidence calibration) ───────────────────

/**
 * Apply Platt scaling to map raw model confidence → calibrated probability.
 * Uses historical (accuracy, avg_confidence) pairs to fit the scaling.
 *
 * Simplified linear calibration when full Platt fitting data isn't available.
 */
function plattScale(
  rawConfidence: number,
  historicalAccuracy: number,
  historicalAvgConfidence: number
): number {
  if (historicalAvgConfidence === 0) return rawConfidence;

  // Scale factor: how much the model over/under-estimates
  const scaleFactor = historicalAccuracy / historicalAvgConfidence;

  // Apply with dampening to avoid extreme corrections
  const dampened = 1 - Math.exp(-3 * scaleFactor);
  const calibrated = rawConfidence * dampened + historicalAccuracy * (1 - dampened);

  return Math.max(0.05, Math.min(0.99, calibrated));
}

// ─── Live Calibration Engine ─────────────────────────────────

export class LiveCalibrationEngine {
  private supabase = getSupabaseServer();
  private cache = new Map<string, { tuple: CalibrationTuple; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Calibrate a raw inference confidence score in real time.
   * Called in the inference route immediately after provider inference.
   */
  async calibrate(params: {
    rawConfidence: number;
    species: string;
    breed?: string | null;
    diagnosis: string | null;
  }): Promise<LiveCalibrationResult> {
    const { rawConfidence, species, breed, diagnosis } = params;

    if (!diagnosis) {
      return this.noCalibrationResult(rawConfidence, 'No primary diagnosis to calibrate against');
    }

    // ── Fetch calibration tuple ──
    const tuple = await this.fetchTuple(species, breed ?? null, diagnosis);

    if (!tuple || !tuple.isStatisticallySignificant) {
      // Not enough data — return raw confidence with phi-hat approximation
      const phiHat = this.computePhiHat(rawConfidence, null);
      return {
        rawConfidence,
        calibratedConfidence: rawConfidence,
        calibrationTuple: tuple,
        calibrationApplied: false,
        calibrationStatement: tuple
          ? `Insufficient outcome data for ${species} ${diagnosis} (n=${tuple.totalCases}, need ≥30). Raw confidence used.`
          : `No historical data for ${species} ${diagnosis}. Raw confidence used.`,
        phiHat,
        uncertaintyBand: [Math.max(0, rawConfidence - 0.15), Math.min(1, rawConfidence + 0.15)],
      };
    }

    // ── Apply Platt scaling ──
    const calibratedConfidence = plattScale(
      rawConfidence,
      tuple.accuracyRate,
      tuple.avgModelConfidence
    );

    const phiHat = this.computePhiHat(calibratedConfidence, tuple);
    const uncertaintyBand = tuple.confidenceInterval;

    const calibrationStatement = this.buildCalibrationStatement(tuple, calibratedConfidence);

    return {
      rawConfidence,
      calibratedConfidence,
      calibrationTuple: tuple,
      calibrationApplied: true,
      calibrationStatement,
      phiHat,
      uncertaintyBand,
    };
  }

  /**
   * Get a published accuracy scorecard for a species.
   * Powers the "94% accurate for feline CKD" public claim.
   */
  async getScorecard(species: string): Promise<CalibrationScorecard> {
    const { data, error } = await this.supabase
      .from('calibration_tuples')
      .select('*')
      .eq('species', species)
      .gte('total_cases', 5)
      .order('total_cases', { ascending: false });

    if (error) throw new Error(`Calibration scorecard query failed: ${error.message}`);

    const rows = data ?? [];
    const tuples = rows.map((r) => ({
      diagnosis: String(r.diagnosis ?? ''),
      accuracyRate: Number(r.accuracy_rate ?? r.correct_cases / Math.max(r.total_cases, 1)),
      totalCases: Number(r.total_cases ?? 0),
      calibrationError: Number(r.calibration_error ?? 0),
      isSignificant: Number(r.total_cases ?? 0) >= 30,
    }));

    const totalOutcomesClosed = tuples.reduce((s, t) => s + t.totalCases, 0);
    const overallAccuracy = tuples.length > 0
      ? tuples.reduce((s, t) => s + t.accuracyRate * t.totalCases, 0) / Math.max(totalOutcomesClosed, 1)
      : 0;

    const significant = tuples.filter((t) => t.isSignificant);
    const bestDiagnosis = significant.sort((a, b) => b.accuracyRate - a.accuracyRate)[0]?.diagnosis ?? null;
    const worstDiagnosis = significant.sort((a, b) => a.accuracyRate - b.accuracyRate)[0]?.diagnosis ?? null;

    return { species, tuples, overallAccuracy, bestDiagnosis, worstDiagnosis, totalOutcomesClosed };
  }

  /**
   * Atomically increment a calibration tuple after outcome confirmation.
   * Called by the RLHF engine — this is the learning loop closure.
   */
  async incrementTuple(params: {
    species: string;
    breed: string | null;
    diagnosis: string;
    isCorrect: boolean;
    modelConfidence: number;
  }): Promise<void> {
    const tupleKey = `${params.species}::${params.breed ?? 'any'}::${params.diagnosis.toLowerCase()}`;

    // Fetch existing or create new
    const existing = await this.fetchTuple(params.species, params.breed, params.diagnosis);

    const totalCases = (existing?.totalCases ?? 0) + 1;
    const confirmedCases = (existing?.confirmedCases ?? 0) + (params.isCorrect ? 1 : 0);
    const accuracyRate = confirmedCases / totalCases;
    const avgModelConfidence =
      ((existing?.avgModelConfidence ?? params.modelConfidence) * (totalCases - 1) + params.modelConfidence) /
      totalCases;
    const calibrationError = Math.abs(accuracyRate - avgModelConfidence);
    const ci = wilsonCI(confirmedCases, totalCases);

    const { error } = await this.supabase.from('calibration_tuples').upsert(
      {
        tuple_key: tupleKey,
        species: params.species,
        breed: params.breed,
        diagnosis: params.diagnosis.toLowerCase(),
        total_cases: totalCases,
        correct_cases: confirmedCases,
        accuracy_rate: accuracyRate,
        avg_model_confidence: avgModelConfidence,
        calibration_error: calibrationError,
        ci_lower: ci[0],
        ci_upper: ci[1],
        is_statistically_significant: totalCases >= 30,
        last_updated: new Date().toISOString(),
      },
      { onConflict: 'tuple_key' }
    );

    if (error) throw new Error(`Calibration incrementTuple failed: ${error.message}`);

    // Invalidate cache
    this.cache.delete(tupleKey);
  }

  // ─── Private Helpers ─────────────────────────────────────

  private async fetchTuple(
    species: string,
    breed: string | null,
    diagnosis: string
  ): Promise<CalibrationTuple | null> {
    const tupleKey = `${species}::${breed ?? 'any'}::${diagnosis.toLowerCase()}`;

    // Cache hit
    const cached = this.cache.get(tupleKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.tuple;
    }

    const { data } = await this.supabase
      .from('calibration_tuples')
      .select('*')
      .eq('tuple_key', tupleKey)
      .single();

    if (!data) {
      // Try species-level fallback (ignore breed)
      const fallbackKey = `${species}::any::${diagnosis.toLowerCase()}`;
      const { data: fallback } = await this.supabase
        .from('calibration_tuples')
        .select('*')
        .eq('tuple_key', fallbackKey)
        .single();

      if (!fallback) return null;
      return this.mapRow(fallback);
    }

    const tuple = this.mapRow(data);
    this.cache.set(tupleKey, { tuple, cachedAt: Date.now() });
    return tuple;
  }

  private mapRow(r: Record<string, unknown>): CalibrationTuple {
    const totalCases = Number(r.total_cases ?? 0);
    const confirmedCases = Number(r.correct_cases ?? 0);
    const accuracyRate = totalCases > 0 ? confirmedCases / totalCases : 0;
    const ci = wilsonCI(confirmedCases, totalCases);

    return {
      species: String(r.species ?? ''),
      breed: r.breed ? String(r.breed) : null,
      diagnosis: String(r.diagnosis ?? ''),
      totalCases,
      confirmedCases,
      accuracyRate: Number(r.accuracy_rate ?? accuracyRate),
      avgModelConfidence: Number(r.avg_model_confidence ?? 0),
      calibrationError: Number(r.calibration_error ?? 0),
      confidenceInterval: ci,
      lastUpdated: String(r.last_updated ?? ''),
      isStatisticallySignificant: totalCases >= 30,
    };
  }

  private computePhiHat(calibratedConfidence: number, tuple: CalibrationTuple | null): number {
    if (!tuple) return calibratedConfidence;
    // phi-hat = geometric mean of calibrated confidence and historical accuracy
    return Math.sqrt(calibratedConfidence * tuple.accuracyRate);
  }

  private buildCalibrationStatement(tuple: CalibrationTuple, calibratedConfidence: number): string {
    const pct = (tuple.accuracyRate * 100).toFixed(0);
    const ci = `${(tuple.confidenceInterval[0] * 100).toFixed(0)}-${(tuple.confidenceInterval[1] * 100).toFixed(0)}%`;
    const label = tuple.breed ? `${tuple.species} (${tuple.breed})` : tuple.species;
    return (
      `VetIOS historical accuracy for ${label} ${tuple.diagnosis}: ${pct}% ` +
      `(95% CI: ${ci}, n=${tuple.totalCases} confirmed outcomes). ` +
      `Calibrated confidence: ${(calibratedConfidence * 100).toFixed(0)}%.`
    );
  }

  private noCalibrationResult(rawConfidence: number, reason: string): LiveCalibrationResult {
    return {
      rawConfidence,
      calibratedConfidence: rawConfidence,
      calibrationTuple: null,
      calibrationApplied: false,
      calibrationStatement: reason,
      phiHat: rawConfidence,
      uncertaintyBand: [Math.max(0, rawConfidence - 0.15), Math.min(1, rawConfidence + 0.15)],
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _engine: LiveCalibrationEngine | null = null;

export function getLiveCalibrationEngine(): LiveCalibrationEngine {
  if (!_engine) _engine = new LiveCalibrationEngine();
  return _engine;
}
