import { createClient } from '@supabase/supabase-js';
import { resolvePMCFigures } from '@vetios/ask-vetios';

async function main() {
    const args = new URLSearchParams(process.argv.slice(2).join('&'));
    const species = args.get('species') ?? process.env.VETIOS_IMAGE_INGEST_SPECIES ?? 'equine';
    const condition = args.get('condition') ?? process.env.VETIOS_IMAGE_INGEST_CONDITION ?? 'rift valley fever';
    const findingType = args.get('finding_type') ?? process.env.VETIOS_IMAGE_INGEST_FINDING_TYPE ?? 'gross_pathology';
    const figures = await resolvePMCFigures(`${species} ${condition} ${findingType} veterinary pathology`, {
        retmax: 10,
        email: process.env.NCBI_TOOL_EMAIL,
        eutilsBaseUrl: process.env.VETIOS_PMC_EUTILS_BASE_URL,
    });
    const supabase = createSupabaseClient();
    const bucket = process.env.VETIOS_CLINICAL_IMAGES_CURATED_BUCKET ?? 'vetios-clinical-images';

    for (const figure of figures) {
        const bytes = await fetch(figure.figure_url).then((response) => response.arrayBuffer());
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
            caption: figure.figure_caption || figure.article_title,
            attribution: `PMC OA ${figure.pmcid}${figure.pmid ? ` // PMID ${figure.pmid}` : ''}${figure.doi ? ` // DOI ${figure.doi}` : ''}`,
            license_type: normalizeLicense(figure.license),
            license_url: figure.pubmed_url,
            quality_score: 0.7,
            active: false,
        }).throwOnError();
    }
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

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
