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
    wikimedia_query?: string;
    pubmed_image_query?: string;
    idexx_relevant?: boolean;
    clinical_note?: string;
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

function localDisease(topic: string | undefined, messageContent: string, queryText?: string) {
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

function speciesDisplay(species: DetectedVetiosSpecies) {
    return species === 'unknown' ? 'the submitted veterinary species' : species;
}

function speciesSpecificRule(species: DetectedVetiosSpecies) {
    if (species === 'feline') return 'Compare with canine disease only after checking feline-specific lymphoid, intestinal, neurologic, and inflammatory patterns.';
    if (species === 'equine') return 'Record whether imaging was obtained standing under sedation or under general anaesthesia because positioning can change interpretation.';
    if (species === 'bovine') return 'Separate slaughter or necropsy findings from live-animal imaging, and account for rumen contents in abdominal views.';
    if (species === 'avian') return 'Specify psittacine, passerine, raptor, or poultry context when the case supplies it.';
    return 'Tie any extrapolation to the submitted signalment and case context.';
}

function localFindingDescription(id: string, disease: string, species: DetectedVetiosSpecies) {
    const speciesName = speciesDisplay(species);
    const rule = speciesSpecificRule(species);
    if (id === 'gross') {
        return `In suspected ${disease} in ${speciesName}, gross pathology should be described at the affected organ level with focal, multifocal, segmental, or diffuse distribution. Record colour, contour, texture, mucosal or capsular change, fluid content, and cut-surface architecture so the process can be separated from autolysis, trauma, and secondary infection. Useful reference images should show the intact organ and a close cut surface highlighting necrosis, haemorrhage, exudate, fibrosis, mineralisation, abscessation, or neoplastic replacement when present. ${rule}`;
    }
    if (id === 'histopathology') {
        return `For ${disease} in ${speciesName}, H&E sections should target the tissue compartment driving the case, such as epithelium, crypts, glands, vessels, lymphoid tissue, nervous tissue, or interstitium. The microscopic pattern should name the cell populations, necrosis type, inflammation, organisms, inclusions, vascular injury, fibrosis, mineralisation, or neoplastic criteria. Special stains, IHC, PCR, culture, or electron microscopy should be chosen from the suspected mechanism when routine H&E does not identify the cause. ${rule}`;
    }
    if (id === 'radiography') {
        return `Imaging for suspected ${disease} in ${speciesName} should match the affected anatomy and document view or plane, opacity, echogenicity, gas, mineral, size, and distribution. Ultrasound should describe wall layering, effusion, vascularity, and sampling targets, while CT or MRI should record window or sequence, contrast enhancement, mass effect, and regional extension. Some disease mechanisms produce normal survey radiographs early, so persistent clinical suspicion should trigger ultrasound, CT, MRI, or repeat imaging. ${rule}`;
    }
    return `Cytology and haematology for suspected ${disease} in ${speciesName} should start with the sample type, such as EDTA blood smear, buffy coat, FNA, impression smear, fluid analysis, or airway/GI preparation. Describe cell lineage, maturation, atypia, toxic change, organisms, inclusions, haemoparasites, platelet changes, and the inflammatory cell mix. CBC interpretation should report leukocyte, neutrophil, lymphocyte, erythrocyte, and platelet changes that distinguish infectious, inflammatory, immune-mediated, toxic, and neoplastic differentials. ${rule}`;
}

function localFindings(topic: string | undefined, messageContent: string, queryText?: string): DiseaseImagePayload {
    const disease = localDisease(topic, messageContent, queryText);
    const species = detectSpeciesFromTexts([queryText, topic, messageContent]);

    const findings: ImageFinding[] = [
        {
            id: 'gross',
            label: 'Gross Pathology',
            description: localFindingDescription('gross', disease, species),
            confidence: 0.46,
            sourceType: 'vetios',
            searchQuery: buildFindingQuery(species, disease, 'gross pathology necropsy lesion cut surface'),
            wikimedia_query: buildFindingQuery(species, disease, 'gross pathology veterinary necropsy lesion'),
            pubmed_image_query: buildFindingQuery(species, disease, 'gross pathology necropsy figure'),
            idexx_relevant: false,
            clinical_note: 'This is primarily a post-mortem or surgical specimen finding; histopathology confirms the process.',
        },
        {
            id: 'histopathology',
            label: 'Histopathology',
            description: localFindingDescription('histopathology', disease, species),
            confidence: 0.42,
            sourceType: 'vetios',
            searchQuery: buildFindingQuery(species, disease, 'histopathology H&E lesion tissue section'),
            wikimedia_query: buildFindingQuery(species, disease, 'histopathology veterinary H&E lesion'),
            pubmed_image_query: buildFindingQuery(species, disease, 'histopathology H&E figure'),
            idexx_relevant: true,
            clinical_note: 'Submit representative tissue in 10% neutral buffered formalin and request ancillary stains or PCR when needed.',
        },
        {
            id: 'radiography',
            label: 'Radiographic & Imaging Findings',
            description: localFindingDescription('radiography', disease, species),
            confidence: 0.39,
            sourceType: 'vetios',
            searchQuery: buildFindingQuery(species, disease, 'radiograph ultrasound diagnostic imaging findings'),
            wikimedia_query: buildFindingQuery(species, disease, 'veterinary radiograph ultrasound pathology'),
            pubmed_image_query: buildFindingQuery(species, disease, 'radiograph ultrasound diagnostic imaging figure'),
            idexx_relevant: false,
            clinical_note: 'Best modality depends on the affected system; repeat or advanced imaging is appropriate when survey views do not match the clinical picture.',
        },
        {
            id: 'cytology',
            label: 'Cytology & Haematology',
            description: localFindingDescription('cytology', disease, species),
            confidence: 0.37,
            sourceType: 'vetios',
            searchQuery: buildFindingQuery(species, disease, 'cytology haematology blood smear CBC cell morphology'),
            wikimedia_query: buildFindingQuery(species, disease, 'veterinary cytology haematology smear'),
            pubmed_image_query: buildFindingQuery(species, disease, 'cytology haematology blood smear figure'),
            idexx_relevant: true,
            clinical_note: 'CBC, pathologist smear review, cytology, PCR, serology, or culture should be selected from the suspected agent or lesion type.',
        },
    ];

    return { disease, species, findings, imagesByFinding: {}, researchSources: [] };
}

export default function DiseaseImagePanel({ messageContent, topic, queryText, messageId }: DiseaseImagePanelProps) {
    const localPayload = useMemo(() => localFindings(topic, messageContent, queryText), [messageContent, queryText, topic]);
    const [payload, setPayload] = useState<DiseaseImagePayload>(localPayload);
    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setPayload(localPayload);
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
                        disease: data.disease || localPayload.disease,
                        species: data.species || localPayload.species,
                        findings: Array.isArray(data.findings) && data.findings.length > 0 ? data.findings : localPayload.findings,
                        imagesByFinding: data.imagesByFinding ?? {},
                        imageProvider: data.imageProvider,
                        researchSources: Array.isArray(data.researchSources) ? data.researchSources : [],
                    });
                    setStatus('ready');
                }
            } catch {
                if (!cancelled) {
                    setPayload(localPayload);
                    setStatus('error');
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [localPayload, messageContent, messageId, queryText, topic]);

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
                            {status === 'loading' ? 'loading' : status === 'error' ? 'local' : 'live'}
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
                    Live clinical image enrichment could not be reached. Local visual descriptors and search queries are still provided for review.
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

                            {finding.clinical_note && (
                                <div className="border border-[#00ff88]/15 bg-[#00ff88]/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-[#b7ffd8]/80">
                                    Clinical note: {finding.clinical_note}
                                </div>
                            )}

                            <div className="grid gap-2 md:grid-cols-2">
                                <div className="rounded border border-white/8 bg-black/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
                                    Search: {finding.searchQuery}
                                </div>
                                <div className="rounded border border-white/8 bg-black/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
                                    Wikimedia: {finding.wikimedia_query || finding.searchQuery}
                                </div>
                                <div className="rounded border border-white/8 bg-black/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
                                    PubMed figures: {finding.pubmed_image_query || finding.searchQuery}
                                </div>
                                <div className="rounded border border-white/8 bg-black/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
                                    IDEXX/Antech: {finding.idexx_relevant ? 'relevant' : 'case dependent'}
                                </div>
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
