import { describe, expect, it } from 'vitest';
import { fallbackExtractClinicalFields } from './extract';

describe('fallbackExtractClinicalFields', () => {
    it('extracts canine parvo-style signalment and labs', () => {
        const result = fallbackExtractClinicalFields('Three year old male Labrador, vomiting for two days, not eating, very tired, PCV 28');
        expect(result.species).toBe('canine');
        expect(result.breed).toBe('Labrador');
        expect(result.age_value).toBe(3);
        expect(result.age_unit).toBe('years');
        expect(result.sex).toBe('male_intact');
        expect(result.symptoms).toContain('vomiting');
        expect(result.symptoms).toContain('anorexia');
        expect(result.duration_value).toBe(2);
        expect(result.duration_unit).toBe('days');
        expect(result.labs?.pcv).toBe(28);
    });

    it('extracts feline kitten upper respiratory case', () => {
        const result = fallbackExtractClinicalFields('Seven month female kitten spayed sneezing and eye discharge with temp high');
        expect(result.species).toBe('feline');
        expect(result.age_value).toBe(7);
        expect(result.age_unit).toBe('months');
        expect(result.sex).toBe('female_spayed');
        expect(result.symptoms).toContain('sneezing');
        expect(result.symptoms).toContain('ocular discharge');
        expect(result.symptoms).toContain('fever');
    });

    it('extracts bovine AMR style production case', () => {
        const result = fallbackExtractClinicalFields('Dairy cow four years off feed milk production down mastitis ketosis glucose 2.1');
        expect(result.species).toBe('bovine');
        expect(result.age_value).toBe(4);
        expect(result.age_unit).toBe('years');
        expect(result.symptoms).toContain('anorexia');
        expect(result.symptoms).toContain('reduced milk production');
        expect(result.symptoms).toContain('mastitis');
        expect(result.symptoms).toContain('ketosis');
        expect(result.labs?.glucose).toBe(2.1);
    });

    it('extracts avian broiler sudden death case', () => {
        const result = fallbackExtractClinicalFields('Broiler chicken sudden death 30 days old bloody droppings coccidiosis');
        expect(result.species).toBe('avian');
        expect(result.breed).toBe('Broiler');
        expect(result.age_value).toBe(30);
        expect(result.age_unit).toBe('days');
        expect(result.symptoms).toContain('sudden death');
        expect(result.symptoms).toContain('bloody diarrhea');
        expect(result.severity).toBe('severe');
    });
});
