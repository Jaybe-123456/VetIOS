import { describe, expect, it } from 'vitest';
import { buildAskVetiosContractResponse, detectEmergencyFlag } from '../responseContract';
import type { AskVetiosHeuristicResponse } from '../heuristicResponse';
import type { RagAnswerResult } from '@/lib/agenticRag/types';

describe('Ask Vetios response contract', () => {
    it('labels unsourced clinical differentials as model priors', () => {
        const response = buildAskVetiosContractResponse({
            sessionId: 'case-1',
            queryId: 'query-1',
            query: 'Dog vomiting and diarrhea',
            heuristic: heuristicFixture(),
            rag: null,
            startedAt: Date.now() - 10,
        });

        expect(response.session_id).toBe('case-1');
        expect(response.differentials[0].source_attribution).toEqual(['model_prior']);
        expect(response.flags.unsourced_priors).toContain('Canine parvovirus');
        expect(response.flags.requires_specialist_review).toBe(true);
        expect(response.rag_chunks_used).toBe(0);
    });

    it('attaches RAG source attribution when citations are available', () => {
        const response = buildAskVetiosContractResponse({
            sessionId: 'case-2',
            queryId: 'query-2',
            query: 'Dog vomiting and diarrhea',
            heuristic: heuristicFixture(),
            rag: ragFixture(),
            startedAt: Date.now() - 10,
        });

        expect(response.differentials[0].source_attribution[0]).toContain('VetIOS canine guideline');
        expect(response.narrative).toContain('[[Source: VetIOS canine guideline');
        expect(response.flags.unsourced_priors).toEqual([]);
        expect(response.rag_chunks_used).toBe(1);
    });

    it('detects emergency respiratory and toxin phrases', () => {
        expect(detectEmergencyFlag('Cat has open mouth breathing and blue gums')).toBe(true);
        expect(detectEmergencyFlag('Dog ate rat poison and collapsed')).toBe(true);
        expect(detectEmergencyFlag('Dog has mild itching')).toBe(false);
    });
});

function heuristicFixture(): AskVetiosHeuristicResponse {
    return {
        mode: 'clinical',
        content: 'Clinical signals detected. Running structured heuristic differential protocol.',
        metadata: {
            diagnosis_ranked: [
                { name: 'Canine parvovirus', confidence: 0.82, reasoning: 'Vomiting and diarrhea cluster.' },
                { name: 'Dietary indiscretion', confidence: 0.24, reasoning: 'Compatible but less specific.' },
            ],
            recommended_tests: ['CBC', 'chemistry', 'fecal testing'],
            red_flags: [],
        },
    };
}

function ragFixture(): RagAnswerResult {
    return {
        answer: 'Use CBC, chemistry, electrolytes, fecal testing, and parvovirus testing when risk factors are present.',
        answer_mode: 'extractive',
        plan: {
            strategy: 'hybrid',
            species: 'canine',
            domain: 'diagnostics',
            domain_filters: ['diagnostics'],
            requireCitations: true,
            safetyBoundary: 'clinical_decision_support',
            speciesFilterRequired: true,
            retrievalOrder: 'semantic_first_then_hybrid',
        },
        citations: [
            {
                index: 1,
                chunk_id: 'chunk-1',
                document_id: 'doc-1',
                source_id: 'source-1',
                title: 'Canine gastroenteritis workflow',
                source_name: 'VetIOS canine guideline',
                source_type: 'guideline',
                authority_tier: 'specialist_guideline',
                url: 'https://vetios.test/canine',
                year: '2026',
                quote: 'CBC, chemistry, electrolytes, fecal testing, and parvovirus testing are recommended.',
                similarity: 0.92,
                provenance: {},
            },
        ],
        retrieval_stats: {
            strategy: 'hybrid',
            vector_hits: 1,
            lexical_hits: 1,
            total_citations: 1,
            top_authority_tier: 'specialist_guideline',
            retrieval_time_ms: 12,
            semantic_first: true,
        },
        evaluation: {
            grounded: true,
            citation_coverage: 1,
            unsupported_claims: 0,
            warnings: [],
        },
        query_id: 'rag-query-1',
    };
}
