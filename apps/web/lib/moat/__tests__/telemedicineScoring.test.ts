import { describe, expect, it } from 'vitest';
import { scoreTelemedicineSymptoms } from '../telemedicineScoring';

describe('telemedicine symptom scoring', () => {
    it('escalates respiratory distress and cyanosis as emergency teleconsults', () => {
        const result = scoreTelemedicineSymptoms({
            species: 'canine',
            symptoms: ['dyspnea', 'cyanosis'],
            description: 'Owner reports difficulty breathing and blue gums.',
            vitals: { rr_bpm: 72, mm_color: 'cyanotic' },
        });

        expect(result.urgency_level).toBe('emergency');
        expect(result.triage_score).toBeGreaterThanOrEqual(0.82);
        expect(result.red_flags).toContain('respiratory_distress');
        expect(result.red_flags).toContain('cyanotic_mucous_membranes');
    });

    it('keeps stable mild gastrointestinal signs below emergency escalation', () => {
        const result = scoreTelemedicineSymptoms({
            species: 'canine',
            symptoms: ['vomiting'],
            description: 'One episode of vomiting, bright and responsive now.',
            vitals: { temp_c: 38.6, hr_bpm: 110, rr_bpm: 24, mm_color: 'pink', cap_refill_s: 1.5 },
        });

        expect(result.urgency_level).toBe('routine');
        expect(result.red_flags).toEqual([]);
    });
});
