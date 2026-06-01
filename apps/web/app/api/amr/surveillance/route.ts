import { NextResponse } from 'next/server';
import { aggregateAMRPatterns, type AMRSurveillanceRow } from '@/lib/amr/screener';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const species = normalizeFilter(searchParams.get('species'));
    const region = normalizeRegion(searchParams.get('region'));
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = getSupabaseServer();

    let query = supabase
        .from('amr_genomic_events')
        .select('species, pathogen_label, region, resistance_genes, resistance_classes, novel_pattern_score, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10_000);

    if (species) query = query.eq('species', species);
    if (region) query = query.eq('region', region);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: 'surveillance_data_unavailable' }, { status: 503 });
    }

    let rnaQuery = supabase
        .from('rna_folding_events')
        .select('pathogen_label, region, sequence_length, wfsg_node_count, secondary_structure, mcc_score, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2_000);

    if (region) rnaQuery = rnaQuery.eq('region', region);

    const { data: rnaData } = await rnaQuery;
    const rows = (Array.isArray(data) ? data : []) as AMRSurveillanceRow[];
    const rnaRows = Array.isArray(rnaData) ? rnaData : [];
    return NextResponse.json({
        period: 'last_90_days',
        total_samples: rows.length,
        patterns: aggregateAMRPatterns(rows),
        novel_rna_structures: aggregateRNAPredictions(rnaRows),
        last_updated: new Date().toISOString(),
        error: null,
    });
}

function normalizeFilter(value: string | null): string | null {
    const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized || null;
}

function normalizeRegion(value: string | null): string | null {
    const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    return normalized || null;
}

function aggregateRNAPredictions(rows: unknown[]) {
    const grouped = new Map<string, {
        pathogen_label: string;
        region: string | null;
        samples: number;
        average_mcc_score: number | null;
        latest_secondary_structure: string | null;
        latest_observed_at: string | null;
    }>();

    for (const row of rows) {
        const record = row as Record<string, unknown>;
        const pathogenLabel = String(record.pathogen_label ?? 'unknown');
        const rowRegion = typeof record.region === 'string' ? record.region : null;
        const key = `${pathogenLabel}:${rowRegion ?? 'global'}`;
        const existing = grouped.get(key) ?? {
            pathogen_label: pathogenLabel,
            region: rowRegion,
            samples: 0,
            average_mcc_score: null,
            latest_secondary_structure: null,
            latest_observed_at: null,
        };

        existing.samples += 1;
        const mcc = typeof record.mcc_score === 'number' ? record.mcc_score : null;
        if (mcc != null) {
            const current = existing.average_mcc_score ?? 0;
            existing.average_mcc_score = ((current * (existing.samples - 1)) + mcc) / existing.samples;
        }
        if (!existing.latest_observed_at || String(record.created_at ?? '') > existing.latest_observed_at) {
            existing.latest_secondary_structure = typeof record.secondary_structure === 'string'
                ? record.secondary_structure
                : null;
            existing.latest_observed_at = typeof record.created_at === 'string' ? record.created_at : null;
        }
        grouped.set(key, existing);
    }

    return Array.from(grouped.values())
        .map((item) => ({
            ...item,
            average_mcc_score: item.average_mcc_score == null
                ? null
                : Math.round(item.average_mcc_score * 10_000) / 10_000,
        }))
        .sort((left, right) => right.samples - left.samples);
}
