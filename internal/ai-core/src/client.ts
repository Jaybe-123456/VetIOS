/**
 * @vetios/ai-core — VetAIClient
 *
 * Model-agnostic abstraction layer for AI provider calls.
 * Implements the AI Gateway pattern: all LLM interactions go through this client.
 *
 * Supports:
 *   - OpenAI-compatible chat completion API (default)
 *   - Embedding generation
 *   - Retry with exponential backoff
 *   - Circuit breaker integration
 *   - Provider fallback chain
 */

import { createLogger } from '@vetios/logger';
import { CircuitBreaker, CircuitBreakerOpenError } from './circuit-breaker';

const logger = createLogger({ module: 'ai-core.client' });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AIProviderConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
    defaultEmbeddingModel?: string;
    maxRetries?: number;
    timeoutMs?: number;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface CompletionRequest {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: 'text' | 'json_object';
}

export interface CompletionResponse {
    content: string;
    model: string;
    provider: string;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    latency_ms: number;
}

export interface EmbeddingRequest {
    input: string | string[];
    model?: string;
}

export interface EmbeddingResponse {
    embeddings: number[][];
    model: string;
    provider: string;
    latency_ms: number;
}

// ─── Retry Logic ─────────────────────────────────────────────────────────────

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;

function calculateBackoff(attempt: number): number {
    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
    // Add jitter: ±25%
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Client Implementation ──────────────────────────────────────────────────

export class VetAIClient {
    private providers: AIProviderConfig[];
    private circuitBreaker: CircuitBreaker;

    constructor(providers: AIProviderConfig[], circuitBreaker?: CircuitBreaker) {
        if (providers.length === 0) {
            throw new Error('VetAIClient requires at least one AI provider configuration.');
        }
        this.providers = providers;
        this.circuitBreaker = circuitBreaker ?? new CircuitBreaker();
    }

    /**
     * Sends a chat completion request through the provider chain.
     * Tries each provider in order; if a provider's circuit is open, skips to the next.
     */
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const errors: Error[] = [];

        for (const provider of this.providers) {
            try {
                this.circuitBreaker.acquirePermission(provider.name);
                const result = await this.executeCompletion(provider, request);
                this.circuitBreaker.recordSuccess(provider.name);
                return result;
            } catch (err) {
                if (err instanceof CircuitBreakerOpenError) {
                    logger.warn('Provider circuit open, skipping', { provider: provider.name });
                    errors.push(err);
                    continue;
                }
                this.circuitBreaker.recordFailure(provider.name);
                logger.error('Provider completion failed', {
                    provider: provider.name,
                    error: err instanceof Error ? err.message : String(err),
                });
                errors.push(err instanceof Error ? err : new Error(String(err)));
            }
        }

        throw new AggregateAIError('All AI providers failed', errors);
    }

    /**
     * Generates embeddings through the provider chain.
     */
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        const errors: Error[] = [];

        for (const provider of this.providers) {
            try {
                this.circuitBreaker.acquirePermission(provider.name);
                const result = await this.executeEmbedding(provider, request);
                this.circuitBreaker.recordSuccess(provider.name);
                return result;
            } catch (err) {
                if (err instanceof CircuitBreakerOpenError) {
                    errors.push(err);
                    continue;
                }
                this.circuitBreaker.recordFailure(provider.name);
                errors.push(err instanceof Error ? err : new Error(String(err)));
            }
        }

        throw new AggregateAIError('All AI providers failed for embedding', errors);
    }

    // ─── Internal Methods ────────────────────────────────────────────────────

    private async executeCompletion(
        provider: AIProviderConfig,
        request: CompletionRequest,
    ): Promise<CompletionResponse> {
        const model = request.model ?? provider.defaultModel;
        const maxRetries = provider.maxRetries ?? 3;
        const timeoutMs = provider.timeoutMs ?? 30_000;

        const body = {
            model,
            messages: request.messages,
            temperature: request.temperature ?? 0.3,
            max_tokens: request.maxTokens ?? 2048,
            ...(request.responseFormat === 'json_object' && {
                response_format: { type: 'json_object' },
            }),
        };

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const startTime = Date.now();

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                const response = await fetch(`${provider.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${provider.apiKey}`,
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);
                const latency_ms = Date.now() - startTime;

                if (!response.ok) {
                    if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRetries) {
                        const backoff = calculateBackoff(attempt);
                        logger.warn('Retryable error, backing off', {
                            provider: provider.name,
                            status: response.status,
                            attempt,
                            backoff_ms: backoff,
                        });
                        await sleep(backoff);
                        continue;
                    }
                    const errorBody = await response.text();
                    throw new Error(
                        `AI provider ${provider.name} returned ${response.status}: ${errorBody}`,
                    );
                }

                const json = (await response.json()) as {
                    choices: Array<{ message: { content: string } }>;
                    model: string;
                    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
                };

                const choice = json.choices[0];
                if (!choice) {
                    throw new Error('AI provider returned empty choices array.');
                }

                return {
                    content: choice.message.content,
                    model: json.model,
                    provider: provider.name,
                    usage: json.usage,
                    latency_ms,
                };
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') {
                    logger.warn('Request timed out', { provider: provider.name, timeoutMs, attempt });
                    if (attempt < maxRetries) {
                        await sleep(calculateBackoff(attempt));
                        continue;
                    }
                    throw new Error(`AI provider ${provider.name} timed out after ${timeoutMs}ms`);
                }
                if (attempt === maxRetries) throw err;
            }
        }

        throw new Error(`Exhausted all retries for provider ${provider.name}`);
    }

    private async executeEmbedding(
        provider: AIProviderConfig,
        request: EmbeddingRequest,
    ): Promise<EmbeddingResponse> {
        const model = request.model ?? provider.defaultEmbeddingModel ?? 'text-embedding-3-small';
        const timeoutMs = provider.timeoutMs ?? 30_000;

        const startTime = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`${provider.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify({
                model,
                input: request.input,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latency_ms = Date.now() - startTime;

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Embedding request failed: ${response.status} ${errorBody}`);
        }

        const json = (await response.json()) as {
            data: Array<{ embedding: number[] }>;
            model: string;
        };

        return {
            embeddings: json.data.map((d) => d.embedding),
            model: json.model,
            provider: provider.name,
            latency_ms,
        };
    }
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export class AggregateAIError extends Error {
    constructor(
        message: string,
        public readonly errors: Error[],
    ) {
        super(`${message}. Errors: ${errors.map((e) => e.message).join(' | ')}`);
        this.name = 'AggregateAIError';
    }
}
