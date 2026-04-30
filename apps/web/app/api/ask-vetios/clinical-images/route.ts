import { NextResponse } from 'next/server';
import { z } from 'zod';
import { compactSearchTerms, detectSpeciesFromTexts, type DetectedVetiosSpecies } from '@/lib/askVetios/context';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
    topic: z.string().trim().optional(),
    messageContent: z.string().trim().min(1).max(12000),
    queryText: z.string().trim().max(4000).optional(),
});

type FindingId = 'gross' | 'histopathology' | 'radiography' | 'cytology';

interface ImageFinding {
    id: FindingId;
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

type ImageProvider = 'bing' | 'google_cse' | 'wikimedia';

interface ResearchSource {
    title: string;
    url: string;
    snippet: string;
    source: string;
    sourceType: 'wikipedia' | 'pubmed';
}

function detectDisease(topic: string | undefined, messageContent: string, queryText?: string) {
    if (topic?.trim()) return topic.trim();
    const queryDisease = queryText?.match(/\b(?:for|of|about)\s+([A-Za-z][A-Za-z\s-]{2,80})/i)?.[1]?.trim();
    if (queryDisease) return queryDisease;
    const firstSentence = messageContent.split(/[.!?]/)[0] ?? '';
    const match = firstSentence.match(/^([A-Z][^,.(]{2,80}?)(?:\s+(?:is|are|causes|results|presents)\b)/);
    return match?.[1]?.trim() || 'Current disease process';
}

function stripCodeFences(value: string) {
    return value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function buildFindingQuery(disease: string, species: DetectedVetiosSpecies, finding: string) {
    return compactSearchTerms([
        species === 'unknown' ? 'veterinary' : species,
        disease,
        finding,
    ]);
}

function buildFallbackFindings(disease: string, species: DetectedVetiosSpecies): ImageFinding[] {
    return [
        {
            id: 'gross',
            label: 'Gross Pathology',
            description: 'Gross lesion enrichment unavailable. Review external pathology references using the generated query.',
            confidence: 0.46,
            sourceType: 'fallback',
            searchQuery: buildFindingQuery(disease, species, 'gross pathology'),
        },
        {
            id: 'histopathology',
            label: 'Histopathology',
            description: 'Histopathology enrichment unavailable. Query tissue architecture patterns directly.',
            confidence: 0.42,
            sourceType: 'fallback',
            searchQuery: buildFindingQuery(disease, species, 'histopathology'),
        },
        {
            id: 'radiography',
            label: 'Radiographic Findings',
            description: 'Radiographic enrichment unavailable. Search representative imaging externally.',
            confidence: 0.39,
            sourceType: 'fallback',
            searchQuery: buildFindingQuery(disease, species, 'radiograph'),
        },
        {
            id: 'cytology',
            label: 'Cytology',
            description: 'Cytology enrichment unavailable. Search cytologic appearance references externally.',
            confidence: 0.37,
            sourceType: 'fallback',
            searchQuery: buildFindingQuery(disease, species, 'cytology'),
        },
    ];
}

async function fetchClaudeFindings(disease: string, species: DetectedVetiosSpecies, messageContent: string, queryText?: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
    if (!apiKey) return null;

    const prompt = [
        'You are VetIOS visual pathology support.',
        'Return only valid JSON with this exact shape:',
        '{"findings":[{"id":"gross"|"histopathology"|"radiography"|"cytology","label":"string","description":"string","confidence":0.0,"sourceType":"claude","searchQuery":"string"}]}',
        `Disease: ${disease}`,
        `Species: ${species}`,
        `Current Ask VetIOS query: ${queryText ?? 'not supplied'}`,
        `Context: ${messageContent.slice(0, 6000)}`,
        'Each description should explain what the disease looks like visually in this species.',
        'Keep descriptions concrete and clinically useful.',
    ].join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1200,
            temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        throw new Error(`Anthropic request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((item) => item.type === 'text')?.text;
    if (!text) return null;

    const parsed = JSON.parse(stripCodeFences(text)) as { findings?: ImageFinding[] };
    return Array.isArray(parsed.findings) ? parsed.findings : null;
}

async function searchWikimediaImages(query: string): Promise<ReferenceImage[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', '2');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata');
    url.searchParams.set('iiurlwidth', '480');

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];

    const data = (await response.json()) as {
        query?: {
            pages?: Record<string, {
                title?: string;
                imageinfo?: Array<{
                    thumburl?: string;
                    descriptionurl?: string;
                    url?: string;
                    extmetadata?: {
                        LicenseShortName?: { value?: string };
                        Artist?: { value?: string };
                        Credit?: { value?: string };
                    };
                }>;
            }>;
        };
    };

    return Object.values(data.query?.pages ?? {})
        .map((page): ReferenceImage | null => {
            const image = page.imageinfo?.[0];
            if (!image?.thumburl || !image.descriptionurl) return null;
            return {
                title: page.title ?? 'Reference image',
                thumbnailUrl: image.thumburl,
                pageUrl: image.descriptionurl,
                source: 'Wikimedia Commons',
                license: stripHtml(image.extmetadata?.LicenseShortName?.value ?? ''),
                attribution: stripHtml(image.extmetadata?.Artist?.value ?? image.extmetadata?.Credit?.value ?? ''),
            };
        })
        .filter((item): item is ReferenceImage => item !== null && isLikelyClinicalImage(item));
}

async function searchBingImages(query: string): Promise<ReferenceImage[]> {
    const apiKey = process.env.BING_IMAGE_SEARCH_API_KEY;
    if (!apiKey) return [];

    const endpoint = process.env.BING_IMAGE_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/images/search';
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', '3');
    url.searchParams.set('safeSearch', 'Moderate');
    url.searchParams.set('imageType', 'Photo');

    const response = await fetch(url.toString(), {
        cache: 'no-store',
        headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
        },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
        value?: Array<{
            name?: string;
            thumbnailUrl?: string;
            hostPageUrl?: string;
            hostPageDisplayUrl?: string;
        }>;
    };

    return (data.value ?? [])
        .map((image) => {
            if (!image.thumbnailUrl || !image.hostPageUrl) return null;
            return {
                title: image.name ?? 'Reference image',
                thumbnailUrl: image.thumbnailUrl,
                pageUrl: image.hostPageUrl,
                source: image.hostPageDisplayUrl ? `Bing // ${image.hostPageDisplayUrl}` : 'Bing Image Search',
            };
        })
        .filter(isLikelyClinicalImage)
        .filter((item): item is ReferenceImage => item !== null);
}

async function searchGoogleCseImages(query: string): Promise<ReferenceImage[]> {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_ID;
    if (!apiKey || !cx) return [];

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('searchType', 'image');
    url.searchParams.set('num', '3');
    url.searchParams.set('safe', 'active');

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];

    const data = (await response.json()) as {
        items?: Array<{
            title?: string;
            link?: string;
            image?: {
                thumbnailLink?: string;
                contextLink?: string;
            };
            displayLink?: string;
        }>;
    };

    return (data.items ?? [])
        .map((image) => {
            const thumbnailUrl = image.image?.thumbnailLink;
            const pageUrl = image.image?.contextLink || image.link;
            if (!thumbnailUrl || !pageUrl) return null;
            return {
                title: image.title ?? 'Reference image',
                thumbnailUrl,
                pageUrl,
                source: image.displayLink ? `Google CSE // ${image.displayLink}` : 'Google Custom Search',
            };
        })
        .filter(isLikelyClinicalImage)
        .filter((item): item is ReferenceImage => item !== null);
}

function resolveImageProvider(): ImageProvider {
    if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID) return 'google_cse';
    if (process.env.BING_IMAGE_SEARCH_API_KEY) return 'bing';
    return 'wikimedia';
}

async function searchConfiguredImages(query: string): Promise<ReferenceImage[]> {
    // Try Google CSE if configured
    if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID) {
        try {
            const results = await searchGoogleCseImages(query);
            if (results.length > 0) return results;
        } catch (error) {
            console.error('Google CSE search failed:', error);
        }
    }

    // Try Bing Image Search if configured
    if (process.env.BING_IMAGE_SEARCH_API_KEY) {
        try {
            const results = await searchBingImages(query);
            if (results.length > 0) return results;
        } catch (error) {
            console.error('Bing Image Search failed:', error);
        }
    }

    // Always fallback to Wikimedia Commons
    return searchWikimediaImages(query);
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function isLikelyClinicalImage(image: ReferenceImage | null): image is ReferenceImage {
    if (!image) return false;
    const haystack = `${image.title} ${image.source}`.toLowerCase();
    const blocked = ['logo', 'map', 'flag', 'book cover', 'pesticides documentation', 'reporter (philadelphia)'];
    return !blocked.some((term) => haystack.includes(term));
}

function buildResearchQuery(disease: string, species: DetectedVetiosSpecies, queryText?: string) {
    return compactSearchTerms([
        queryText,
        species === 'unknown' ? 'veterinary' : species,
        disease,
    ]);
}

async function searchWikipediaSources(query: string): Promise<ResearchSource[]> {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', '4');

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];

    const data = (await response.json()) as {
        query?: {
            search?: Array<{ title?: string; snippet?: string }>;
        };
    };

    return (data.query?.search ?? [])
        .filter((item) => item.title)
        .map((item) => ({
            title: item.title ?? 'Wikipedia result',
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent((item.title ?? '').replace(/\s+/g, '_'))}`,
            snippet: stripHtml(item.snippet ?? ''),
            source: 'Wikipedia',
            sourceType: 'wikipedia' as const,
        }));
}

async function searchPubMedSources(query: string): Promise<ResearchSource[]> {
    const searchUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
    searchUrl.searchParams.set('db', 'pubmed');
    searchUrl.searchParams.set('term', compactSearchTerms([query, 'veterinary']));
    searchUrl.searchParams.set('retmode', 'json');
    searchUrl.searchParams.set('retmax', '4');
    searchUrl.searchParams.set('sort', 'relevance');
    searchUrl.searchParams.set('tool', 'VetIOS');
    if (process.env.NCBI_TOOL_EMAIL) {
        searchUrl.searchParams.set('email', process.env.NCBI_TOOL_EMAIL);
    }

    const searchResponse = await fetch(searchUrl.toString(), { cache: 'no-store' });
    if (!searchResponse.ok) return [];

    const searchData = (await searchResponse.json()) as {
        esearchresult?: { idlist?: string[] };
    };
    const ids = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const summaryUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
    summaryUrl.searchParams.set('db', 'pubmed');
    summaryUrl.searchParams.set('id', ids.join(','));
    summaryUrl.searchParams.set('retmode', 'json');
    summaryUrl.searchParams.set('tool', 'VetIOS');
    if (process.env.NCBI_TOOL_EMAIL) {
        summaryUrl.searchParams.set('email', process.env.NCBI_TOOL_EMAIL);
    }

    const summaryResponse = await fetch(summaryUrl.toString(), { cache: 'no-store' });
    if (!summaryResponse.ok) return [];

    const summaryData = (await summaryResponse.json()) as {
        result?: Record<string, { title?: string; source?: string; pubdate?: string } | string[]>;
    };

    return ids
        .map((id): ResearchSource | null => {
            const result = summaryData.result?.[id];
            if (!result || Array.isArray(result)) return null;
            return {
                title: result.title ?? `PubMed ${id}`,
                url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
                snippet: compactSearchTerms([result.source, result.pubdate]),
                source: 'PubMed',
                sourceType: 'pubmed' as const,
            };
        })
        .filter((item): item is ResearchSource => item !== null);
}

async function resolveResearchSources(disease: string, species: DetectedVetiosSpecies, queryText?: string) {
    const query = buildResearchQuery(disease, species, queryText);
    const [wikipedia, pubmed] = await Promise.all([
        searchWikipediaSources(query),
        searchPubMedSources(query),
    ]);
    return [...wikipedia, ...pubmed].slice(0, 8);
}

export async function POST(req: Request) {
    try {
        const parsed = RequestSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
        }

        const { topic, messageContent, queryText } = parsed.data;
        const species = detectSpeciesFromTexts([queryText, topic, messageContent]);
        const disease = detectDisease(topic, messageContent, queryText);

        let findings = buildFallbackFindings(disease, species);

        try {
            const claudeFindings = await fetchClaudeFindings(disease, species, messageContent, queryText);
            if (claudeFindings?.length) {
                findings = claudeFindings;
            }
        } catch {
            // Fall back silently to deterministic findings.
        }

        const imagesByFinding: Record<string, ReferenceImage[]> = {};
        await Promise.all(
            findings.map(async (finding) => {
                imagesByFinding[finding.id] = await searchConfiguredImages(finding.searchQuery);
            }),
        );
        const researchSources = await resolveResearchSources(disease, species, queryText);

        return NextResponse.json({
            disease,
            species,
            findings,
            imagesByFinding,
            imageProvider: resolveImageProvider(),
            researchSources,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Clinical image enrichment failed' },
            { status: 500 },
        );
    }
}
