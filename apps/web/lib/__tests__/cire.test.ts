import { describe, expect, test } from 'vitest';
import { computeCIRE } from '@/lib/cire';

describe('computeCIRE', () => {
    test('returns nominal for high top confidence and low spread', () => {
        expect(computeCIRE([
            { label: 'canine_parvovirus', p: 0.82 },
            { label: 'dietary_indiscretion', p: 0.04 },
            { label: 'pancreatitis', p: 0.01 },
        ])).toEqual({
            phi_hat: 0.82,
            cps: 0.3072,
            safety_state: 'nominal',
        });
    });

    test('returns review when confidence or spread is intermediate', () => {
        expect(computeCIRE([
            { label: 'pancreatitis', p: 0.48 },
            { label: 'gastroenteritis', p: 0.28 },
            { label: 'foreign_body', p: 0.18 },
        ]).safety_state).toBe('review');
    });

    test('returns hold for low confidence and high spread', () => {
        expect(computeCIRE([
            { label: 'pancreatitis', p: 0.3 },
            { label: 'gastroenteritis', p: 0.28 },
            { label: 'foreign_body', p: 0.24 },
        ]).safety_state).toBe('hold');
    });

    test('handles an empty differential array', () => {
        expect(computeCIRE([])).toEqual({ phi_hat: 0, cps: 1, safety_state: 'hold' });
    });

    test('sets cps to zero for a single differential', () => {
        expect(computeCIRE([{ label: 'canine_parvovirus', p: 0.7 }])).toEqual({
            phi_hat: 0.7,
            cps: 0,
            safety_state: 'nominal',
        });
    });

    test('skips zero probabilities in entropy', () => {
        expect(computeCIRE([
            { label: 'canine_parvovirus', p: 0.7 },
            { label: 'dietary_indiscretion', p: 0 },
        ])).toEqual({
            phi_hat: 0.7,
            cps: 0.3602,
            safety_state: 'nominal',
        });
    });
});
