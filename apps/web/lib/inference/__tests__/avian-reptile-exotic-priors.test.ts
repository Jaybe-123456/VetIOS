import { describe, expect, it } from 'vitest';
import { panelsToDiagnosticTests } from '../panel-diagnostics';
import { runClinicalInferenceEngine } from '../engine';
import { applyAvianReptileExoticPriors } from '../avian-reptile-exotic-priors';
import type { InferenceRequest } from '../types';
import type { SystemPanel } from '@vetios/inference-schema';

describe('avian reptile exotic clinical priors', () => {
    it('maps avian/reptile haematology and cytology into engine buckets', () => {
        const panels: SystemPanel[] = [
            {
                system: 'haematology',
                panel: 'haematology_avian',
                tests: {
                    pcv: 22,
                    heterophil_lymphocyte_ratio: 2.1,
                    thrombocytes: 'low',
                },
            },
            {
                system: 'cytology',
                panel: 'cytology_avian',
                tests: {
                    heterophils: 'elevated',
                    toxic_changes: 'present',
                },
            },
        ];

        expect(panelsToDiagnosticTests(panels)).toEqual({
            cbc: {
                packed_cell_volume_percent: 22,
                heterophil_lymphocyte_ratio: 2.1,
                thrombocytes: 'low',
            },
            cytology: {
                heterophils: 'elevated',
                toxic_changes: 'present',
            },
        });
    });

    it('routes avian PCR evidence into avian disease space instead of canine fallback', () => {
        const result = runClinicalInferenceEngine({
            species: 'avian',
            breed: 'African Grey Parrot',
            presenting_signs: ['respiratory_signs', 'ocular_discharge', 'lethargy', 'anorexia'],
            diagnostic_tests: {
                pcr: {
                    chlamydia_psittaci_pcr: 'positive',
                },
                cytology: {
                    heterophils: 'elevated',
                },
            },
        });

        expect(result.species_validation.canonical_species).toBe('avian');
        expect(result.differentials[0]?.condition).toContain('Avian Chlamydiosis');
        expect(result.differentials.some((entry) => entry.condition.includes('Heartworm'))).toBe(false);
    });

    it('routes reptile calcium-phosphorus evidence toward metabolic bone disease', () => {
        const result = runClinicalInferenceEngine({
            species: 'reptile',
            breed: 'Bearded Dragon',
            presenting_signs: ['weakness', 'lameness', 'anorexia', 'tremors'],
            diagnostic_tests: {
                biochemistry: {
                    calcium: 'low',
                    phosphorus: 'elevated',
                },
            },
        });

        expect(result.species_validation.canonical_species).toBe('reptile');
        expect(result.differentials[0]?.condition).toContain('Metabolic Bone Disease');
    });

    it('routes exotic reduced fecal output and anorexia toward small mammal GI stasis', () => {
        const result = runClinicalInferenceEngine({
            species: 'rabbit',
            breed: 'Mini Rex',
            presenting_signs: ['anorexia', 'reduced_feces', 'lethargy', 'abdominal_pain'],
        });

        expect(result.species_validation.canonical_species).toBe('exotic');
        expect(result.differentials[0]?.condition).toContain('Gastrointestinal Stasis');
    });

    it('keeps avian/reptile/exotic priors away from canine cases', () => {
        const request: InferenceRequest = {
            species: 'canine',
            presenting_signs: ['lethargy'],
            diagnostic_tests: {
                pcr: {
                    avian_influenza_pcr: 'positive',
                },
                biochemistry: {
                    calcium: 'low',
                },
            },
        };

        expect(applyAvianReptileExoticPriors(request)).toEqual([]);
    });
});
