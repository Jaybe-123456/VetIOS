import { describe, expect, it } from 'vitest';
import {
    aggregateAMRStewardship,
    normalizeAMRLabel,
    normalizeAMRStringList,
} from '@/lib/amr/stewardship';

describe('AMR stewardship moat', () => {
    it('normalizes clinical AMR labels for surveillance joins', () => {
        expect(normalizeAMRLabel('Escherichia coli / UTI')).toBe('escherichia_coli_uti');
        expect(normalizeAMRStringList(['Beta Lactam', 'beta-lactam', 'Fluoroquinolone'])).toEqual([
            'beta_lactam',
            'fluoroquinolone',
        ]);
    });

    it('aggregates de-identified stewardship events without exposing case rows', () => {
        const aggregate = aggregateAMRStewardship([
            {
                species: 'canine',
                pathogen_label: 'escherichia_coli',
                infection_site: 'urinary_tract',
                drug_name: 'amoxicillin clavulanate',
                drug_class: 'beta_lactam',
                decision_stage: 'culture_guided',
                stewardship_status: 'culture_guided',
                outcome_status: 'improved',
                culture_collected: true,
                resistance_suspected: true,
                de_escalation_recommended: true,
                review_required: true,
                resistance_classes: ['beta_lactam'],
                observed_at: '2026-06-19T10:00:00.000Z',
            },
            {
                species: 'canine',
                pathogen_label: 'escherichia_coli',
                infection_site: 'skin',
                drug_name: 'doxycycline',
                drug_class: 'tetracycline',
                decision_stage: 'empiric',
                stewardship_status: 'pending_culture',
                outcome_status: 'unchanged',
                culture_collected: false,
                resistance_suspected: false,
                de_escalation_recommended: false,
                review_required: true,
                resistance_classes: ['tetracycline'],
                observed_at: '2026-06-19T11:00:00.000Z',
            },
        ]);

        expect(aggregate.total_events).toBe(2);
        expect(aggregate.culture_guided_events).toBe(1);
        expect(aggregate.culture_guided_rate).toBe(0.5);
        expect(aggregate.resistance_suspected_rate).toBe(0.5);
        expect(aggregate.review_required_rate).toBe(1);
        expect(aggregate.top_pathogens[0]).toEqual({ pathogen_label: 'escherichia_coli', count: 2 });
        expect(aggregate.latest_observed_at).toBe('2026-06-19T11:00:00.000Z');
    });
});
