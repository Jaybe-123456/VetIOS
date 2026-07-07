import { describe, expect, it } from 'vitest';
import { recordOfficialOntologyIngestionRunEvent } from '../officialOntologyIngestionEvents';
import type { OfficialOntologyIngestionSummary } from '../globalOneHealthOfficialIngestion';

describe('official ontology ingestion run event writer', () => {
    it('persists provider readiness, skipped providers, and inserted mapping counts', async () => {
        let inserted: Record<string, unknown> | null = null;
        const client = {
            from(table: string) {
                expect(table).toBe('official_ontology_ingestion_run_events');
                return {
                    insert(payload: Record<string, unknown>) {
                        inserted = payload;
                        return {
                            select() {
                                return {
                                    async single() {
                                        return { data: { id: 'ingestion-run-1' }, error: null };
                                    },
                                };
                            },
                        };
                    },
                };
            },
        };

        const ingestion: OfficialOntologyIngestionSummary = {
            provider_plan: [
                {
                    provider_key: 'mondo_obo_json',
                    source_key: 'mondo_disease_ontology',
                    code_system: 'MONDO',
                    access: 'public_obo_json',
                    role: 'condition_code',
                    status: 'ready',
                    url: 'https://purl.obolibrary.org/obo/mondo.json',
                    required_env: [],
                },
                {
                    provider_key: 'snomed_ct_release',
                    source_key: 'snomed_ct',
                    code_system: 'SNOMEDCT',
                    access: 'licensed_release',
                    role: 'terminology_bridge',
                    status: 'license_gated',
                    url: 'https://www.snomed.org/',
                    required_env: [],
                },
            ],
            matches: [
                {
                    condition_key: 'rabies',
                    canonical_name: 'Rabies',
                    source_key: 'mondo_disease_ontology',
                    code_system: 'MONDO',
                    external_code: 'MONDO:0005091',
                    provider_key: 'mondo_obo_json',
                    matched_label: 'rabies',
                    matched_term: 'rabies',
                    match_basis: 'label',
                    mapping_confidence: 0.95,
                    source_document_hash: 'a'.repeat(64),
                },
            ],
            skipped_providers: [{ provider_key: 'snomed_ct_release', reason: 'license_gated' }],
            errors: [],
        };

        const result = await recordOfficialOntologyIngestionRunEvent(client, {
            tenantId: '00000000-0000-4000-8000-000000000001',
            requestId: 'official-ingestion-run-test',
            ingestion,
            insertedRows: 1,
            dryRun: false,
        });

        expect(result.error).toBeNull();
        expect(inserted).toMatchObject({
            ingestion_status: 'partial',
            ready_provider_count: 1,
            skipped_provider_count: 1,
            matched_condition_count: 1,
            verified_mapping_count: 1,
            inserted_mapping_count: 1,
            dry_run: false,
        });
        expect(inserted?.blockers).toContain('license_required:snomed_ct_release');
        expect(inserted?.source_manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    });
});
