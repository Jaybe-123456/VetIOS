'use client';

import { useEffect, useMemo, useState } from 'react';
import { ImageIcon, ExternalLink } from 'lucide-react';
import { compactSearchTerms, detectSpeciesFromTexts, type DetectedVetiosSpecies } from '@/lib/askVetios/context';

interface DiseaseImagePanelProps {
    messageContent: string;
    topic?: string;
    queryText?: string;
    messageId?: string;
}

interface ImageFinding {
    id: string;
    label: string;
    description: string;
    confidence: number;
    sourceType: string;
    searchQuery: string;
}

interface ReferenceImage {
    title: string;
    thumbnailUrl: string;
    pageUrl: string;
    source: string;
    license?: string;
    attribution?: string;
}

interface ResearchSource {
    title: string;
    url: string;
    snippet: string;
    source: string;
    sourceType: 'wikipedia' | 'pubmed';
}

interface DiseaseImagePayload {
    disease: string;
    species: DetectedVetiosSpecies;
    findings: ImageFinding[];
    imagesByFinding: Record<string, ReferenceImage[]>;
    imageProvider?: string;
    researchSources?: ResearchSource[];
}

function fallbackDisease(topic: string | undefined, messageContent: string, queryText?: string) {
    if (topic?.trim()) return topic.trim();
    const queryDisease = queryText?.match(/\b(?:for|of|about)\s+([A-Za-z][A-Za-z\s-]{2,70})/i)?.[1]?.trim();
    if (queryDisease) return queryDisease;
    const firstSentence = messageContent.split(/[.!?]/)[0] ?? '';
    const match = firstSentence.match(/^([A-Z][^,.(]{2,70}?)(?:\s+(?:is|are|causes|results|presents)\b)/);
    return match?.[1]?.trim() || 'Current disease process';
}

function buildFindingQuery(species: DetectedVetiosSpecies, disease: string, finding: string) {
    return compactSearchTerms([
        species === 'unknown' ? 'veterinary' : species,
        disease,
        finding,
    ]);
}

function fallbackFindings(topic: string | undefined, messageContent: string, queryText?: string): DiseaseImagePayload {
    const disease = fallbackDisease(topic, messageContent, queryText);
    const species = detectSpeciesFromTexts([queryText, topic, messageContent]);

    const findings: ImageFinding[] = [
        {
            id: 'gross',
            label: 'Gross Pathology',
            description: 'Structured visual description unavailable from the model route. Use the search query to review gross lesions for external reference.',
            confidence: 0.46,
            sourceType: 'fallback',
            searchQuery: buildFindingQuery(species, disease, 'gross pathology'),
        },
        {
            id: 'histopathology',
            label: 'Histopathology',
            description: 'Histopathology detail is unavailable in fallback mode. Search the tissue pattern directly for reference slides.',
            confidence: 0.42,
            sourceType: 'fallback',
            searchQuery: buildFindingQuery(species, disease, 'histopathology'),
        },
        {
            id: 'radiography',
            label: 'Radiographic Findings',
            description: 'Radiographic patterning is unavailable in fallback mode. Use the query to inspect representative imaging.',
            confidence: 0.39,
            sourceType: 'fallback',
            searchQuery: buildFindingQuery(species, disease, 'radiograph'),
        },
        {
            id: 'cytology',
            label: 'Cytology',
            description: 'Cytology detail is unavailable in fallback mode. Query is still generated for manual image review.',
            confidence: 0.37,
            sourceType: 'fallback',
            searchQuery: buildFindingQuery(species, disease, 'cytology'),
        },
    ];

    return { disease, species, findings, imagesByFinding: {}, researchSources: [] };
}

export default function DiseaseImagePanel({ messageContent, topic, queryText, messageId }: DiseaseImagePanelProps) {
    const fallback = useMemo(() => fallbackFindings(topic, messageContent, queryText), [messageContent, queryText, topic]);
    const [payload, setPayload] = useState<DiseaseImagePayload>(fallback);
    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setPayload(fallback);
            setStatus('loading');

            try {
                const response = await fetch('/api/ask-vetios/clinical-images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic, messageContent, queryText }),
                });

                if (!response.ok) {
                    throw new Error(`Request failed with ${response.status}`);
                }

                const data = (await response.json()) as DiseaseImagePayload;
                if (!cancelled) {
                    setPayload({
                        disease: data.disease || fallback.disease,
                        species: data.species || fallback.species,
                        findings: Array.isArray(data.findings) && data.findings.length > 0 ? data.findings : fallback.findings,
                        imagesByFinding: data.imagesByFinding ?? {},
                        imageProvider: data.imageProvider,
                        researchSources: Array.isArray(data.researchSources) ? data.researchSources : [],
                    });
                    setStatus('ready');
                }
            } catch {
                if (!cancelled) {
                    setPayload(fallback);
                    setStatus('error');
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [fallback, messageContent, messageId, queryText, topic]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-[#00ff88]" />
                        <h3 className="font-mono text-xs uppercase tracking-[0.22em] text-[#00ff88]">
                            Clinical Image Reference
                        </h3>
                    </div>
                    <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-white/58">
                        Visual descriptors are generated for {payload.species === 'unknown' ? 'the current species context' : payload.species} {payload.disease} and paired with inline reference images when available.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Species</div>
                        <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">{payload.species}</div>
                    </div>
                    <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Signal</div>
                        <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">
                            {status === 'loading' ? 'loading' : status === 'error' ? 'fallback' : 'live'}
                        </div>
                    </div>
                    <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Images</div>
                        <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">
                            {payload.imageProvider ?? 'pending'}
                        </div>
                    </div>
                </div>
            </div>

            {status === 'loading' && (
                <div className="border border-white/10 bg-white/[0.02] px-4 py-3 font-mono text-[11px] text-white/54">
                    Fetching structured disease image descriptors and reference searches...
                </div>
            )}

            {status === 'error' && (
                <div className="border border-amber-500/20 bg-amber-500/6 px-4 py-3 font-mono text-[11px] leading-relaxed text-amber-200/80">
                    Live clinical image enrichment is unavailable right now. Fallback search queries are still provided so the panel remains usable.
                </div>
            )}

            <div className="grid gap-3">
                {payload.findings.map((finding) => {
                    const images = payload.imagesByFinding[finding.id] ?? [];

                    return (
                        <div key={finding.id} className="space-y-3 border border-white/10 bg-white/[0.02] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">
                                        {finding.label}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <span className="border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/56">
                                            {finding.sourceType}
                                        </span>
                                        <span className="border border-[#00ff88]/20 bg-[#00ff88]/8 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#00ff88]">
                                            {Math.round(finding.confidence * 100)}% confidence
                                        </span>
                                    </div>
                                </div>

                                <div className="border border-white/10 bg-black/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">
                                    Inline references
                                </div>
                            </div>

                            <p className="font-mono text-[11px] leading-relaxed text-white/74">
                                {finding.description}
                            </p>

                            <div className="rounded border border-white/8 bg-black/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
                                Query: {finding.searchQuery}
                            </div>

                            {images.length > 0 ? (
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {images.map((image) => (
                                        <figure
                                            key={`${finding.id}-${image.pageUrl}`}
                                            className="overflow-hidden border border-white/10 bg-black/20 transition-colors hover:border-white/20"
                                        >
                                            <img src={image.thumbnailUrl} alt={image.title} className="h-36 w-full object-cover" />
                                            <div className="space-y-1 p-2">
                                                <div className="line-clamp-2 font-mono text-[11px] leading-relaxed text-white/76">
                                                    {image.title}
                                                </div>
                                                <a
                                                    href={image.pageUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/42 hover:text-[#00ff88]"
                                                >
                                                    {image.source}
                                                    <ExternalLink className="h-2.5 w-2.5" />
                                                </a>
                                                {(image.license || image.attribution) && (
                                                    <div className="font-mono text-[10px] leading-relaxed text-white/32">
                                                        {[image.license, image.attribution].filter(Boolean).join(' // ')}
                                                    </div>
                                                )}
                                            </div>
                                        </figure>
                                    ))}
                                </div>
                            ) : (
                                <div className="border border-dashed border-white/10 bg-black/20 px-3 py-4 font-mono text-[11px] text-white/44">
                                    No inline reference images were resolved for this finding.
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="border border-white/10 bg-white/[0.02] p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Research Sources</div>
                <div className="mt-3 grid gap-2">
                    {(payload.researchSources ?? []).length > 0 ? payload.researchSources!.map((source) => (
                        <a
                            key={`${source.sourceType}-${source.url}`}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="border border-white/8 bg-black/25 px-3 py-2 transition-colors hover:border-white/18"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-mono text-[11px] leading-relaxed text-white/76">{source.title}</span>
                                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#00ff88]">{source.source}</span>
                            </div>
                            {source.snippet && (
                                <p className="mt-1 line-clamp-2 font-mono text-[11px] leading-relaxed text-white/48">{source.snippet}</p>
                            )}
                        </a>
                    )) : (
                        <p className="font-mono text-[11px] leading-relaxed text-white/46">
                            No inline Wikipedia or PubMed sources were resolved for this query.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
