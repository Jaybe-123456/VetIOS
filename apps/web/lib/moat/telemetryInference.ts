export interface TelemetryAnomalySignal {
    metric_type: string;
    anomaly_type: string;
    severity: string;
}

export interface TelemetryReadingSignal {
    metric_type: string;
    value: number;
    recorded_at?: string;
    quality_score?: number;
}

export function mapTelemetryAnomaliesToSymptoms(anomalies: TelemetryAnomalySignal[]) {
    const symptoms = new Set<string>();
    for (const anomaly of anomalies) {
        const direction = anomaly.anomaly_type;
        if (anomaly.metric_type === 'heart_rate_bpm') {
            symptoms.add(direction === 'low' ? 'bradycardia' : 'tachycardia');
            if (anomaly.severity === 'critical') symptoms.add('collapse');
        }
        if (anomaly.metric_type === 'temperature_c') {
            symptoms.add(direction === 'low' ? 'hypothermia' : 'fever');
            if (anomaly.severity === 'critical') symptoms.add('lethargy');
        }
        if (anomaly.metric_type === 'respiratory_rate_bpm') {
            symptoms.add('dyspnea');
            if (direction === 'high') symptoms.add('tachycardia');
        }
        if (anomaly.metric_type === 'spo2_pct') {
            symptoms.add('dyspnea');
            symptoms.add('cyanosis');
        }
        if (anomaly.metric_type === 'activity_score' && direction === 'low') {
            symptoms.add('lethargy');
        }
        if (anomaly.metric_type === 'glucose_mmol') {
            symptoms.add(direction === 'low' ? 'collapse' : 'polyuria');
        }
    }
    return Array.from(symptoms);
}

export function shouldTriggerTelemetryInference(anomalies: TelemetryAnomalySignal[]) {
    if (anomalies.length === 0) return false;
    return anomalies.some((anomaly) => ['critical', 'severe'].includes(anomaly.severity) || anomaly.metric_type !== 'activity_score');
}

export function buildTelemetryInferenceSignature(input: {
    tenantId: string;
    patientId: string;
    species: string;
    deviceId: string;
    deviceType: string;
    readings: TelemetryReadingSignal[];
    anomalies: TelemetryAnomalySignal[];
    source: string;
}) {
    const symptoms = mapTelemetryAnomaliesToSymptoms(input.anomalies);
    return {
        tenant_id: input.tenantId,
        patient_id: input.patientId,
        species: input.species,
        symptoms,
        presenting_symptoms: symptoms,
        source: input.source,
        telemetry: {
            device_id: input.deviceId,
            device_type: input.deviceType,
            readings: input.readings,
            anomalies: input.anomalies,
        },
        metadata: {
            source: input.source,
            modality: 'passive_telemetry',
            device_id: input.deviceId,
            device_type: input.deviceType,
        },
    };
}
