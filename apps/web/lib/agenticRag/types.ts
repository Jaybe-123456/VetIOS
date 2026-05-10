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
    external_key: string | null;
    name: string;
    source_type: RagSourceType;
    authority_tier: RagAuthorityTier;
    species_scope: string[];
    medicine_domain: string[];
    url: string | null;
    license: string | null;
    attribution: string | null;
    ingestion_policy: Record<string, unknown>;
    refresh_policy: Record<string, unknown>;
    quality_score: number;
    last_refreshed_at: string | null;
    next_refresh_at: string | null;
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
    auto_indexed: boolean;
    refresh_status: 'current' | 'stale' | 'failed';
    source_fetched_at: string | null;
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
    year: string | null;
    quote: string;
    similarity: number;
    provenance: Record<string, unknown>;
}

export interface RagDiagnosticRecommendation {
    rank: number;
    workflow_step:
        | 'labs'
        | 'imaging'
        | 'fecal_external_tests'
        | 'history_exam'
        | 'infectious_testing'
        | 'advanced_airway_diagnostics';
    recommendation: string;
    confidence: 'high' | 'medium' | 'low';
    citation_indexes: number[];
    rationale: string;
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
    domain_filters: string[];
    requireCitations: boolean;
    safetyBoundary: 'clinical_decision_support' | 'general_knowledge';
    speciesFilterRequired: boolean;
    retrievalOrder: 'semantic_first_then_hybrid';
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
        direct_lexical_hits?: number;
        total_citations: number;
        top_authority_tier: RagAuthorityTier | null;
        retrieval_time_ms: number;
        semantic_first: boolean;
        species_filtered_hits?: number;
        candidate_citations?: number;
        withheld_citations?: number;
    };
    evaluation: {
        grounded: boolean;
        citation_coverage: number;
        unsupported_claims: number;
        warnings: string[];
        top_recommendations?: RagDiagnosticRecommendation[];
        causal_memory_triggered?: boolean;
        counterfactual_reasoning_triggered?: boolean;
        causal_memory_linked?: boolean;
        counterfactual_reasoning_linked?: boolean;
        one_health_surveillance_linked?: boolean;
    };
    query_id: string | null;
}

export interface RagReadinessSummary {
    sources: number;
    documents: number;
    chunks: number;
    high_authority_sources: number;
    stale_documents: number;
    last_refreshed_at: string | null;
    ready: boolean;
    warnings: string[];
}
