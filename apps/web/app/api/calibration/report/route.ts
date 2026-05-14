import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const species = url.searchParams.get('species')?.trim().toLowerCase();
    const reportTenantId = process.env.VETIOS_PLATFORM_TENANT_ID || auth.actor.tenantId;

    let query = supabase
        .from('calibration_drift_reports')
        .select('*')
        .eq('tenant_id', reportTenantId);

    if (species) {
        query = query.eq('species', species);
    }

    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        return NextResponse.json(
            { error: 'calibration_report_failed', detail: error.message },
            { status: 500 },
        );
    }

    const latestByCluster = new Map<string, Record<string, unknown>>();
    for (const row of data ?? []) {
        const record = row as Record<string, unknown>;
        const key = `${record.species}:${record.symptom_cluster}`;
        if (!latestByCluster.has(key)) {
            latestByCluster.set(key, record);
        }
    }

    const reports = Array.from(latestByCluster.values());

    return NextResponse.json({
        data: {
            reports,
            alert_count: reports.filter((row) => row.alert === true).length,
            report_tenant_id: reportTenantId,
        },
        meta: {
            timestamp: new Date().toISOString(),
        },
    });
}
