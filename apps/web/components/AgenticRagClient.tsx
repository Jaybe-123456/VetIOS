'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { BookOpenCheck, DatabaseZap, FileText, Loader2, RefreshCw, SearchCheck, ShieldCheck } from 'lucide-react';
import {
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
    TerminalTextarea,
} from '@/components/ui/terminal';

interface RagSource {
    id: string;
    external_key?: string | null;
    name: string;
    source_type: string;
    authority_tier: string;
    species_scope: string[];
    medicine_domain: string[];
    url: string | null;
    status: string;
}

interface RagDocument {
    id: string;
    title: string;
    source_id: string;
    ingestion_status: string;
    content_length: number;
    indexed_at: string | null;
}

interface RagReadiness {
    sources: number;
    documents: number;
    chunks: number;
    high_authority_sources: number;
    stale_documents: number;
    last_refreshed_at: string | null;
    embedding_mode?: 'live_provider' | 'deterministic_fallback';
    embedding_model?: string | null;
    embedding_dimensions?: number;
    embedding_live_provider_configured?: boolean;
    ready: boolean;
    warnings: string[];
}

interface CatalogSeedBatchResult {
    sources_indexed?: number;
    documents_indexed?: number;
    chunks_indexed?: number;
    errors?: Array<{ source: string; message: string }>;
    warnings?: string[];
    next_cursor?: string | null;
    has_more?: boolean;
}

interface RagCitation {
    index: number;
    title: string;
    source_name: string;
    authority_tier: string;
    url: string | null;
    quote: string;
    similarity: number;
}

interface RagQueryResult {
    answer: string;
    citations: RagCitation[];
    retrieval_stats: {
        strategy: string;
        vector_hits: number;
        lexical_hits: number;
        direct_lexical_hits?: number;
        catalog_fallback_hits?: number;
        candidate_citations?: number;
        withheld_citations?: number;
        total_citations: number;
        retrieval_time_ms: number;
    };
    evaluation: {
        grounded: boolean;
        warnings: string[];
        causal_memory_linked?: boolean;
        counterfactual_reasoning_linked?: boolean;
        one_health_surveillance_linked?: boolean;
    };
    query_id: string | null;
}

interface RagEmbeddingProbe {
    probe_ok: boolean;
    provider_reachable: boolean;
    deterministic_fallback_used: boolean;
    embedding_mode: 'live_provider' | 'deterministic_fallback';
    embedding_model: string;
    embedding_dimensions: number;
    embedding_live_provider_configured: boolean;
    latency_ms: number;
    vector_dimension_observed: number | null;
    vector_norm: number | null;
    error: string | null;
    warnings: string[];
}

interface AgenticRagMoatSnapshot {
    moat_status: 'compounding' | 'forming' | 'blocked';
    evidence_freshness: 'fresh' | 'stale' | 'empty';
    query_count_30d: number;
    grounded_queries_30d: number;
    grounding_rate: number;
    citation_coverage_avg: number;
    catalog_fallback_queries_30d: number;
    catalog_fallback_rate: number;
    withheld_citations_30d: number;
    feedback_events_30d?: number;
    useful_feedback_30d?: number;
    needs_review_feedback_30d?: number;
    citation_usefulness_rate?: number;
    avg_retrieval_ms: number | null;
    top_authority_tier: string | null;
    warnings: string[];
}

export default function AgenticRagClient() {
    const [sources, setSources] = useState<RagSource[]>([]);
    const [documents, setDocuments] = useState<RagDocument[]>([]);
    const [loadingSnapshot, setLoadingSnapshot] = useState(true);
    const [ingesting, setIngesting] = useState(false);
    const [querying, setQuerying] = useState(false);
    const [seedingCatalog, setSeedingCatalog] = useState(false);
    const [persistingMoat, setPersistingMoat] = useState(false);
    const [probingEmbeddings, setProbingEmbeddings] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [catalogErrors, setCatalogErrors] = useState<Array<{ source: string; message: string }>>([]);
    const [catalogCount, setCatalogCount] = useState(0);
    const [readiness, setReadiness] = useState<RagReadiness | null>(null);
    const [moatSnapshot, setMoatSnapshot] = useState<AgenticRagMoatSnapshot | null>(null);
    const [embeddingProbe, setEmbeddingProbe] = useState<RagEmbeddingProbe | null>(null);
    const [queryResult, setQueryResult] = useState<RagQueryResult | null>(null);
    const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
    const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
    const [sourceForm, setSourceForm] = useState({
        name: 'VetIOS clinical guideline source',
        source_type: 'guideline',
        authority_tier: 'specialist_guideline',
        species_scope: 'canine,feline',
        medicine_domain: 'clinical_guideline,diagnostics',
        url: '',
    });
    const [documentForm, setDocumentForm] = useState({
        title: 'Indexed veterinary reference',
        content_text: '',
    });
    const [queryForm, setQueryForm] = useState({
        question: 'What evidence is indexed for canine vomiting and diarrhea diagnostics?',
        species: '',
        domain: '',
        strategy: 'hybrid',
    });

    useEffect(() => {
        void refreshSnapshot();
    }, []);

    const indexedCount = useMemo(
        () => documents.filter((document) => document.ingestion_status === 'indexed').length,
        [documents],
    );

    async function refreshSnapshot() {
        setLoadingSnapshot(true);
        try {
            const [sourcesResponse, documentsResponse, catalogResponse, moatResponse] = await Promise.all([
                fetch('/api/rag/sources', { cache: 'no-store', credentials: 'same-origin' }),
                fetch('/api/rag/documents', { cache: 'no-store', credentials: 'same-origin' }),
                fetch('/api/rag/catalog', { cache: 'no-store', credentials: 'same-origin' }),
                fetch('/api/rag/moat', { cache: 'no-store', credentials: 'same-origin' }),
            ]);
            if (sourcesResponse.ok) {
                const body = await readResponseJson<{ sources?: RagSource[] }>(sourcesResponse);
                setSources(body.sources ?? []);
            }
            if (documentsResponse.ok) {
                const body = await readResponseJson<{ documents?: RagDocument[] }>(documentsResponse);
                setDocuments(body.documents ?? []);
            }
            if (catalogResponse.ok) {
                const body = await readResponseJson<{ catalog?: unknown[]; readiness?: RagReadiness }>(catalogResponse);
                setCatalogCount(body.catalog?.length ?? 0);
                setReadiness(body.readiness ?? null);
            }
            if (moatResponse.ok) {
                const body = await readResponseJson<{
                    latest_snapshot?: AgenticRagMoatSnapshot | null;
                    live_snapshot?: AgenticRagMoatSnapshot | null;
                }>(moatResponse);
                setMoatSnapshot(body.latest_snapshot ?? body.live_snapshot ?? null);
            }
        } finally {
            setLoadingSnapshot(false);
        }
    }

    async function handleSeedCatalog(forceRefresh = false) {
        setSeedingCatalog(true);
        setStatus(null);
        setCatalogErrors([]);
        try {
            let cursor: string | null = null;
            let hasMore = true;
            let batchCount = 0;
            let sourcesIndexed = 0;
            let documentsIndexed = 0;
            let chunksIndexed = 0;
            const errors: Array<{ source: string; message: string }> = [];
            const warnings: string[] = [];

            while (hasMore && batchCount < 12) {
                setStatus(`Catalog refresh batch ${batchCount + 1} is indexing curated evidence...`);
                const response: Response = await fetch('/api/rag/catalog', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        force_refresh: forceRefresh,
                        batch_size: 6,
                        cursor,
                        remote_mode: 'summaries_only',
                    }),
                });
                const body: CatalogSeedBatchResult & { detail?: string; error?: string } = await readResponseJson<CatalogSeedBatchResult>(response);
                if (!response.ok && response.status !== 207) {
                    throw new Error(body.detail ?? body.error ?? 'RAG catalog refresh failed.');
                }

                sourcesIndexed += body.sources_indexed ?? 0;
                documentsIndexed += body.documents_indexed ?? 0;
                chunksIndexed += body.chunks_indexed ?? 0;
                errors.push(...(body.errors ?? []));
                warnings.push(...(body.warnings ?? []));
                batchCount += 1;

                cursor = body.next_cursor ?? null;
                hasMore = Boolean(body.has_more && cursor);
            }

            setCatalogErrors(errors);
            const errorSuffix = errors.length ? ` ${errors.length} source(s) need review.` : '';
            const limitSuffix = hasMore ? ' More catalog batches remain; run refresh again to continue.' : '';
            const warningSuffix = warnings.length && !hasMore ? ` ${warnings[0]}` : '';
            setStatus(`Catalog indexed ${sourcesIndexed} source(s), ${documentsIndexed} document(s), ${chunksIndexed} chunk(s) across ${batchCount} batch(es).${errorSuffix}${limitSuffix}${warningSuffix}`);
            await refreshSnapshot();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'RAG catalog refresh failed.');
        } finally {
            setSeedingCatalog(false);
        }
    }

    async function handlePersistMoatSnapshot() {
        setPersistingMoat(true);
        setStatus(null);
        try {
            const response = await fetch('/api/rag/moat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({}),
            });
            const body = await readResponseJson<{
                snapshot?: AgenticRagMoatSnapshot;
                stored?: boolean;
                warning?: string | null;
                detail?: string;
                error?: string;
            }>(response);
            if (!response.ok) {
                throw new Error(body.detail ?? body.error ?? 'Agentic RAG moat snapshot failed.');
            }
            if (body.snapshot) setMoatSnapshot(body.snapshot);
            setStatus(body.warning ?? (body.stored ? 'Agentic RAG moat snapshot sealed.' : 'Agentic RAG moat snapshot computed but not stored.'));
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Agentic RAG moat snapshot failed.');
        } finally {
            setPersistingMoat(false);
        }
    }

    async function handleProbeEmbeddings() {
        setProbingEmbeddings(true);
        setStatus(null);
        try {
            const response = await fetch('/api/rag/embedding-health', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({}),
            });
            const body = await readResponseJson<{
                probe?: RagEmbeddingProbe;
                detail?: string;
                error?: string;
            }>(response);
            if (!body.probe && !response.ok) {
                throw new Error(body.detail ?? body.error ?? 'RAG embedding probe failed.');
            }
            if (body.probe) {
                setEmbeddingProbe(body.probe);
                setStatus(body.probe.probe_ok
                    ? 'RAG embedding provider probe passed.'
                    : 'RAG embedding probe did not verify live semantic retrieval.');
            }
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'RAG embedding probe failed.');
        } finally {
            setProbingEmbeddings(false);
        }
    }

    async function handleIngest(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIngesting(true);
        setStatus(null);
        try {
            const response = await fetch('/api/rag/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    source: {
                        name: sourceForm.name,
                        source_type: sourceForm.source_type,
                        authority_tier: sourceForm.authority_tier,
                        species_scope: splitList(sourceForm.species_scope),
                        medicine_domain: splitList(sourceForm.medicine_domain),
                        url: sourceForm.url || null,
                    },
                    document: {
                        title: documentForm.title,
                        document_type: 'text',
                        language: 'en',
                        content_text: documentForm.content_text,
                        metadata: {
                            console_ingest: true,
                        },
                    },
                    chunking: {
                        maxTokens: 420,
                        overlapTokens: 60,
                    },
                }),
            });
            const body = await readResponseJson<{ chunks_indexed?: number; detail?: string; error?: string }>(response);
            if (!response.ok) {
                throw new Error(body.detail ?? body.error ?? 'RAG ingest failed.');
            }
            setStatus(`Indexed ${body.chunks_indexed ?? 0} chunk(s).`);
            setDocumentForm((current) => ({ ...current, content_text: '' }));
            await refreshSnapshot();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'RAG ingest failed.');
        } finally {
            setIngesting(false);
        }
    }

    async function handleQuery(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setQuerying(true);
        setStatus(null);
        try {
            const response = await fetch('/api/rag/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    question: queryForm.question,
                    species: queryForm.species || null,
                    domain: queryForm.domain || null,
                    strategy: queryForm.strategy,
                    limit: 6,
                }),
            });
            const body = await readResponseJson<RagQueryResult & { detail?: string; error?: string }>(response);
            if (!response.ok) {
                throw new Error(body.detail ?? body.error ?? 'RAG query failed.');
            }
            setQueryResult(body);
            setFeedbackStatus(null);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'RAG query failed.');
        } finally {
            setQuerying(false);
        }
    }

    async function handleFeedback(
        feedbackKind: 'answer_useful' | 'answer_not_useful' | 'citation_useful' | 'citation_not_useful' | 'needs_review',
        citation?: RagCitation,
    ) {
        if (!queryResult?.query_id) {
            setFeedbackStatus('Query ledger ID is missing. Apply the RAG migrations before recording feedback.');
            return;
        }

        setFeedbackSubmitting(true);
        setFeedbackStatus(null);
        try {
            const citations = citation ? [{
                index: citation.index,
                title: citation.title,
                source_name: citation.source_name,
                url: citation.url,
            }] : queryResult.citations.map((entry) => ({
                index: entry.index,
                title: entry.title,
                source_name: entry.source_name,
                url: entry.url,
            }));

            const response = await fetch('/api/rag/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    query_id: queryResult.query_id,
                    feedback_kind: feedbackKind,
                    citation_indexes: citations.map((entry) => entry.index),
                    citations,
                    grounded: queryResult.evaluation.grounded,
                    clinical_use_case: queryForm.question.slice(0, 120),
                }),
            });
            const body = await readResponseJson<{ stored?: boolean; warning?: string | null; error?: string; detail?: string }>(response);
            if (!response.ok) {
                throw new Error(body.detail ?? body.error ?? 'RAG feedback failed.');
            }
            setFeedbackStatus(body.warning ?? (body.stored === false ? 'Feedback was accepted but not stored.' : 'Feedback recorded.'));
            await refreshSnapshot();
        } catch (error) {
            setFeedbackStatus(error instanceof Error ? error.message : 'RAG feedback failed.');
        } finally {
            setFeedbackSubmitting(false);
        }
    }

    return (
        <Container className="max-w-[96rem]">
            <PageHeader
                title="AGENTIC RAG SERVICE"
                description="Index veterinary and medical sources, retrieve grounded evidence, and return citation-first answers for VetIOS workflows."
            />

            <div className="mb-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <MetricTile icon={<DatabaseZap className="h-4 w-4" />} label="Sources" value={sources.length} />
                <MetricTile icon={<FileText className="h-4 w-4" />} label="Documents" value={documents.length} />
                <MetricTile icon={<BookOpenCheck className="h-4 w-4" />} label="Indexed" value={indexedCount} />
                <MetricTile icon={<ShieldCheck className="h-4 w-4" />} label="High Trust" value={readiness?.high_authority_sources ?? 0} />
                <MetricTile icon={<SearchCheck className="h-4 w-4" />} label="Catalog" value={catalogCount} />
                <MetricTile icon={<ShieldCheck className="h-4 w-4" />} label="Moat" value={formatMoatStatus(moatSnapshot?.moat_status)} />
            </div>

            {status && (
                <div className="mb-6 border border-accent/20 bg-accent/5 px-4 py-3 font-mono text-xs uppercase tracking-[0.12em] text-accent">
                    {status}
                </div>
            )}

            {catalogErrors.length > 0 && (
                <div className="mb-6 border border-amber-300/20 bg-amber-300/5 p-4">
                    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200">Catalog Seed Diagnostics</div>
                    <div className="space-y-2">
                        {summarizeCatalogErrors(catalogErrors).map((error) => (
                            <div key={`${error.source}-${error.message}`} className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber-100">
                                {error.source}: {error.message}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {readiness && (
                <section className="mb-6 border border-grid bg-panel/40 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-grid pb-3">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-accent" />
                            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-foreground">Corpus Readiness</h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${readiness.ready ? 'text-accent' : 'text-amber-300'}`}>
                                {readiness.ready ? 'Ready' : 'Needs Evidence'}
                            </span>
                            <TerminalButton type="button" onClick={() => void handleProbeEmbeddings()} disabled={probingEmbeddings}>
                                {probingEmbeddings ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                                Probe Embeddings
                            </TerminalButton>
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                        <DataRow label="Chunks" value={readiness.chunks} tone={readiness.chunks > 0 ? 'accent' : undefined} />
                        <DataRow label="High Authority" value={readiness.high_authority_sources} tone={readiness.high_authority_sources > 0 ? 'accent' : undefined} />
                        <DataRow label="Stale Docs" value={readiness.stale_documents} tone={readiness.stale_documents === 0 ? 'accent' : undefined} />
                        <DataRow label="Last Refresh" value={formatDate(readiness.last_refreshed_at)} />
                        <DataRow label="Embeddings" value={formatEmbeddingMode(readiness.embedding_mode)} tone={readiness.embedding_live_provider_configured ? 'accent' : 'warning'} />
                        <DataRow label="Embedding Model" value={readiness.embedding_model ?? 'Unknown'} />
                        <DataRow label="Vector Dims" value={readiness.embedding_dimensions ?? 'Unknown'} />
                    </div>
                    {embeddingProbe && (
                        <div className={`mt-3 border p-3 ${embeddingProbe.probe_ok ? 'border-accent/20 bg-accent/5' : 'border-amber-300/20 bg-amber-300/5'}`}>
                            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground">Embedding Probe</div>
                            <div className="grid gap-3 md:grid-cols-4">
                                <DataRow label="Status" value={embeddingProbe.probe_ok ? 'Live Verified' : 'Not Verified'} tone={embeddingProbe.probe_ok ? 'accent' : 'warning'} />
                                <DataRow label="Provider" value={embeddingProbe.provider_reachable ? 'Reachable' : 'Not Reachable'} tone={embeddingProbe.provider_reachable ? 'accent' : 'warning'} />
                                <DataRow label="Latency" value={`${embeddingProbe.latency_ms}ms`} />
                                <DataRow label="Observed Dims" value={embeddingProbe.vector_dimension_observed ?? 'None'} tone={embeddingProbe.vector_dimension_observed === embeddingProbe.embedding_dimensions ? 'accent' : 'warning'} />
                                <DataRow label="Fallback" value={embeddingProbe.deterministic_fallback_used ? 'Used' : 'No'} tone={embeddingProbe.deterministic_fallback_used ? 'warning' : 'accent'} />
                                <DataRow label="Norm" value={embeddingProbe.vector_norm ?? 'None'} />
                            </div>
                            {embeddingProbe.error && (
                                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-100">
                                    {embeddingProbe.error}
                                </div>
                            )}
                        </div>
                    )}
                    {readiness.warnings.length > 0 && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {readiness.warnings.map((warning) => (
                                <div key={warning} className="border border-amber-300/20 bg-amber-300/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-200">
                                    {warning}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {moatSnapshot && (
                <section className="mb-6 border border-accent/20 bg-accent/5 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-accent/20 pb-3">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-accent" />
                            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-foreground">Agentic RAG Moat</h2>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${moatSnapshot.moat_status === 'compounding' ? 'text-accent' : moatSnapshot.moat_status === 'forming' ? 'text-amber-300' : 'text-red-300'}`}>
                                {formatMoatStatus(moatSnapshot.moat_status)}
                            </span>
                            <TerminalButton type="button" onClick={() => void handlePersistMoatSnapshot()} disabled={persistingMoat}>
                                {persistingMoat ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                                Seal Snapshot
                            </TerminalButton>
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                        <DataRow label="30D Queries" value={moatSnapshot.query_count_30d} tone={moatSnapshot.query_count_30d > 0 ? 'accent' : undefined} />
                        <DataRow label="Grounding Rate" value={formatPercent(moatSnapshot.grounding_rate)} tone={moatSnapshot.grounding_rate >= 0.8 ? 'accent' : undefined} />
                        <DataRow label="Citation Coverage" value={formatPercent(moatSnapshot.citation_coverage_avg)} tone={moatSnapshot.citation_coverage_avg >= 0.8 ? 'accent' : undefined} />
                        <DataRow label="Fallback Rate" value={formatPercent(moatSnapshot.catalog_fallback_rate)} tone={moatSnapshot.catalog_fallback_rate <= 0.2 ? 'accent' : undefined} />
                        <DataRow label="Grounded Queries" value={moatSnapshot.grounded_queries_30d} />
                        <DataRow label="Withheld Citations" value={moatSnapshot.withheld_citations_30d} />
                        <DataRow label="Feedback Events" value={moatSnapshot.feedback_events_30d ?? 0} tone={(moatSnapshot.feedback_events_30d ?? 0) > 0 ? 'accent' : undefined} />
                        <DataRow label="Usefulness" value={formatPercent(moatSnapshot.citation_usefulness_rate ?? 0)} tone={(moatSnapshot.citation_usefulness_rate ?? 0) >= 0.65 ? 'accent' : undefined} />
                        <DataRow label="Useful Signals" value={moatSnapshot.useful_feedback_30d ?? 0} />
                        <DataRow label="Needs Review" value={moatSnapshot.needs_review_feedback_30d ?? 0} />
                        <DataRow label="Avg Retrieval" value={moatSnapshot.avg_retrieval_ms === null ? 'No ledger' : `${moatSnapshot.avg_retrieval_ms}ms`} />
                        <DataRow label="Freshness" value={moatSnapshot.evidence_freshness} tone={moatSnapshot.evidence_freshness === 'fresh' ? 'accent' : undefined} />
                    </div>
                    {moatSnapshot.warnings.length > 0 && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {moatSnapshot.warnings.slice(0, 4).map((warning) => (
                                <div key={warning} className="border border-amber-300/20 bg-amber-300/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-200">
                                    {warning}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <section className="border border-grid bg-panel/50 p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-grid pb-3">
                        <div className="flex items-center gap-2">
                            <DatabaseZap className="h-4 w-4 text-accent" />
                            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-foreground">Index Source</h2>
                        </div>
                        <TerminalButton type="button" onClick={() => void handleSeedCatalog(false)} disabled={seedingCatalog}>
                            {seedingCatalog ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                            Seed Catalog
                        </TerminalButton>
                    </div>
                    <form onSubmit={handleIngest} className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                            <Field label="Source Name" value={sourceForm.name} onChange={(value) => setSourceForm((current) => ({ ...current, name: value }))} />
                            <SelectField label="Source Type" value={sourceForm.source_type} options={['guideline', 'journal', 'drug_label', 'lab_reference', 'clinical_protocol', 'textbook', 'web', 'file', 'other']} onChange={(value) => setSourceForm((current) => ({ ...current, source_type: value }))} />
                            <SelectField label="Authority" value={sourceForm.authority_tier} options={['specialist_guideline', 'peer_reviewed', 'regulatory', 'institutional', 'clinic_local', 'unverified']} onChange={(value) => setSourceForm((current) => ({ ...current, authority_tier: value }))} />
                            <Field label="Public HTTPS URL" value={sourceForm.url} onChange={(value) => setSourceForm((current) => ({ ...current, url: value }))} placeholder="Optional provenance URL" />
                            <Field label="Species Scope" value={sourceForm.species_scope} onChange={(value) => setSourceForm((current) => ({ ...current, species_scope: value }))} />
                            <Field label="Domains" value={sourceForm.medicine_domain} onChange={(value) => setSourceForm((current) => ({ ...current, medicine_domain: value }))} />
                        </div>
                        <Field label="Document Title" value={documentForm.title} onChange={(value) => setDocumentForm((current) => ({ ...current, title: value }))} />
                        <div>
                            <TerminalLabel htmlFor="rag-content">Document Text</TerminalLabel>
                            <TerminalTextarea
                                id="rag-content"
                                value={documentForm.content_text}
                                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDocumentForm((current) => ({ ...current, content_text: event.target.value }))}
                                className="min-h-[220px]"
                                placeholder="Paste guideline, drug label, lab reference, paper abstract, protocol, or extracted PDF text..."
                                required
                            />
                        </div>
                        <TerminalButton type="submit" disabled={ingesting || !documentForm.content_text.trim()}>
                            {ingesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Index Evidence
                        </TerminalButton>
                    </form>
                </section>

                <section className="border border-grid bg-panel/50 p-4">
                    <div className="mb-4 flex items-center gap-2 border-b border-grid pb-3">
                        <SearchCheck className="h-4 w-4 text-accent" />
                        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-foreground">Ask Indexed Evidence</h2>
                    </div>
                    <form onSubmit={handleQuery} className="space-y-4">
                        <div>
                            <TerminalLabel htmlFor="rag-question">Question</TerminalLabel>
                            <TerminalTextarea
                                id="rag-question"
                                value={queryForm.question}
                                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setQueryForm((current) => ({ ...current, question: event.target.value }))}
                                className="min-h-[120px]"
                                required
                            />
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                            <Field label="Species" value={queryForm.species} onChange={(value) => setQueryForm((current) => ({ ...current, species: value }))} placeholder="Optional" />
                            <Field label="Domain" value={queryForm.domain} onChange={(value) => setQueryForm((current) => ({ ...current, domain: value }))} placeholder="Optional" />
                            <SelectField label="Strategy" value={queryForm.strategy} options={['hybrid', 'vector', 'lexical', 'clinical_guideline', 'drug_safety', 'lab_reference']} onChange={(value) => setQueryForm((current) => ({ ...current, strategy: value }))} />
                        </div>
                        <TerminalButton type="submit" disabled={querying || !queryForm.question.trim()}>
                            {querying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Retrieve Answer
                        </TerminalButton>
                    </form>

                    {queryResult && (
                        <div className="mt-6 space-y-4">
                            <div className="border border-accent/15 bg-black/20 p-4">
                                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Grounded Answer</div>
                                <p className="font-mono text-sm leading-relaxed text-foreground">{queryResult.answer}</p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <TerminalButton type="button" disabled={feedbackSubmitting || !queryResult.query_id} onClick={() => handleFeedback('answer_useful')}>
                                        Useful Answer
                                    </TerminalButton>
                                    <TerminalButton type="button" disabled={feedbackSubmitting || !queryResult.query_id} onClick={() => handleFeedback('answer_not_useful')}>
                                        Not Useful
                                    </TerminalButton>
                                    <TerminalButton type="button" disabled={feedbackSubmitting || !queryResult.query_id} onClick={() => handleFeedback('needs_review')}>
                                        Needs Review
                                    </TerminalButton>
                                </div>
                                {feedbackStatus && (
                                    <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{feedbackStatus}</div>
                                )}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <DataRow label="Strategy" value={queryResult.retrieval_stats.strategy} tone="accent" />
                                <DataRow label="Latency" value={`${queryResult.retrieval_stats.retrieval_time_ms}ms`} />
                                <DataRow label="Vector Hits" value={queryResult.retrieval_stats.vector_hits} />
                                <DataRow label="Lexical Hits" value={queryResult.retrieval_stats.lexical_hits} />
                                <DataRow label="Direct Lexical" value={queryResult.retrieval_stats.direct_lexical_hits ?? 0} />
                                <DataRow label="Catalog Fallback" value={queryResult.retrieval_stats.catalog_fallback_hits ?? 0} tone={(queryResult.retrieval_stats.catalog_fallback_hits ?? 0) > 0 ? 'accent' : undefined} />
                                <DataRow label="Candidates" value={queryResult.retrieval_stats.candidate_citations ?? queryResult.retrieval_stats.total_citations} />
                                <DataRow label="Withheld" value={queryResult.retrieval_stats.withheld_citations ?? 0} />
                                <DataRow label="Causal Memory" value={queryResult.evaluation.causal_memory_linked ? 'LINKED' : 'NO MATCH'} tone={queryResult.evaluation.causal_memory_linked ? 'accent' : undefined} />
                                <DataRow label="Counterfactual" value={queryResult.evaluation.counterfactual_reasoning_linked ? 'LINKED' : 'NO MATCH'} tone={queryResult.evaluation.counterfactual_reasoning_linked ? 'accent' : undefined} />
                                <DataRow label="One Health" value={queryResult.evaluation.one_health_surveillance_linked ? 'LINKED' : 'NO MATCH'} tone={queryResult.evaluation.one_health_surveillance_linked ? 'accent' : undefined} />
                            </div>
                            {queryResult.evaluation.warnings.length > 0 && (
                                <div className="border border-amber-300/20 bg-amber-300/5 p-3">
                                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200">Retrieval Warnings</div>
                                    <div className="space-y-2">
                                        {queryResult.evaluation.warnings.slice(0, 5).map((warning) => (
                                            <div key={warning} className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber-100">
                                                {warning}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="space-y-3">
                                {queryResult.citations.map((citation) => (
                                    <div key={`${citation.index}-${citation.title}`} className="border border-grid bg-black/20 p-3">
                                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                                            <span className="text-accent">[{citation.index}] {citation.source_name}</span>
                                            <span className="text-muted">{citation.authority_tier} // {(citation.similarity * 100).toFixed(1)}%</span>
                                        </div>
                                        <p className="font-mono text-xs leading-relaxed text-foreground/90">{citation.quote}</p>
                                        {citation.url && (
                                            <a href={citation.url} target="_blank" rel="noreferrer" className="mt-2 block break-all font-mono text-[10px] uppercase tracking-[0.12em] text-accent/80">
                                                {citation.url}
                                            </a>
                                        )}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <TerminalButton type="button" disabled={feedbackSubmitting || !queryResult.query_id} onClick={() => handleFeedback('citation_useful', citation)}>
                                                Useful Citation
                                            </TerminalButton>
                                            <TerminalButton type="button" disabled={feedbackSubmitting || !queryResult.query_id} onClick={() => handleFeedback('citation_not_useful', citation)}>
                                                Not Useful
                                            </TerminalButton>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </section>
            </div>

            <section className="mt-6 border border-grid bg-panel/40 p-4">
                <div className="mb-4 flex items-center justify-between gap-4 border-b border-grid pb-3">
                    <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-accent" />
                        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-foreground">Indexed Corpus</h2>
                    </div>
                    <div className="flex items-center gap-4">
                        <button type="button" onClick={() => void handleSeedCatalog(true)} disabled={seedingCatalog} className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent disabled:opacity-50">
                            {seedingCatalog ? 'Refreshing...' : 'Refresh Catalog'}
                        </button>
                        <button type="button" onClick={() => void refreshSnapshot()} className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                            {loadingSnapshot ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                    {documents.slice(0, 8).map((document) => {
                        const source = sources.find((candidate) => candidate.id === document.source_id);
                        return (
                            <div key={document.id} className="border border-grid bg-black/20 p-3">
                                <div className="font-mono text-xs uppercase tracking-[0.12em] text-foreground">{document.title}</div>
                                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                                    {source?.name ?? 'Unknown source'} // {document.ingestion_status} // {document.content_length} chars
                                </div>
                            </div>
                        );
                    })}
                    {documents.length === 0 && (
                        <div className="border border-grid bg-black/20 p-4 font-mono text-xs uppercase tracking-[0.12em] text-muted">
                            No RAG documents indexed yet.
                        </div>
                    )}
                </div>
            </section>
        </Container>
    );
}

function MetricTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
    return (
        <div className="border border-grid bg-panel/50 p-3">
            <div className="mb-3 flex items-center justify-between text-accent">{icon}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">{value}</div>
        </div>
    );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            <TerminalInput value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} placeholder={placeholder} />
        </div>
    );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            <select
                value={value}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
                className="w-full border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_8%_/_0.9)] px-3 py-2.5 font-mono text-sm text-foreground focus:border-accent/60 focus:outline-none"
            >
                {options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        </div>
    );
}

function splitList(value: string): string[] {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function formatDate(value: string | null): string {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function formatPercent(value: number): string {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatMoatStatus(value?: AgenticRagMoatSnapshot['moat_status']): string {
    switch (value) {
        case 'compounding':
            return 'Compounding';
        case 'forming':
            return 'Forming';
        case 'blocked':
            return 'Blocked';
        default:
            return 'Unknown';
    }
}

function formatEmbeddingMode(value?: RagReadiness['embedding_mode']): string {
    switch (value) {
        case 'live_provider':
            return 'Live Provider';
        case 'deterministic_fallback':
            return 'Deterministic Fallback';
        default:
            return 'Unknown';
    }
}

function summarizeCatalogErrors(errors: Array<{ source: string; message: string }>): Array<{ source: string; message: string }> {
    const firstMissingSchema = errors.find((error) => /Could not find the table 'public\.rag_|schema cache/i.test(error.message));
    if (firstMissingSchema) {
        return [{
            source: 'schema',
            message: 'RAG database tables are missing. Apply supabase/migrations/20260510000000_agentic_rag_service.sql and supabase/migrations/20260510010000_agentic_rag_automation.sql, then rerun Seed Catalog.',
        }];
    }
    return errors.slice(0, 6);
}

async function readResponseJson<T>(response: Response): Promise<T & { detail?: string; error?: string }> {
    const text = await response.text();
    if (!text.trim()) return {} as T & { detail?: string; error?: string };

    try {
        return JSON.parse(text) as T & { detail?: string; error?: string };
    } catch {
        return {
            error: `Non-JSON response from ${response.url || 'VetIOS API'} (${response.status}): ${summarizeResponseText(text)}`,
        } as T & { detail?: string; error?: string };
    }
}

function summarizeResponseText(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180) || 'empty response';
}
