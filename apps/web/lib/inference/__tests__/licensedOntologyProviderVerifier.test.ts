import { describe, expect, it } from 'vitest';
import { verifyLicensedOntologyProviderOperations } from '../licensedOntologyProviderVerifier';

describe('licensed ontology provider verifier', () => {
    it('blocks licensed and credentialed providers when credentials or release URLs are missing', async () => {
        const packet = await verifyLicensedOntologyProviderOperations({
            env: {},
            fetchImpl: async () => {
                throw new Error('fetch should not run without configuration');
            },
        });

        expect(packet.summary.all_provider_operations_verified).toBe(false);
        expect(packet.summary.active_candidate_expansion_allowed).toBe(false);
        expect(packet.providers).toHaveLength(4);
        expect(packet.providers.find((provider) => provider.provider_key === 'umls_rest')).toMatchObject({
            status: 'missing_credentials',
            missing_env: ['UMLS_API_KEY'],
            inference_expansion: { allowed: false, mode: 'blocked' },
        });
        expect(packet.providers.find((provider) => provider.provider_key === 'snomed_ct_release')).toMatchObject({
            status: 'missing_release_url',
            missing_env: ['SNOMED_CT_RELEASE_URL'],
        });
        expect(packet.providers.find((provider) => provider.provider_key === 'venom_release')).toMatchObject({
            status: 'missing_release_url',
            missing_env: ['VENOM_RELEASE_URL'],
        });
    });

    it('verifies UMLS, ICD-11, SNOMED CT, and VeNom by exercising their fetch and parser paths', async () => {
        const requestedUrls: string[] = [];
        const packet = await verifyLicensedOntologyProviderOperations({
            env: {
                UMLS_API_KEY: 'umls-test-key',
                WHO_ICD_CLIENT_ID: 'icd-client',
                WHO_ICD_CLIENT_SECRET: 'icd-secret',
                SNOMED_CT_RELEASE_URL: 'https://example.test/licensed/snomed-rf2.json',
                VENOM_RELEASE_URL: 'https://example.test/licensed/venom.csv',
            },
            fetchImpl: async (url) => {
                requestedUrls.push(url);
                if (url.includes('uts-ws.nlm.nih.gov')) {
                    return jsonResponse({
                        result: {
                            results: [
                                {
                                    ui: 'C0034494',
                                    name: 'Rabies',
                                },
                            ],
                        },
                    });
                }
                if (url.includes('icdaccessmanagement.who.int')) {
                    return jsonResponse({ access_token: 'icd-token' });
                }
                if (url.includes('id.who.int/icd')) {
                    return jsonResponse({
                        destinationEntities: [
                            {
                                id: 'https://id.who.int/icd/entity/123',
                                theCode: '1A82',
                                title: 'Rabies',
                            },
                        ],
                    });
                }
                if (url === 'https://example.test/licensed/snomed-rf2.json') {
                    return jsonResponse({
                        concepts_tsv: [
                            'id\teffectiveTime\tactive\tmoduleId\tdefinitionStatusId',
                            '404684003\t20260131\t1\t900000000000207008\t900000000000074008',
                        ].join('\n'),
                        descriptions_tsv: [
                            'id\teffectiveTime\tactive\tmoduleId\tconceptId\tlanguageCode\ttypeId\tterm\tcaseSignificanceId',
                            '555\t20260131\t1\t900000000000207008\t404684003\ten\t900000000000013009\tClinical finding\t900000000000448009',
                        ].join('\n'),
                        relationships_tsv: [
                            'id\teffectiveTime\tactive\tmoduleId\tsourceId\tdestinationId\trelationshipGroup\ttypeId\tcharacteristicTypeId\tmodifierId',
                            '777\t20260131\t1\t900000000000207008\t404684003\t138875005\t0\t116680003\t900000000000011006\t900000000000451002',
                        ].join('\n'),
                    });
                }
                if (url === 'https://example.test/licensed/venom.csv') {
                    return textResponse([
                        'venom_id,term,status,parent_id,body_system,top_level_model',
                        'V001,Rabies,active,VROOT,Neurologic,Diagnosis',
                    ].join('\n'), 'text/csv');
                }
                throw new Error(`unexpected fetch: ${url}`);
            },
        });

        expect(requestedUrls.some((url) => url.includes('apiKey=umls-test-key'))).toBe(true);
        expect(packet.summary.all_provider_operations_verified).toBe(true);
        expect(packet.summary.active_candidate_expansion_allowed).toBe(false);
        expect(packet.providers.map((provider) => provider.status)).toEqual([
            'verified',
            'verified',
            'verified',
            'verified',
        ]);
        expect(packet.providers.find((provider) => provider.provider_key === 'who_icd_11_api')).toMatchObject({
            parser_version: 'who_icd_11_search_v1',
            imported_nodes: 1,
            inference_expansion: { allowed: true, mode: 'shadow' },
        });
        expect(packet.providers.find((provider) => provider.provider_key === 'snomed_ct_release')).toMatchObject({
            parser_version: 'snomed_ct_rf2_manifest_json_v1',
            imported_nodes: 1,
            imported_relationships: 1,
            inference_expansion: { allowed: true, mode: 'shadow' },
        });
        expect(packet.providers.find((provider) => provider.provider_key === 'venom_release')).toMatchObject({
            parser_version: 'venom_release_delimited_v1',
            imported_nodes: 1,
            imported_relationships: 1,
        });
        expect(packet.source_manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    });
});

function jsonResponse(payload: unknown) {
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
            return payload;
        },
        async text() {
            return JSON.stringify(payload);
        },
    };
}

function textResponse(text: string, contentType: string) {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
            get(name: string) {
                return name.toLowerCase() === 'content-type' ? contentType : null;
            },
        },
        async json() {
            throw new Error('text response should not be read as JSON');
        },
        async text() {
            return text;
        },
    };
}
