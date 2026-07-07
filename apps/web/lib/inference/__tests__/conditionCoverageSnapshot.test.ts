import { describe, expect, it } from 'vitest';
import { recordConditionCoverageSnapshotEvent } from '../conditionCoverageSnapshot';
import type { GlobalConditionCoverageReport } from '../types';

describe('condition coverage snapshot events', () => {
    it('persists aggregate ontology coverage without materializing source hints as edges', async () => {
        let inserted: Record<string, unknown> | null = null;
        const client = {
            from(table: string) {
                expect(table).toBe('condition_coverage_snapshot_events');
                return {
                    insert(payload: Record<string, unknown>) {
                        inserted = payload;
                        return {
                            select() {
                                return {
                                    async single() {
                                        return {
                                            data: {
                                                id: 'coverage-event-1',
                                                request_id: payload.request_id,
                                                coverage_scope: payload.coverage_scope,
                                                ontology_version: payload.ontology_version,
                                                coverage_status: payload.coverage_status,
                                                open_world_candidate_generation_status: payload.open_world_candidate_generation_status,
                                                coverage_score: payload.coverage_score,
                                                registered_condition_count: payload.registered_condition_count,
                                                source_mapped_condition_count: payload.source_mapped_condition_count,
                                                one_health_edge_count: payload.one_health_edge_count,
                                                blockers: payload.blockers,
                                                warnings: payload.warnings,
                                                created_at: '2026-07-06T00:00:00.000Z',
                                            },
                                            error: null,
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            },
        };

        const coverage: GlobalConditionCoverageReport = {
            status: 'partial',
            score: 0.42,
            registry_scope: 'closed_world',
            canonical_species: 'avian',
            input_species: 'avian',
            registered_candidate_count: 6,
            source_backed_count: 12,
            one_health_source_count: 5,
            human_correlation_requested: true,
            one_health_review_required: true,
            open_world_candidate_generation: 'missing',
            candidate_expansion_status: 'source_hints_only',
            candidate_expansion_hints: [
                {
                    source_key: 'woah_terrestrial_manual',
                    source_name: 'WOAH Terrestrial Manual',
                    source_type: 'guideline',
                    authority_tier: 'specialist_guideline',
                    species_scope: ['avian'],
                    medicine_domain: ['infectious_disease', 'surveillance', 'one_health'],
                    reason: 'One Health or surveillance source matched species/context.',
                },
            ],
            condition_candidate_status: 'seeded_source_candidates',
            condition_candidate_hints: [
                {
                    condition_key: 'highly_pathogenic_avian_influenza',
                    canonical_name: 'Highly pathogenic avian influenza',
                    condition_domain: 'infectious',
                    species_scope: ['avian', 'wildlife', 'human'],
                    host_scope: ['poultry', 'wild_bird', 'human'],
                    human_relevance: 'zoonotic',
                    zoonotic_role: 'spillover_host',
                    amr_relevance: 'none_known',
                    source_keys: ['woah_wahis', 'woah_terrestrial_manual'],
                    matched_terms: ['outbreak', 'wildlife'],
                    reason: 'Matched outbreak and wildlife. Candidate is source-seeded only.',
                },
            ],
            blockers: ['open_world_candidate_generation_missing', 'one_health_condition_edges_not_materialized'],
            warnings: ['Current inference candidates come from the local closed-world condition registry.'],
            recommended_next_action: 'Use current inference only as closed-world decision support.',
        };

        const result = await recordConditionCoverageSnapshotEvent(client, {
            tenantId: '00000000-0000-4000-8000-000000000001',
            requestId: 'coverage-request-1',
            inferenceEventId: '00000000-0000-4000-8000-000000000002',
            coverage,
        });

        expect(result.error).toBeNull();
        expect(result.data).toMatchObject({
            request_id: 'coverage-request-1',
            coverage_status: 'partial',
            open_world_candidate_generation_status: 'missing',
            one_health_edge_count: 0,
        });
        expect(inserted?.source_manifest_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(inserted?.coverage_packet).toMatchObject({
            inference_event_id: '00000000-0000-4000-8000-000000000002',
            registry_scope: 'closed_world',
            human_correlation_requested: true,
            condition_candidate_status: 'seeded_source_candidates',
            condition_hints: [
                {
                    condition_key: 'highly_pathogenic_avian_influenza',
                    human_relevance: 'zoonotic',
                },
            ],
        });
    });
});
