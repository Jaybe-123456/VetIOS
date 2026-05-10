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

const RAG_EMBEDDING_MODEL = process.env.VETIOS_RAG_EMBEDDING_MODEL || 'text-embedding-3-small';
const RAG_EMBEDDING_DIMENSIONS = 1536;

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
        throw new Error(`RAG embedding provider returned ${response.status}`);
    }

    const data = (await response.json()) as {
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
