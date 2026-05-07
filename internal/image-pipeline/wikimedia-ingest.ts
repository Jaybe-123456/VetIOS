import { createClient } from '@supabase/supabase-js';

interface WikimediaImage {
    title: string;
    imageUrl: string;
    pageUrl: string;
    license: string;
    attribution: string;
}

async function main() {
    const args = new URLSearchParams(process.argv.slice(2).join('&'));
    const species = args.get('species') ?? process.env.VETIOS_IMAGE_INGEST_SPECIES ?? 'equine';
    const condition = args.get('condition') ?? process.env.VETIOS_IMAGE_INGEST_CONDITION ?? 'rift valley fever';
    const findingType = args.get('finding_type') ?? process.env.VETIOS_IMAGE_INGEST_FINDING_TYPE ?? 'gross_pathology';
    const images = await searchWikimedia(`${species} ${condition} ${findingType} veterinary pathology`);
    const supabase = createSupabaseClient();
    const bucket = process.env.VETIOS_CLINICAL_IMAGES_CURATED_BUCKET ?? 'vetios-clinical-images';

    for (const image of images) {
        const bytes = await fetch(image.imageUrl).then((response) => response.arrayBuffer());
        const id = crypto.randomUUID();
        const basePath = `clinical-images/${species}/${conditionCode(condition)}/${findingType}/${id}.jpg`;
        await supabase.storage.from(bucket).upload(basePath, bytes, { contentType: 'image/jpeg', upsert: true });
        await supabase.from('clinical_image_library').insert({
            species,
            condition_code: conditionCode(condition),
            finding_type: findingType,
            image_category: 'licensed_third_party',
            storage_path: basePath,
            thumbnail_path: basePath,
            caption: image.title,
            attribution: `${image.attribution} // ${image.pageUrl}`,
            license_type: normalizeLicense(image.license),
            license_url: image.pageUrl,
            quality_score: 0.7,
            active: false,
        }).throwOnError();
    }
}

async function searchWikimedia(query: string): Promise<WikimediaImage[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', '10');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata|size');
    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json() as {
        query?: {
            pages?: Record<string, {
                title?: string;
                imageinfo?: Array<{
                    url?: string;
                    descriptionurl?: string;
                    width?: number;
                    height?: number;
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
        .map((page) => {
            const info = page.imageinfo?.[0];
            if (!info?.url || !info.descriptionurl) return null;
            if ((info.width ?? 0) < 800 || (info.height ?? 0) < 600) return null;
            const license = stripHtml(info.extmetadata?.LicenseShortName?.value ?? '');
            if (/no.?deriv/i.test(license)) return null;
            return {
                title: page.title ?? 'Wikimedia reference image',
                imageUrl: info.url,
                pageUrl: info.descriptionurl,
                license,
                attribution: stripHtml(info.extmetadata?.Artist?.value ?? info.extmetadata?.Credit?.value ?? 'Wikimedia Commons'),
            };
        })
        .filter((image): image is WikimediaImage => image != null);
}

function createSupabaseClient() {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return createClient(url, key, { auth: { persistSession: false } });
}

function conditionCode(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'condition';
}

function normalizeLicense(value: string) {
    const lower = value.toLowerCase();
    if (lower.includes('cc-by-sa')) return 'cc_by_sa';
    if (lower.includes('cc-by')) return 'cc_by';
    if (lower.includes('public domain')) return 'public_domain';
    return 'licensed_third_party';
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
