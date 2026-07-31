import { describe, expect, it } from 'vitest';
import { aggregateAMRPatterns, normalizeFasta, screenSequenceLocally } from '@/lib/amr/screener';

describe('AMR screener', () => {
    it('normalizes FASTA and identifies known AMR markers', () => {
        const sequence = [
            '>sample',
            'NNNATGGTTAAAAAATCACTGCGNNN',
            'tetA',
        ].join('\n');

        const result = screenSequenceLocally(sequence);

        expect(normalizeFasta(sequence)).toContain('ATGGTTAAAAAATCACTGCG');
        expect(result.resistance_genes).toContain('blaCTX-M-15');
        expect(result.resistance_genes).toContain('tetA');
        expect(result.resistance_classes).toContain('beta_lactam');
        expect(result.sequence_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(result).toMatchObject({
            quantum_backend: null,
            computation_class: 'classical_heuristic',
            validation_status: 'unvalidated',
            clinical_use_allowed: false,
            card_db_version: null,
        });
        expect(result.reference_database_versions).toEqual({
            vetios_local_marker_set: 'v1',
        });
        expect(result.warnings).toContain('phenotypic_ast_required');
    });

    it('aggregates public surveillance rows without individual records', () => {
        const patterns = aggregateAMRPatterns([
            {
                species: 'canine',
                pathogen_label: 'escherichia_coli',
                region: 'KE',
                resistance_genes: ['mcr-1'],
                resistance_classes: ['colistin'],
                novel_pattern_score: 0.8,
            },
            {
                species: 'canine',
                pathogen_label: 'escherichia_coli',
                region: 'KE',
                resistance_genes: ['mcr-1', 'tetA'],
                resistance_classes: ['colistin', 'tetracycline'],
                novel_pattern_score: 0.4,
            },
        ]);

        expect(patterns).toHaveLength(1);
        expect(patterns[0]?.sample_count).toBe(2);
        expect(patterns[0]?.resistance_genes[0]).toEqual({ gene: 'mcr-1', count: 2 });
        expect(patterns[0]?.average_novel_pattern_score).toBe(0.6);
    });
});
