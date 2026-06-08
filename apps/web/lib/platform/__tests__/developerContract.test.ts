import { describe, expect, it } from 'vitest';
import {
    DEVELOPER_CONTRACT_KEY,
    DEVELOPER_CONTRACT_VERSION,
    getDeveloperContract,
    getDeveloperContractSummary,
    getDeveloperOpenApiDocument,
    getDeveloperOpenApiYaml,
    partnerContractEndpoints,
} from '@/lib/platform/developerContract';

const BASE_URL = 'https://www.vetios.tech';

describe('developer contract OpenAPI surface', () => {
    it('publishes generated OpenAPI URLs from the same contract source of truth', () => {
        const contract = getDeveloperContract(BASE_URL);
        const summary = getDeveloperContractSummary(BASE_URL);

        expect(contract.openapi_url).toBe(`${BASE_URL}/api/public/developer-openapi.yaml`);
        expect(contract.openapi_json_url).toBe(`${BASE_URL}/api/public/developer-openapi`);
        expect(contract.openapi_yaml_url).toBe(`${BASE_URL}/api/public/developer-openapi.yaml`);
        expect(summary.openapi_url).toBe(contract.openapi_url);
        expect(summary.openapi_json_url).toBe(contract.openapi_json_url);
        expect(summary.endpoint_count).toBe(partnerContractEndpoints.length);
    });

    it('covers every partner contract endpoint in the generated OpenAPI document', () => {
        const openapi = getDeveloperOpenApiDocument(BASE_URL);
        const paths = readRecord(openapi.paths);

        expect(openapi.openapi).toBe('3.0.3');
        expect(openapi['x-vetios-contract-key']).toBe(DEVELOPER_CONTRACT_KEY);
        expect(openapi['x-vetios-contract-version']).toBe(DEVELOPER_CONTRACT_VERSION);

        for (const endpoint of partnerContractEndpoints) {
            const pathItem = readRecord(paths[endpoint.path]);
            const operation = readRecord(pathItem[endpoint.method]);
            expect(operation.operationId).toBe(endpoint.operationId);
            expect(operation['x-vetios-scope']).toBe(endpoint.scope);
            expect(operation['x-vetios-billable']).toBe(endpoint.billable);
        }
    });

    it('renders YAML that OpenAPI tooling can discover without the stale static spec', () => {
        const yaml = getDeveloperOpenApiYaml(BASE_URL);

        expect(yaml).toContain('openapi: "3.0.3"');
        expect(yaml).toContain('title: "VetIOS Partner API"');
        expect(yaml).toContain('/api/v1/inference/differential:');
        expect(yaml).toContain('PartnerApiKey:');
        expect(yaml).toContain('bearerFormat: "vios_k1"');
    });
});

function readRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
