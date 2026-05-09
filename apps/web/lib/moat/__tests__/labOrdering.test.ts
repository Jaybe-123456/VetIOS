import { describe, expect, it } from 'vitest';
import { buildLabOrderPayload, shouldAutoOrderLabs } from '../labOrdering';

describe('lab ordering agent helpers', () => {
    it('auto-orders only when enabled, confident, and diagnostically useful', () => {
        const panels = [{ panel_code: 'cbc', priority: 'high', estimated_diagnostic_lift: 0.18 }];

        expect(shouldAutoOrderLabs({ enabled: true, agentConfidence: 0.82, panels, threshold: 0.8 })).toBe(true);
        expect(shouldAutoOrderLabs({ enabled: false, agentConfidence: 0.82, panels, threshold: 0.8 })).toBe(false);
        expect(shouldAutoOrderLabs({ enabled: true, agentConfidence: 0.72, panels, threshold: 0.8 })).toBe(false);
    });

    it('builds an auditable lab order payload without patient-facing identifiers beyond ids already present', () => {
        const payload = buildLabOrderPayload({
            recommendationId: 'rec-1',
            inferenceEventId: 'inf-1',
            patientId: 'patient-1',
            vendor: 'idexx',
            mode: 'manual',
            panels: [{ panel_code: 'serum_chemistry', rationale: 'vomiting + anorexia', priority: 'high', estimated_diagnostic_lift: 0.16 }],
        });

        expect(payload.vendor).toBe('idexx');
        expect(payload.panels[0]).toMatchObject({
            panel_code: 'serum_chemistry',
            priority: 'high',
            estimated_diagnostic_lift: 0.16,
        });
    });
});
