/**
 * VetIOS Tier 3 — Wearable Signal Processor
 *
 * Processes raw vital readings from wearable devices:
 * 1. Builds per-patient 30-day baseline (mean ± std per vital)
 * 2. Computes Z-score for each incoming reading vs baseline
 * 3. Maps vital deviations to VKG symptoms for pre-symptomatic inference
 * 4. Generates vital_anomaly_alerts when Z-score exceeds threshold
 *
 * Z-score thresholds (sensitivity-adjusted):
 *   mild:     |Z| > 1.5
 *   moderate: |Z| > 2.0
 *   severe:   |Z| > 3.0
 *
 * Connects to:
 *   passive_vital_readings          — source of baseline data + reading storage
 *   wearable_device_registrations   — baseline stats storage
 *   vital_anomaly_alerts            — alert output
 *   apps/web/lib/vkg                — VKG symptom mapping for pre-symptomatic inference
 */

import { getSupabaseServer } from '@/lib/supabaseServer';
import { getVKG } from '@/lib/vkg/veterinaryKnowledgeGraph';

// ─── Types ───────────────────────────────────────────────────

export type AnomalySeverity = 'mild' | 'moderate' | 'severe';
export type AlertSensitivity = 'low' | 'moderate' | 'high';

export interface NormalisedReading {
  tenantId: string;
  patientId: string;
  deviceId: string;
  deviceType: string;
  species: string;
  region: string | null;
  heartRate: number | null;
  temperature: number | null;
  respiratoryRate: number | null;
  activityScore: number | null;
  sleepScore: number | null;
  recordedAt: string;
  rawPayload: Record<string, unknown>;
}

export interface AnomalyAssessment {
  isAnomalous: boolean;
  severity: AnomalySeverity | null;
  triggeredVitals: string[];
  zScores: Record<string, number>;
  maxZScore: number;
  inferredSymptoms: string[];
  vkgDifferentials: Array<{ diagnosis: string; score: number }>;
  alertTitle: string | null;
  alertDescription: string | null;
  recommendedActions: string[];
}

// ─── Vital → VKG symptom mapping ─────────────────────────────
// Maps wearable anomaly patterns to VKG symptom node ids.
// These become inputs to getDiseasesForSymptoms() for pre-symptomatic inference.

const VITAL_ANOMALY_SYMPTOM_MAP: Record<string, Record<string, string[]>> = {
  heart_rate: {
    high: ['tachycardia', 'exercise_intolerance', 'respiratory_distress'],
    low:  ['bradycardia', 'weakness', 'collapse'],
  },
  temperature: {
    high: ['fever', 'lethargy', 'anorexia'],
    low:  ['hypothermia', 'weakness', 'collapse'],
  },
  respiratory_rate: {
    high: ['respiratory_distress', 'tachypnoea', 'exercise_intolerance'],
    low:  ['respiratory_depression', 'lethargy'],
  },
  activity_score: {
    high: ['restlessness', 'pain', 'anxiety'],
    low:  ['lethargy', 'weakness', 'anorexia'],
  },
};

// Z-score thresholds per sensitivity level
const Z_THRESHOLDS: Record<AlertSensitivity, { mild: number; moderate: number; severe: number }> = {
  low:      { mild: 2.5, moderate: 3.0, severe: 4.0 },
  moderate: { mild: 1.5, moderate: 2.0, severe: 3.0 },
  high:     { mild: 1.2, moderate: 1.8, severe: 2.5 },
};

// ─── Wearable Signal Processor ────────────────────────────────

export class WearableSignalProcessor {
  private supabase = getSupabaseServer();

  /**
   * Process an incoming normalised reading.
   * 1. Fetch baseline for this patient+device
   * 2. Compute Z-scores
   * 3. If anomalous: map to symptoms, run VKG inference, generate alert
   * Returns AnomalyAssessment — always, even if not anomalous.
   */
  async processReading(
    reading: NormalisedReading,
    sensitivity: AlertSensitivity = 'moderate'
  ): Promise<AnomalyAssessment> {
    // Step 1: Fetch device registration + baseline
    const { data: device } = await this.supabase
      .from('wearable_device_registrations')
      .select('*')
      .eq('tenant_id', reading.tenantId)
      .eq('patient_id', reading.patientId)
      .eq('device_id', reading.deviceId)
      .maybeSingle();

    // Step 2: Compute Z-scores
    const zScores: Record<string, number> = {};
    const thresholds = Z_THRESHOLDS[sensitivity];

    if (device?.baseline_computed) {
      if (reading.heartRate !== null && device.baseline_heart_rate_mean && device.baseline_heart_rate_std) {
        zScores.heart_rate = this.zScore(reading.heartRate, device.baseline_heart_rate_mean, device.baseline_heart_rate_std);
      }
      if (reading.temperature !== null && device.baseline_temp_mean && device.baseline_temp_std) {
        zScores.temperature = this.zScore(reading.temperature, device.baseline_temp_mean, device.baseline_temp_std);
      }
      if (reading.respiratoryRate !== null && device.baseline_respiratory_mean && device.baseline_respiratory_std) {
        zScores.respiratory_rate = this.zScore(reading.respiratoryRate, device.baseline_respiratory_mean, device.baseline_respiratory_std);
      }
      if (reading.activityScore !== null && device.baseline_activity_mean && device.baseline_activity_std) {
        zScores.activity_score = this.zScore(reading.activityScore, device.baseline_activity_mean, device.baseline_activity_std);
      }
    }

    const maxZScore = Math.max(...Object.values(zScores).map(Math.abs), 0);
    const severity = maxZScore >= thresholds.severe ? 'severe'
      : maxZScore >= thresholds.moderate ? 'moderate'
      : maxZScore >= thresholds.mild ? 'mild'
      : null;

    const triggeredVitals = Object.entries(zScores)
      .filter(([, z]) => Math.abs(z) >= thresholds.mild)
      .map(([vital]) => vital);

    // Step 3: Write reading to DB
    const { data: savedReading } = await this.supabase
      .from('passive_vital_readings')
      .insert({
        tenant_id: reading.tenantId,
        patient_id: reading.patientId,
        device_id: reading.deviceId,
        device_type: reading.deviceType,
        species: reading.species,
        region: reading.region,
        heart_rate: reading.heartRate,
        temperature: reading.temperature,
        respiratory_rate: reading.respiratoryRate,
        activity_score: reading.activityScore,
        sleep_score: reading.sleepScore,
        heart_rate_zscore: zScores.heart_rate ?? null,
        temp_zscore: zScores.temperature ?? null,
        respiratory_zscore: zScores.respiratory_rate ?? null,
        activity_zscore: zScores.activity_score ?? null,
        is_anomalous: severity !== null,
        anomaly_severity: severity,
        raw_payload: reading.rawPayload,
        recorded_at: reading.recordedAt,
        ingested_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (severity === null) {
      // Update baseline computation if needed (non-blocking)
      void this.maybeUpdateBaseline(reading, device);
      return {
        isAnomalous: false, severity: null, triggeredVitals: [],
        zScores, maxZScore, inferredSymptoms: [], vkgDifferentials: [],
        alertTitle: null, alertDescription: null, recommendedActions: [],
      };
    }

    // Step 4: Map triggered vitals to VKG symptoms
    const inferredSymptoms = this.mapVitalsToSymptoms(zScores, thresholds.mild);

    // Step 5: Run VKG inference for pre-symptomatic differentials
    const vkgDifferentials = inferredSymptoms.length > 0
      ? this.runVKGInference(inferredSymptoms, reading.species)
      : [];

    // Step 6: Build alert
    const { title, description, actions } = this.buildAlert(
      reading, triggeredVitals, zScores, severity, vkgDifferentials
    );

    // Step 7: Persist alert (non-blocking)
    const readingId = (savedReading as Record<string, unknown> | null)?.id as string | null;
    void this.persistAlert({
      tenantId: reading.tenantId,
      patientId: reading.patientId,
      deviceId: reading.deviceId,
      species: reading.species,
      region: reading.region,
      triggeredVitals,
      severity,
      maxZScore,
      inferredSymptoms,
      vkgDifferentials,
      title,
      description,
      recommendedActions: actions,
      readingId,
    });

    // Step 8: Update last_reading_at on device registration (non-blocking)
    void this.supabase.from('wearable_device_registrations')
      .update({ last_reading_at: reading.recordedAt })
      .eq('tenant_id', reading.tenantId)
      .eq('patient_id', reading.patientId)
      .eq('device_id', reading.deviceId);

    return {
      isAnomalous: true,
      severity,
      triggeredVitals,
      zScores,
      maxZScore,
      inferredSymptoms,
      vkgDifferentials,
      alertTitle: title,
      alertDescription: description,
      recommendedActions: actions,
    };
  }

  /**
   * Compute or recompute baseline stats for a patient+device
   * from the last 30 days of readings.
   */
  async computeBaseline(
    tenantId: string,
    patientId: string,
    deviceId: string
  ): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: readings } = await this.supabase
      .from('passive_vital_readings')
      .select('heart_rate, temperature, respiratory_rate, activity_score')
      .eq('tenant_id', tenantId)
      .eq('patient_id', patientId)
      .eq('device_id', deviceId)
      .gte('recorded_at', thirtyDaysAgo)
      .limit(2000);

    if (!readings || readings.length < 10) return; // need minimum data

    const stats = this.computeStats(readings as Array<Record<string, unknown>>);

    await this.supabase.from('wearable_device_registrations').update({
      baseline_computed: true,
      baseline_computed_at: new Date().toISOString(),
      baseline_heart_rate_mean: stats.heart_rate?.mean ?? null,
      baseline_heart_rate_std: stats.heart_rate?.std ?? null,
      baseline_temp_mean: stats.temperature?.mean ?? null,
      baseline_temp_std: stats.temperature?.std ?? null,
      baseline_respiratory_mean: stats.respiratory_rate?.mean ?? null,
      baseline_respiratory_std: stats.respiratory_rate?.std ?? null,
      baseline_activity_mean: stats.activity_score?.mean ?? null,
      baseline_activity_std: stats.activity_score?.std ?? null,
    })
      .eq('tenant_id', tenantId)
      .eq('patient_id', patientId)
      .eq('device_id', deviceId);
  }

  // ─── Private helpers ──────────────────────────────────────

  private zScore(value: number, mean: number, std: number): number {
    if (std === 0) return 0;
    return (value - mean) / std;
  }

  private computeStats(
    readings: Array<Record<string, unknown>>
  ): Record<string, { mean: number; std: number } | null> {
    const vitals = ['heart_rate', 'temperature', 'respiratory_rate', 'activity_score'];
    const result: Record<string, { mean: number; std: number } | null> = {};

    for (const vital of vitals) {
      const values = readings
        .map(r => r[vital])
        .filter((v): v is number => typeof v === 'number' && !isNaN(v));

      if (values.length < 5) { result[vital] = null; continue; }

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const std = Math.sqrt(
        values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
      );
      result[vital] = { mean, std: Math.max(std, 0.001) };
    }

    return result;
  }

  private mapVitalsToSymptoms(
    zScores: Record<string, number>,
    threshold: number
  ): string[] {
    const symptoms = new Set<string>();

    for (const [vital, z] of Object.entries(zScores)) {
      if (Math.abs(z) < threshold) continue;
      const direction = z > 0 ? 'high' : 'low';
      const mapped = VITAL_ANOMALY_SYMPTOM_MAP[vital]?.[direction] ?? [];
      mapped.forEach(s => symptoms.add(s));
    }

    return Array.from(symptoms);
  }

  private runVKGInference(
    symptoms: string[],
    species: string
  ): Array<{ diagnosis: string; score: number }> {
    try {
      const vkg = getVKG();
      const candidates = vkg.getDiseasesForSymptoms(symptoms, species);
      return candidates.slice(0, 5).map(c => ({
        diagnosis: c.disease.label,
        score: Math.round(c.score * 100),
      }));
    } catch {
      return [];
    }
  }

  private buildAlert(
    reading: NormalisedReading,
    triggeredVitals: string[],
    zScores: Record<string, number>,
    severity: AnomalySeverity,
    differentials: Array<{ diagnosis: string; score: number }>
  ): { title: string; description: string; actions: string[] } {
    const vitalLabels: Record<string, string> = {
      heart_rate: 'Heart Rate',
      temperature: 'Temperature',
      respiratory_rate: 'Respiratory Rate',
      activity_score: 'Activity Level',
    };

    const vitalDesc = triggeredVitals
      .map(v => {
        const z = zScores[v];
        const dir = z > 0 ? 'elevated' : 'depressed';
        return `${vitalLabels[v] ?? v} ${dir} (Z=${z.toFixed(1)})`;
      })
      .join(', ');

    const title = `${severity.toUpperCase()} vital anomaly detected — ${reading.species} patient ${reading.patientId}`;
    const description = `Wearable monitoring detected: ${vitalDesc}. ` +
      (differentials.length > 0
        ? `Pre-symptomatic VKG inference suggests: ${differentials.slice(0, 2).map(d => d.diagnosis).join(', ')}.`
        : 'No specific differential identified yet.');

    const actions: string[] = [];
    if (severity === 'severe') {
      actions.push('Contact owner immediately — urgent veterinary assessment recommended');
      actions.push('Schedule same-day appointment');
    } else if (severity === 'moderate') {
      actions.push('Notify owner — schedule appointment within 24 hours');
      actions.push('Monitor vitals closely over next 4 hours');
    } else {
      actions.push('Flag for next routine check — monitor trend');
    }

    if (differentials.length > 0) {
      actions.push(`Consider workup for: ${differentials[0].diagnosis}`);
    }

    return { title, description, actions: actions.slice(0, 4) };
  }

  private async persistAlert(input: {
    tenantId: string; patientId: string; deviceId: string;
    species: string; region: string | null; triggeredVitals: string[];
    severity: AnomalySeverity; maxZScore: number; inferredSymptoms: string[];
    vkgDifferentials: Array<{ diagnosis: string; score: number }>;
    title: string; description: string; recommendedActions: string[];
    readingId: string | null;
  }): Promise<void> {
    try {
      await this.supabase.from('vital_anomaly_alerts').insert({
        tenant_id: input.tenantId,
        patient_id: input.patientId,
        device_id: input.deviceId,
        species: input.species,
        region: input.region,
        triggered_vitals: input.triggeredVitals,
        severity: input.severity,
        max_zscore: input.maxZScore,
        inferred_symptoms: input.inferredSymptoms,
        vkg_differentials: input.vkgDifferentials,
        title: input.title,
        description: input.description,
        recommended_actions: input.recommendedActions,
        reading_id: input.readingId,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[WearableSignalProcessor] persistAlert failed:', err);
    }
  }

  private async maybeUpdateBaseline(
    reading: NormalisedReading,
    device: Record<string, unknown> | null
  ): Promise<void> {
    if (device?.baseline_computed) return;
    // Trigger baseline computation after 10 days of data
    const { count } = await this.supabase
      .from('passive_vital_readings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', reading.tenantId)
      .eq('patient_id', reading.patientId)
      .eq('device_id', reading.deviceId);

    if ((count ?? 0) >= 100) {
      await this.computeBaseline(reading.tenantId, reading.patientId, reading.deviceId);
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────
let _processor: WearableSignalProcessor | null = null;
export function getWearableSignalProcessor(): WearableSignalProcessor {
  if (!_processor) _processor = new WearableSignalProcessor();
  return _processor;
}
