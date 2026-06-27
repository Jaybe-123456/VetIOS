import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import {
    buildAMROneHealthExportPacket,
    normalizeOptionalAMRLabel,
    type AMRLabFeedSurveillanceEventRow,
} from '@/lib/amr/stewardship';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 40, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const days = clampDays(Number(searchParams.get('days') ?? 90));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const species = normalizeOptionalAMRLabel(searchParams.get('species'));
    const pathogenKey = normalizeOptionalAMRLabel(searchParams.get('pathogen_key'));
    const drugClass = normalizeOptionalAMRLabel(searchParams.get('drug_class'));
    const exportReadyOnly = searchParams.get('export_ready_only') === 'true';

    let query = supabase
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

    if (species) query = query.eq('species', species);
    if (pathogenKey) query = query.eq('pathogen_key', pathogenKey);
    if (drugClass) query = query.eq('drug_class', drugClass);
    if (exportReadyOnly) query = query.eq('one_health_export_ready', true);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json(
            { error: 'amr_one_health_export_unavailable', detail: error.message },
            { status: 503 },
        );
    }

    const rows = (Array.isArray(data) ? data : []) as unknown as AMRLabFeedSurveillanceEventRow[];
    const packet = buildAMROneHealthExportPacket({
        rows,
        periodStart: since,
        periodEnd: new Date().toISOString(),
    });

    return NextResponse.json({
        period: `last_${days}_days`,
        filters: {
            species,
            pathogen_key: pathogenKey,
            drug_class: drugClass,
            export_ready_only: exportReadyOnly,
        },
        one_health_export: packet,
        de_identified: true,
        error: null,
    });
}

function clampDays(value: number): number {
    if (!Number.isFinite(value)) return 90;
    return Math.min(365, Math.max(1, Math.round(value)));
}
