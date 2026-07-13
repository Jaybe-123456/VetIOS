import { describe, expect, it } from 'vitest';
import { recordGlobalConditionExpansionEvent } from '../globalConditionExpansionEvents';
import type { GlobalConditionExpansionReport } from '../types';

describe('global condition expansion event writer', () => {
    it('persists review-gated verified expansion evidence without enabling probability scoring', async () => {
        let inserted: Record<string, unknown> | null = null;
        const client = {
            from(table: string) {
                expect(table).toBe('global_condition_expansion_events');
                return {
                    insert(payload: Record<string, unknown>) {
                        inserted = payload;
                        return {
                            select() {
                                return {
                                    async single() {
                                        return { data: { id: 'expansion-event-1' }, error: null };
                                    },
                                };
                            },
                        };
                    },
                };
            },
        };

        const expansion: GlobalConditionExpansionReport = {
            status: 'verified_candidates_available',
            expansion_mode: 'shadow',
            scoring_allowed: false,
            candidate_count: 1,
            verified_mapping_count: 1,
            source_attested_mapping_count: 1,
            reviewer_verified_mapping_count: 0,
            externally_verified_mapping_count: 0,
            graph_candidate_count: 0,
            graph_relationship_count: 0,
            candidate_keys: ['rabies'],
            verified_mappings: [
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
            graph_candidates: [],
            blockers: ['reviewer_verification_required_before_probability_scoring'],
            warnings: ['Expansion does not alter probabilities.'],
            active_expansion_required_evidence: [
                'reviewer_verified_source_mapping',
                'external_mapping_validation',
                'outcome_confirmed_case_evidence',
                'calibrated_candidate_expansion_audit',
            ],
            recommended_next_action: 'Show for clinician review.',
        };

        const result = await recordGlobalConditionExpansionEvent(client, {
            tenantId: '00000000-0000-4000-8000-000000000001',
            requestId: 'request-1:global_condition_expansion',
            inferenceEventId: '00000000-0000-4000-8000-000000000002',
            expansion,
        });

        expect(result.error).toBeNull();
        expect(inserted).toMatchObject({
            expansion_status: 'verified_candidates_available',
            probability_scoring_status: 'blocked_pending_review',
            reviewer_gate_status: 'required',
            verified_condition_keys: ['rabies'],
            verified_code_systems: ['MONDO'],
        });
        expect(inserted?.expansion_packet).toMatchObject({
            expansion_mode: 'shadow',
            scoring_allowed: false,
            source_attested_mapping_count: 1,
        });
        expect(inserted?.source_manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    });
});
