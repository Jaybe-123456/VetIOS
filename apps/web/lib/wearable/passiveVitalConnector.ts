/**
 * VetIOS Tier 3 — Passive Vital Connector
 *
 * SDK-agnostic connector that normalises raw wearable device payloads
 * into NormalisedReading format for the WearableSignalProcessor.
 *
 * Supported device formats:
 *   generic  — standard JSON with labelled fields
 *   whistle  — Whistle GPS + activity tracker format
 *   petpace  — PetPace health monitoring collar format
 *   felcana  — Felcana activity monitor format
 *
 * Connects to:
 *   lib/wearable/wearableSignalProcessor.ts — processing + anomaly detection
 *   wearable_device_registrations           — device lookup + registration
 */

import {
  getWearableSignalProcessor,
  type NormalisedReading,
  type AlertSensitivity,
  type AnomalyAssessment,
} from '@/lib/wearable/wearableSignalProcessor';
import { getSupabaseServer } from '@/lib/supabaseServer';

// ─── Types ───────────────────────────────────────────────────

export type DeviceType = 'generic' | 'whistle' | 'petpace' | 'felcana';

export interface IngestRequest {
  tenantId: string;
  patientId: string;
  deviceId: string;
  deviceType: DeviceType;
  species: string;
  breed?: string | null;
  region?: string | null;
  payload: Record<string, unknown>;
  recordedAt?: string;
}

export interface IngestResult {
  success: boolean;
  readingId: string | null;
  anomalyAssessment: AnomalyAssessment;
  deviceRegistered: boolean;
}

// ─── Device payload normalisers ───────────────────────────────

function normaliseGeneric(payload: Record<string, unknown>): Partial<NormalisedReading> {
  return {
    heartRate: toFloat(payload.heart_rate ?? payload.heartRate ?? payload.hr),
    temperature: toFloat(payload.temperature ?? payload.temp ?? payload.body_temp),
    respiratoryRate: toFloat(payload.respiratory_rate ?? payload.respiratoryRate ?? payload.rr),
    activityScore: toFloat(payload.activity ?? payload.activity_score ?? payload.activityScore),
    sleepScore: toFloat(payload.sleep ?? payload.sleep_score ?? payload.sleepScore),
  };
}

function normaliseWhistle(payload: Record<string, unknown>): Partial<NormalisedReading> {
  // Whistle format: { activity_minutes, rest_minutes, calories, distance_km }
  // Whistle measures activity but not vitals directly
  const activityMinutes = toFloat(payload.activity_minutes);
  const restMinutes = toFloat(payload.rest_minutes);
  const totalMinutes = (activityMinutes ?? 0) + (restMinutes ?? 0);
  const activityScore = totalMinutes > 0 && activityMinutes !== null
    ? Math.min((activityMinutes / totalMinutes) * 100, 100)
    : null;

  return {
    heartRate: toFloat(payload.heart_rate),
    temperature: toFloat(payload.temperature),
    respiratoryRate: null,
    activityScore,
    sleepScore: restMinutes !== null && totalMinutes > 0
      ? Math.min((restMinutes / totalMinutes) * 100, 100)
      : null,
  };
}

function normalisePetPace(payload: Record<string, unknown>): Partial<NormalisedReading> {
  // PetPace format: { pulse, temp, resp, activity, hrv, position }
  return {
    heartRate: toFloat(payload.pulse ?? payload.heart_rate),
    temperature: toFloat(payload.temp ?? payload.temperature),
    respiratoryRate: toFloat(payload.resp ?? payload.respiratory_rate),
    activityScore: toFloat(payload.activity),
    sleepScore: null,
  };
}

function normaliseFelcana(payload: Record<string, unknown>): Partial<NormalisedReading> {
  // Felcana format: { activity_level, rest_level, calories_kcal }
  return {
    heartRate: null,
    temperature: null,
    respiratoryRate: null,
    activityScore: toFloat(payload.activity_level ?? payload.activity),
    sleepScore: toFloat(payload.rest_level),
  };
}

const NORMALISERS: Record<DeviceType, (p: Record<string, unknown>) => Partial<NormalisedReading>> = {
  generic: normaliseGeneric,
  whistle: normaliseWhistle,
  petpace: normalisePetPace,
  felcana: normaliseFelcana,
};

// ─── Passive Vital Connector ──────────────────────────────────

export class PassiveVitalConnector {
  private supabase = getSupabaseServer();
  private processor = getWearableSignalProcessor();

  /**
   * Ingest a raw wearable payload, normalise it, and process for anomalies.
   * Auto-registers the device if not already registered.
   */
  async ingest(request: IngestRequest): Promise<IngestResult> {
    // Step 1: Ensure device is registered
    const deviceRegistered = await this.ensureDeviceRegistered(request);

    // Step 2: Get sensitivity from device registration
    const { data: device } = await this.supabase
      .from('wearable_device_registrations')
      .select('alert_sensitivity')
      .eq('tenant_id', request.tenantId)
      .eq('patient_id', request.patientId)
      .eq('device_id', request.deviceId)
      .maybeSingle();

    const sensitivity = (device?.alert_sensitivity as AlertSensitivity) ?? 'moderate';

    // Step 3: Normalise payload
    const normaliser = NORMALISERS[request.deviceType] ?? NORMALISERS.generic;
    const normalisedVitals = normaliser(request.payload);

    const normalisedReading: NormalisedReading = {
      tenantId: request.tenantId,
      patientId: request.patientId,
      deviceId: request.deviceId,
      deviceType: request.deviceType,
      species: request.species,
      region: request.region ?? null,
      heartRate: normalisedVitals.heartRate ?? null,
      temperature: normalisedVitals.temperature ?? null,
      respiratoryRate: normalisedVitals.respiratoryRate ?? null,
      activityScore: normalisedVitals.activityScore ?? null,
      sleepScore: normalisedVitals.sleepScore ?? null,
      recordedAt: request.recordedAt ?? new Date().toISOString(),
      rawPayload: request.payload,
    };

    // Step 4: Process through anomaly detector
    const anomalyAssessment = await this.processor.processReading(
      normalisedReading,
      sensitivity
    );

    return {
      success: true,
      readingId: null, // reading ID is written inside processReading
      anomalyAssessment,
      deviceRegistered,
    };
  }

  /**
   * Register a device and trigger baseline computation if enough data exists.
   */
  async registerDevice(params: {
    tenantId: string;
    patientId: string;
    deviceId: string;
    deviceType: DeviceType;
    species: string;
    breed?: string | null;
    ageYears?: number | null;
    weightKg?: number | null;
    alertSensitivity?: AlertSensitivity;
  }): Promise<void> {
    await this.supabase.from('wearable_device_registrations').upsert(
      {
        tenant_id: params.tenantId,
        patient_id: params.patientId,
        device_id: params.deviceId,
        device_type: params.deviceType,
        species: params.species,
        breed: params.breed ?? null,
        age_years: params.ageYears ?? null,
        weight_kg: params.weightKg ?? null,
        alert_sensitivity: params.alertSensitivity ?? 'moderate',
        active: true,
        registered_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,patient_id,device_id', ignoreDuplicates: false }
    );
  }

  private async ensureDeviceRegistered(request: IngestRequest): Promise<boolean> {
    const { data: existing } = await this.supabase
      .from('wearable_device_registrations')
      .select('id')
      .eq('tenant_id', request.tenantId)
      .eq('patient_id', request.patientId)
      .eq('device_id', request.deviceId)
      .maybeSingle();

    if (existing) return false;

    await this.registerDevice({
      tenantId: request.tenantId,
      patientId: request.patientId,
      deviceId: request.deviceId,
      deviceType: request.deviceType,
      species: request.species,
      breed: request.breed,
    });

    return true;
  }
}

function toFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

// ─── Singleton ────────────────────────────────────────────────
let _connector: PassiveVitalConnector | null = null;
export function getPassiveVitalConnector(): PassiveVitalConnector {
  if (!_connector) _connector = new PassiveVitalConnector();
  return _connector;
}
