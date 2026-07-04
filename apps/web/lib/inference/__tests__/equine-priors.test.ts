import { describe, expect, it } from 'vitest';
import { panelsToDiagnosticTests } from '../panel-diagnostics';
import { runClinicalInferenceEngine } from '../engine';
import { applyEquinePriors } from '../equine-priors';
import type { InferenceRequest } from '../types';
import type { SystemPanel } from '@vetios/inference-schema';

describe('equine clinical priors', () => {
    it('maps culture and sensitivity panels into microbiology instead of serology', () => {
        const panels: SystemPanel[] = [
            {
                system: 'microbiology',
                panel: 'culture_sensitivity',
                tests: {
                    growth: 'heavy',
                    organism: 'Streptococcus equi; mixed anaerobes',
                    sensitivity_pattern: 'doxycycline susceptible; penicillin susceptible',
                },
            },
        ];

        expect(panelsToDiagnosticTests(panels)).toEqual({
            microbiology: {
                growth: 'heavy',
                organism: ['Streptococcus equi', 'mixed anaerobes'],
                sensitivity_pattern: ['doxycycline susceptible', 'penicillin susceptible'],
            },
        });
    });

    it('uses positive Coggins evidence as a high-confidence equine infectious anaemia route', () => {
        const result = runClinicalInferenceEngine({
            species: 'equine',
            breed: 'Quarter Horse',
            presenting_signs: ['fever', 'weight_loss', 'lethargy'],
            diagnostic_tests: {
                serology: {
                    coggins_result: 'positive',
                },
            },
        });

        expect(result.differentials[0]?.condition).toContain('Equine Infectious Anaemia');
        expect(result.differentials[0]?.probability ?? 0).toBeGreaterThanOrEqual(0.85);
        expect(result.differentials[0]?.determination_basis).toBe('pathognomonic_test');
    });

    it('combines SAA, pleural imaging, septic cytology, and culture for pleuropneumonia', () => {
        const result = runClinicalInferenceEngine({
            species: 'horse',
            breed: 'Thoroughbred',
            presenting_signs: ['fever', 'cough', 'respiratory_distress', 'lethargy'],
            diagnostic_tests: {
                biochemistry: {
                    saa_value: 180,
                },
                thoracic_radiograph: {
                    pleural_effusion: 'present',
                    pulmonary_infiltrates: 'present',
                },
                microbiology: {
                    growth: 'heavy',
                    organism: ['mixed anaerobes'],
                },
            },
        });

        expect(result.differentials[0]?.condition).toContain('Pleuropneumonia');
        expect(result.differentials[0]?.supporting_evidence.map((entry) => entry.finding).join(' ')).toContain('Pleural effusion');
    });

    it('routes abdominal fluid bacteria toward equine septic peritonitis and surgical colic concern', () => {
        const result = runClinicalInferenceEngine({
            species: 'equine',
            breed: 'Arabian',
            presenting_signs: ['colic', 'fever', 'abdominal_pain', 'tachycardia'],
            diagnostic_tests: {
                biochemistry: {
                    saa_level: 'elevated',
                },
                abdominal_ultrasound: {
                    free_fluid: 'present',
                },
                cytology: {
                    abdominal_fluid_bacteria: 'present',
                },
            },
        });
        const adjustments = applyEquinePriors({
            species: 'equine',
            presenting_signs: ['colic', 'fever', 'abdominal_pain', 'tachycardia'],
            diagnostic_tests: {
                abdominal_ultrasound: {
                    free_fluid: 'present',
                },
            },
        });

        expect(result.differentials[0]?.condition).toContain('Septic Peritonitis');
        expect(adjustments).toEqual(expect.arrayContaining([
            expect.objectContaining({ condition_id: 'equine_colic_strangulating' }),
        ]));
    });

    it('keeps equine priors species-gated away from canine cases', () => {
        const request: InferenceRequest = {
            species: 'canine',
            presenting_signs: ['fever'],
            diagnostic_tests: {
                serology: {
                    coggins_result: 'positive',
                },
                biochemistry: {
                    saa_value: 120,
                },
            },
        };

        expect(applyEquinePriors(request)).toEqual([]);
    });
});
