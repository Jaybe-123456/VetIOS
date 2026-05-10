export type RagSourceType =
    | 'guideline'
    | 'journal'
    | 'textbook'
    | 'drug_label'
    | 'lab_reference'
    | 'clinical_protocol'
    | 'client_handout'
    | 'dataset'
    | 'web'
    | 'file'
    | 'other';

export type RagAuthorityTier =
    | 'peer_reviewed'
    | 'specialist_guideline'
    | 'regulatory'
    | 'institutional'
    | 'clinic_local'
    | 'unverified';

export type RagRetrievalStrategy = 'hybrid' | 'vector' | 'lexical' | 'clinical_guideline' | 'drug_safety' | 'lab_reference';

export interface RagSourceRecord {
    id: string;
    tenant_id: string;
    name: string;
    source_type: RagSourceType;
    authority_tier: RagAuthorityTier;
    species_scope: string[];
    medicine_domain: string[];
    url: string | null;
    license: string | null;
    attribution: string | null;
    ingestion_policy: Record<string, unknown>;
    status: 'active' | 'paused' | 'quarantined';
    created_at: string;
    updated_at: string;
}

export interface RagDocumentRecord {
    id: string;
    tenant_id: string;
    source_id: string;
    title: string;
    document_type: string;
    language: string;
    content_sha256: string;
    content_length: number;
    metadata: Record<string, unknown>;
    provenance: Record<string, unknown>;
    ingestion_status: 'pending' | 'indexed' | 'failed' | 'quarantined';
    error_message: string | null;
    indexed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface RagChunkRecord {
    id: string;
    tenant_id: string;
    source_id: string;
    document_id: string;
    chunk_index: number;
    chunk_text: string;
    chunk_hash: string;
    heading: string | null;
    token_estimate: number;
    embedding_model: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface RagCitation {
    index: number;
    chunk_id: string;
    document_id: string;
    source_id: string;
    title: string;
    source_name: string;
    source_type: RagSourceType;
    authority_tier: RagAuthorityTier;
    url: string | null;
    quote: string;
    similarity: number;
    provenance: Record<string, unknown>;
}

export interface RagRetrievedChunk {
    chunk_id: string;
    document_id: string;
    source_id: string;
    source_name: string;
    source_type: RagSourceType;
    authority_tier: RagAuthorityTier;
    title: string;
    url: string | null;
    chunk_index: number;
    chunk_text: string;
    similarity: number;
    metadata: Record<string, unknown>;
    provenance: Record<string, unknown>;
    created_at: string;
}

export interface RagQueryPlan {
    strategy: RagRetrievalStrategy;
    species: string | null;
    domain: string | null;
    requireCitations: boolean;
    safetyBoundary: 'clinical_decision_support' | 'general_knowledge';
}

export interface RagAnswerResult {
    answer: string;
    answer_mode: 'extractive';
    plan: RagQueryPlan;
    citations: RagCitation[];
    retrieval_stats: {
        strategy: RagRetrievalStrategy;
        vector_hits: number;
        lexical_hits: number;
        total_citations: number;
        top_authority_tier: RagAuthorityTier | null;
        retrieval_time_ms: number;
    };
    evaluation: {
        grounded: boolean;
        citation_coverage: number;
        unsupported_claims: number;
        warnings: string[];
    };
    query_id: string | null;
}
