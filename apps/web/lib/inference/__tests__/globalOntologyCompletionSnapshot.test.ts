import { describe, expect, it } from 'vitest';
import { buildGlobalOntologyCompletionSnapshot } from '../globalOntologyCompletionSnapshot';
import { OFFICIAL_ONTOLOGY_PROVIDERS } from '../globalOneHealthOfficialIngestion';

describe('global ontology completion snapshot', () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';

    it('blocks full completion when providers, reviews, validation, or coverage are missing', async () => {
        const result = await buildGlobalOntologyCompletionSnapshot(buildClient({
            official_ontology_release_events: [
                { provider_key: 'mondo_obo_json', release_status: 'imported' },
            ],
            global_condition_source_mapping_events: [
                { source_key: 'mondo_disease_ontology', mapping_status: 'source_attested' },
            ],
        }), {
            tenantId,
            requestId: 'completion-partial-test',
            env: {},
        });

        expect(result.snapshot.completion_status).toBe('partial');
        expect(result.snapshot.missing_provider_count).toBeGreaterThan(0);
        expect(result.snapshot.scoring_state).toBe('blocked_pending_review');
        expect(result.snapshot.blockers).toContain('no_reviewer_verified_mappings');
        expect(result.snapshot.blockers).toContain('no_external_validation_events');
        expect(result.snapshot.blockers).toContain('no_live_coverage_snapshots');
    });

    it('marks fully_populated only when required providers, external validation, and coverage exist', async () => {
        const releaseRows = OFFICIAL_ONTOLOGY_PROVIDERS
            .filter((provider) => provider.provider_key !== 'umls_rest')
            .map((provider) => ({
                provider_key: provider.provider_key,
                release_status: 'imported',
            }));
        const result = await buildGlobalOntologyCompletionSnapshot(buildClient({
            official_ontology_release_events: releaseRows,
            global_condition_source_mapping_events: [
                { source_key: 'nlm_umls', mapping_status: 'externally_verified' },
                { source_key: 'mondo_disease_ontology', mapping_status: 'source_attested' },
                { source_key: 'snomed_ct', mapping_status: 'reviewer_verified' },
            ],
            global_condition_source_mapping_review_events: [
                { review_status: 'reviewer_verified' },
            ],
            global_ontology_external_validation_events: [
                { validation_status: 'externally_verified' },
            ],
            condition_coverage_snapshot_events: [
                {
                    coverage_score: 0.96,
                    open_world_candidate_generation_status: 'shadow',
                },
            ],
        }), {
            tenantId,
            requestId: 'completion-full-test',
            env: {
                UMLS_API_KEY: 'umls',
                WHO_ICD_CLIENT_ID: 'icd-id',
                WHO_ICD_CLIENT_SECRET: 'icd-secret',
                WAHIS_EXPORT_URL: 'https://example.test/wahis.json',
                CDC_OPEN_DATA_URL: 'https://example.test/cdc.json',
                SNOMED_CT_RELEASE_URL: 'https://example.test/snomed.json',
                VENOM_RELEASE_URL: 'https://example.test/venom.json',
            },
        });

        expect(result.snapshot.missing_provider_count).toBe(0);
        expect(result.snapshot.completion_status).toBe('fully_populated');
        expect(result.snapshot.scoring_state).toBe('externally_verified_shadow');
        expect(result.snapshot.latest_coverage_score).toBe(0.96);
        expect(result.snapshot.source_manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    });
});

function buildClient(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
    return {
        from(table: string) {
            return {
                select() {
                    return {
                        eq() {
                            return {
                                order() {
                                    return {
                                        async limit() {
                                            return { data: rowsByTable[table] ?? [], error: null };
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
