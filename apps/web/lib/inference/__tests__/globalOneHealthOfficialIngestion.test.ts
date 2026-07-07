import { describe, expect, it } from 'vitest';
import {
    OFFICIAL_ONTOLOGY_PROVIDERS,
    buildOfficialOntologyIngestionPlan,
    buildVerifiedExternalMappingRows,
    extractOboJsonMatches,
    fetchOfficialOntologyMatches,
} from '../globalOneHealthOfficialIngestion';

const mondoProvider = OFFICIAL_ONTOLOGY_PROVIDERS.find((provider) => provider.provider_key === 'mondo_obo_json')!;

describe('global One Health official ontology ingestion', () => {
    it('extracts verified condition mappings only from official artifact nodes', () => {
        const matches = extractOboJsonMatches({
            provider: mondoProvider,
            payload: {
                graphs: [
                    {
                        nodes: [
                            {
                                id: 'http://purl.obolibrary.org/obo/MONDO_0005091',
                                lbl: 'rabies',
                                meta: {
                                    synonyms: [{ val: 'hydrophobia' }],
                                },
                            },
                            {
                                id: 'http://purl.obolibrary.org/obo/MONDO_9999999',
                                lbl: 'unrelated placeholder',
                            },
                        ],
                    },
                ],
            },
            conditionKeys: new Set(['rabies']),
        });

        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
            condition_key: 'rabies',
            code_system: 'MONDO',
            external_code: 'MONDO:0005091',
            match_basis: 'label',
            source_key: 'mondo_disease_ontology',
        });
        expect(matches[0].source_document_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does not pretend credentialed, release-gated, or surveillance providers are complete', () => {
        const plan = buildOfficialOntologyIngestionPlan({});
        expect(plan.find((provider) => provider.provider_key === 'who_icd_11_api')?.status).toBe('requires_credentials');
        expect(plan.find((provider) => provider.provider_key === 'umls_rest')?.status).toBe('requires_credentials');
        expect(plan.find((provider) => provider.provider_key === 'hpo_obo_json')?.status).toBe('ready');
        expect(plan.find((provider) => provider.provider_key === 'woah_wahis_official_export')?.status).toBe('requires_source_release');
        expect(plan.find((provider) => provider.provider_key === 'snomed_ct_release')?.status).toBe('license_gated');
    });

    it('marks official release providers ready only when the release URL is configured', () => {
        const plan = buildOfficialOntologyIngestionPlan({
            WAHIS_EXPORT_URL: 'https://example.test/wahis.json',
            SNOMED_CT_RELEASE_URL: 'https://example.test/snomed.json',
            VENOM_RELEASE_URL: 'https://example.test/venom.json',
        });

        expect(plan.find((provider) => provider.provider_key === 'woah_wahis_official_export')?.status).toBe('ready');
        expect(plan.find((provider) => provider.provider_key === 'snomed_ct_release')?.status).toBe('ready');
        expect(plan.find((provider) => provider.provider_key === 'venom_release')?.status).toBe('ready');
    });

    it('fetches public OBO JSON providers and builds verified mapping rows', async () => {
        const fakeFetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            async json() {
                return {
                    graphs: [
                        {
                            nodes: [
                                {
                                    id: 'http://purl.obolibrary.org/obo/MONDO_0004979',
                                    lbl: 'anthrax',
                                },
                            ],
                        },
                    ],
                };
            },
        });

        const ingestion = await fetchOfficialOntologyMatches({
            fetchImpl: fakeFetch,
            providerKeys: ['mondo_obo_json'],
            conditionKeys: ['anthrax'],
        });

        expect(ingestion.errors).toEqual([]);
        expect(ingestion.matches).toHaveLength(1);
        const rows = buildVerifiedExternalMappingRows({
            matches: ingestion.matches,
            requestId: 'official-ingest-test',
            tenantId: '00000000-0000-4000-8000-000000000001',
        });

        expect(rows[0]).toMatchObject({
            condition_key: 'anthrax',
            source_key: 'mondo_disease_ontology',
            external_code_system: 'MONDO',
            external_code: 'MONDO:0004979',
            mapping_status: 'source_attested',
        });
    });

    it('uses UMLS REST exact search only when an API key is provided', async () => {
        const requestedUrls: string[] = [];
        const fakeFetch = async (url: string) => {
            requestedUrls.push(url);
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                async json() {
                    return {
                        result: {
                            results: [
                                {
                                    ui: 'C0034494',
                                    name: 'Rabies',
                                },
                            ],
                        },
                    };
                },
            };
        };

        const ingestion = await fetchOfficialOntologyMatches({
            fetchImpl: fakeFetch,
            providerKeys: ['umls_rest'],
            conditionKeys: ['rabies'],
            env: { UMLS_API_KEY: 'test-key' },
        });

        expect(requestedUrls[0]).toContain('apiKey=test-key');
        expect(ingestion.matches).toHaveLength(1);
        expect(ingestion.matches[0]).toMatchObject({
            condition_key: 'rabies',
            source_key: 'nlm_umls',
            code_system: 'UMLS',
            external_code: 'C0034494',
            match_basis: 'api_search',
        });
    });
});
