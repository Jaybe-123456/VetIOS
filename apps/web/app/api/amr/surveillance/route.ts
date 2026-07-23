import { NextResponse } from 'next/server';
import { aggregateAMRPatterns, type AMRSurveillanceRow } from '@/lib/amr/screener';
import {
    buildAMROneHealthExportPacket,
    normalizeOptionalAMRLabel,
    type AMRLabFeedSurveillanceEventRow,
} from '@/lib/amr/stewardship';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['signals:read'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: guard.requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const { searchParams } = new URL(req.url);
    const species = normalizeFilter(searchParams.get('species'));
    const region = normalizeRegion(searchParams.get('region'));
    const pathogenKey = normalizeOptionalAMRLabel(searchParams.get('pathogen_key'));
    const drugClass = normalizeOptionalAMRLabel(searchParams.get('drug_class'));
    const days = clampDays(Number(searchParams.get('days') ?? 90));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    let query = supabase
        .from('amr_genomic_events')
        .select('species, pathogen_label, region, resistance_genes, resistance_classes, novel_pattern_score, created_at')
        .eq('tenant_id', auth.actor.tenantId)
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
        .eq('tenant_id', auth.actor.tenantId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2_000);

    if (region) rnaQuery = rnaQuery.eq('region', region);

    const { data: rnaData } = await rnaQuery;
    let labFeedQuery = supabase
        .from('amr_lab_feed_surveillance_events')
        .select([
            'species',
            'pathogen_label',
            'pathogen_key',
            'infection_site',
            'sample_source',
            'drug_name',
            'drug_class',
            'lab_feed_status',
            'surveillance_score',
            'resistance_signal_score',
            'ast_panel_drug_count',
            'mic_result_count',
            'susceptibility_result_count',
            'resistance_gene_count',
            'resistance_class_count',
            'lab_partner_feed_ready',
            'one_health_export_ready',
            'trend_bucket_key',
            'source_record_digest',
            'packet_hash',
            'surveillance_packet',
            'blockers',
            'warnings',
            'observed_at',
        ].join(','))
        .eq('tenant_id', auth.actor.tenantId)
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(10_000);

    if (species) labFeedQuery = labFeedQuery.eq('species', species);
    if (pathogenKey) labFeedQuery = labFeedQuery.eq('pathogen_key', pathogenKey);
    if (drugClass) labFeedQuery = labFeedQuery.eq('drug_class', drugClass);

    const { data: labFeedData, error: labFeedError } = await labFeedQuery;
    const labFeedRows = (Array.isArray(labFeedData) ? labFeedData : []) as unknown as AMRLabFeedSurveillanceEventRow[];
    const labFeedPacket = labFeedError
        ? null
        : buildAMROneHealthExportPacket({
            rows: labFeedRows,
            periodStart: since,
            periodEnd: now,
            generatedAt: now,
        });
    const rows = (Array.isArray(data) ? data : []) as AMRSurveillanceRow[];
    const rnaRows = Array.isArray(rnaData) ? rnaData : [];
    return NextResponse.json({
        period: `last_${days}_days`,
        filters: {
            species,
            region,
            pathogen_key: pathogenKey,
            drug_class: drugClass,
        },
        genomic_surveillance: {
            total_samples: rows.length,
            patterns: aggregateAMRPatterns(rows),
        },
        novel_rna_structures: aggregateRNAPredictions(rnaRows),
        lab_feed_surveillance: labFeedPacket
            ? {
                export_status: labFeedPacket.export_status,
                summary: labFeedPacket.summary,
                trends: labFeedPacket.trends.slice(0, 25),
                provenance: labFeedPacket.provenance,
                blockers: labFeedPacket.blockers,
                warnings: labFeedPacket.warnings,
                next_actions: labFeedPacket.next_actions,
                privacy_contract: labFeedPacket.privacy_contract,
            }
            : null,
        lab_feed_warning: labFeedError
            ? `AMR lab-feed surveillance unavailable: ${labFeedError.message}`
            : null,
        total_samples: rows.length,
        patterns: aggregateAMRPatterns(rows),
        de_identified: true,
        last_updated: now,
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

function clampDays(value: number): number {
    if (!Number.isFinite(value)) return 90;
    return Math.min(365, Math.max(1, Math.round(value)));
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
