import { VETIOS_API_DEPRECATION_POLICY, VETIOS_API_SUPPORTED_VERSIONS, VETIOS_API_VERSION } from '@/lib/api/versioning';

type HttpMethod = 'get' | 'post';
type PartnerScope = 'inference' | 'outcomes' | 'dataset' | 'petpass' | 'simulation' | 'usage';

interface ContractEndpoint {
    method: HttpMethod;
    path: string;
    operationId: string;
    summary: string;
    scope: PartnerScope;
    billable: boolean;
    requestExample?: Record<string, unknown>;
}

export const DEVELOPER_CONTRACT_KEY = 'vetios-partner-api';
export const DEVELOPER_CONTRACT_VERSION = VETIOS_API_VERSION;

export const partnerContractEndpoints: ContractEndpoint[] = [
    {
        method: 'post',
        path: '/api/v1/inference/differential',
        operationId: 'createDifferentialDiagnosis',
        summary: 'Run a structured veterinary differential diagnosis request.',
        scope: 'inference',
        billable: true,
        requestExample: {
            species: 'canine',
            breed: 'Labrador Retriever',
            age_years: 4,
            sex: 'female_spayed',
            presenting_signs: ['vomiting', 'lethargy', 'bloody diarrhea'],
            history: 'Acute onset after kennel exposure.',
        },
    },
    {
        method: 'post',
        path: '/api/v1/inference/drug-check',
        operationId: 'createDrugCheck',
        summary: 'Check species-aware medication safety and interaction risk.',
        scope: 'inference',
        billable: true,
        requestExample: {
            species: 'canine',
            weight_kg: 18.2,
            medications: ['carprofen', 'prednisone'],
            diagnosis_context: 'acute orthopedic pain',
        },
    },
    {
        method: 'post',
        path: '/api/v1/inference/adversarial',
        operationId: 'createAdversarialInferenceRun',
        summary: 'Run adversarial or boundary-condition inference simulation.',
        scope: 'simulation',
        billable: true,
        requestExample: {
            species: 'feline',
            presenting_signs: ['dyspnea', 'open mouth breathing'],
            perturbations: ['low_history_detail', 'conflicting_temperature'],
        },
    },
    {
        method: 'post',
        path: '/api/v1/outcomes/contribute',
        operationId: 'contributeOutcome',
        summary: 'Attach a confirmed clinical outcome to a prior inference.',
        scope: 'outcomes',
        billable: true,
        requestExample: {
            inference_event_id: '11111111-1111-4111-8111-111111111111',
            confirmed_diagnosis: 'canine parvoviral enteritis',
            label_type: 'lab_confirmed',
            clinician_feedback_score: 0.93,
        },
    },
    {
        method: 'get',
        path: '/api/v1/dataset/prevalence',
        operationId: 'getDatasetPrevalence',
        summary: 'Read de-identified regional prevalence aggregates.',
        scope: 'dataset',
        billable: true,
    },
    {
        method: 'get',
        path: '/api/v1/models/card',
        operationId: 'getActiveModelCard',
        summary: 'Read the active model card and trust posture for partner review.',
        scope: 'inference',
        billable: true,
    },
    {
        method: 'post',
        path: '/api/v1/petpass/sync',
        operationId: 'syncPetPassVisit',
        summary: 'Push a de-identified visit summary into a PetPass timeline.',
        scope: 'petpass',
        billable: true,
        requestExample: {
            pet_id: 'pet_123',
            visit_date: '2026-06-06',
            summary: 'Annual wellness exam completed.',
            follow_up: ['vaccination booster in 12 months'],
        },
    },
    {
        method: 'get',
        path: '/api/v1/petpass/history/{pet_id}',
        operationId: 'getPetPassHistory',
        summary: 'Retrieve a PetPass health timeline for a linked pet.',
        scope: 'petpass',
        billable: true,
    },
    {
        method: 'get',
        path: '/api/v1/usage/quota',
        operationId: 'getPartnerQuotaUsage',
        summary: 'Read current API quota use and projected monthly consumption.',
        scope: 'usage',
        billable: false,
    },
    {
        method: 'get',
        path: '/api/v1/usage/analytics',
        operationId: 'getPartnerUsageAnalytics',
        summary: 'Read endpoint, error, latency, and billable usage analytics.',
        scope: 'usage',
        billable: false,
    },
];

export function getDeveloperContract(baseUrl = 'https://www.vetios.tech') {
    return {
        contract_key: DEVELOPER_CONTRACT_KEY,
        version: DEVELOPER_CONTRACT_VERSION,
        status: 'published',
        generated_at: new Date().toISOString(),
        base_url: baseUrl,
        openapi_url: `${baseUrl}/api-spec/openapi-v1.yaml`,
        json_contract_url: `${baseUrl}/api/public/developer-contract`,
        auth: {
            scheme: 'Bearer',
            token_prefix: 'vios_k1_',
            header: 'Authorization: Bearer vios_k1_...',
        },
        version_headers: {
            'API-Version': VETIOS_API_VERSION,
            'API-Supported-Versions': VETIOS_API_SUPPORTED_VERSIONS,
            'API-Deprecation-Policy': VETIOS_API_DEPRECATION_POLICY,
        },
        quota_headers: {
            'X-RateLimit-Limit': 'requests per minute',
            'X-RateLimit-Remaining': 'remaining requests in the current minute window',
            'X-RateLimit-Reset': 'unix timestamp for minute window reset',
            'X-Quota-Limit': 'requests per month',
            'X-Quota-Remaining': 'remaining requests in the current monthly window',
            'X-Quota-Reset': 'unix timestamp for monthly quota reset',
            'X-Partner-Plan': 'sandbox, clinic, research, or enterprise',
        },
        plans: [
            { name: 'sandbox', requests_per_minute: 10, requests_per_month: 500, burst_allowance: 5 },
            { name: 'clinic', requests_per_minute: 60, requests_per_month: 10000, burst_allowance: 20 },
            { name: 'research', requests_per_minute: 120, requests_per_month: 50000, burst_allowance: 50 },
            { name: 'enterprise', requests_per_minute: 1000, requests_per_month: 5000000, burst_allowance: 200 },
        ],
        endpoints: partnerContractEndpoints,
        openapi: buildOpenApiDocument(baseUrl),
    };
}

export function getDeveloperContractSummary(baseUrl = 'https://www.vetios.tech') {
    return {
        contract_key: DEVELOPER_CONTRACT_KEY,
        version: DEVELOPER_CONTRACT_VERSION,
        status: 'published',
        endpoint_count: partnerContractEndpoints.length,
        openapi_url: `${baseUrl}/api-spec/openapi-v1.yaml`,
        json_contract_url: `${baseUrl}/api/public/developer-contract`,
    };
}

function buildOpenApiDocument(baseUrl: string): Record<string, unknown> {
    const paths: Record<string, unknown> = {};

    for (const endpoint of partnerContractEndpoints) {
        const existing = readRecord(paths[endpoint.path]);
        paths[endpoint.path] = {
            ...existing,
            [endpoint.method]: buildOperation(endpoint),
        };
    }

    return {
        openapi: '3.0.3',
        info: {
            title: 'VetIOS Partner API',
            version: DEVELOPER_CONTRACT_VERSION,
            description: 'Versioned external contract for VetIOS partner clinical intelligence APIs.',
        },
        servers: [{ url: baseUrl, description: 'Production' }],
        security: [{ PartnerApiKey: [] }],
        paths,
        components: {
            securitySchemes: {
                PartnerApiKey: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'vios_k1',
                },
            },
            responses: {
                Unauthorized: {
                    description: 'Missing, invalid, expired, or revoked API key.',
                },
                Forbidden: {
                    description: 'Credential scope or partner plan does not allow the requested endpoint.',
                },
                RateLimited: {
                    description: 'Minute rate limit or monthly quota exceeded.',
                },
                Error: {
                    description: 'Structured error response.',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['error'],
                                properties: {
                                    error: { type: 'string' },
                                    message: { type: 'string' },
                                    request_id: { type: 'string' },
                                },
                            },
                        },
                    },
                },
            },
        },
    };
}

function buildOperation(endpoint: ContractEndpoint): Record<string, unknown> {
    return {
        operationId: endpoint.operationId,
        summary: endpoint.summary,
        tags: [endpoint.scope],
        security: [{ PartnerApiKey: [] }],
        'x-vetios-scope': endpoint.scope,
        'x-vetios-billable': endpoint.billable,
        parameters: endpoint.path.includes('{pet_id}')
            ? [{
                name: 'pet_id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
            }]
            : undefined,
        requestBody: endpoint.method === 'post'
            ? {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            additionalProperties: true,
                        },
                        example: endpoint.requestExample ?? {},
                    },
                },
            }
            : undefined,
        responses: {
            '200': {
                description: 'Successful VetIOS response.',
                headers: {
                    'API-Version': { schema: { type: 'string' } },
                    'X-RateLimit-Remaining': { schema: { type: 'string' } },
                    'X-Quota-Remaining': { schema: { type: 'string' } },
                },
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            additionalProperties: true,
                        },
                    },
                },
            },
            '400': { $ref: '#/components/responses/Error' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '500': { $ref: '#/components/responses/Error' },
        },
    };
}

function readRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
