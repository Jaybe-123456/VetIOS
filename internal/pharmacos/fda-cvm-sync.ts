import { createClient } from '@supabase/supabase-js';
import { drugFormularyRecordSchema, type DrugFormularyRecord } from '@vetios/pharmacos';

const FDA_SYNC_URL = process.env.VETIOS_PHARMACOS_FDA_SYNC_URL
    ?? 'https://www.fda.gov/animal-veterinary/new-animal-drug-approvals';

async function main() {
    if (process.env.VETIOS_PHARMACOS_FDA_SYNC_ENABLED === 'false') return;
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    const html = await fetch(FDA_SYNC_URL, { cache: 'no-store' }).then((response) => response.text());
    const approvals = parseApprovals(html).slice(0, 50);
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const autoPublish = process.env.VETIOS_PHARMACOS_AUTO_PUBLISH_UPDATES === 'true'
        || process.env.VETIOS_PHARMACOS_FORMULARY_AUTO_UPDATE === 'true';

    for (const approval of approvals) {
        const draft = buildDraftRecord(approval);
        if (autoPublish) {
            await supabase.from('drug_formulary').insert(draft).throwOnError();
        } else {
            await supabase.from('drug_formulary_review_queue').insert({
                update_type: 'new_drug',
                drug_name: draft.drug_name,
                draft_record: draft,
                regulatory_reference: approval.url,
                effective_date: approval.date ?? null,
                created_by: 'fda_sync',
            }).throwOnError();
        }
    }
}

function parseApprovals(html: string) {
    return Array.from(html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]*(?:approval|approved|animal drug)[^<]*)<\/a>/gi))
        .map((match) => ({
            title: stripHtml(match[2] ?? '').slice(0, 180),
            url: absolutize(match[1] ?? ''),
            date: (match.input?.slice(Math.max(0, match.index - 200), match.index + 200).match(/\b20\d{2}-\d{2}-\d{2}\b/) ?? [null])[0],
        }))
        .filter((item, index, list) => item.title && list.findIndex((other) => other.url === item.url) === index);
}

function buildDraftRecord(approval: { title: string; url: string }): DrugFormularyRecord {
    const name = approval.title.replace(/\b(new animal drug approval|approval|approved)\b/gi, '').trim() || approval.title;
    return drugFormularyRecordSchema.parse({
        drug_name: name,
        brand_names: [],
        drug_class: 'Pending operator classification',
        drug_class_code: 'PENDING_REVIEW',
        primary_indication: 'Pending FDA-CVM operator review',
        indication_codes: ['pending_review'],
        species_dosing: [],
        withdrawal_periods: [],
        organ_adjustments: {},
        contraindications: [],
        pk_profiles: {},
        monitoring: [],
        adverse_effects: [],
        compounding: {},
        fda_cvm_approved_species: [],
        primary_reference: approval.url,
        secondary_references: [FDA_SYNC_URL],
        formulary_version: 1,
        update_source: 'fda_label_sync',
        active: false,
    });
}

function stripHtml(value: string) {
    return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function absolutize(href: string) {
    if (/^https?:\/\//i.test(href)) return href;
    return `https://www.fda.gov${href.startsWith('/') ? href : `/${href}`}`;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
