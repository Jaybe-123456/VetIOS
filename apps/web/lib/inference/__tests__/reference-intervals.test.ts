import { describe, expect, it } from 'vitest';
import { runClinicalInferenceEngine } from '../engine';
import { interpretReferenceIntervals } from '../reference-intervals';
import type { DiagnosticTests } from '../types';

describe('species-aware reference interval interpretation', () => {
    it('maps raw ruminant metabolic values into transition-cow diagnostic signals', () => {
        const interpreted = interpretReferenceIntervals({
            species: 'Bovine (Cattle)',
            diagnostic_tests: {
                biochemistry: {
                    bhba: 1.8,
                    nefa: 0.9,
                    calcium: 7.2,
                    glucose: 38,
                    magnesium: 1.4,
                    phosphorus: 3.5,
                },
            } as unknown as DiagnosticTests,
        });

        expect(interpreted.diagnostic_tests?.biochemistry).toMatchObject({
            bhba: 'elevated',
            nefa: 'elevated',
            calcium: 'low',
            glucose: 'hypoglycemia',
            magnesium: 'low',
            phosphorus: 'low',
        });
        expect(interpreted.normalized_findings.map((finding) => finding.canonical_path)).toEqual(expect.arrayContaining([
            'biochemistry.bhba',
            'biochemistry.calcium',
            'biochemistry.glucose',
        ]));
        expect(interpreted.warnings[0]).toContain('conservative screening support');
    });

    it('preserves equine SAA value while deriving an inflammation label', () => {
        const interpreted = interpretReferenceIntervals({
            species: 'Equine (Horse)',
            diagnostic_tests: {
                biochemistry: {
                    saa_value: 120,
                },
            } as unknown as DiagnosticTests,
        });

        expect(interpreted.diagnostic_tests?.biochemistry).toMatchObject({
            saa_value: 120,
            saa_level: 'elevated',
        });
    });

    it('routes reptile mineral derangements into reptile-compatible labels', () => {
        const interpreted = interpretReferenceIntervals({
            species: 'reptile',
            diagnostic_tests: {
                biochemistry: {
                    calcium: 7.1,
                    phosphorus: 9.4,
                },
            } as unknown as DiagnosticTests,
        });

        expect(interpreted.diagnostic_tests?.biochemistry).toMatchObject({
            calcium: 'low',
            phosphorus: 'elevated',
        });
    });

    it('keeps companion animal glucose interpretation separate from ruminant thresholds', () => {
        const interpreted = interpretReferenceIntervals({
            species: 'canine',
            diagnostic_tests: {
                biochemistry: {
                    glucose: 220,
                    calcium: 13.2,
                },
            } as unknown as DiagnosticTests,
        });

        expect(interpreted.diagnostic_tests?.biochemistry).toMatchObject({
            glucose: 'hyperglycemia',
            calcium: 'hypercalcemia',
        });
    });

    it('lets raw bovine lab values drive the clinical engine without generic small-animal panels', () => {
        const result = runClinicalInferenceEngine({
            species: 'bovine',
            breed: 'Holstein-Friesian',
            presenting_signs: ['anorexia', 'lethargy', 'reduced_milk_yield'],
            diagnostic_tests: {
                biochemistry: {
                    bhba: 1.9,
                    calcium: 7.4,
                    glucose: 39,
                },
            },
        });

        const conditionIds = result.differentials.map((entry) => entry.condition_id);
        expect(conditionIds).toContain('bovine_ketosis');
        expect(conditionIds.some((conditionId) => conditionId?.includes('canine') || conditionId?.includes('feline'))).toBe(false);
        expect(result.evidence_normalization?.normalized_findings.map((finding) => finding.canonical_path)).toEqual(expect.arrayContaining([
            'biochemistry.bhba',
            'biochemistry.calcium',
            'biochemistry.glucose',
        ]));
    });
});
