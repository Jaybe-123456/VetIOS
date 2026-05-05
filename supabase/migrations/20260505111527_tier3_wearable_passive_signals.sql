-- ─── Tier 3: Real-Time Passive Signal Ingestion ───────────────────────────────
-- Connects to: ai_inference_events, one_health_signals, population_disease_signals
--
-- Three tables:
--   wearable_device_registrations — registered devices per patient
--   passive_vital_readings        — continuous raw readings from devices
--   vital_anomaly_alerts          — fired when readings deviate from baseline

-- ── 1. Wearable Device Registrations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wearable_device_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  patient_id      TEXT NOT NULL,
  device_id       TEXT NOT NULL,           -- device serial/ID
  device_type     TEXT NOT NULL,           -- 'whistle'|'petpace'|'felcana'|'generic'
  species         TEXT NOT NULL,
  breed           TEXT,
  age_years       FLOAT,
  weight_kg       FLOAT,
  -- Baseline window: computed from first 30 days of readings
  baseline_computed BOOLEAN DEFAULT FALSE,
  baseline_computed_at TIMESTAMPTZ,
  -- Per-vital baseline stats (mean ± std)
  baseline_heart_rate_mean   FLOAT,
  baseline_heart_rate_std    FLOAT,
  baseline_temp_mean         FLOAT,
  baseline_temp_std          FLOAT,
  baseline_respiratory_mean  FLOAT,
  baseline_respiratory_std   FLOAT,
  baseline_activity_mean     FLOAT,
  baseline_activity_std      FLOAT,
  -- Config
  alert_sensitivity TEXT NOT NULL DEFAULT 'moderate', -- 'low'|'moderate'|'high'
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  registered_at    TIMESTAMPTZ DEFAULT NOW(),
  last_reading_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, patient_id, device_id)
);

-- ── 2. Passive Vital Readings ─────────────────────────────────────────────────
-- Raw readings from wearable devices. High-volume table — indexed for time queries.
CREATE TABLE IF NOT EXISTS passive_vital_readings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  patient_id      TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  device_type     TEXT NOT NULL,
  species         TEXT NOT NULL,
  region          TEXT,
  -- Vital measurements (all optional — device may not measure all)
  heart_rate      FLOAT,            -- bpm
  temperature     FLOAT,            -- celsius
  respiratory_rate FLOAT,           -- breaths per minute
  activity_score  FLOAT,            -- 0-100 normalised activity level
  sleep_score     FLOAT,            -- 0-100
  -- Anomaly flags (computed by wearableSignalProcessor)
  heart_rate_zscore    FLOAT,
  temp_zscore          FLOAT,
  respiratory_zscore   FLOAT,
  activity_zscore      FLOAT,
  is_anomalous         BOOLEAN DEFAULT FALSE,
  anomaly_severity     TEXT,        -- 'mild'|'moderate'|'severe'
  -- Raw payload for debugging
  raw_payload     JSONB DEFAULT '{}',
  recorded_at     TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Vital Anomaly Alerts ───────────────────────────────────────────────────
-- Fired when a vital reading deviates significantly from the patient baseline.
-- Triggers VKG symptom inference to generate pre-symptomatic differentials.
CREATE TABLE IF NOT EXISTS vital_anomaly_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  patient_id      TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  species         TEXT NOT NULL,
  region          TEXT,
  -- Which vitals triggered the alert
  triggered_vitals TEXT[] NOT NULL,
  -- Severity
  severity        TEXT NOT NULL,   -- 'mild'|'moderate'|'severe'
  max_zscore      FLOAT NOT NULL,
  -- VKG inference result
  inferred_symptoms TEXT[],        -- symptoms mapped from vital deviations
  vkg_differentials JSONB,         -- top differentials from VKG traversal
  -- Alert content
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  recommended_actions TEXT[],
  -- Owner notification
  owner_notified  BOOLEAN DEFAULT FALSE,
  vet_notified    BOOLEAN DEFAULT FALSE,
  -- Linking
  reading_id      UUID REFERENCES passive_vital_readings(id) ON DELETE SET NULL,
  inference_event_id UUID REFERENCES ai_inference_events(id) ON DELETE SET NULL,
  -- Lifecycle
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS wearable_device_tenant_patient_idx
  ON wearable_device_registrations(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS passive_readings_patient_time_idx
  ON passive_vital_readings(patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS passive_readings_device_time_idx
  ON passive_vital_readings(device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS passive_readings_anomaly_idx
  ON passive_vital_readings(is_anomalous, anomaly_severity) WHERE is_anomalous = TRUE;
CREATE INDEX IF NOT EXISTS vital_alerts_patient_idx
  ON vital_anomaly_alerts(tenant_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vital_alerts_severity_idx
  ON vital_anomaly_alerts(severity, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE wearable_device_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE passive_vital_readings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vital_anomaly_alerts          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_wearable_devices"
  ON wearable_device_registrations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_passive_readings"
  ON passive_vital_readings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_vital_alerts"
  ON vital_anomaly_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE wearable_device_registrations IS
  'Tier 3 — registered wearable devices with per-patient baseline stats';
COMMENT ON TABLE passive_vital_readings IS
  'Tier 3 — continuous raw readings from wearable devices';
COMMENT ON TABLE vital_anomaly_alerts IS
  'Tier 3 — pre-symptomatic alerts from wearable anomaly detection';
