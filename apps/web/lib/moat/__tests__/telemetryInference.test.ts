import { describe, expect, it } from 'vitest';
import {
    buildTelemetryInferenceSignature,
    mapTelemetryAnomaliesToSymptoms,
    shouldTriggerTelemetryInference,
} from '../telemetryInference';

describe('telemetry inference helpers', () => {
    it('maps critical passive telemetry anomalies into clinical symptoms', () => {
        const symptoms = mapTelemetryAnomaliesToSymptoms([
            { metric_type: 'spo2_pct', anomaly_type: 'low', severity: 'critical' },
            { metric_type: 'heart_rate_bpm', anomaly_type: 'high', severity: 'critical' },
        ]);

        expect(symptoms).toContain('dyspnea');
        expect(symptoms).toContain('cyanosis');
        expect(symptoms).toContain('tachycardia');
        expect(symptoms).toContain('collapse');
    });

    it('does not trigger full inference for isolated mild activity drift', () => {
        expect(shouldTriggerTelemetryInference([
            { metric_type: 'activity_score', anomaly_type: 'low', severity: 'moderate' },
        ])).toBe(false);
    });

    it('builds an inference signature with passive telemetry provenance', () => {
        const signature = buildTelemetryInferenceSignature({
            tenantId: 'tenant-1',
            patientId: 'patient-1',
            species: 'canine',
            deviceId: 'collar-1',
            deviceType: 'collar',
            source: 'telemetry_stream',
            readings: [{ metric_type: 'temperature_c', value: 40.5 }],
            anomalies: [{ metric_type: 'temperature_c', anomaly_type: 'high', severity: 'critical' }],
        });

        expect(signature.symptoms).toContain('fever');
        expect(signature.metadata.source).toBe('telemetry_stream');
        expect(signature.telemetry.device_id).toBe('collar-1');
    });
});
