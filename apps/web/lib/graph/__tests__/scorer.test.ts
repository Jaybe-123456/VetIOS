import { describe, expect, it } from 'vitest';

import { aggregateDiseaseScores, type GraphEdgeRow } from '@vetios/graph';

const vomiting = {
    id: 'symptom-vomiting',
    label: 'vomiting',
    display_name: 'Vomiting',
    species: 'both',
    prevalence_weight: 1,
};

const lethargy = {
    id: 'symptom-lethargy',
    label: 'lethargy',
    display_name: 'Lethargy',
    species: 'both',
    prevalence_weight: 1,
};

describe('aggregateDiseaseScores', () => {
    it('ranks diseases by base prior and matched edge weights', () => {
        const edges: GraphEdgeRow[] = [
            {
                weight: 0.9,
                vet_symptom_nodes: vomiting,
                vet_disease_nodes: disease('parvo', 'Canine Parvovirus', 0.12, 'high'),
            },
            {
                weight: 0.7,
                vet_symptom_nodes: lethargy,
                vet_disease_nodes: disease('parvo', 'Canine Parvovirus', 0.12, 'high'),
            },
            {
                weight: 0.8,
                vet_symptom_nodes: vomiting,
                vet_disease_nodes: disease('gastritis', 'Gastritis', 0.02, 'medium'),
            },
        ];

        const scores = aggregateDiseaseScores(edges, 2);

        expect(scores).toHaveLength(2);
        expect(scores[0]).toMatchObject({
            label: 'parvo',
            score: 0.096,
            matched_symptoms: ['lethargy', 'vomiting'],
            edge_count: 2,
        });
        expect(scores[1]).toMatchObject({ label: 'gastritis', score: 0.008 });
    });

    it('applies age filtering and modifier boosts without exceeding probability bounds', () => {
        const edges: GraphEdgeRow[] = [
            {
                weight: 0.9,
                age_range_min: 0,
                age_range_max: 24,
                modifier_key: 'unvaccinated',
                vet_symptom_nodes: vomiting,
                vet_disease_nodes: disease('parvo', 'Canine Parvovirus', 0.2, 'high'),
            },
            {
                weight: 0.8,
                age_range_min: 60,
                vet_symptom_nodes: lethargy,
                vet_disease_nodes: disease('kidney', 'Kidney Disease', 0.2, 'medium'),
            },
        ];

        const scores = aggregateDiseaseScores(edges, 1, 12, ['unvaccinated']);

        expect(scores).toHaveLength(1);
        expect(scores[0]).toMatchObject({
            label: 'parvo',
            score: 0.2,
            matched_symptoms: ['vomiting'],
        });
    });
});

function disease(
    label: string,
    displayName: string,
    basePrior: number,
    urgency: 'high' | 'medium' | 'low',
) {
    return {
        id: `disease-${label}`,
        label,
        display_name: displayName,
        species: 'canine',
        base_prior: basePrior,
        urgency,
    };
}
