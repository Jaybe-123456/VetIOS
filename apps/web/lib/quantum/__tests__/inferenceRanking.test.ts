import { describe, expect, it } from 'vitest';
import { buildAnonymizedGbsProblem } from '@/lib/quantum/inferenceRanking';

describe('buildAnonymizedGbsProblem', () => {
    it('builds a quantum request without clinical labels or symptoms', () => {
        const problem = buildAnonymizedGbsProblem({
            species: 'canine',
            symptoms: ['vomiting', 'lethargy'],
            metadata: {
                graph_priors: [
                    {
                        id: 'disease-1',
                        label: 'canine_parvovirus',
                        display_name: 'Canine Parvovirus',
                        score: 0.82,
                        matched_symptoms: ['vomiting', 'lethargy'],
                    },
                    {
                        id: 'disease-2',
                        label: 'pancreatitis',
                        display_name: 'Pancreatitis',
                        score: 0.54,
                        matched_symptoms: ['vomiting'],
                    },
                ],
            },
        });

        expect(problem).not.toBeNull();
        expect(problem?.request.nodes).toHaveLength(2);
        expect(problem?.request.edges).toHaveLength(1);
        expect(JSON.stringify(problem?.request)).not.toContain('parvovirus');
        expect(JSON.stringify(problem?.request)).not.toContain('vomiting');
        expect(problem?.mapping.map((entry) => entry.label)).toEqual(['canine_parvovirus', 'pancreatitis']);
    });

    it('returns null when graph priors are insufficient', () => {
        const problem = buildAnonymizedGbsProblem({
            species: 'feline',
            symptoms: ['coughing'],
            metadata: {
                graph_priors: [
                    { label: 'asthma_feline', score: 0.5, matched_symptoms: ['coughing'] },
                ],
            },
        });

        expect(problem).toBeNull();
    });
});
