import type {
    AlertCreateRequest,
    AlertRecord,
    ApiEnvelope,
    DatasetSnapshot,
    DatasetStatsResponse,
    EvaluationCreateRequest,
    EvaluationCreateResponse,
    EvaluationListResponse,
    GovernanceAuditEvent,
    GovernancePolicy,
    GovernancePolicyActivateRequest,
    GovernancePolicyCreateRequest,
    InferenceBlockedResponse,
    InferenceCreateRequest,
    InferenceCreateResponse,
    InferenceListItem,
    ModelVersionOption,
    OrphanCountResponse,
    OutcomeCreateRequest,
    OutcomeCreateResponse,
    PlatformTelemetryRecord,
    RateLimitExceeded,
    RequestOptions,
    SimulateRunRequest,
    SimulateRunResponse,
    SimulationProgress,
    SimulationRecord,
    SimulationRunRequest,
    TenantRateLimitConfig,
    TenantRateLimitUpdateRequest,
    WebhookCreateRequest,
    WebhookSubscription,
} from './types';

type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

export interface VetiosClientOptions {
    apiKey: string;
    tenantId: string;
    baseUrl?: string;
    fetch?: typeof fetch;
}

export class VetiosApiError extends Error {
    status: number;
    body: unknown;

    constructor(status: number, message: string, body: unknown) {
        super(message);
        this.name = 'VetiosApiError';
        this.status = status;
        this.body = body;
    }
}

export class VetiosClient {
    private readonly apiKey: string;
    private readonly tenantId: string;
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;

    readonly inference = {
        create: (body: InferenceCreateRequest, options?: RequestOptions) =>
            this.request<InferenceCreateResponse | InferenceBlockedResponse | RateLimitExceeded>('POST', '/api/inference', { body, ...options }),
        list: (params?: { tenant_id?: string; limit?: number; sort?: string }, options?: RequestOptions) =>
            this.request<ApiEnvelope<InferenceListItem[]>>('GET', '/api/inference', { query: params, ...options }),
    };

    readonly outcome = {
        create: (body: OutcomeCreateRequest, options?: RequestOptions) =>
            this.request<OutcomeCreateResponse>('POST', '/api/outcome', { body, ...options }),
    };

    readonly simulate = {
        run: (body: SimulateRunRequest, options?: RequestOptions) =>
            this.request<SimulateRunResponse | RateLimitExceeded>('POST', '/api/simulate', { body, ...options }),
    };

    readonly evaluation = {
        create: (body: EvaluationCreateRequest, options?: RequestOptions) =>
            this.request<ApiEnvelope<EvaluationCreateResponse>>('POST', '/api/evaluation', { body, ...options }),
        list: (params?: { tenant_id?: string; model_version?: string; limit?: number }, options?: RequestOptions) =>
            this.request<ApiEnvelope<EvaluationListResponse>>('GET', '/api/evaluation', { query: params, ...options }),
        backfill: (body: { inference_event_id?: string | null; tenant_id?: string | null }, options?: RequestOptions) =>
            this.request<ApiEnvelope<EvaluationCreateResponse[]>>('POST', '/api/evaluation/backfill', { body, ...options }),
    };

    readonly datasets = {
        stats: (options?: RequestOptions) =>
            this.request<DatasetStatsResponse>('GET', '/api/datasets/stats', options),
        versions: (params?: { tenant_id?: string }, options?: RequestOptions) =>
            this.request<ApiEnvelope<DatasetSnapshot[]>>('GET', '/api/datasets/versions', { query: params, ...options }),
    };

    readonly events = {
        orphanCount: (options?: RequestOptions) =>
            this.request<OrphanCountResponse>('GET', '/api/events/orphans/count', options),
    };

    readonly governance = {
        audit: {
            list: (params?: { tenant_id?: string; page?: string; limit?: number }, options?: RequestOptions) =>
                this.request<ApiEnvelope<GovernanceAuditEvent[]>>('GET', '/api/governance/audit', { query: params, ...options }),
        },
        policy: {
            list: (params?: { tenant_id?: string }, options?: RequestOptions) =>
                this.request<ApiEnvelope<GovernancePolicy[]>>('GET', '/api/governance/policy', { query: params, ...options }),
            create: (body: GovernancePolicyCreateRequest, options?: RequestOptions) =>
                this.request<ApiEnvelope<GovernancePolicy>>('POST', '/api/governance/policy', { body, ...options }),
            activate: (policyId: string, body: GovernancePolicyActivateRequest = {}, options?: RequestOptions) =>
                this.request<ApiEnvelope<GovernancePolicy>>('POST', `/api/governance/policy/${policyId}/activate`, { body, ...options }),
        },
    };

    readonly telemetry = {
        streamUrl: (params?: { tenant_id?: string }) => this.buildUrl('/api/telemetry/stream', params).toString(),
    };

    readonly alerts = {
        create: (body: AlertCreateRequest, options?: RequestOptions) =>
            this.request<ApiEnvelope<AlertRecord>>('POST', '/api/alerts', { body, ...options }),
    };

    readonly rateLimits = {
        get: (params?: { tenant_id?: string }, options?: RequestOptions) =>
            this.request<ApiEnvelope<TenantRateLimitConfig>>('GET', '/api/rate-limits', { query: params, ...options }),
        update: (body: TenantRateLimitUpdateRequest, options?: RequestOptions) =>
            this.request<ApiEnvelope<TenantRateLimitConfig>>('POST', '/api/rate-limits', { body, ...options }),
    };

    readonly models = {
        available: (params?: { tenant_id?: string }, options?: RequestOptions) =>
            this.request<ApiEnvelope<ModelVersionOption[]>>('GET', '/api/models/available', { query: params, ...options }),
    };

    readonly webhooks = {
        list: (params?: { tenant_id?: string }, options?: RequestOptions) =>
            this.request<ApiEnvelope<WebhookSubscription[]>>('GET', '/api/webhooks', { query: params, ...options }),
        create: (body: WebhookCreateRequest, options?: RequestOptions) =>
            this.request<ApiEnvelope<WebhookSubscription>>('POST', '/api/webhooks', { body, ...options }),
        delete: (id: string, params?: { tenant_id?: string }, options?: RequestOptions) =>
            this.request<ApiEnvelope<WebhookSubscription | null>>('DELETE', `/api/webhooks/${id}`, { query: params, ...options }),
    };

    readonly simulations = {
        run: (body: SimulationRunRequest, options?: RequestOptions) =>
            this.request<ApiEnvelope<SimulationRecord>>('POST', '/api/simulations/run', { body, ...options }),
        progressUrl: (id: string, params?: { tenant_id?: string }) => this.buildUrl(`/api/simulations/${id}/progress`, params).toString(),
    };

    constructor(options: VetiosClientOptions) {
        this.apiKey = options.apiKey;
        this.tenantId = options.tenantId;
        this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'http://localhost:3000');
        this.fetchImpl = options.fetch ?? fetch;
    }

    private buildUrl(path: string, query?: Record<string, QueryValue>) {
        const url = new URL(path, this.baseUrl);
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value == null) {
                    continue;
                }
                if (Array.isArray(value)) {
                    for (const entry of value) {
                        url.searchParams.append(key, String(entry));
                    }
                    continue;
                }
                url.searchParams.set(key, String(value));
            }
        }
        return url;
    }

    private async request<T>(
        method: 'GET' | 'POST' | 'DELETE',
        path: string,
        config: {
            body?: unknown;
            query?: Record<string, QueryValue>;
            signal?: AbortSignal;
        } = {},
    ): Promise<T> {
        const response = await this.fetchImpl(this.buildUrl(path, config.query), {
            method,
            headers: {
                Authorization: formatAuthorizationHeader(this.apiKey),
                'Content-Type': 'application/json',
                'X-Tenant-Scope': this.tenantId,
            },
            body: config.body == null ? undefined : JSON.stringify(config.body),
            signal: config.signal,
        });

        const parsedBody = await parseJsonResponse(response);
        if (!response.ok) {
            throw new VetiosApiError(
                response.status,
                resolveErrorMessage(parsedBody, `Vetios request failed with HTTP ${response.status}.`),
                parsedBody,
            );
        }

        return parsedBody as T;
    }
}

async function parseJsonResponse(response: Response) {
    const text = await response.text();
    if (!text.trim()) {
        return null;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { raw: text };
    }
}

function resolveErrorMessage(body: unknown, fallback: string) {
    if (typeof body === 'string' && body.trim().length > 0) {
        return body;
    }

    if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        const envelopeError = record.error;
        if (typeof envelopeError === 'object' && envelopeError !== null && 'message' in envelopeError) {
            const message = (envelopeError as Record<string, unknown>).message;
            if (typeof message === 'string' && message.trim().length > 0) {
                return message;
            }
        }

        if (typeof record.error === 'string' && record.error.trim().length > 0) {
            return record.error;
        }

        if (typeof record.reason === 'string' && record.reason.trim().length > 0) {
            return record.reason;
        }
    }

    return fallback;
}

function normalizeBaseUrl(baseUrl: string) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function formatAuthorizationHeader(apiKey: string) {
    return /^Bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`;
}

export type {
    AlertCreateRequest,
    AlertRecord,
    ApiEnvelope,
    DatasetSnapshot,
    DatasetStatsResponse,
    EvaluationCreateRequest,
    EvaluationCreateResponse,
    EvaluationListResponse,
    GovernanceAuditEvent,
    GovernancePolicy,
    GovernancePolicyActivateRequest,
    GovernancePolicyCreateRequest,
    InferenceBlockedResponse,
    InferenceCreateRequest,
    InferenceCreateResponse,
    InferenceListItem,
    ModelVersionOption,
    OrphanCountResponse,
    OutcomeCreateRequest,
    OutcomeCreateResponse,
    PlatformTelemetryRecord,
    RateLimitExceeded,
    SimulateRunRequest,
    SimulateRunResponse,
    SimulationProgress,
    SimulationRecord,
    SimulationRunRequest,
    TenantRateLimitConfig,
    TenantRateLimitUpdateRequest,
    WebhookCreateRequest,
    WebhookSubscription,
};
