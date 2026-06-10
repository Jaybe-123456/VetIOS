import { describe, expect, it } from 'vitest';
import { buildAgenticRagMoatSnapshot } from '../moatSnapshot';
import type { RagReadinessSummary } from '../types';

const readyCorpus: RagReadinessSummary = {
    sources: 12,
    documents: 34,
    chunks: 480,
    high_authority_sources: 8,
    stale_documents: 0,
    last_refreshed_at: '2026-06-08T12:00:00.000Z',
    ready: true,
    warnings: [],
};

describe('Agentic RAG moat snapshots', () => {
    it('classifies a high-quality active RAG ledger as compounding', () => {
        const snapshot = buildAgenticRagMoatSnapshot({
            tenantId: 'tenant-1',
            readiness: readyCorpus,
            now: new Date('2026-06-09T12:00:00.000Z'),
            queryMetrics: {
                query_count_30d: 20,
                grounded_queries_30d: 18,
                grounding_rate: 0.9,
                citation_coverage_avg: 0.92,
                catalog_fallback_queries_30d: 2,
                catalog_fallback_rate: 0.1,
                withheld_citations_30d: 3,
                feedback_events_30d: 8,
                useful_feedback_30d: 7,
                needs_review_feedback_30d: 1,
                citation_usefulness_rate: 0.875,
                avg_retrieval_ms: 142.331,
                top_authority_tier: 'specialist_guideline',
                strategy_counts: {
                    hybrid: 12,
                    clinical_guideline: 8,
                },
            },
        });

        expect(snapshot.snapshot_key).toHaveLength(64);
        expect(snapshot.snapshot_date).toBe('2026-06-09');
        expect(snapshot.moat_status).toBe('compounding');
        expect(snapshot.evidence_freshness).toBe('fresh');
        expect(snapshot.grounding_rate).toBe(0.9);
        expect(snapshot.catalog_fallback_rate).toBe(0.1);
        expect(snapshot.feedback_events_30d).toBe(8);
        expect(snapshot.citation_usefulness_rate).toBe(0.875);
        expect(snapshot.avg_retrieval_ms).toBe(142.33);
        expect(snapshot.warnings).toEqual([]);
    });

    it('keeps the moat forming until citation usefulness feedback is active', () => {
        const snapshot = buildAgenticRagMoatSnapshot({
            tenantId: 'tenant-1',
            readiness: readyCorpus,
            now: new Date('2026-06-09T12:00:00.000Z'),
            queryMetrics: {
                query_count_30d: 20,
                grounded_queries_30d: 18,
                grounding_rate: 0.9,
                citation_coverage_avg: 0.92,
                catalog_fallback_queries_30d: 1,
                catalog_fallback_rate: 0.05,
                strategy_counts: {
                    hybrid: 20,
                },
            },
        });

        expect(snapshot.moat_status).toBe('forming');
        expect(snapshot.warnings).toContain('No citation usefulness feedback has been recorded for recent RAG answers.');
    });

    it('blocks the moat when the corpus is not indexed or high-authority', () => {
        const snapshot = buildAgenticRagMoatSnapshot({
            tenantId: 'tenant-1',
            readiness: {
                sources: 0,
                documents: 0,
                chunks: 0,
                high_authority_sources: 0,
                stale_documents: 0,
                last_refreshed_at: null,
                ready: false,
                warnings: ['No RAG sources are registered.'],
            },
            now: new Date('2026-06-09T12:00:00.000Z'),
        });

        expect(snapshot.moat_status).toBe('blocked');
        expect(snapshot.evidence_freshness).toBe('empty');
        expect(snapshot.warnings).toContain('Agentic RAG has no indexed evidence corpus yet.');
        expect(snapshot.warnings).toContain('No RAG query ledger activity in the last 30 days.');
    });

    it('does not persist raw questions, answers, or citation text in the aggregate snapshot', () => {
        const snapshot = buildAgenticRagMoatSnapshot({
            tenantId: 'tenant-1',
            readiness: readyCorpus,
            now: new Date('2026-06-09T12:00:00.000Z'),
            queryMetrics: {
                query_count_30d: 1,
                grounded_queries_30d: 1,
                grounding_rate: 1,
                citation_coverage_avg: 1,
                strategy_counts: {
                    'raw question: dog vomiting blood': 1,
                },
            },
        });

        const serialized = JSON.stringify(snapshot);
        expect(serialized).not.toContain('answer_text');
        expect(serialized).not.toContain('citation quote');
        expect(serialized).not.toContain('dog vomiting blood');
    });
});
