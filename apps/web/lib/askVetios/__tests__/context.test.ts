import { describe, expect, it } from 'vitest';
import { detectSpeciesFromTexts } from '../context';

describe('Ask VetIOS context detection', () => {
    it('prioritizes the current user query over assistant content', () => {
        expect(detectSpeciesFromTexts([
            'bovine mastitis drug doses',
            'Visual descriptors are generated for feline glanders.',
        ])).toBe('bovine');
    });

    it('detects the supported species terms', () => {
        expect(detectSpeciesFromTexts(['cat with nasal discharge'])).toBe('feline');
        expect(detectSpeciesFromTexts(['equine glanders clinical images'])).toBe('equine');
        expect(detectSpeciesFromTexts(['avian aspergillosis'])).toBe('avian');
        expect(detectSpeciesFromTexts(['porcine respiratory disease'])).toBe('porcine');
        expect(detectSpeciesFromTexts(['ovine foot rot'])).toBe('ovine');
    });
});
