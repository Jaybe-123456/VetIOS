import { describe, expect, it } from 'vitest';
import { detectSpeciesFromTexts } from '../context';
import { ASK_VETIOS_CASE_DRAFT_STORAGE_KEY, buildAskVetiosIntake } from '../intake';

describe('Ask VetIOS context detection', () => {
    it('prioritizes the current user query over assistant content', () => {
        expect(detectSpeciesFromTexts([
            'bovine mastitis drug doses',
            'Visual descriptors are generated for feline glanders.',
        ])).toBe('bovine');
    });

    it('detects the supported species terms', () => {
        expect(detectSpeciesFromTexts(['dog with cough'])).toBe('canine');
        expect(detectSpeciesFromTexts(['cat with nasal discharge'])).toBe('feline');
        expect(detectSpeciesFromTexts(['equine glanders clinical images'])).toBe('equine');
        expect(detectSpeciesFromTexts(['avian aspergillosis'])).toBe('avian');
        expect(detectSpeciesFromTexts(['porcine respiratory disease'])).toBe('porcine');
        expect(detectSpeciesFromTexts(['ovine foot rot'])).toBe('ovine');
    });

    it('builds a clinical case draft and inference handoff', () => {
        const intake = buildAskVetiosIntake({
            message: 'Dog, 7 year old neutered male, vomiting and lethargy for 2 days. CBC and chemistry done. Distended abdomen with unproductive retching.',
        });

        expect(intake.is_clinical_intake).toBe(true);
        expect(intake.case_draft.species).toBe('canine');
        expect(intake.case_draft.age_years).toBe(7);
        expect(intake.case_draft.sex).toBe('neutered male');
        expect(intake.case_draft.clinical_signs).toContain('vomiting');
        expect(intake.case_draft.labs_or_tests).toContain('CBC');
        expect(intake.case_draft.red_flags).toContain('possible GDV/bloat pattern');
        expect(intake.case_handoff.storage_key).toBe(ASK_VETIOS_CASE_DRAFT_STORAGE_KEY);
        expect(intake.case_handoff.payload.input.input_signature.species).toBe('canine');
    });
});
