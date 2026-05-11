import { describe, expect, it } from 'vitest';
import { analyseLabResults, classifyDeviation, normalizeAnalyteName, parseCsvLabResults } from '../labAnalysis';

describe('Inference Console lab analysis', () => {
    it('normalizes analyte aliases and classifies deviations', () => {
        expect(normalizeAnalyteName('WBC')).toBe('white_blood_cell_count');
        expect(normalizeAnalyteName('Creatinine')).toBe('creatinine');
        expect(classifyDeviation(18, 6, 17)).toBe('mildly_high');
        expect(classifyDeviation(40, 200, 500)).toBe('markedly_low');
    });

    it('detects renal azotaemia and low sodium potassium ratio patterns', () => {
        const report = analyseLabResults({
            species: 'canine',
            results: [
                { analyte: 'BUN', value: 70 },
                { analyte: 'CREA', value: 3.6 },
                { analyte: 'Na', value: 132 },
                { analyte: 'K', value: 5.4 },
            ],
            now: new Date('2026-05-11T00:00:00.000Z'),
        });

        expect(report.pattern_matches.map((entry) => entry.pattern_name)).toContain('Azotaemia pattern');
        expect(report.pattern_matches.map((entry) => entry.pattern_name)).toContain('Low sodium:potassium ratio');
        expect(report.key_abnormalities_summary).toContain('creatinine');
    });

    it('detects inflammatory and stress leucogram patterns', () => {
        const report = analyseLabResults({
            species: 'dog',
            results: [
                { analyte: 'WBC', value: 26 },
                { analyte: 'NEU', value: 20 },
                { analyte: 'LYM', value: 0.4 },
            ],
        });

        expect(report.panel_types).toContain('CBC');
        expect(report.pattern_matches.map((entry) => entry.pattern_name)).toContain('Inflammatory leucogram');
        expect(report.pattern_matches.map((entry) => entry.pattern_name)).toContain('Stress leucogram');
    });

    it('parses CSV lab rows', () => {
        const results = parseCsvLabResults('analyte,value,unit,reference_low,reference_high\nWBC,22,10^9/L,6,17\nALT,240,U/L,10,125');

        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({ analyte: 'WBC', value: 22, reference_low: 6, reference_high: 17 });
    });
});
