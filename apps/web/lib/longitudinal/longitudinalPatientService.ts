/**
 * VetIOS Longitudinal Patient Intelligence
 *
 * Accumulates patient data across months and years of clinic visits.
 * Tracks disease progression, flags pattern changes, and surfaces
 * alerts when a patient's trajectory diverges from population norms.
 *
 * This is the memory layer that makes VetIOS irreplaceable:
 * a patient record spanning 5 years cannot be migrated.
 */

import { getSupabaseServer } from '@/lib/supabaseServer';

// ─── Types ───────────────────────────────────────────────────

export interface PatientVisitRecord {
  id: string;
  patient_id: string;
  tenant_id: string;
  visit_date: string;
  species: string;
  breed: string | null;
  age_years: number | null;
  weight_kg: number | null;
  symptoms: string[];
  biomarkers: Record<string, number | string> | null;
  inference_event_id: string | null;
  primary_diagnosis: string | null;
  diagnosis_confidence: number | null;
  treatment_prescribed: string[] | null;
  outcome_confirmed: boolean;
  confirmed_diagnosis: string | null;
  vet_notes: string | null;
  created_at: string;
}

export interface PatientTrajectory {
  patient_id: string;
  totalVisits: number;
  firstVisit: string;
  lastVisit: string;
  visitHistory: PatientVisitRecord[];
  weightTrend: TrendAnalysis | null;
  biomarkerTrends: Record<string, TrendAnalysis>;
  diagnosisHistory: string[];
  activeConditions: string[];
  progressionAlerts: ProgressionAlert[];
  populationDivergenceScore: number; // 0-1, how far this patient deviates from peers
  longitudinalSummary: string;
}

export interface TrendAnalysis {
  values: Array<{ date: string; value: number }>;
  direction: 'improving' | 'stable' | 'worsening' | 'insufficient_data';
  changeRate: number; // per month
  isAlerting: boolean;
  alertReason?: string;
}

export interface ProgressionAlert {
  alertType: 'weight_loss_acceleration' | 'biomarker_deterioration' | 'symptom_escalation' |
             'new_diagnosis' | 'treatment_failure' | 'population_divergence';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  detectedAt: string;
  affectedMetric: string;
  currentValue: number | string | null;
  expectedRange: string | null;
}

// ─── Population Norms (species-specific baselines) ───────────

const POPULATION_NORMS: Record<string, Record<string, { min: number; max: number; unit: string }>> = {
  feline: {
    weight_kg: { min: 2.5, max: 6.5, unit: 'kg' },
    BUN: { min: 14, max: 36, unit: 'mg/dL' },
    creatinine: { min: 0.8, max: 2.4, unit: 'mg/dL' },
    ALT: { min: 12, max: 130, unit: 'U/L' },
    T4: { min: 0.8, max: 4.7, unit: 'µg/dL' },
    glucose: { min: 64, max: 170, unit: 'mg/dL' },
    PCV: { min: 24, max: 45, unit: '%' },
  },
  canine: {
    weight_kg: { min: 2.0, max: 80.0, unit: 'kg' },
    BUN: { min: 6, max: 31, unit: 'mg/dL' },
    creatinine: { min: 0.5, max: 1.8, unit: 'mg/dL' },
    ALT: { min: 10, max: 100, unit: 'U/L' },
    ALP: { min: 20, max: 150, unit: 'U/L' },
    glucose: { min: 65, max: 120, unit: 'mg/dL' },
    PCV: { min: 37, max: 55, unit: '%' },
  },
};

// ─── Longitudinal Service ─────────────────────────────────────

export class LongitudinalPatientService {
  private supabase = getSupabaseServer();
  private readonly TABLE = 'patient_longitudinal_records';

  /**
   * Record a new visit for a patient.
   * Called after every inference + outcome cycle.
   */
  async recordVisit(record: Omit<PatientVisitRecord, 'id' | 'created_at'>): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from(this.TABLE)
      .insert({
        ...record,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw new Error(`Longitudinal recordVisit failed: ${error.message}`);
    return { id: data.id };
  }

  /**
   * Confirm a visit's diagnosis outcome.
   * Closes the learning loop for this patient record.
   */
  async confirmVisitOutcome(
    visitId: string,
    confirmedDiagnosis: string,
    vetNotes?: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from(this.TABLE)
      .update({
        outcome_confirmed: true,
        confirmed_diagnosis: confirmedDiagnosis,
        vet_notes: vetNotes ?? null,
        outcome_confirmed_at: new Date().toISOString(),
      })
      .eq('id', visitId);

    if (error) throw new Error(`Longitudinal confirmOutcome failed: ${error.message}`);
  }

  /**
   * Build the full patient trajectory across all recorded visits.
   * The primary intelligence product of this module.
   */
  async buildTrajectory(patientId: string, tenantId: string): Promise<PatientTrajectory | null> {
    const { data, error } = await this.supabase
      .from(this.TABLE)
      .select('*')
      .eq('patient_id', patientId)
      .eq('tenant_id', tenantId)
      .order('visit_date', { ascending: true });

    if (error) throw new Error(`Longitudinal buildTrajectory failed: ${error.message}`);

    const visits = (data ?? []) as PatientVisitRecord[];
    if (visits.length === 0) return null;

    const species = visits[0].species;
    const norms = POPULATION_NORMS[species] ?? {};

    // ── Weight trend ──
    const weightTrend = this.analyseTrend(
      visits
        .filter((v) => v.weight_kg !== null)
        .map((v) => ({ date: v.visit_date, value: v.weight_kg as number })),
      { min: norms.weight_kg?.min, max: norms.weight_kg?.max },
      'weight_loss_acceleration'
    );

    // ── Biomarker trends ──
    const biomarkerKeys = new Set<string>();
    for (const v of visits) {
      if (v.biomarkers) {
        for (const k of Object.keys(v.biomarkers)) biomarkerKeys.add(k);
      }
    }

    const biomarkerTrends: Record<string, TrendAnalysis> = {};
    for (const key of biomarkerKeys) {
      const points = visits
        .filter((v) => v.biomarkers && v.biomarkers[key] !== undefined)
        .map((v) => ({ date: v.visit_date, value: Number(v.biomarkers![key]) }))
        .filter((p) => !isNaN(p.value));

      if (points.length >= 2) {
        const norm = norms[key];
        biomarkerTrends[key] = this.analyseTrend(points, norm, 'biomarker_deterioration');
      }
    }

    // ── Diagnosis history ──
    const diagnosisHistory = visits
      .map((v) => v.confirmed_diagnosis ?? v.primary_diagnosis)
      .filter((d): d is string => d !== null);

    // Active conditions = unique diagnoses in last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const recentVisits = visits.filter((v) => new Date(v.visit_date) >= sixMonthsAgo);
    const activeConditions = [
      ...new Set(
        recentVisits
          .map((v) => v.confirmed_diagnosis ?? v.primary_diagnosis)
          .filter((d): d is string => d !== null)
      ),
    ];

    // ── Progression alerts ──
    const progressionAlerts: ProgressionAlert[] = [];

    if (weightTrend?.isAlerting) {
      progressionAlerts.push({
        alertType: 'weight_loss_acceleration',
        severity: weightTrend.changeRate < -0.5 ? 'critical' : 'warning',
        message: weightTrend.alertReason ?? 'Accelerating weight loss detected',
        detectedAt: new Date().toISOString(),
        affectedMetric: 'weight_kg',
        currentValue: visits[visits.length - 1].weight_kg,
        expectedRange: norms.weight_kg ? `${norms.weight_kg.min}-${norms.weight_kg.max}kg` : null,
      });
    }

    for (const [key, trend] of Object.entries(biomarkerTrends)) {
      if (trend.isAlerting) {
        const norm = norms[key];
        progressionAlerts.push({
          alertType: 'biomarker_deterioration',
          severity: trend.changeRate > 0.3 ? 'critical' : 'warning',
          message: trend.alertReason ?? `${key} trending abnormally`,
          detectedAt: new Date().toISOString(),
          affectedMetric: key,
          currentValue: trend.values[trend.values.length - 1]?.value ?? null,
          expectedRange: norm ? `${norm.min}-${norm.max} ${norm.unit}` : null,
        });
      }
    }

    // Population divergence score (simplified: proportion of alerting metrics)
    const allTrends = [weightTrend, ...Object.values(biomarkerTrends)].filter(Boolean);
    const alertingCount = allTrends.filter((t) => t!.isAlerting).length;
    const populationDivergenceScore = allTrends.length > 0 ? alertingCount / allTrends.length : 0;

    const longitudinalSummary = this.buildSummary(visits, activeConditions, progressionAlerts, populationDivergenceScore);

    return {
      patient_id: patientId,
      totalVisits: visits.length,
      firstVisit: visits[0].visit_date,
      lastVisit: visits[visits.length - 1].visit_date,
      visitHistory: visits,
      weightTrend,
      biomarkerTrends,
      diagnosisHistory,
      activeConditions,
      progressionAlerts,
      populationDivergenceScore,
      longitudinalSummary,
    };
  }

  // ─── Trend Analysis ─────────────────────────────────────

  private analyseTrend(
    points: Array<{ date: string; value: number }>,
    norm?: { min?: number; max?: number },
    _alertType?: ProgressionAlert['alertType']
  ): TrendAnalysis {
    if (points.length < 2) {
      return {
        values: points,
        direction: 'insufficient_data',
        changeRate: 0,
        isAlerting: false,
      };
    }

    // Linear regression for trend direction
    const n = points.length;
    const xValues = points.map((_, i) => i);
    const yValues = points.map((p) => p.value);
    const xMean = xValues.reduce((s, x) => s + x, 0) / n;
    const yMean = yValues.reduce((s, y) => s + y, 0) / n;
    const slope =
      xValues.reduce((s, x, i) => s + (x - xMean) * (yValues[i] - yMean), 0) /
      xValues.reduce((s, x) => s + (x - xMean) ** 2, 0);

    // Monthly change rate (assuming each point = ~1 month)
    const changeRate = slope;

    let direction: TrendAnalysis['direction'] = 'stable';
    if (slope < -0.05) direction = 'worsening';
    else if (slope > 0.05) direction = 'improving';

    // Check if latest value is outside normal range
    const latest = points[points.length - 1].value;
    let isAlerting = false;
    let alertReason: string | undefined;

    if (norm?.min !== undefined && latest < norm.min) {
      isAlerting = true;
      alertReason = `Value ${latest.toFixed(2)} below normal minimum ${norm.min}`;
    } else if (norm?.max !== undefined && latest > norm.max) {
      isAlerting = true;
      alertReason = `Value ${latest.toFixed(2)} above normal maximum ${norm.max}`;
    } else if (Math.abs(slope) > 0.2) {
      isAlerting = true;
      alertReason = `Rapid ${slope < 0 ? 'decline' : 'increase'} detected (${changeRate.toFixed(2)}/visit)`;
    }

    return { values: points, direction, changeRate, isAlerting, alertReason };
  }

  // ─── Summary Builder ────────────────────────────────────

  private buildSummary(
    visits: PatientVisitRecord[],
    activeConditions: string[],
    alerts: ProgressionAlert[],
    divergenceScore: number
  ): string {
    const parts: string[] = [];
    parts.push(`${visits.length} visit${visits.length !== 1 ? 's' : ''} recorded`);
    parts.push(`spanning ${visits[0].visit_date} to ${visits[visits.length - 1].visit_date}`);

    if (activeConditions.length > 0) {
      parts.push(`Active conditions: ${activeConditions.join(', ')}`);
    }

    const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
    if (criticalAlerts.length > 0) {
      parts.push(`⚠ ${criticalAlerts.length} critical alert${criticalAlerts.length !== 1 ? 's' : ''}: ${criticalAlerts.map((a) => a.message).join('; ')}`);
    }

    if (divergenceScore > 0.5) {
      parts.push(`Patient trajectory diverges significantly from population norms (score: ${(divergenceScore * 100).toFixed(0)}%)`);
    }

    return parts.join('. ') + '.';
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _service: LongitudinalPatientService | null = null;

export function getLongitudinalService(): LongitudinalPatientService {
  if (!_service) _service = new LongitudinalPatientService();
  return _service;
}
