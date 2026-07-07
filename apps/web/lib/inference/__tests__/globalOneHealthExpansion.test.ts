import { describe, expect, it } from 'vitest';
import { expandGlobalConditionCandidatesFromVerifiedMappings } from '../globalOneHealthExpansion';
import type { GlobalConditionCoverageReport } from '../types';

const coverage: GlobalConditionCoverageReport = {
    status: 'partial',
    score: 0.42,
    registry_scope: 'closed_world',
    canonical_species: 'canine',
    input_species: 'canine',
    registered_candidate_count: 10,
    source_backed_count: 12,
    one_health_source_count: 5,
    human_correlation_requested: true,
    one_health_review_required: true,
    open_world_candidate_generation: 'missing',
    candidate_expansion_status: 'source_hints_only',
    candidate_expansion_hints: [],
    condition_candidate_status: 'seeded_source_candidates',
    condition_candidate_hints: [
        {
            condition_key: 'rabies',
            canonical_name: 'Rabies',
            condition_domain: 'infectious',
            species_scope: ['canine', 'human'],
            host_scope: ['mammal', 'human'],
            human_relevance: 'zoonotic',
            zoonotic_role: 'reservoir',
            amr_relevance: 'none_known',
            source_keys: ['mondo_disease_ontology'],
            matched_terms: ['rabies'],
            reason: 'Matched rabies.',
        },
    ],
    blockers: ['open_world_candidate_generation_missing'],
    warnings: [],
    recommended_next_action: 'Expand through source-mapped ontology.',
};

describe('global One Health verified expansion', () => {
    it('returns verified mappings for candidate keys without changing diagnostic scores', async () => {
        const client = buildClient({
            mappings: [
                {
                    condition_key: 'rabies',
                    source_key: 'mondo_disease_ontology',
                    source_authority: 'institutional',
                    source_type: 'dataset',
                    external_code_system: 'MONDO',
                    external_code: 'MONDO:0005091',
                    mapping_status: 'source_attested',
                    mapping_confidence: 0.95,
                    source_version: null,
                    created_at: '2026-07-06T00:00:00.000Z',
                },
            ],
        });

        const report = await expandGlobalConditionCandidatesFromVerifiedMappings({
            client,
            tenantId: '00000000-0000-4000-8000-000000000001',
            coverage,
        });

        expect(report.status).toBe('verified_candidates_available');
        expect(report.candidate_count).toBe(1);
        expect(report.verified_mapping_count).toBe(1);
        expect(report.verified_mappings[0]).toMatchObject({
            condition_key: 'rabies',
            external_code_system: 'MONDO',
            external_code: 'MONDO:0005091',
        });
        expect(report.graph_candidate_count).toBe(0);
        expect(report.blockers).toContain('reviewer_verification_required_before_probability_scoring');
    });

    it('returns graph-backed shadow candidates from populated ontology edges', async () => {
        const report = await expandGlobalConditionCandidatesFromVerifiedMappings({
            client: buildClient({
                mappings: [
                    {
                        condition_key: 'rabies',
                        source_key: 'mondo_disease_ontology',
                        source_authority: 'institutional',
                        source_type: 'dataset',
                        external_code_system: 'MONDO',
                        external_code: 'MONDO:0005091',
                        mapping_status: 'reviewer_verified',
                        mapping_confidence: 0.98,
                        source_version: null,
                        created_at: '2026-07-06T00:00:00.000Z',
                    },
                ],
                relationships: [
                    {
                        provider_key: 'mondo_obo_json',
                        source_key: 'mondo_disease_ontology',
                        code_system: 'MONDO',
                        subject_code: 'MONDO:0005091',
                        predicate: 'is_a',
                        object_code: 'MONDO:0000001',
                        relationship_kind: 'subclass',
                    },
                ],
                nodes: [
                    {
                        provider_key: 'mondo_obo_json',
                        source_key: 'mondo_disease_ontology',
                        code_system: 'MONDO',
                        external_code: 'MONDO:0000001',
                        canonical_label: 'infectious disease',
                        node_kind: 'class',
                    },
                ],
            }),
            tenantId: '00000000-0000-4000-8000-000000000001',
            coverage,
        });

        expect(report.status).toBe('graph_candidates_available');
        expect(report.graph_relationship_count).toBe(1);
        expect(report.graph_candidate_count).toBe(1);
        expect(report.graph_candidates[0]).toMatchObject({
            source_condition_key: 'rabies',
            candidate_external_code: 'MONDO:0000001',
            candidate_label: 'infectious disease',
        });
        expect(report.blockers).toContain('reviewer_verification_required_before_probability_scoring');
    });

    it('reports no candidate hints when the inference has no source-seeded candidates', async () => {
        const report = await expandGlobalConditionCandidatesFromVerifiedMappings({
            client: buildClient({ mappings: [] }),
            tenantId: '00000000-0000-4000-8000-000000000001',
            coverage: {
                ...coverage,
                condition_candidate_status: 'none',
                condition_candidate_hints: [],
            },
        });

        expect(report.status).toBe('no_candidate_hints');
        expect(report.verified_mapping_count).toBe(0);
        expect(report.blockers).toContain('no_source_seeded_condition_candidates');
    });
});

function buildClient(rows: {
    mappings: Array<Record<string, unknown>>;
    relationships?: Array<Record<string, unknown>>;
    nodes?: Array<Record<string, unknown>>;
}) {
    return {
        from(table: string) {
            const data = table === 'global_condition_source_mapping_events'
                ? rows.mappings
                : table === 'global_biomedical_ontology_relationship_events'
                    ? rows.relationships ?? []
                    : table === 'global_biomedical_ontology_node_events'
                        ? rows.nodes ?? []
                        : [];
            return {
                select() {
                    return {
                        eq() {
                            return {
                                in() {
                                    return {
                                        order() {
                                            return {
                                                async limit() {
                                                    return { data, error: null };
                                                },
                                            };
                                        },
                                        not() {
                                            return {
                                                order() {
                                                    return {
                                                        async limit() {
                                                            return { data, error: null };
                                                        },
                                                    };
                                                },
                                            };
                                        },
                                    };
                                },
                                or() {
                                    return {
                                        order() {
                                            return {
                                                async limit() {
                                                    return { data, error: null };
                                                },
                                            };
                                        },
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    };
}
