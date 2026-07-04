import { describe, expect, it } from 'vitest';
import { runClinicalInferenceEngine } from '../engine';
import { applyRuminantPriors } from '../ruminant-priors';
import type { InferenceRequest } from '../types';

describe('ruminant clinical priors', () => {
    it('converts ruminant metabolic panel findings into bovine transition-cow differentials', () => {
        const request: InferenceRequest = {
            species: 'bovine',
            breed: 'Holstein-Friesian',
            presenting_signs: ['anorexia', 'lethargy', 'reduced_milk_yield'],
            diagnostic_tests: {
                biochemistry: {
                    bhba: 'elevated',
                    nefa: 'elevated',
                    calcium: 'low',
                    glucose: 'hypoglycemia',
                },
            },
        };

        const adjustments = applyRuminantPriors(request);

        expect(adjustments).toEqual(expect.arrayContaining([
            expect.objectContaining({ condition_id: 'bovine_ketosis' }),
            expect.objectContaining({ condition_id: 'ruminant_hypocalcemia' }),
        ]));
    });

    it('keeps ruminant priors species-gated away from companion-animal cases', () => {
        const adjustments = applyRuminantPriors({
            species: 'canine',
            presenting_signs: ['lethargy'],
            diagnostic_tests: {
                biochemistry: {
                    bhba: 'elevated',
                    calcium: 'low',
                },
            },
        });

        expect(adjustments).toEqual([]);
    });

    it('routes mastitis milk-quality evidence into a ruminant mastitis differential', () => {
        const result = runClinicalInferenceEngine({
            species: 'bovine',
            breed: 'Friesian',
            presenting_signs: ['fever', 'reduced_milk_yield', 'lethargy'],
            diagnostic_tests: {
                cytology: {
                    california_mastitis_test: 'positive',
                    milk_culture_growth: 'present',
                    somatic_cell_count: 850000,
                    organism: ['Staphylococcus aureus'],
                },
            },
        });

        expect(result.differentials[0]?.condition).toContain('Mastitis');
        expect(result.differentials[0]?.supporting_evidence.map((entry) => entry.finding).join(' ')).toContain('Milk culture');
    });

    it('lets ruminant infectious molecular evidence drive high-confidence cattle alerts', () => {
        const result = runClinicalInferenceEngine({
            species: 'bovine',
            breed: 'Zebu',
            region: 'east_africa',
            presenting_signs: ['fever', 'skin_nodules', 'lymphadenopathy', 'reduced_milk_yield'],
            diagnostic_tests: {
                pcr: {
                    lumpy_skin_disease_pcr: 'positive',
                },
            },
        });

        expect(result.differentials[0]?.condition).toContain('Lumpy Skin Disease');
        expect(result.differentials[0]?.probability ?? 0).toBeGreaterThanOrEqual(0.85);
        expect(result.differentials[0]?.determination_basis).toBe('pathognomonic_test');
    });

    it('surfaces herd infectious and parasitology evidence without small-animal panels', () => {
        const request: InferenceRequest = {
            species: 'bovine',
            breed: 'Nguni',
            presenting_signs: ['diarrhea', 'weight_loss', 'poor_growth'],
            diagnostic_tests: {
                serology: {
                    bvd_antigen: 'negative',
                    johnes_elisa: 'positive',
                },
                parasitology: {
                    fecal_egg_count: 1200,
                    fecal_flotation: ['Coccidia'],
                },
            },
        };
        const result = runClinicalInferenceEngine(request);
        const adjustments = applyRuminantPriors(request);

        const topThree = result.differentials.slice(0, 3).map((entry) => entry.condition);

        expect(topThree.some((entry) => entry.includes("Johne's Disease"))).toBe(true);
        expect(adjustments).toEqual(expect.arrayContaining([
            expect.objectContaining({ condition_id: 'ruminant_parasitic_gastroenteritis' }),
        ]));
        expect(result.differentials.some((entry) => entry.condition.includes('Heartworm'))).toBe(false);
    });
});
