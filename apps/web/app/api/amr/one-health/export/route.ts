import { NextResponse } from 'next/server';
import { buildRouteAuthorizationContext } from '@/lib/auth/authorization';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { enforceVetiosClinicalActorGate, enforceVetiosHighRiskRouteGate } from '@/lib/auth/authTrustRouteGate';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import {
    buildAMROneHealthExportPacket,
    normalizeOptionalAMRLabel,
    type AMRLabFeedSurveillanceEventRow,
} from '@/lib/amr/stewardship';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 40, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

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
    const trustGate = auth.actor.authMode === 'session'
        ? await enforceSessionExportGate(req, requestId, startTime, {
            species,
            pathogenKey,
            drugClass,
            exportReadyOnly,
        })
        : await enforceVetiosClinicalActorGate({
            client: supabase as unknown as Parameters<typeof enforceVetiosClinicalActorGate>[0]['client'],
            requestId,
            actor: auth.actor,
            actionKey: 'surveillance.cross_tenant.export',
            resource: {
                type: 'amr_one_health_export',
                id: `${species ?? 'all'}:${pathogenKey ?? 'all'}:${drugClass ?? 'all'}`,
                tenantId: auth.actor.tenantId,
            },
            evidence: {
                route: 'api/amr/one-health/export',
                days,
                species,
                pathogen_key: pathogenKey,
                drug_class: drugClass,
                export_ready_only: exportReadyOnly,
            },
        });
    if (!trustGate.ok) {
        withRequestHeaders(trustGate.response.headers, requestId, startTime);
        return trustGate.response;
    }

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

async function enforceSessionExportGate(
    req: Request,
    requestId: string,
    _startTime: number,
    evidence: {
        species: string | null;
        pathogenKey: string | null;
        drugClass: string | null;
        exportReadyOnly: boolean;
    },
) {
    const session = await resolveSessionTenant();
    if (!session) {
        return {
            ok: false as const,
            packet: null as never,
            response: NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
        };
    }
    const actor = resolveRequestActor(session);
    const context = buildRouteAuthorizationContext({
        tenantId: actor.tenantId,
        userId: actor.userId,
        authMode: 'session',
        user: (await session.supabase.auth.getUser()).data.user ?? null,
    });
    return enforceVetiosHighRiskRouteGate({
        client: getSupabaseServer() as unknown as Parameters<typeof enforceVetiosHighRiskRouteGate>[0]['client'],
        requestId,
        context,
        actionKey: 'surveillance.cross_tenant.export',
        resource: {
            type: 'amr_one_health_export',
            id: `${evidence.species ?? 'all'}:${evidence.pathogenKey ?? 'all'}:${evidence.drugClass ?? 'all'}`,
            tenantId: context.tenantId,
        },
        evidence: {
            route: 'api/amr/one-health/export',
            days: Number(new URL(req.url).searchParams.get('days') ?? 90),
            species: evidence.species,
            pathogen_key: evidence.pathogenKey,
            drug_class: evidence.drugClass,
            export_ready_only: evidence.exportReadyOnly,
        },
    });
}

function clampDays(value: number): number {
    if (!Number.isFinite(value)) return 90;
    return Math.min(365, Math.max(1, Math.round(value)));
}
