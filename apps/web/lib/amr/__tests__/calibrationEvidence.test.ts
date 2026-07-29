import { describe, expect, it } from 'vitest';
import { readAMRInferenceDifferentials } from '@/lib/amr/calibrationEvidence';

describe('AMR calibration inference evidence', () => {
    it('reads V1 differentials from the persisted output payload', () => {
        expect(readAMRInferenceDifferentials({
            output_payload: {
                differentials: [
                    { label: 'canine_ehrlichiosis', p: 0.91 },
                    { label: 'anaplasmosis', p: 0.09 },
                ],
            },
        })).toEqual([
            { label: 'canine_ehrlichiosis', probability: 0.91 },
            { label: 'anaplasmosis', probability: 0.09 },
        ]);
    });

    it('reads V2 top differentials without requiring a table-level differentials column', () => {
        expect(readAMRInferenceDifferentials({
            output_payload: {
                diagnosis: {
                    top_differentials: [
                        { name: 'Escherichia coli urinary tract infection', probability: 0.84 },
                        { diagnosis: 'Sterile cystitis', confidence_score: 0.16 },
                    ],
                },
            },
        })).toEqual([
            { label: 'Escherichia coli urinary tract infection', probability: 0.84 },
            { label: 'Sterile cystitis', probability: 0.16 },
        ]);
    });

    it('drops incomplete entries and clamps malformed probabilities', () => {
        expect(readAMRInferenceDifferentials({
            output_payload: {
                differentials: [
                    { condition: 'resistant_infection', confidence: 1.4 },
                    { label: 'missing_probability' },
                    { probability: 0.5 },
                ],
            },
        })).toEqual([
            { label: 'resistant_infection', probability: 1 },
        ]);
    });
});
