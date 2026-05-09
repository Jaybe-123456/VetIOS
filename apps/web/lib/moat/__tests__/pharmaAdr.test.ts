import { describe, expect, it } from 'vitest';
import { matchesOptionalFilter, summarizeAdverseSignals } from '../pharmaAdr';

describe('pharma ADR helpers', () => {
    it('enforces optional licensee filters case-insensitively', () => {
        expect(matchesOptionalFilter('canine', [])).toBe(true);
        expect(matchesOptionalFilter('Canine', ['canine', 'feline'])).toBe(true);
        expect(matchesOptionalFilter('equine', ['canine', 'feline'])).toBe(false);
    });

    it('summarizes anonymized adverse event signal batches', () => {
        const summary = summarizeAdverseSignals([
            { species: 'canine', drug_class: 'NSAID', outcome_severity: 'severe' },
            { species: 'canine', drug_class: 'NSAID', outcome_severity: 'moderate' },
            { species: 'feline', drug_class: 'opioid', outcome_severity: 'moderate' },
        ]);

        expect(summary.total).toBe(3);
        expect(summary.by_species).toEqual({ canine: 2, feline: 1 });
        expect(summary.by_drug_class).toEqual({ NSAID: 2, opioid: 1 });
        expect(summary.by_severity).toEqual({ severe: 1, moderate: 2 });
    });
});
