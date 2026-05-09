import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolvePMCFigures } from '@vetios/ask-vetios';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const FindingSchema = z.enum(['gross', 'histopathology', 'radiography', 'cytology']);
const ImageSourceSchema = z.enum(['pmc_oa', 'wikimedia', 'manual']);
const ManualImageSchema = z.object({
    title: z.string().trim().min(1).max(240),
    image_url: z.string().trim().url(),
    thumbnail_url: z.string().trim().url().optional(),
    page_url: z.string().trim().url().optional(),
    attribution: z.string().trim().min(1).max(500),
    license_type: z.string().trim().min(1).max(120),
    license_url: z.string().trim().url().optional(),
    quality_score: z.number().min(0).max(1).optional(),
});
const RequestSchema = z.object({
    source: ImageSourceSchema,
    species: z.string().trim().min(1).max(80),
    condition: z.string().trim().min(1).max(160),
    condition_code: z.string().trim().min(1).max(120).optional(),
    finding_type: FindingSchema,
    query: z.string().trim().max(400).optional(),
    limit: z.number().int().min(1).max(20).default(8),
    reviewed_by: z.string().trim().max(160).optional(),
    images: z.array(ManualImageSchema).optional(),
});

interface CandidateImage {
    title: string;
    imageUrl: string;
    thumbnailUrl: string;
    pageUrl: string;
    attribution: string;
    licenseType: string;
    licenseUrl: string | null;
    qualityScore: number;
}

export async function POST(req: Request) {
    const auth = authorizeOperator(req);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => null);
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid clinical image ingest request', details: parsed.error.flatten() }, { status: 400 });
    }

    const input = parsed.data;
    const candidates = await resolveCandidateImages(input);
    const supabase = getSupabaseServer();
    const condition = clinicalImageConditionCode(input.condition_code ?? input.condition);

    let inserted = 0;
    let skipped = 0;
    for (const image of candidates) {
        const exists = await existingImageId(supabase, {
            species: input.species,
            conditionCode: condition,
            findingType: input.finding_type,
            storagePath: image.imageUrl,
        });
        if (exists) {
            skipped += 1;
            continue;
        }

        const { error } = await supabase.from('clinical_image_library').insert({
            species: input.species,
            condition_code: condition,
            finding_type: input.finding_type,
            image_category: input.source,
            storage_path: image.imageUrl,
            thumbnail_path: image.thumbnailUrl,
            caption: image.title,
            attribution: image.attribution,
            license_type: image.licenseType,
            license_url: image.licenseUrl ?? image.pageUrl,
            quality_score: image.qualityScore,
            reviewed_by: input.reviewed_by ?? 'curation_pipeline',
            reviewed_at: new Date().toISOString(),
            active: true,
        });
        if (error) {
            return NextResponse.json({ error: error.message, image: image.title }, { status: 500 });
        }
        inserted += 1;
    }

    return NextResponse.json({
        status: 'ok',
        source: input.source,
        species: input.species,
        condition_code: condition,
        finding_type: input.finding_type,
        resolved: candidates.length,
        inserted,
        skipped,
    });
}

async function resolveCandidateImages(input: z.infer<typeof RequestSchema>): Promise<CandidateImage[]> {
    if (input.source === 'manual') {
        return (input.images ?? []).map((image) => ({
            title: image.title,
            imageUrl: image.image_url,
            thumbnailUrl: image.thumbnail_url ?? image.image_url,
            pageUrl: image.page_url ?? image.image_url,
            attribution: image.attribution,
            licenseType: image.license_type,
            licenseUrl: image.license_url ?? null,
            qualityScore: image.quality_score ?? 0.85,
        }));
    }

    const query = input.query || `${input.species} ${input.condition} ${input.finding_type} veterinary pathology`;
    if (input.source === 'pmc_oa') {
        const figures = await resolvePMCFigures(query, {
            retmax: input.limit,
            email: process.env.NCBI_TOOL_EMAIL,
            eutilsBaseUrl: process.env.VETIOS_PMC_EUTILS_BASE_URL,
        }).catch(() => []);
        return figures.map((figure) => ({
            title: figure.figure_caption || figure.article_title,
            imageUrl: figure.figure_url,
            thumbnailUrl: figure.figure_url,
            pageUrl: figure.pubmed_url || `https://www.ncbi.nlm.nih.gov/pmc/articles/${figure.pmcid}/`,
            attribution: [figure.pmid ? `PMID ${figure.pmid}` : '', figure.doi ? `DOI ${figure.doi}` : ''].filter(Boolean).join(' // ') || figure.journal,
            licenseType: figure.license || 'PMC Open Access',
            licenseUrl: figure.pubmed_url || null,
            qualityScore: 0.82,
        })).filter((image) => image.imageUrl && /^https?:\/\//i.test(image.imageUrl));
    }

    return searchWikimediaImages(query, input.limit);
}

async function searchWikimediaImages(query: string, limit: number): Promise<CandidateImage[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', String(limit));
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata');
    url.searchParams.set('iiurlwidth', '640');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];
    const data = (await response.json()) as {
        query?: {
            pages?: Record<string, {
                title?: string;
                imageinfo?: Array<{
                    url?: string;
                    thumburl?: string;
                    descriptionurl?: string;
                    extmetadata?: Record<string, { value?: string }>;
                }>;
            }>;
        };
    };
    return Object.values(data.query?.pages ?? {})
        .map((page): CandidateImage | null => {
            const image = page.imageinfo?.[0];
            if (!image?.url || !image.descriptionurl) return null;
            return {
                title: stripHtml(page.title ?? 'Wikimedia clinical image'),
                imageUrl: image.url,
                thumbnailUrl: image.thumburl ?? image.url,
                pageUrl: image.descriptionurl,
                attribution: stripHtml(image.extmetadata?.Artist?.value ?? image.extmetadata?.Credit?.value ?? 'Wikimedia Commons'),
                licenseType: stripHtml(image.extmetadata?.LicenseShortName?.value ?? 'Wikimedia Commons license'),
                licenseUrl: image.descriptionurl,
                qualityScore: 0.74,
            };
        })
        .filter((image): image is CandidateImage => image != null);
}

async function existingImageId(
    supabase: ReturnType<typeof getSupabaseServer>,
    input: {
        species: string;
        conditionCode: string;
        findingType: string;
        storagePath: string;
    },
) {
    const { data, error } = await supabase
        .from('clinical_image_library')
        .select('id')
        .eq('species', input.species)
        .eq('condition_code', input.conditionCode)
        .eq('finding_type', input.findingType)
        .eq('storage_path', input.storagePath)
        .limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.id ? String(data[0].id) : null;
}

function authorizeOperator(req: Request): { ok: true } | { ok: false; status: number; error: string } {
    const configured = process.env.VETIOS_INTERNAL_API_TOKEN?.trim();
    if (!configured) return { ok: false, status: 503, error: 'Operator token is not configured' };
    const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearer || !safeCompare(bearer, configured)) return { ok: false, status: 401, error: 'Unauthorized' };
    return { ok: true };
}

function safeCompare(a: string, b: string): boolean {
    try {
        const left = Buffer.from(a);
        const right = Buffer.from(b);
        return left.length === right.length && timingSafeEqual(left, right);
    } catch {
        return false;
    }
}

function clinicalImageConditionCode(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'condition';
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
