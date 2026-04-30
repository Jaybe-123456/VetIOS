import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
    topic: z.string().trim().optional(),
    messageContent: z.string().trim().min(1).max(12000),
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
}

type ImageProvider = 'bing' | 'google_cse' | 'wikimedia';

function detectSpecies(content: string) {
    const lower = content.toLowerCase();
    if (/\bfeline|cat|kitten\b/.test(lower)) return 'feline';
    if (/\bequine|horse|foal\b/.test(lower)) return 'equine';
    if (/\bbovine|cow|cattle|calf\b/.test(lower)) return 'bovine';
    if (/\bavian|bird|chicken|parrot|psittacine\b/.test(lower)) return 'avian';
    if (/\bporcine|pig|swine|piglet\b/.test(lower)) return 'porcine';
    if (/\bovine|sheep|lamb\b/.test(lower)) return 'ovine';
    return 'canine';
}

function detectDisease(topic: string | undefined, messageContent: string) {
    if (topic?.trim()) return topic.trim();
    const firstSentence = messageContent.split(/[.!?]/)[0] ?? '';
    const match = firstSentence.match(/^([A-Z][^,.(]{2,80}?)(?:\s+(?:is|are|causes|results|presents)\b)/);
    return match?.[1]?.trim() || 'Current disease process';
}

function stripCodeFences(value: string) {
    return value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function buildFallbackFindings(disease: string, species: string): ImageFinding[] {
    return [
        {
            id: 'gross',
            label: 'Gross Pathology',
            description: 'Gross lesion enrichment unavailable. Review external pathology references using the generated query.',
            confidence: 0.46,
            sourceType: 'fallback',
            searchQuery: `${species} ${disease} gross pathology`,
        },
        {
            id: 'histopathology',
            label: 'Histopathology',
            description: 'Histopathology enrichment unavailable. Query tissue architecture patterns directly.',
            confidence: 0.42,
            sourceType: 'fallback',
            searchQuery: `${species} ${disease} histopathology`,
        },
        {
            id: 'radiography',
            label: 'Radiographic Findings',
            description: 'Radiographic enrichment unavailable. Search representative imaging externally.',
            confidence: 0.39,
            sourceType: 'fallback',
            searchQuery: `${species} ${disease} radiograph`,
        },
        {
            id: 'cytology',
            label: 'Cytology',
            description: 'Cytology enrichment unavailable. Search cytologic appearance references externally.',
            confidence: 0.37,
            sourceType: 'fallback',
            searchQuery: `${species} ${disease} cytology`,
        },
    ];
}

async function fetchClaudeFindings(disease: string, species: string, messageContent: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
    if (!apiKey) return null;

    const prompt = [
        'You are VetIOS visual pathology support.',
        'Return only valid JSON with this exact shape:',
        '{"findings":[{"id":"gross"|"histopathology"|"radiography"|"cytology","label":"string","description":"string","confidence":0.0,"sourceType":"claude","searchQuery":"string"}]}',
        `Disease: ${disease}`,
        `Species: ${species}`,
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
    url.searchParams.set('iiprop', 'url');
    url.searchParams.set('iiurlwidth', '480');

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];

    const data = (await response.json()) as {
        query?: {
            pages?: Record<string, {
                title?: string;
                imageinfo?: Array<{ thumburl?: string; descriptionurl?: string; url?: string }>;
            }>;
        };
    };

    return Object.values(data.query?.pages ?? {})
        .map((page) => {
            const image = page.imageinfo?.[0];
            if (!image?.thumburl || !image.descriptionurl) return null;
            return {
                title: page.title ?? 'Reference image',
                thumbnailUrl: image.thumburl,
                pageUrl: image.descriptionurl,
                source: 'Wikimedia Commons',
            };
        })
        .filter((item): item is ReferenceImage => item !== null);
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
        .filter((item): item is ReferenceImage => item !== null);
}

function resolveImageProvider(): ImageProvider {
    if (process.env.BING_IMAGE_SEARCH_API_KEY) return 'bing';
    if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID) return 'google_cse';
    return 'wikimedia';
}

async function searchConfiguredImages(query: string): Promise<ReferenceImage[]> {
    const provider = resolveImageProvider();

    if (provider === 'bing') {
        const results = await searchBingImages(query);
        if (results.length > 0) return results;
    }

    if (provider === 'google_cse') {
        const results = await searchGoogleCseImages(query);
        if (results.length > 0) return results;
    }

    return searchWikimediaImages(query);
}

export async function POST(req: Request) {
    try {
        const parsed = RequestSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
        }

        const { topic, messageContent } = parsed.data;
        const species = detectSpecies(messageContent);
        const disease = detectDisease(topic, messageContent);

        let findings = buildFallbackFindings(disease, species);

        try {
            const claudeFindings = await fetchClaudeFindings(disease, species, messageContent);
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

        return NextResponse.json({
            disease,
            species,
            findings,
            imagesByFinding,
            imageProvider: resolveImageProvider(),
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Clinical image enrichment failed' },
            { status: 500 },
        );
    }
}
