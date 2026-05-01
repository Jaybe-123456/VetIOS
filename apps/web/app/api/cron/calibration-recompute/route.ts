/**
 * GET /api/cron/calibration-recompute
 *
 * Runs daily at 2am UTC (0 2 * * *).
 * Full recompute of all calibration tuples from confirmed outcome records.
 * This ensures calibration accuracy even if incremental updates drifted.
 *
 *   1. Pull all confirmed outcome pairs from rlhf_feedback_events
 *   2. Group by (species, breed, diagnosis) tuple
 *   3. Recompute accuracy_rate, avg_confidence, calibration_error, CI
 *   4. Identify and log the best and worst calibrated tuples
 *   5. Publish calibration health metric to platform telemetry
 *
 * Protected by CRON_SECRET.
 */

import { NextResponse } from 'next/server';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Wilson CI helper
function wilsonCI(s: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = s / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

export async function GET(req: Request) {
  const requestId = `cron_cal_${Date.now()}`;
  const startTime = Date.now();

  const _cronAuth = authorizeCronRequest(req, 'calibration-recompute');
  if (!_cronAuth.authorized) {
    const res = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }

  const supabase = getSupabaseServer();

  let tuplesRecomputed = 0;
  let tuplesPromoted = 0; // became statistically significant this cycle
  const errors: string[] = [];

  try {
    // ── 1. Pull all confirmed feedback events ──
    const { data: allFeedback, error: fetchErr } = await supabase
      .from('rlhf_feedback_events')
      .select('species, breed, actual_diagnosis, feedback_type, predicted_confidence')
      .not('actual_diagnosis', 'is', null)
      .in('feedback_type', ['diagnosis_confirmed', 'diagnosis_corrected', 'outcome_at_7d', 'outcome_at_30d']);

    if (fetchErr) throw new Error(`Calibration fetch failed: ${fetchErr.message}`);

    // ── 2. Group by tuple ──
    const tupleMap = new Map<string, {
      species: string;
      breed: string | null;
      diagnosis: string;
      total: number;
      correct: number;
      confidenceSum: number;
    }>();

    for (const row of allFeedback ?? []) {
      if (!row.actual_diagnosis || !row.species) continue;
      const tupleKey = `${row.species}::${row.breed ?? 'any'}::${row.actual_diagnosis.toLowerCase()}`;
      const existing = tupleMap.get(tupleKey) ?? {
        species: row.species,
        breed: row.breed ?? null,
        diagnosis: row.actual_diagnosis.toLowerCase(),
        total: 0,
        correct: 0,
        confidenceSum: 0,
      };
      existing.total++;
      if (row.feedback_type === 'diagnosis_confirmed') existing.correct++;
      existing.confidenceSum += row.predicted_confidence ?? 0;
      tupleMap.set(tupleKey, existing);
    }

    // ── 3. Upsert recomputed tuples ──
    const upsertRows = [];
    for (const [key, t] of tupleMap.entries()) {
      const accuracyRate = t.total > 0 ? t.correct / t.total : 0;
      const avgConf = t.total > 0 ? t.confidenceSum / t.total : 0;
      const calErr = Math.abs(accuracyRate - avgConf);
      const ci = wilsonCI(t.correct, t.total);
      const isSignificant = t.total >= 30;

      upsertRows.push({
        tuple_key: key,
        species: t.species,
        breed: t.breed,
        diagnosis: t.diagnosis,
        total_cases: t.total,
        correct_cases: t.correct,
        accuracy_rate: parseFloat(accuracyRate.toFixed(4)),
        avg_model_confidence: parseFloat(avgConf.toFixed(4)),
        calibration_error: parseFloat(calErr.toFixed(4)),
        ci_lower: parseFloat(ci[0].toFixed(4)),
        ci_upper: parseFloat(ci[1].toFixed(4)),
        is_statistically_significant: isSignificant,
        last_updated: new Date().toISOString(),
      });
    }

    // Batch upsert in chunks of 100
    const CHUNK = 100;
    for (let i = 0; i < upsertRows.length; i += CHUNK) {
      const chunk = upsertRows.slice(i, i + CHUNK);
      const { error: upsertErr } = await supabase
        .from('calibration_tuples')
        .upsert(chunk, { onConflict: 'tuple_key' });

      if (upsertErr) {
        errors.push(`Upsert chunk ${i / CHUNK}: ${upsertErr.message}`);
      } else {
        tuplesRecomputed += chunk.length;
        tuplesPromoted += chunk.filter((r) => r.is_statistically_significant).length;
      }
    }

    // ── 4. Identify best/worst calibrated tuples ──
    const significantTuples = upsertRows.filter((r) => r.is_statistically_significant);
    significantTuples.sort((a, b) => a.calibration_error - b.calibration_error);

    const bestCalibrated = significantTuples.slice(0, 3).map((r) => ({
      tuple: `${r.species} ${r.diagnosis}`,
      accuracy: r.accuracy_rate,
      calibration_error: r.calibration_error,
      n: r.total_cases,
    }));

    const worstCalibrated = [...significantTuples]
      .sort((a, b) => b.calibration_error - a.calibration_error)
      .slice(0, 3)
      .map((r) => ({
        tuple: `${r.species} ${r.diagnosis}`,
        accuracy: r.accuracy_rate,
        calibration_error: r.calibration_error,
        n: r.total_cases,
      }));

    // Overall calibration error
    const avgCalibrationError =
      significantTuples.length > 0
        ? significantTuples.reduce((s, r) => s + r.calibration_error, 0) / significantTuples.length
        : null;

    const latencyMs = Date.now() - startTime;

    const res = NextResponse.json({
      cron: {
        job: 'calibration-recompute',
        schedule: '0 2 * * *',
        authorized_by: _cronAuth.method,
        ran_at: new Date().toISOString(),
      },
      summary: {
        total_feedback_events: (allFeedback ?? []).length,
        unique_tuples_recomputed: tuplesRecomputed,
        statistically_significant_tuples: tuplesPromoted,
        avg_calibration_error: avgCalibrationError !== null
          ? parseFloat(avgCalibrationError.toFixed(4))
          : null,
        errors: errors.length,
        latency_ms: latencyMs,
      },
      best_calibrated: bestCalibrated,
      worst_calibrated: worstCalibrated,
      errors: errors.slice(0, 10),
      request_id: requestId,
    });
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      {
        error: { code: 'cron_failed', message: err instanceof Error ? err.message : String(err) },
        cron: { job: 'calibration-recompute' },
        request_id: requestId,
      },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    return res;
  }
}






