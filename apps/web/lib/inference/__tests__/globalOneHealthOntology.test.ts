import { describe, expect, it } from 'vitest';
import { runClinicalInferenceEngine } from '../engine';
import { assessGlobalConditionCoverage } from '../globalOneHealthOntology';

describe('global One Health ontology coverage gate', () => {
    it('attaches closed-world coverage evidence to normal inference output', () => {
        const result = runClinicalInferenceEngine({
            species: 'bovine',
            breed: 'Holstein-Friesian',
            symptom_vector: ['reduced milk production', 'anorexia', 'ketone smell'],
            diagnostic_tests: {
                biochemistry: {
                    bhba: 'elevated',
                    glucose: 'hypoglycemia',
                },
            },
        });

        expect(result.global_condition_coverage).toMatchObject({
            status: 'partial',
            registry_scope: 'closed_world',
            canonical_species: 'bovine',
            open_world_candidate_generation: 'missing',
        });
        expect(result.global_condition_coverage?.registered_candidate_count).toBeGreaterThan(0);
        expect(result.global_condition_coverage?.blockers).toContain('open_world_candidate_generation_missing');
        expect(result.global_condition_coverage?.score).toBeLessThan(0.75);
    });

    it('requires One Health review when human-animal-environment correlation is requested', () => {
        const report = assessGlobalConditionCoverage({
            species: 'avian',
            presenting_signs: ['respiratory distress', 'cyanosis'],
            symptom_vector: ['respiratory distress', 'cyanosis'],
            history: {
                owner_observations: [
                    'Backyard poultry outbreak with wildlife contact and human public health concern',
                ],
                geographic_region: 'global',
            },
        });

        expect(report.status).toBe('partial');
        expect(report.human_correlation_requested).toBe(true);
        expect(report.one_health_review_required).toBe(true);
        expect(report.blockers).toContain('one_health_condition_edges_not_materialized');
        expect(report.candidate_expansion_status).toBe('source_hints_only');
        expect(report.candidate_expansion_hints.some((hint) =>
            hint.medicine_domain.some((domain) => domain.includes('one_health') || domain.includes('surveillance')),
        )).toBe(true);
        expect(report.condition_candidate_status).toBe('seeded_source_candidates');
        expect(report.condition_candidate_hints.some((hint) =>
            hint.condition_key === 'highly_pathogenic_avian_influenza'
            && hint.source_keys.includes('woah_wahis')
            && hint.matched_terms.includes('outbreak'),
        )).toBe(true);
    });

    it('does not silently treat unsupported species labels as globally covered', () => {
        const report = assessGlobalConditionCoverage({
            species: 'axolotl',
            presenting_signs: ['lethargy', 'skin lesion'],
            symptom_vector: ['lethargy', 'skin lesion'],
        });

        expect(report.status).toBe('unsupported');
        expect(report.registered_candidate_count).toBe(0);
        expect(report.score).toBe(0);
        expect(report.blockers).toContain('species_not_supported_by_registry');
        expect(report.condition_candidate_status).toBe('none');
    });
});
