import { describe, expect, it } from 'vitest';
import { buildIngestionOperationsSnapshot } from '../ontologyIngestionOperations';

type TableRows = Record<string, Array<Record<string, unknown>>>;

function makeClient(rowsByTable: TableRows) {
    return {
        from(table: string) {
            return {
                select() {
                    return {
                        eq() {
                            return {
                                order() {
                                    return {
                                        async limit(limit: number) {
                                            return {
                                                data: (rowsByTable[table] ?? []).slice(0, limit),
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
        },
    };
}

describe('ontology ingestion operations snapshot', () => {
    it('summarizes provider configuration, latest run evidence, coverage, and inference expansion gates', async () => {
        const tenantId = '5254467f-ad37-4edc-8664-3c6ddc9c88b3';
        const sourceHash = 'a'.repeat(64);
        const mondoHash = 'b'.repeat(64);
        const client = makeClient({
            official_ontology_release_events: [
                {
                    provider_key: 'cdc_open_data_surveillance',
                    source_key: 'cdc_open_data',
                    code_system: 'CDC_OPEN_DATA',
                    source_url: 'https://data.cdc.gov/resource/demo.json',
                    release_status: 'imported',
                    source_document_hash: sourceHash,
                    node_count: 20,
                    relationship_count: 5,
                    imported_node_count: 20,
                    imported_relationship_count: 5,
                    release_packet: { parser: 'cdc_open_data_json_v1', raw_rows: 30, skipped_rows: 5 },
                    blockers: [],
                    warnings: [],
                    observed_at: '2026-07-09T00:00:00.000Z',
                    created_at: '2026-07-09T00:01:00.000Z',
                },
                {
                    provider_key: 'mondo_obo_json',
                    source_key: 'mondo_disease_ontology',
                    code_system: 'MONDO',
                    source_url: 'https://purl.obolibrary.org/obo/mondo.json',
                    release_status: 'imported',
                    source_document_hash: mondoHash,
                    node_count: 10,
                    relationship_count: 2,
                    imported_node_count: 10,
                    imported_relationship_count: 2,
                    release_packet: { parser: 'obo_json_v1', raw_rows: 12, skipped_rows: 0 },
                    blockers: [],
                    warnings: [],
                    observed_at: '2026-07-09T00:00:00.000Z',
                    created_at: '2026-07-09T00:00:30.000Z',
                },
            ],
            official_ontology_ingestion_run_events: [
                {
                    ingestion_status: 'partial',
                    provider_keys: ['cdc_open_data_surveillance', 'woah_wahis_official_export'],
                    ready_provider_count: 1,
                    skipped_provider_count: 1,
                    error_count: 0,
                    verified_mapping_count: 2,
                    inserted_mapping_count: 2,
                    dry_run: false,
                    blockers: ['source_release_required:woah_wahis_official_export'],
                    warnings: [],
                    ingestion_packet: {
                        skipped_providers: [
                            {
                                provider_key: 'woah_wahis_official_export',
                                reason: 'source_release_required',
                            },
                        ],
                    },
                    created_at: '2026-07-09T00:02:00.000Z',
                },
            ],
            global_biomedical_ontology_completion_snapshot_events: [
                {
                    completion_status: 'partial',
                    imported_provider_count: 2,
                    missing_provider_count: 7,
                    latest_coverage_score: 0.18,
                    open_world_candidate_generation_status: 'source_attested_shadow',
                    scoring_state: 'blocked_pending_review',
                    imported_provider_keys: ['cdc_open_data_surveillance', 'mondo_obo_json'],
                    missing_provider_keys: ['woah_wahis_official_export'],
                    blockers: ['reviewer_verification_required'],
                    warnings: [],
                    created_at: '2026-07-09T00:03:00.000Z',
                },
            ],
            global_biomedical_ontology_population_snapshot_events: [
                {
                    population_status: 'partial',
                    imported_provider_count: 2,
                    blocked_provider_count: 1,
                    total_node_count: 30,
                    total_relationship_count: 7,
                    source_manifest_hash: sourceHash,
                    created_at: '2026-07-09T00:04:00.000Z',
                },
            ],
            global_condition_source_mapping_events: [
                { source_key: 'cdc_open_data', mapping_status: 'source_attested', created_at: '2026-07-09T00:05:00.000Z' },
                { source_key: 'cdc_open_data', mapping_status: 'reviewer_verified', created_at: '2026-07-09T00:06:00.000Z' },
                { source_key: 'mondo_disease_ontology', mapping_status: 'reviewer_verified', created_at: '2026-07-09T00:07:00.000Z' },
            ],
        });

        const snapshot = await buildIngestionOperationsSnapshot({
            client,
            tenantId,
            env: {
                CDC_OPEN_DATA_URL: 'https://data.cdc.gov/resource/demo.json',
            },
        });

        const cdc = snapshot.providers.find((provider) => provider.provider_key === 'cdc_open_data_surveillance');
        const mondo = snapshot.providers.find((provider) => provider.provider_key === 'mondo_obo_json');
        const wahis = snapshot.providers.find((provider) => provider.provider_key === 'woah_wahis_official_export');

        expect(snapshot.summary.configured_count).toBeGreaterThanOrEqual(1);
        expect(snapshot.summary.imported_provider_count).toBe(2);
        expect(snapshot.summary.latest_completion_status).toBe('partial');
        expect(cdc).toMatchObject({
            configured: true,
            source_url: 'https://data.cdc.gov/resource/demo.json',
            source_hash: sourceHash,
            imported_rows: 25,
            skipped_rows: 5,
            raw_rows: 30,
            parser_version: 'cdc_open_data_json_v1',
        });
        expect(cdc?.latest_ontology_coverage.provider_imported).toBe(true);
        expect(cdc?.inference_expansion.mode).toBe('not_applicable');
        expect(cdc?.inference_expansion.allowed).toBe(false);
        expect(mondo?.inference_expansion.mode).toBe('shadow');
        expect(mondo?.inference_expansion.allowed).toBe(true);
        expect(wahis?.configured).toBe(false);
        expect(wahis?.configuration_status).toBe('missing_url');
        expect(wahis?.last_error_or_blocker).toBe('source_release_required:woah_wahis_official_export');
    });
});
