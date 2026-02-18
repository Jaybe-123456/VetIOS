/**
 * @vetios/ai-core — RAG Engine
 *
 * Retrieval-Augmented Generation interface.
 * Queries the knowledge_vectors pgvector table for semantically similar content
 * to inject into the prompt context before AI inference.
 */

import type { TypedSupabaseClient, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';
import type { VetAIClient } from './client';

const logger = createLogger({ module: 'ai-core.rag' });

export interface RAGSearchOptions {
    /** Maximum number of results to return. Default: 5 */
    limit?: number;
    /** Minimum similarity threshold (0–1). Default: 0.7 */
    threshold?: number;
    /** Filter by content type (e.g., 'formulary', 'protocol', 'case_summary') */
    contentType?: string;
}

export interface RAGResult {
    id: string;
    content: string;
    content_type: string;
    metadata: Record<string, unknown>;
    similarity: number;
}

/**
 * Searches the knowledge vector store for content semantically similar to the query.
 *
 * Flow:
 * 1. Embed the query text using the AI client
 * 2. Query pgvector for nearest neighbors
 * 3. Return ranked results above the similarity threshold
 *
 * @param supabase - Typed Supabase client (with tenant context set)
 * @param aiClient - VetAIClient for generating query embeddings
 * @param query - Natural language search query
 * @param tenantId - Tenant ID (includes global knowledge where tenant_id is null)
 * @param options - Search configuration
 */
export async function searchKnowledge(
    supabase: TypedSupabaseClient,
    aiClient: VetAIClient,
    query: string,
    tenantId: string | null,
    options?: RAGSearchOptions,
): Promise<RAGResult[]> {
    const limit = options?.limit ?? 5;
    const threshold = options?.threshold ?? 0.7;

    // Step 1: Generate query embedding
    const embeddingResponse = await aiClient.embed({ input: query });
    const queryEmbedding = embeddingResponse.embeddings[0];

    if (!queryEmbedding) {
        logger.error('Failed to generate query embedding', { query });
        throw new Error('Embedding generation returned no results.');
    }

    // Step 2: Call the pgvector similarity search function
    const { data, error } = await supabase.rpc(
        'search_knowledge_vectors' as never,
        {
            query_embedding: JSON.stringify(queryEmbedding),
            match_tenant_id: tenantId,
            match_count: limit,
            match_threshold: threshold,
        } as never,
    );

    if (error) {
        logger.error('Knowledge vector search failed', { error, query });
        throw new Error(`RAG search failed: ${error.message}`);
    }

    const results = (data as unknown as RAGResult[]) ?? [];

    // Step 3: Filter by content type if specified
    const filtered = options?.contentType
        ? results.filter((r) => r.content_type === options.contentType)
        : results;

    logger.info('RAG search completed', {
        query_length: query.length,
        results_count: filtered.length,
        top_similarity: filtered[0]?.similarity ?? 0,
    });

    return filtered;
}

/**
 * Indexes a piece of knowledge into the vector store.
 *
 * @param supabase - Typed Supabase client
 * @param aiClient - VetAIClient for generating embeddings
 * @param content - The text content to index
 * @param contentType - Category of knowledge (e.g., 'formulary', 'protocol')
 * @param tenantId - Owning tenant (null for global knowledge)
 * @param metadata - Additional metadata
 */
export async function indexKnowledge(
    supabase: TypedSupabaseClient,
    aiClient: VetAIClient,
    content: string,
    contentType: string,
    tenantId: string | null,
    metadata: Json = {},
): Promise<string> {
    // Generate content hash for deduplication
    const contentHash = simpleHash(content);

    // Check for existing identical content
    const { data: existing } = await supabase
        .from('knowledge_vectors')
        .select('id')
        .eq('content_hash', contentHash)
        .single();

    if (existing) {
        logger.info('Knowledge already indexed, skipping', { content_hash: contentHash });
        return (existing as { id: string }).id;
    }

    // Generate embedding
    const embeddingResponse = await aiClient.embed({ input: content });
    const embedding = embeddingResponse.embeddings[0];

    if (!embedding) {
        throw new Error('Embedding generation returned no results for indexing.');
    }

    const { data, error } = await supabase
        .from('knowledge_vectors')
        .insert({
            tenant_id: tenantId,
            content_type: contentType,
            content_hash: contentHash,
            content,
            embedding: embedding as unknown as number[],
            metadata,
        })
        .select('id')
        .single();

    if (error || !data) {
        throw new Error(`Failed to index knowledge: ${error?.message ?? 'Unknown error'}`);
    }

    const result = data as { id: string };
    logger.info('Knowledge indexed', {
        knowledge_id: result.id,
        content_type: contentType,
        content_hash: contentHash,
    });

    return result.id;
}

/** Simple hash for content deduplication. */
function simpleHash(str: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
