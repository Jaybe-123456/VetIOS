import { createHash } from 'crypto';
import {
    getAiProviderApiKey,
    getAiProviderBaseUrl,
    shouldUseAiHeuristicFallback,
} from '@/lib/ai/config';

export interface RagEmbeddingResult {
    vector: number[];
    dimension: number;
    input_tokens: number;
    model: string;
    deterministic_fallback: boolean;
}

export interface RagEmbeddingReadiness {
    embedding_mode: 'live_provider' | 'deterministic_fallback';
    embedding_model: string;
    embedding_dimensions: number;
    embedding_live_provider_configured: boolean;
    warnings: string[];
}

const RAG_EMBEDDING_MODEL = process.env.VETIOS_RAG_EMBEDDING_MODEL || 'text-embedding-3-small';
const RAG_EMBEDDING_DIMENSIONS = 1536;

export function getRagEmbeddingReadiness(): RagEmbeddingReadiness {
    const heuristicFallback = shouldUseAiHeuristicFallback();
    const hasProviderKey = Boolean(process.env.OPENAI_API_KEY || process.env.AI_PROVIDER_API_KEY);
    const liveProviderConfigured = !heuristicFallback && hasProviderKey;
    const warnings: string[] = [];

    if (heuristicFallback) {
        warnings.push('RAG embeddings are using deterministic fallback mode; semantic retrieval quality is reduced until live embeddings are enabled.');
    } else if (!hasProviderKey) {
        warnings.push('RAG live embeddings are not configured. Set OPENAI_API_KEY or AI_PROVIDER_API_KEY for production semantic retrieval.');
    }

    return {
        embedding_mode: liveProviderConfigured ? 'live_provider' : 'deterministic_fallback',
        embedding_model: liveProviderConfigured ? RAG_EMBEDDING_MODEL : 'deterministic-vetios-rag-embedding',
        embedding_dimensions: RAG_EMBEDDING_DIMENSIONS,
        embedding_live_provider_configured: liveProviderConfigured,
        warnings,
    };
}

export async function embedRagText(text: string): Promise<RagEmbeddingResult> {
    if (shouldUseAiHeuristicFallback()) {
        return deterministicEmbedding(text);
    }

    const apiKey = getAiProviderApiKey();
    const baseUrl = getAiProviderBaseUrl();
    const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: RAG_EMBEDDING_MODEL,
            input: text,
            dimensions: RAG_EMBEDDING_DIMENSIONS,
        }),
    });

    if (!response.ok) {
        const detail = await readResponseText(response);
        throw new Error(`RAG embedding provider returned ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const data = await readJsonResponse(response, 'RAG embedding provider') as {
        data?: Array<{ embedding?: number[] }>;
        usage?: { total_tokens?: number };
    };
    const vector = data.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error('RAG embedding provider returned an empty vector.');
    }

    return {
        vector,
        dimension: vector.length,
        input_tokens: data.usage?.total_tokens ?? estimateTokens(text),
        model: RAG_EMBEDDING_MODEL,
        deterministic_fallback: false,
    };
}

function deterministicEmbedding(text: string): RagEmbeddingResult {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const vector = new Array<number>(RAG_EMBEDDING_DIMENSIONS).fill(0);
    const terms = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    for (const term of terms.length > 0 ? terms : [normalized || 'empty']) {
        const hash = createHash('sha256').update(term).digest();
        for (let i = 0; i < 8; i += 1) {
            const index = hash.readUInt16BE(i * 2) % RAG_EMBEDDING_DIMENSIONS;
            const direction = hash[i] % 2 === 0 ? 1 : -1;
            vector[index] += direction * (1 / Math.sqrt(Math.max(terms.length, 1)));
        }
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return {
        vector: vector.map((value) => Number((value / norm).toFixed(6))),
        dimension: RAG_EMBEDDING_DIMENSIONS,
        input_tokens: estimateTokens(text),
        model: 'deterministic-vetios-rag-embedding',
        deterministic_fallback: true,
    };
}

function estimateTokens(value: string): number {
    return Math.max(1, Math.ceil(value.length / 4));
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
    const text = await readResponseText(response);
    if (!text) throw new Error(`${label} returned an empty response.`);
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error(`${label} returned a non-JSON response: ${summarizeResponseText(text)}`);
    }
}

async function readResponseText(response: Response): Promise<string> {
    return response.text().catch(() => '');
}

function summarizeResponseText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}
