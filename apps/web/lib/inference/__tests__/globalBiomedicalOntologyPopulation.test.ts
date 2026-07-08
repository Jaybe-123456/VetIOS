import { describe, expect, it } from 'vitest';
import {
    buildGlobalBiomedicalOntologyPopulationRows,
    recordGlobalBiomedicalOntologyPopulationEvents,
} from '../globalBiomedicalOntologyPopulation';

describe('global biomedical ontology population importer', () => {
    it('imports official OBO JSON release nodes, relationships, and population snapshot rows', async () => {
        const fakeFetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            async json() {
                return {
                    version: '2026-07-06',
                    graphs: [
                        {
                            id: 'http://purl.obolibrary.org/obo/mondo.owl',
                            nodes: [
                                {
                                    id: 'http://purl.obolibrary.org/obo/MONDO_0005091',
                                    lbl: 'rabies',
                                    meta: {
                                        synonyms: [{ val: 'hydrophobia' }],
                                        xrefs: [{ val: 'UMLS:C0034494' }],
                                    },
                                },
                                {
                                    id: 'http://purl.obolibrary.org/obo/MONDO_0004979',
                                    lbl: 'anthrax',
                                },
                            ],
                            edges: [
                                {
                                    sub: 'http://purl.obolibrary.org/obo/MONDO_0005091',
                                    pred: 'is_a',
                                    obj: 'http://purl.obolibrary.org/obo/MONDO_0000001',
                                },
                            ],
                        },
                    ],
                };
            },
        });

        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            tenantId: '00000000-0000-4000-8000-000000000001',
            requestId: 'population-test',
            providerKeys: ['mondo_obo_json'],
            fetchImpl: fakeFetch,
        });

        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows).toHaveLength(2);
        expect(rows.relationshipRows).toHaveLength(1);
        expect(rows.nodeRows[0]).toMatchObject({
            provider_key: 'mondo_obo_json',
            code_system: 'MONDO',
            external_code: 'MONDO:0005091',
            canonical_label: 'rabies',
            synonyms: ['hydrophobia'],
            xrefs: ['UMLS:C0034494'],
        });
        expect(rows.relationshipRows[0]).toMatchObject({
            subject_code: 'MONDO:0005091',
            predicate: 'is_a',
        });
        expect(rows.snapshotRow).toMatchObject({
            population_status: 'public_sources_populated',
            imported_provider_count: 1,
            total_node_count: 2,
            total_relationship_count: 1,
        });
        expect(rows.snapshotRow.source_manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('persists release, node, relationship, and snapshot rows in chunks', async () => {
        const inserted: Record<string, number> = {};
        const client = {
            from(table: string) {
                return {
                    async insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
                        inserted[table] = (inserted[table] ?? 0) + (Array.isArray(payload) ? payload.length : 1);
                        return { error: null };
                    },
                };
            },
        };

        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'population-persist-test',
            providerKeys: ['mondo_obo_json'],
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                statusText: 'OK',
                async json() {
                    return {
                        graphs: [
                            {
                                nodes: [
                                    { id: 'http://purl.obolibrary.org/obo/MONDO_0005091', lbl: 'rabies' },
                                ],
                                edges: [],
                            },
                        ],
                    };
                },
            }),
        });

        const result = await recordGlobalBiomedicalOntologyPopulationEvents(client, rows);

        expect(result.error).toBeNull();
        expect(inserted.official_ontology_release_events).toBe(1);
        expect(inserted.global_biomedical_ontology_node_events).toBe(1);
        expect(inserted.global_biomedical_ontology_population_snapshot_events).toBe(1);
    });

    it('imports PubMed evidence nodes through the NCBI E-utilities adapter', async () => {
        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'pubmed-population-test',
            providerKeys: ['pubmed_eutils'],
            maxNodesPerProvider: 2,
            fetchImpl: async (url) => {
                expect(url).toContain('eutils');
                expect(url).toContain('db=pubmed');
                return {
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    async json() {
                        return {
                            esearchresult: {
                                idlist: ['12345', '67890'],
                            },
                        };
                    },
                };
            },
        });

        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows).toHaveLength(2);
        expect(rows.nodeRows[0]).toMatchObject({
            provider_key: 'pubmed_eutils',
            code_system: 'PMID',
            external_code: 'PMID:12345',
            node_kind: 'literature_evidence',
        });
    });

    it('imports configured official JSON exports for surveillance and licensed release providers', async () => {
        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'wahis-population-test',
            providerKeys: ['woah_wahis_official_export'],
            env: {
                WAHIS_EXPORT_URL: 'https://example.test/wahis-export.json',
            },
            fetchImpl: async (url) => {
                expect(url).toBe('https://example.test/wahis-export.json');
                return {
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    async json() {
                        return {
                            records: [
                                {
                                    id: 'WAHIS-1',
                                    disease_name: 'Rabies',
                                    url: 'https://wahis.woah.org/',
                                },
                            ],
                        };
                    },
                };
            },
        });

        expect(rows.skippedProviders).toHaveLength(0);
        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows[0]).toMatchObject({
            provider_key: 'woah_wahis_official_export',
            code_system: 'WAHIS',
            external_code: 'WAHIS:WAHIS-1',
            canonical_label: 'Rabies',
            node_kind: 'surveillance_record',
        });
    });

    it('records a blocked WAHIS provider run when the export URL is missing', async () => {
        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'wahis-missing-url-test',
            providerKeys: ['woah_wahis_official_export'],
            env: {},
            fetchImpl: async () => {
                throw new Error('fetch should not run without WAHIS_EXPORT_URL');
            },
        });

        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows).toHaveLength(0);
        expect(rows.skippedProviders).toEqual([
            {
                provider_key: 'woah_wahis_official_export',
                reason: 'missing_export_url',
            },
        ]);
        expect(rows.releaseRows[0]).toMatchObject({
            provider_key: 'woah_wahis_official_export',
            release_status: 'blocked',
            license_status: 'blocked',
            imported_node_count: 0,
            blockers: ['missing_export_url:WAHIS_EXPORT_URL'],
        });
        expect(rows.releaseRows[0].release_packet).toMatchObject({
            provider_status: 'missing_export_url',
            expected_storage_path: 'ontology-provider-exports/wahis/latest.csv',
        });
        expect(rows.snapshotRow).toMatchObject({
            imported_provider_count: 0,
            blocked_provider_count: 1,
        });
    });

    it('auto-ingests WAHIS CSV exports with source hash and row-count evidence', async () => {
        const csv = [
            'event_id,disease_name,country,species,event_start_date,status,cases,deaths',
            'EVT-1,Rabies,Kenya,Canine,2026-07-01,ongoing,4,1',
            'EVT-2,Foot and mouth disease,Uganda,Bovine,2026-07-02,resolved,20,0',
            'EVT-3,,Tanzania,,2026-07-03,ongoing,,',
        ].join('\n');

        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'wahis-csv-test',
            providerKeys: ['woah_wahis_official_export'],
            env: {
                WAHIS_EXPORT_URL: 'https://example.test/storage/wahis/latest.csv',
            },
            fetchImpl: async (url) => {
                expect(url).toBe('https://example.test/storage/wahis/latest.csv');
                return {
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    headers: {
                        get(name: string) {
                            return name.toLowerCase() === 'content-type' ? 'text/csv' : null;
                        },
                    },
                    async json() {
                        throw new Error('csv should be read as text');
                    },
                    async text() {
                        return csv;
                    },
                };
            },
        });

        expect(rows.skippedProviders).toHaveLength(0);
        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows).toHaveLength(2);
        expect(rows.releaseRows[0]).toMatchObject({
            provider_key: 'woah_wahis_official_export',
            access_mode: 'public_dataset',
            release_status: 'partial',
            node_count: 3,
            imported_node_count: 2,
        });
        expect(rows.releaseRows[0].source_document_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(rows.releaseRows[0].release_packet).toMatchObject({
            provider_status: 'imported',
            parser: 'wahis_csv_export_v1',
            raw_rows: 3,
            imported_rows: 2,
            skipped_rows: 1,
        });
        expect(rows.nodeRows[0]).toMatchObject({
            provider_key: 'woah_wahis_official_export',
            code_system: 'WAHIS',
            external_code: 'WAHIS:EVT-1',
            canonical_label: 'Rabies · Kenya · Canine',
            node_kind: 'surveillance_record',
        });
    });

    it('records a blocked CDC Open Data run when the dataset URL is missing', async () => {
        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'cdc-missing-url-test',
            providerKeys: ['cdc_open_data_surveillance'],
            env: {},
            fetchImpl: async () => {
                throw new Error('fetch should not run without CDC_OPEN_DATA_URL');
            },
        });

        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows).toHaveLength(0);
        expect(rows.skippedProviders).toEqual([
            {
                provider_key: 'cdc_open_data_surveillance',
                reason: 'missing_open_data_url',
            },
        ]);
        expect(rows.releaseRows[0]).toMatchObject({
            provider_key: 'cdc_open_data_surveillance',
            release_status: 'blocked',
            license_status: 'blocked',
            imported_node_count: 0,
            blockers: ['missing_open_data_url:CDC_OPEN_DATA_URL'],
        });
        expect(rows.releaseRows[0].release_packet).toMatchObject({
            provider_status: 'missing_open_data_url',
            expected_url_shape: 'https://data.cdc.gov/resource/<dataset-id>.json',
        });
    });

    it('rejects the CDC Open Data catalog homepage because it is not an ingestable endpoint', async () => {
        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'cdc-portal-url-test',
            providerKeys: ['cdc_open_data_surveillance'],
            env: {
                CDC_OPEN_DATA_URL: 'https://data.cdc.gov/',
            },
            fetchImpl: async () => {
                throw new Error('fetch should not run for portal homepage');
            },
        });

        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows).toHaveLength(0);
        expect(rows.skippedProviders).toEqual([
            {
                provider_key: 'cdc_open_data_surveillance',
                reason: 'portal_url_not_dataset_endpoint',
            },
        ]);
        expect(rows.releaseRows[0]).toMatchObject({
            release_status: 'blocked',
            blockers: ['cdc_open_data_url_portal_url_not_dataset_endpoint'],
        });
        expect(rows.releaseRows[0].release_packet).toMatchObject({
            provider_status: 'portal_url_not_dataset_endpoint',
        });
    });

    it('auto-ingests CDC Socrata JSON endpoints with limit, app token, source hash, and row evidence', async () => {
        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'cdc-json-test',
            providerKeys: ['cdc_open_data_surveillance'],
            maxNodesPerProvider: 2,
            env: {
                CDC_OPEN_DATA_URL: 'https://data.cdc.gov/resource/abcd-1234.json',
                CDC_OPEN_DATA_APP_TOKEN: 'cdc-token',
            },
            fetchImpl: async (url, init) => {
                expect(url).toBe('https://data.cdc.gov/resource/abcd-1234.json?%24limit=2');
                expect(init?.headers).toEqual({ 'X-App-Token': 'cdc-token' });
                return {
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    headers: {
                        get(name: string) {
                            return name.toLowerCase() === 'content-type' ? 'application/json' : null;
                        },
                    },
                    async json() {
                        throw new Error('json endpoint should be read from text for stable hashing');
                    },
                    async text() {
                        return JSON.stringify([
                            {
                                id: 'CDC-1',
                                condition: 'Rabies exposure',
                                jurisdiction: 'United States',
                                population: 'Human',
                                week_end: '2026-07-04',
                                cases: '7',
                                deaths: '0',
                            },
                            {
                                id: 'CDC-2',
                                condition: 'Salmonellosis',
                                jurisdiction: 'United States',
                                population: 'Human',
                                week_end: '2026-07-04',
                                cases: '42',
                            },
                        ]);
                    },
                };
            },
        });

        expect(rows.skippedProviders).toHaveLength(0);
        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows).toHaveLength(2);
        expect(rows.releaseRows[0]).toMatchObject({
            provider_key: 'cdc_open_data_surveillance',
            access_mode: 'public_dataset',
            release_status: 'imported',
            node_count: 2,
            imported_node_count: 2,
        });
        expect(rows.releaseRows[0].source_document_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(rows.releaseRows[0].release_packet).toMatchObject({
            provider_status: 'imported',
            parser: 'cdc_socrata_json_v1',
            raw_rows: 2,
            imported_rows: 2,
            skipped_rows: 0,
            app_token_used: true,
        });
        expect(rows.nodeRows[0]).toMatchObject({
            provider_key: 'cdc_open_data_surveillance',
            code_system: 'CDC',
            external_code: 'CDC:CDC-1',
            canonical_label: 'Rabies exposure - United States - Human - 2026-07-04',
            node_kind: 'surveillance_record',
        });
    });

    it('auto-ingests CDC CSV exports and records skipped rows without condition signals', async () => {
        const csv = [
            'id,condition,state,date,cases,deaths',
            'CDC-10,Leptospirosis,Florida,2026-07-01,3,0',
            'CDC-11,,Georgia,2026-07-01,1,0',
        ].join('\n');

        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'cdc-csv-test',
            providerKeys: ['cdc_open_data_surveillance'],
            env: {
                CDC_OPEN_DATA_URL: 'https://data.cdc.gov/resource/wxyz-9876.csv',
            },
            fetchImpl: async (url) => {
                expect(url).toBe('https://data.cdc.gov/resource/wxyz-9876.csv');
                return {
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    headers: {
                        get(name: string) {
                            return name.toLowerCase() === 'content-type' ? 'text/csv' : null;
                        },
                    },
                    async json() {
                        throw new Error('csv should be read as text');
                    },
                    async text() {
                        return csv;
                    },
                };
            },
        });

        expect(rows.skippedProviders).toHaveLength(0);
        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows).toHaveLength(1);
        expect(rows.releaseRows[0]).toMatchObject({
            provider_key: 'cdc_open_data_surveillance',
            release_status: 'partial',
            node_count: 2,
            imported_node_count: 1,
        });
        expect(rows.releaseRows[0].release_packet).toMatchObject({
            provider_status: 'imported',
            parser: 'cdc_socrata_csv_v1',
            raw_rows: 2,
            imported_rows: 1,
            skipped_rows: 1,
        });
        expect(rows.nodeRows[0]).toMatchObject({
            external_code: 'CDC:CDC-10',
            canonical_label: 'Leptospirosis - Florida - 2026-07-01',
            node_kind: 'surveillance_record',
        });
    });

    it('imports ICD-11 nodes through the credentialed WHO API adapter', async () => {
        const requestedUrls: string[] = [];
        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            requestId: 'icd-population-test',
            providerKeys: ['who_icd_11_api'],
            env: {
                WHO_ICD_CLIENT_ID: 'client',
                WHO_ICD_CLIENT_SECRET: 'secret',
            },
            fetchImpl: async (url) => {
                requestedUrls.push(url);
                if (url.includes('connect/token')) {
                    return {
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        async json() {
                            return { access_token: 'token' };
                        },
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    async json() {
                        return {
                            destinationEntities: [
                                {
                                    id: 'https://id.who.int/icd/entity/123',
                                    theCode: '1A00',
                                    title: { '@value': '<em>Cholera</em>' },
                                },
                            ],
                        };
                    },
                };
            },
        });

        expect(requestedUrls[0]).toContain('connect/token');
        expect(requestedUrls[1]).toContain('/icd/release/11/mms/search');
        expect(rows.releaseRows).toHaveLength(1);
        expect(rows.nodeRows[0]).toMatchObject({
            provider_key: 'who_icd_11_api',
            code_system: 'ICD-11',
            external_code: 'ICD-11:1A00',
            canonical_label: 'Cholera',
            node_kind: 'class',
        });
    });
});
